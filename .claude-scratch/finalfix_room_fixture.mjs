// Wholly synthetic test unit/room/tenancy for verifying Fix 1
// (upcomingMeterCutoff's previousCutoff should now be 2026-09-24, not
// 2026-10-24). Never touches any real hostel_units/hostel_rooms row —
// everything here is freshly inserted and ZZTEST-tagged, deleted after.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const UNIT_CODE = "ZZTEST-FF";
const ROOM_LABEL = "ZZTEST-FF-R1";

async function cleanup() {
  const [unit] = await sql`SELECT id FROM hostel_units WHERE unit_code = ${UNIT_CODE}`;
  if (!unit) {
    console.log("nothing to clean");
    return;
  }
  const [room] = await sql`SELECT id FROM hostel_rooms WHERE unit_id = ${unit.id} AND room_label = ${ROOM_LABEL}`;
  if (room) {
    const beds = await sql`SELECT id FROM bed_spaces WHERE room_id = ${room.id}`;
    for (const bed of beds) {
      await sql`DELETE FROM meter_readings WHERE bed_space_id = ${bed.id} OR room_id = ${room.id}`;
      const assignments = await sql`SELECT id, student_id FROM accommodation_assignments WHERE bed_space_id = ${bed.id}`;
      for (const a of assignments) {
        await sql`DELETE FROM accommodation_assignments WHERE id = ${a.id}`;
        await sql`DELETE FROM student_profiles WHERE id = ${a.student_id}`;
      }
      await sql`DELETE FROM bed_spaces WHERE id = ${bed.id}`;
    }
    await sql`DELETE FROM hostel_rooms WHERE id = ${room.id}`;
  }
  await sql`DELETE FROM hostel_units WHERE id = ${unit.id}`;
  console.log("cleaned up unit", unit.id);
}

if (process.argv[2] === "clean") {
  await cleanup();
  await sql.end();
  process.exit(0);
}

await cleanup();

const [hostel] = await sql`SELECT id FROM hostel_properties ORDER BY id LIMIT 1`;
if (!hostel) throw new Error("no hostel_properties row to attach the synthetic unit to");

const [unit] = await sql`
  INSERT INTO hostel_units (hostel_id, unit_code, address, gender, status, notes, electricity_billing)
  VALUES (${hostel.id}, ${UNIT_CODE}, 'ZZTEST synthetic unit — delete me', 'mixed', 'active', 'ZZTEST', 'meter')
  RETURNING id`;

const [room] = await sql`
  INSERT INTO hostel_rooms (unit_id, room_label, status)
  VALUES (${unit.id}, ${ROOM_LABEL}, 'active')
  RETURNING id`;

const [bed] = await sql`
  INSERT INTO bed_spaces (room_id, bed_label, legacy_code, status)
  VALUES (${room.id}, 'A', 'ZZTEST-FF-BED', 'occupied')
  RETURNING id`;

const [student] = await sql`
  INSERT INTO student_profiles (source_key, student_code, full_name, status)
  VALUES ('zztest-finalfix-student', 'ZZTEST-FF', 'ZZTEST FinalFix Student', 'active')
  RETURNING id`;

const [assignment] = await sql`
  INSERT INTO accommodation_assignments
    (source_key, student_id, bed_space_id, check_in_date, status, remarks)
  VALUES ('zztest-finalfix-assignment', ${student.id}, ${bed.id}, '2026-01-01', 'active', 'ZZTEST-FINALFIX')
  RETURNING id`;

// Two readings so readingCountByRoom >= 2 (otherwise "count < 2" alone would
// mark it overdue regardless of the staleness/cutoff logic under test).
await sql`
  INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, notes)
  VALUES (${bed.id}, ${room.id}, '2026-08-25', 100, 'ZZTEST-FINALFIX')`;
await sql`
  INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, notes)
  VALUES (${bed.id}, ${room.id}, '2026-09-25', 120, 'ZZTEST-FINALFIX')`;

console.log(JSON.stringify({ unitId: unit.id, roomId: room.id, bedId: bed.id, roomCode: `${UNIT_CODE}-${ROOM_LABEL}` }));

await sql.end();
