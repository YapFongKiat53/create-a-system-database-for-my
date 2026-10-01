import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { getSessionUser, permissionsForRole } from "../../../db/auth";
import {
  billingCycles,
  billingInvoices,
  billingPaymentRecords,
  maintenanceTickets,
  storedAttachments,
  ticketMessages,
} from "../../../db/schema";

// Files (payment slips, etc.) live in Supabase Storage rather than the
// database itself — same project as DATABASE_URL, just the object-storage
// side instead of Postgres. Talked to directly over its REST API rather than
// the @supabase/supabase-js client, since these are three plain fetch calls
// and pulling in a client SDK for that would be pure overhead.
const BUCKET = "Bill";

function getStorageConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("File storage is not available yet");
  return { url, key };
}

function authHeaders(key:string, extra?:Record<string,string>) {
  return { Authorization:`Bearer ${key}`, apikey:key, ...extra };
}

/**
 * Whether a tenant (identified by their studentId) is allowed to read/write
 * an attachment filed under `contextType`/`recordId`. This mirrors — on
 * purpose, exactly — the tenant-scoping rule `GET /api/system` already
 * applies to `attachments:` inside its `currentUser?.roleKey === "tenant"`
 * branch: own tickets, own ticket-update messages, own (non-draft-cycle)
 * payment proofs. Do not diverge from that rule here; if it changes, mirror
 * the change in both places.
 */
async function tenantOwnsContext(
  db: ReturnType<typeof getDb>,
  studentId: number,
  contextType: string,
  recordId: number,
): Promise<boolean> {
  if (contextType === "ticket") {
    const row = (
      await db
        .select({ studentId: maintenanceTickets.studentId })
        .from(maintenanceTickets)
        .where(eq(maintenanceTickets.id, recordId))
    )[0];
    return row?.studentId === studentId;
  }
  if (contextType === "ticket-update") {
    const row = (
      await db
        .select({ studentId: maintenanceTickets.studentId })
        .from(ticketMessages)
        .innerJoin(
          maintenanceTickets,
          eq(ticketMessages.ticketId, maintenanceTickets.id),
        )
        .where(eq(ticketMessages.id, recordId))
    )[0];
    return row?.studentId === studentId;
  }
  if (contextType === "payment-proof") {
    const row = (
      await db
        .select({
          studentId: billingInvoices.studentId,
          cycleId: billingInvoices.cycleId,
          cycleStatus: billingCycles.status,
        })
        .from(billingPaymentRecords)
        .innerJoin(
          billingInvoices,
          eq(billingPaymentRecords.invoiceId, billingInvoices.id),
        )
        .leftJoin(billingCycles, eq(billingInvoices.cycleId, billingCycles.id))
        .where(eq(billingPaymentRecords.id, recordId))
    )[0];
    if (!row || row.studentId !== studentId) return false;
    // Same rule as the /api/system tenant branch's `draftCycleIds`/
    // `ownInvoiceIds`: a cycle invoice still in draft hasn't been reviewed
    // by Accounts yet, so a tenant can't see it — or its payment proof —
    // even if it's theirs. Move-in invoices (no cycleId) are exempt.
    if (row.cycleId && row.cycleStatus === "draft") return false;
    return true;
  }
  return false;
}

// Which module a staff member needs view access to for each kind of file.
// Staff used to be able to open, rename or delete ANY attachment by id, so a
// technician could walk the ids and read every payment slip and tenancy
// agreement. A context not listed here is refused for staff (fail closed).
const STAFF_CONTEXT_MODULES: Record<string, string[]> = {
  "payment-proof": ["finance", "hostels-sales"],
  agreement: ["units-owner"],
  room: ["units-general"],
  ticket: ["maintenance"],
  "ticket-update": ["maintenance"],
  "ticket-receipt": ["maintenance", "finance"],
};

async function staffMayUseContext(
  db: ReturnType<typeof getDb>,
  user: { roleId: number },
  contextType: string,
): Promise<boolean> {
  const modules = STAFF_CONTEXT_MODULES[contextType];
  if (!modules) return false;
  const permissions = await permissionsForRole(user.roleId, db);
  return permissions.some(
    (row) => modules.includes(row.moduleKey) && row.canView,
  );
}

