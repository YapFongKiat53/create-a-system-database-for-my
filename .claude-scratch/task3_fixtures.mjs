import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const encoder = new TextEncoder();
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Buffer.from(binary, "binary").toString("base64");
}
async function sha256b64(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64(new Uint8Array(digest));
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes);
}

const maintenanceRole = (
  await sql`SELECT id FROM app_roles WHERE role_key = 'maintenance'`
)[0];

const staffEmail = "task3-fixture-staff@example.invalid";

const [staffUser] = await sql`
  INSERT INTO app_users (email, display_name, role_id, status)
  VALUES (${staffEmail}, 'Task3 Fixture Staff', ${maintenanceRole.id}, 'active')
  RETURNING id`;

const staffToken = randomToken();
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

await sql`
  INSERT INTO user_sessions (token_hash, user_id, expires_at)
  VALUES (${await sha256b64(staffToken)}, ${staffUser.id}, ${expiresAt})`;

console.log(JSON.stringify({
  staffUserId: staffUser.id,
  staffToken,
}));

await sql.end();
