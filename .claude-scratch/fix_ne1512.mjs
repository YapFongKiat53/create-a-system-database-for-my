import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

// NE-1512's whole-unit contract sat on row NE-1512-A1 with the tenant name
// left as "(Empty)". The importer only created a tenancy where a name was
// present, so the RM 3,640 that covers the whole unit was dropped. Rebuilt
// here from that same spreadsheet row, following the Weststar Aviation
// pattern already used on NB-1708 and NE-1903.
const BED = 494;            // NE-1512-A1, vacant
const SOURCE_KEY = "NDY:NE-1512-A1";

const existing = await sql`SELECT id FROM student_profiles WHERE source_key = ${SOURCE_KEY}`;
if (existing.length) {
  console.log("already exists, nothing to do:", existing);
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  await tx`SET search_path TO public`;
  const [profile] = await tx`
    INSERT INTO student_profiles (source_key, full_name, status, gender, nationality, hometown)
    VALUES (${SOURCE_KEY}, 'Weststar Aviation', 'active', 'unspecified', '', '')
    RETURNING id, full_name`;
  const [assignment] = await tx`
    INSERT INTO accommodation_assignments
      (source_key, student_id, bed_space_id, monthly_rental, security_deposit,
       access_card_deposit, salesperson, check_in_date, agreement_start_date,
       agreement_end_date, agreement_duration, status, remarks)
    VALUES
      (${SOURCE_KEY}, ${profile.id}, ${BED}, 3640, 7280, 640, 'Foo',
       '2025-08-03', '2025-08-01', '2026-09-30', '14 months', 'active',
       'Whole-unit contract for NE-1512 — restored from S2 Student Data (2).xlsx row NE-1512-A1 (S/R 02212), where the tenant name was left blank.')
    RETURNING id, monthly_rental`;
  await tx`UPDATE bed_spaces SET status = 'occupied', updated_at = ${new Date().toISOString()} WHERE id = ${BED}`;
  console.log({ profile, assignment });
});

const check = await sql`
  SELECT u.unit_code, b.legacy_code, s.full_name, COALESCE(a.monthly_rental,0) rent, s.school
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND u.unit_code = 'NE-1512'
  ORDER BY b.legacy_code`;
console.log("\nNE-1512 现况:");
console.table(check.map((x) => ({ ...x })));
await sql.end();
