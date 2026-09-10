import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
console.table(
  (await sql`
    SELECT m.id, u.unit_code || '-' || r.room_label AS code, m.reading_date, m.reading_value,
           m.reading_type, m.submitted_by, m.created_at
    FROM meter_readings m JOIN hostel_rooms r ON r.id = m.room_id
    JOIN hostel_units u ON u.id = r.unit_id
    WHERE m.reading_date >= '2026-09-01' ORDER BY m.created_at DESC`).map((x) => ({ ...x })),
);
await sql.end();
