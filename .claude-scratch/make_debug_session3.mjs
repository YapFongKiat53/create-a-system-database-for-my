import postgres from "postgres";
import crypto from "node:crypto";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
const [any] = await sql`SELECT id FROM app_users WHERE status = 'active' LIMIT 1`;
const token = crypto.randomBytes(32).toString("base64");
const tokenHash = crypto.createHash("sha256").update(token).digest("base64");
const [nextId] = await sql`SELECT COALESCE(MAX(id),0)+1 AS id FROM user_sessions`;
await sql`INSERT INTO user_sessions (id, token_hash, user_id, expires_at)
  VALUES (${nextId.id}, ${tokenHash}, ${any.id}, ${new Date(Date.now()+3600000).toISOString()})`;
console.log(JSON.stringify({ userId: any.id, token, sessionId: nextId.id }));
await sql.end();
