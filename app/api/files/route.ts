import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { storedAttachments } from "../../../db/schema";

function getBucket() {
  const bindings = env as unknown as { FILES?:R2Bucket };
  if (!bindings.FILES) throw new Error("File storage is not available yet");
  return bindings.FILES;
}

export async function POST(request:Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const contextType = String(form.get("contextType") || "general");
    const recordId = Number(form.get("recordId") || 0);
    if (!(file instanceof File) || !recordId) return Response.json({ error:"File and related record are required" }, { status:400 });
    if (file.size > 25 * 1024 * 1024) return Response.json({ error:"File must be 25 MB or smaller" }, { status:400 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100);
    const objectKey = `${contextType}/${recordId}/${Date.now()}-${safeName}`;
    await getBucket().put(objectKey, await file.arrayBuffer(), { httpMetadata:{ contentType:file.type || "application/octet-stream" } });
    const inserted = await getDb().insert(storedAttachments).values({
      contextType, recordId, objectKey, fileName:file.name, contentType:file.type || "application/octet-stream",
      sizeBytes:file.size, uploadedBy:String(form.get("uploadedBy") || ""),
    }).returning({id:storedAttachments.id});
    return Response.json({ ok:true, id:inserted[0].id }, { status:201 });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Unable to upload file" }, { status:500 });
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
    await getBucket().delete(row.objectKey);
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
    const object = await getBucket().get(row.objectKey);
    if (!object) return new Response("Stored file not found", { status:404 });
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
