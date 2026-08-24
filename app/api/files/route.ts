import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { storedAttachments } from "../../../db/schema";

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

export async function POST(request:Request) {
  try {
    const form = await request.formData();
    const contextType = String(form.get("contextType") || "general");
    const recordId = Number(form.get("recordId") || 0);
    if (!recordId) return Response.json({ error:"Related record is required" }, { status:400 });
    const db = getDb();

    // Linking mode: attach an already-uploaded file (e.g. a payment slip)
    // to a second record — the reservation payment and its mirrored Finance
    // invoice payment both need to show the same slip — without a second
    // upload to storage.
    const linkAttachmentId = Number(form.get("linkAttachmentId") || 0);
    if (linkAttachmentId) {
      const source = (
        await db.select().from(storedAttachments).where(eq(storedAttachments.id, linkAttachmentId))
      )[0];
      if (!source) return Response.json({ error:"Source attachment not found" }, { status:404 });
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
    const inserted = await db.insert(storedAttachments).values({
      contextType, recordId, objectKey, fileName:displayName, contentType,
      sizeBytes:file.size, uploadedBy:String(form.get("uploadedBy") || ""),
    }).returning({id:storedAttachments.id});
    return Response.json({ ok:true, id:inserted[0].id }, { status:201 });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to upload file" }, { status:500 });
  }
}

export async function PATCH(request:Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return Response.json({ error:"Missing attachment" }, { status:400 });
    const body = (await request.json().catch(() => ({}))) as { fileName?: string };
    const fileName = String(body.fileName || "").trim();
    if (!fileName) return Response.json({ error:"A file name is required" }, { status:400 });
    const db = getDb();
    const row = (
      await db.select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
    if (!row) return Response.json({ error:"Attachment not found" }, { status:404 });
    await db.update(storedAttachments).set({ fileName }).where(eq(storedAttachments.id, id));
    return Response.json({ ok:true });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to rename file" }, { status:500 });
  }
}

export async function DELETE(request:Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return Response.json({ error:"Missing attachment" }, { status:400 });
    const db = getDb();
    const row = (
      await db.select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
    if (!row) return Response.json({ error:"Attachment not found" }, { status:404 });
    const { url, key } = getStorageConfig();
    await fetch(`${url}/storage/v1/object/${BUCKET}`, {
      method:"DELETE",
      headers:authHeaders(key, { "Content-Type":"application/json" }),
      body:JSON.stringify({ prefixes:[row.objectKey] }),
    });
    await db.delete(storedAttachments).where(eq(storedAttachments.id, id));
    return Response.json({ ok:true });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to delete file" }, { status:500 });
  }
}

export async function GET(request:Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return new Response("Missing attachment", { status:400 });
    const row = (
      await getDb().select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
    if (!row) return new Response("Attachment not found", { status:404 });
    const { url, key } = getStorageConfig();
    const object = await fetch(`${url}/storage/v1/object/${BUCKET}/${row.objectKey}`, {
      headers:authHeaders(key),
    });
    if (!object.ok) return new Response("Stored file not found", { status:404 });
    return new Response(object.body, {
      headers:{
        "content-type":row.contentType,
        "content-disposition":`inline; filename="${row.fileName.replace(/"/g, "")}"`,
        "cache-control":"private, max-age=300",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Unable to open file", { status:500 });
  }
}
