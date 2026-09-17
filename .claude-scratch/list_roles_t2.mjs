import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;
const roles = await sql`SELECT id, role_key, name FROM app_roles ORDER BY id`;
console.log("roles:", JSON.stringify(roles, null, 2));
const student = await sql`SELECT id, full_name FROM student_profiles ORDER BY id LIMIT 1`;
console.log("student:", JSON.stringify(student, null, 2));
await sql.end();
