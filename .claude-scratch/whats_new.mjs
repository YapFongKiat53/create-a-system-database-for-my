import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

console.log("=== 今天新增或改动的租约 ===");
console.table(
  (await sql`
    SELECT a.id, s.full_name, u.unit_code || '-' || r.room_label AS room,
           a.monthly_rental, a.status, a.check_in_date, a.checked_in_at
    FROM accommodation_assignments a
    JOIN student_profiles s ON s.id = a.student_id
    JOIN bed_spaces b ON b.id = a.bed_space_id
    JOIN hostel_rooms r ON r.id = b.room_id
    JOIN hostel_units u ON u.id = r.unit_id
    WHERE a.checked_in_at >= '2026-09-10' OR a.id > 535
    ORDER BY a.id DESC LIMIT 10`).map((x) => ({ ...x })),
);

console.log("\n=== 在住租约总数 ===");
console.log((await sql`SELECT count(*)::int n FROM accommodation_assignments WHERE status='active'`)[0].n);

console.log("\n=== 今天新增的抄表 ===");
console.table(
  (await sql`
    SELECT m.id, u.unit_code || '-' || r.room_label AS room, m.reading_date,
           m.reading_value, m.reading_type, m.submitted_by, m.created_at
    FROM meter_readings m JOIN hostel_rooms r ON r.id = m.room_id
    JOIN hostel_units u ON u.id = r.unit_id
    WHERE m.created_at >= '2026-09-10' ORDER BY m.created_at DESC LIMIT 10`).map((x) => ({ ...x })),
);
await sql.end();
