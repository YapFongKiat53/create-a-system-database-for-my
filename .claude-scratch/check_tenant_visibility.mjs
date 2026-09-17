import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;
const rows = await sql`
  SELECT u.id, u.username, u.role_key, u.student_id, p.full_name
  FROM users u
  LEFT JOIN student_profiles p ON p.id = u.student_id
  WHERE p.full_name = 'testing 2'`;
console.log(JSON.stringify(rows, null, 2));
await sql.end();
