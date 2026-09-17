import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;
const email = "review-task3-fixture-staff@example.invalid";
const [user] = await sql`SELECT id FROM app_users WHERE email = ${email}`;
if (user) {
  await sql`DELETE FROM user_sessions WHERE user_id = ${user.id}`;
  await sql`DELETE FROM app_users WHERE id = ${user.id}`;
  console.log("cleaned up", user.id);
} else {
  console.log("nothing to clean");
}
await sql.end();