export async function POST(request:Request) {
  try {
    const db = getDb();
    const currentUser = await getSessionUser(request, db);
    if (!currentUser) return Response.json({ error:"Not signed in" }, { status:401 });
    const form = await request.formData();
    const contextType = String(form.get("contextType") || "general");
    const recordId = Number(form.get("recordId") || 0);
    if (!recordId) return Response.json({ error:"Related record is required" }, { status:400 });
    if (currentUser.roleKey === "tenant") {
      const allowed =
        !!currentUser.studentId &&
        (await tenantOwnsContext(db, currentUser.studentId, contextType, recordId));
      if (!allowed)
        return Response.json({ error:"You can only upload to your own records" }, { status:403 });
    } else if (!(await staffMayUseContext(db, currentUser, contextType))) {
      return Response.json({ error:"Your role does not allow this action" }, { status:403 });
    }

    // Linking mode: attach an already-uploaded file (e.g. a payment slip)
    // to a second record — the reservation payment and its mirrored Finance
    // invoice payment both need to show the same slip — without a second
    // upload to storage. Staff-only: it's only ever called from
    // app/modules/HostelInformation.tsx (verified — no tenant-portal module
    // imports linkAttachment). Critically, the check above only verifies the
    // *target* contextType/recordId belongs to the caller — it never checks
    // that the *source* `linkAttachmentId` does. Allowing a tenant down this
    // path would let them link an arbitrary attachment id (e.g. another
    // tenant's payment slip, found by guessing) into their own ticket, then
    // GET it back out — reading (and, via DELETE, destroying) a file they
    // never had access to. So tenants are blocked from this path entirely
    // rather than trying to also scope the source, which would need the same
    // tenantOwnsContext check run a second time against the source row's own
    // contextType/recordId and is more surface area than this feature needs
    // for a role that never legitimately uses it.
    const linkAttachmentId = Number(form.get("linkAttachmentId") || 0);
    if (linkAttachmentId) {
      if (currentUser.roleKey === "tenant")
        return Response.json({ error:"You can only upload to your own records" }, { status:403 });
      const source = (
        await db.select().from(storedAttachments).where(eq(storedAttachments.id, linkAttachmentId))
      )[0];
      if (!source) return Response.json({ error:"Source attachment not found" }, { status:404 });
      // The source file must be one this role could open itself; otherwise
      // linking it into a permitted record would be a way around the check.
      if (!(await staffMayUseContext(db, currentUser, source.contextType)))
        return Response.json({ error:"Source attachment not found" }, { status:404 });
      const inserted = await db.insert(storedAttachments).values({
        contextType, recordId, objectKey:source.objectKey, fileName:source.fileName,
        contentType:source.contentType, sizeBytes:source.sizeBytes,
        uploadedBy:String(form.get("uploadedBy") || source.uploadedBy),
      }).returning({id:storedAttachments.id});
      return Response.json({ ok:true, id:inserted[0].id }, { status:201 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error:"File and related record are required" }, { status:400 });
    if (file.size > 25 * 1024 * 1024) return Response.json({ error:"File must be 25 MB or smaller" }, { status:400 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100);
    const objectKey = `${contextType}/${recordId}/${Date.now()}-${safeName}`;
    const contentType = file.type || "application/octet-stream";
    const { url, key } = getStorageConfig();
    const uploadRes = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectKey}`, {
      method:"POST",
      headers:authHeaders(key, { "Content-Type":contentType }),
      body:await file.arrayBuffer(),
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);
    const displayName = String(form.get("fileName") || "").trim() || file.name;
    // A tenant's uploader identity is always their own real session identity,
    // never whatever the client form sent — the client-supplied `uploadedBy`
    // is only trusted for non-tenant (staff) uploads. This is what makes the
    // existing (inherited, already-known-to-be-weak) `uploadedBy` string
    // check on DELETE/PATCH actually mean something for tenant-uploaded
    // rows, instead of being trivially spoofable by the uploader themselves.
    const uploadedBy =
      currentUser.roleKey === "tenant"
        ? currentUser.displayName
        : String(form.get("uploadedBy") || "");
    const inserted = await db.insert(storedAttachments).values({
      contextType, recordId, objectKey, fileName:displayName, contentType,
      sizeBytes:file.size, uploadedBy,
    }).returning({id:storedAttachments.id});
    return Response.json({ ok:true, id:inserted[0].id }, { status:201 });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to upload file" }, { status:500 });
  }
}

export async function PATCH(request:Request) {
  try {
    const db = getDb();
    const currentUser = await getSessionUser(request, db);
    if (!currentUser) return Response.json({ error:"Not signed in" }, { status:401 });
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return Response.json({ error:"Missing attachment" }, { status:400 });
    const body = (await request.json().catch(() => ({}))) as { fileName?: string };
    const fileName = String(body.fileName || "").trim();
    if (!fileName) return Response.json({ error:"A file name is required" }, { status:400 });
    const row = (
      await db.select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
    if (!row) return Response.json({ error:"Attachment not found" }, { status:404 });
    if (currentUser.roleKey === "tenant") {
      const allowed =
        !!currentUser.studentId &&
        (await tenantOwnsContext(db, currentUser.studentId, row.contextType, row.recordId));
      // Same rule as DELETE below: scoped to the tenant's own context AND
      // uploaded by them specifically — inherited from the UI's existing
      // `canDelete={(a) => a.uploadedBy === currentUser.displayName}` check
      // (see app/modules/StudentMaintenance.tsx), now enforced server-side.
      if (!allowed || row.uploadedBy !== currentUser.displayName)
        return Response.json({ error:"Attachment not found" }, { status:404 });
    } else if (!(await staffMayUseContext(db, currentUser, row.contextType))) {
      return Response.json({ error:"Attachment not found" }, { status:404 });
    }
    await db.update(storedAttachments).set({ fileName }).where(eq(storedAttachments.id, id));
    return Response.json({ ok:true });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to rename file" }, { status:500 });
  }
}

export async function DELETE(request:Request) {
  try {
    const db = getDb();
    const currentUser = await getSessionUser(request, db);
    if (!currentUser) return Response.json({ error:"Not signed in" }, { status:401 });
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return Response.json({ error:"Missing attachment" }, { status:400 });
    const row = (
      await db.select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
    if (!row) return Response.json({ error:"Attachment not found" }, { status:404 });
    if (currentUser.roleKey === "tenant") {
      const allowed =
        !!currentUser.studentId &&
        (await tenantOwnsContext(db, currentUser.studentId, row.contextType, row.recordId));
      // `uploadedBy` is a client-supplied-at-upload-time string, not a real
      // identity column — this comparison is inherited from the UI's own
      // (equally client-trusting) `canDelete` prop, not newly introduced
      // here. The schema has no student/user id on stored_attachments to
      // check against instead without a migration, so the real fix — the
      // part that was actually missing — is the `allowed` context-ownership
      // check above, which a client can't spoof by setting `uploadedBy`.
      if (!allowed || row.uploadedBy !== currentUser.displayName)
        return Response.json({ error:"Attachment not found" }, { status:404 });
    } else if (!(await staffMayUseContext(db, currentUser, row.contextType))) {
      return Response.json({ error:"Attachment not found" }, { status:404 });
    }
    // The linking feature (see POST's `linkAttachmentId` branch) lets more
    // than one storedAttachments row point at the same objectKey on purpose
    // — e.g. a reservation payment slip mirrored onto its Finance invoice
    // payment. If another row still references this objectKey, deleting the
    // underlying storage object here would silently break that other row's
    // file too, so only the DB row is removed in that case.
    const otherRowsSharingObject = await db
      .select({ id:storedAttachments.id })
      .from(storedAttachments)
      .where(eq(storedAttachments.objectKey, row.objectKey));
    const objectStillReferencedElsewhere = otherRowsSharingObject.some(
      (r) => r.id !== id,
    );
    if (!objectStillReferencedElsewhere) {
      const { url, key } = getStorageConfig();
      await fetch(`${url}/storage/v1/object/${BUCKET}`, {
        method:"DELETE",
        headers:authHeaders(key, { "Content-Type":"application/json" }),
        body:JSON.stringify({ prefixes:[row.objectKey] }),
      });
    }
    await db.delete(storedAttachments).where(eq(storedAttachments.id, id));
    return Response.json({ ok:true });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to delete file" }, { status:500 });
  }
}

export async function GET(request:Request) {
  try {
    const db = getDb();
    const currentUser = await getSessionUser(request, db);
    if (!currentUser) return Response.json({ error:"Not signed in" }, { status:401 });
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return new Response("Missing attachment", { status:400 });
    const row = (
      await db.select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
    if (!row) return new Response("Attachment not found", { status:404 });
    if (currentUser.roleKey === "tenant") {
      const allowed =
        !!currentUser.studentId &&
        (await tenantOwnsContext(db, currentUser.studentId, row.contextType, row.recordId));
      if (!allowed) return new Response("Attachment not found", { status:404 });
    } else if (!(await staffMayUseContext(db, currentUser, row.contextType))) {
      return new Response("Attachment not found", { status:404 });
    }
    const { url, key } = getStorageConfig();
    const object = await fetch(`${url}/storage/v1/object/${BUCKET}/${row.objectKey}`, {
      headers:authHeaders(key),
    });
    if (!object.ok) return new Response("Stored file not found", { status:404 });
    // Only images, video and PDF can actually be shown in a browser tab.
    // Serving a spreadsheet or Word file as "inline" leaves the tab either
    // blank or full of binary noise, so those download under their real name
    // instead.
    // SVG is excluded: opened directly in a tab it runs its own scripts under
    // this origin (an uploader could then act as whoever opens the link). It
    // still renders inside an <img>, where scripts never run.
    const previewable =
      (row.contentType.startsWith("image/") &&
        !row.contentType.toLowerCase().startsWith("image/svg")) ||
      row.contentType.startsWith("video/") ||
      row.contentType.startsWith("audio/") ||
      row.contentType === "application/pdf" ||
      row.contentType === "text/plain";
    const disposition = previewable ? "inline" : "attachment";
    return new Response(object.body, {
      headers:{
        "content-type":row.contentType,
        "content-disposition":`${disposition}; filename="${row.fileName.replace(/"/g, "")}"`,
        "cache-control":"private, max-age=300",
        // Uploads are user-controlled: never let the browser second-guess the
        // declared type, and sandbox anything that could execute if navigated
        // to directly. (PDF is left out — Chrome's viewer won't load sandboxed.)
        "x-content-type-options":"nosniff",
        ...(row.contentType === "application/pdf" ? {} : { "content-security-policy":"sandbox" }),
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Unable to open file", { status:500 });
  }
}
