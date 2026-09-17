import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const now = new Date().toISOString();

const before = await sql`
  SELECT bed_type, count(*) FROM bed_spaces GROUP BY bed_type ORDER BY bed_type
`;
console.log("BEFORE:", before);

// 1. Single rooms -> single bed, every property.
const singleResult = await sql`
  UPDATE bed_spaces bs
  SET bed_type = 'single', updated_at = ${now}
  FROM hostel_rooms r
  WHERE bs.room_id = r.id AND r.room_type = 'single'
`;
console.log("single rooms updated:", singleResult.count);

// 2. Nadayu 801, sharing, Room A/B -> double decker (bunk).
const nadayuAB = await sql`
  UPDATE bed_spaces bs
  SET bed_type = 'bunk', updated_at = ${now}
  FROM hostel_rooms r
  JOIN hostel_units u ON r.unit_id = u.id
  JOIN hostel_properties p ON u.hostel_id = p.id
  WHERE bs.room_id = r.id
    AND r.room_type = 'sharing'
    AND p.code = 'NDY'
    AND r.room_label IN ('A', 'B')
`;
console.log("Nadayu A/B sharing beds updated to bunk:", nadayuAB.count);

// 3. Nadayu 801, sharing, Room C/D -> two single beds.
const nadayuCD = await sql`
  UPDATE bed_spaces bs
  SET bed_type = 'two-single', updated_at = ${now}
  FROM hostel_rooms r
  JOIN hostel_units u ON r.unit_id = u.id
  JOIN hostel_properties p ON u.hostel_id = p.id
  WHERE bs.room_id = r.id
    AND r.room_type = 'sharing'
    AND p.code = 'NDY'
    AND r.room_label IN ('C', 'D')
`;
console.log("Nadayu C/D sharing beds updated to two-single:", nadayuCD.count);

const after = await sql`
  SELECT bed_type, count(*) FROM bed_spaces GROUP BY bed_type ORDER BY bed_type
`;
console.log("AFTER:", after);

// Sanity: any sharing room outside Nadayu left untouched (still unknown)?
const untouched = await sql`
  SELECT p.code, count(*)
  FROM bed_spaces bs
  JOIN hostel_rooms r ON bs.room_id = r.id
  JOIN hostel_units u ON r.unit_id = u.id
  JOIN hostel_properties p ON u.hostel_id = p.id
  WHERE r.room_type = 'sharing' AND bs.bed_type = 'unknown'
  GROUP BY p.code ORDER BY p.code
`;
console.log("Sharing rooms left as 'unknown' (staff to set manually), by property:", untouched);

await sql.end();
