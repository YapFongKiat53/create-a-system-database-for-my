import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const MARK = "OCT CUTOFF TEST — delete me";
if (process.argv[2] === "clean") {
  console.log("已删除", (await sql`DELETE FROM meter_readings WHERE notes=${MARK} RETURNING id`).length, "笔");
  await sql.end(); process.exit(0);
}
// 一间整间出租 (NE-1512) + 一间一般合租 (NE-1002)，抄表日期 2026-10-10：
// 旧的 cut-off 是 2026-09-28，这些读数会被排除在十月之外。
const rooms = await sql`
  SELECT r.id room_id, u.unit_code||'-'||r.room_label code,
    (SELECT id FROM bed_spaces b WHERE b.room_id=r.id ORDER BY b.legacy_code LIMIT 1) bed_id,
    COALESCE((SELECT reading_value FROM meter_readings m WHERE m.room_id=r.id ORDER BY reading_date DESC, id DESC LIMIT 1),1000) last_val
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id
  WHERE u.unit_code = ANY(ARRAY['NE-1512','NE-1002']) ORDER BY u.unit_code, r.room_label`;
const out=[];
for (const [i,r] of rooms.entries()) {
  const add = 100 + i*10;
  await sql`INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
            VALUES (${r.bed_id}, ${r.room_id}, '2026-10-10', ${Number(r.last_val)+add}, 'monthly','TEST',${MARK})`;
  out.push({code:r.code, usage:add});
}
console.table(out);
await sql.end();
