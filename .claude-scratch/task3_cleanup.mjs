import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const staffEmail = "task3-fixture-staff@example.invalid";

const [staffUser] = await sql`SELECT id FROM app_users WHERE email = ${staffEmail}`;
if (staffUser) {
  await sql`DELETE FROM user_sessions WHERE user_id = ${staffUser.id}`;
  await sql`DELETE FROM app_users WHERE id = ${staffUser.id}`;
  console.log("cleaned up staff fixture user", staffUser.id);
} else {
  console.log("no fixture user found (already cleaned up)");
}

await sql.end();
