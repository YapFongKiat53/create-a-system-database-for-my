import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
// 用有抄表的房间实际算出来的每月平均，套到没抄表的房间上（各栋用自己的费率）
const rows = await sql`
  SELECT h.code hostel, h.electricity_rate rate,
         count(*)::int rooms,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM accommodation_assignments a
            JOIN bed_spaces b ON b.id=a.bed_space_id
            WHERE b.room_id=r.id AND a.status='active'))::int occupied
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id JOIN hostel_properties h ON h.id=u.hostel_id
  WHERE (SELECT count(*) FROM meter_readings m WHERE m.room_id=r.id)=0
  GROUP BY h.code, h.electricity_rate ORDER BY 3 DESC`;
const AVG = 88.5;
let total = 0, occTotal = 0;
const table = rows.map((r) => {
  const monthly = Math.round(r.occupied * AVG * Number(r.rate));
  total += monthly; occTotal += r.occupied;
  return { hostel: r.hostel, rate: Number(r.rate), 没抄表房间: r.rooms, 其中有人住: r.occupied, 每月约: "RM " + monthly.toLocaleString() };
});
console.table(table);
console.log(`有人住的 ${occTotal} 间 × 平均 ${AVG} kWh/月 ≈ 每月 RM ${total.toLocaleString()} 收不到`);
console.log(`拖 3 个月 ≈ RM ${(total*3).toLocaleString()} ／ 拖 6 个月 ≈ RM ${(total*6).toLocaleString()}`);
await sql.end();
