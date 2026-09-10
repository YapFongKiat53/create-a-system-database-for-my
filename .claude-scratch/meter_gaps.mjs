import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const rooms = await sql`
  SELECT r.id room_id, h.code hostel, h.name hostel_name, u.unit_code,
         u.unit_code || '-' || r.room_label code, r.meter_serial,
         (SELECT count(*)::int FROM meter_readings m
            WHERE m.room_id = r.id OR m.bed_space_id IN (SELECT id FROM bed_spaces b WHERE b.room_id = r.id)) readings,
         (SELECT max(reading_date) FROM meter_readings m
            WHERE m.room_id = r.id OR m.bed_space_id IN (SELECT id FROM bed_spaces b WHERE b.room_id = r.id)) last_date,
         (SELECT count(*)::int FROM accommodation_assignments a
            JOIN bed_spaces b ON b.id = a.bed_space_id
            WHERE b.room_id = r.id AND a.status = 'active') occupants
  FROM hostel_rooms r
  JOIN hostel_units u ON u.id = r.unit_id
  JOIN hostel_properties h ON h.id = u.hostel_id
  ORDER BY h.code, u.unit_code, r.room_label`;

const never = rooms.filter((r) => r.readings === 0);
const once = rooms.filter((r) => r.readings === 1);
const ok = rooms.filter((r) => r.readings >= 2);

console.log(`房间总数 ${rooms.length}`);
console.log(`  从来没抄过表 : ${never.length}  (${never.filter(r=>r.occupants>0).length} 间有人住)`);
console.log(`  只抄过一次   : ${once.length}  (${once.filter(r=>r.occupants>0).length} 间有人住) — 已有基准，下次抄就能收费`);
console.log(`  抄过两次以上 : ${ok.length}`);

const group = (list) => {
  const m = new Map();
  for (const r of list) { const k = r.hostel_name; if(!m.has(k)) m.set(k,[]); m.get(k).push(r); }
  return m;
};
console.log("\n=== 从来没抄过表，而且有人住 ===");
for (const [h, list] of group(never.filter(r=>r.occupants>0)))
  console.log(`${h} (${list.length} 间): ${list.map(r=>`${r.code}${r.occupants>1?`×${r.occupants}`:""}`).join(", ")}`);
console.log("\n=== 从来没抄过表，目前空着 ===");
for (const [h, list] of group(never.filter(r=>r.occupants===0)))
  console.log(`${h} (${list.length} 间): ${list.map(r=>r.code).join(", ")}`);
console.log("\n=== 有电表编号却没抄过表 ===");
console.log(never.filter(r=>r.meter_serial).length, "间（有装表，只是没人去抄）");
await sql.end();
