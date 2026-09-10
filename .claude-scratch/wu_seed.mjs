import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const MARK = "WHOLEUNIT TEST — delete me";
const DATE = "2026-09-20";
const UNITS = ["NE-1512", "NE-1002"];

if (process.argv[2] === "clean") {
  const gone = await sql`DELETE FROM meter_readings WHERE notes = ${MARK} RETURNING id`;
  console.log("已删除测试读数", gone.length, "笔");
  await sql.end(); process.exit(0);
}

const rooms = await sql`
  SELECT r.id room_id, u.unit_code||'-'||r.room_label code,
    (SELECT id FROM bed_spaces b WHERE b.room_id=r.id ORDER BY b.legacy_code LIMIT 1) bed_id,
    COALESCE((SELECT reading_value FROM meter_readings m WHERE m.room_id=r.id ORDER BY reading_date DESC, id DESC LIMIT 1), 1000) last_val
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id
  WHERE u.unit_code = ANY(${UNITS}) ORDER BY u.unit_code, r.room_label`;
const out = [];
for (const [i, r] of rooms.entries()) {
  const add = 100 + i * 10;          // different usage per room so the split is visible
  await sql`INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
            VALUES (${r.bed_id}, ${r.room_id}, ${DATE}, ${Number(r.last_val) + add}, 'monthly', 'TEST', ${MARK})`;
  out.push({ code: r.code, from: Number(r.last_val), to: Number(r.last_val) + add, usage: add });
}
console.table(out);
console.log("总用电 kWh:", out.reduce((s,x)=>s+x.usage,0));
await sql.end();
