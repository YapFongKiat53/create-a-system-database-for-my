import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const rooms = await sql`
  SELECT r.id room_id, u.unit_code || '-' || r.room_label code, h.name hostel,
         u.electricity_billing,
         (SELECT count(*)::int FROM meter_readings m WHERE m.room_id = r.id) readings
  FROM hostel_rooms r JOIN hostel_units u ON u.id = r.unit_id
  JOIN hostel_properties h ON h.id = u.hostel_id`;
const never = rooms.filter((r) => r.readings === 0);
const meterNever = never.filter((r) => r.electricity_billing !== "tnb-direct");

console.log(`房间总数 ${rooms.length}`);
console.log(`  从来没抄过表 : ${never.length}（其中 ${never.length - meterNever.length} 间是 TNB 直接计费，本来就没表）`);
console.log(`  真正还缺抄表 : ${meterNever.length}`);
const g = new Map();
for (const r of meterNever) {
  if (!g.has(r.hostel)) g.set(r.hostel, []);
  g.get(r.hostel).push(r.code);
}
for (const [h, l] of g) console.log(`    ${h} (${l.length}): ${l.join(", ")}`);

console.log("\n=== 抄表日分布（最近 8 期）===");
console.table(
  (await sql`SELECT reading_date, count(*)::int n FROM meter_readings
             GROUP BY 1 ORDER BY 1 DESC LIMIT 8`).map((x) => ({ ...x })),
);

console.log("\n=== 换表纪录 ===");
console.table(
  (await sql`
    SELECT u.unit_code || '-' || r.room_label code, m.reading_date,
           m.replaced_meter_final 旧表最后, m.reading_value 新表读数
    FROM meter_readings m JOIN hostel_rooms r ON r.id = m.room_id
    JOIN hostel_units u ON u.id = r.unit_id
    WHERE m.reading_type = 'meter-reset' ORDER BY m.reading_date DESC LIMIT 12`).map((x) => ({ ...x })),
);
console.log(
  "换表纪录共",
  (await sql`SELECT count(*)::int n FROM meter_readings WHERE reading_type='meter-reset'`)[0].n,
  "笔",
);
await sql.end();
