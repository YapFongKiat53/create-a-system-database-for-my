import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const checks = [
  sql`SELECT id, period_label FROM billing_cycles WHERE period_label ILIKE '%ZZTEST%' OR cutoff_date ILIKE '%ZZTEST%'`,
  sql`SELECT id, reading_date, notes FROM meter_readings WHERE notes ILIKE '%ZZTEST%'`,
  sql`SELECT id, email, display_name FROM app_users WHERE email ILIKE '%ZZTEST%' OR display_name ILIKE '%ZZTEST%'`,
  sql`SELECT id, unit_code, notes FROM hostel_units WHERE unit_code ILIKE '%ZZTEST%' OR notes ILIKE '%ZZTEST%'`,
  sql`SELECT id, room_label FROM hostel_rooms WHERE room_label ILIKE '%ZZTEST%'`,
  sql`SELECT id, full_name, student_code, source_key FROM student_profiles WHERE full_name ILIKE '%ZZTEST%' OR student_code ILIKE '%ZZTEST%' OR source_key ILIKE '%ZZTEST%'`,
  sql`SELECT id, source_key, remarks FROM accommodation_assignments WHERE source_key ILIKE '%ZZTEST%' OR remarks ILIKE '%ZZTEST%'`,
];
const names = ["billing_cycles", "meter_readings", "app_users", "hostel_units", "hostel_rooms", "student_profiles", "accommodation_assignments"];

let total = 0;
for (let i = 0; i < checks.length; i++) {
  const rows = await checks[i];
  total += rows.length;
  console.log(`${names[i]}: ${rows.length} row(s)`);
  if (rows.length) console.table(rows);
}
console.log(total === 0 ? "CLEAN — zero ZZTEST rows remain" : `WARNING — ${total} ZZTEST rows remain`);

await sql.end();
