import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const UNIT = process.argv[2] || "NE-1512";
const rooms = await sql`
  SELECT r.id room_id, u.unit_code || '-' || r.room_label code,
         (SELECT reading_value FROM meter_readings m WHERE m.room_id = r.id
           ORDER BY reading_date DESC, id DESC LIMIT 1) last_value,
         (SELECT reading_date FROM meter_readings m WHERE m.room_id = r.id
           ORDER BY reading_date DESC, id DESC LIMIT 1) last_date,
         (SELECT id FROM bed_spaces b WHERE b.room_id = r.id ORDER BY b.legacy_code LIMIT 1) bed_id
  FROM hostel_rooms r JOIN hostel_units u ON u.id = r.unit_id
  WHERE u.unit_code = ${UNIT} ORDER BY r.room_label`;
console.log(`${UNIT} 的房间与最后读数:`);
console.table(rooms.map((x) => ({ ...x })));

if (process.argv[3] === "seed") {
  const date = "2026-09-20";
  let n = 0;
  for (const r of rooms) {
    const base = Number(r.last_value ?? 1000);
    await sql`
      INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
      VALUES (${r.bed_id}, ${r.room_id}, ${date}, ${base + 100}, 'monthly', 'TEST', 'WHOLEUNIT TEST — delete me')`;
    n++;
  }
  console.log(`\n已加入 ${n} 笔测试读数（每间 +100 kWh），日期 ${date}`);
}
await sql.end();
