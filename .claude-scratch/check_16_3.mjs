import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const rows = await sql`
  SELECT u.unit_code || '-' || r.room_label code, m.reading_date, m.reading_value, m.reading_type, m.submitted_by
  FROM meter_readings m
  JOIN hostel_rooms r ON r.id = m.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE u.unit_code = '16-3'
  ORDER BY r.room_label, m.reading_date DESC`;

const byRoom = new Map();
for (const r of rows) {
  if (!byRoom.has(r.code)) byRoom.set(r.code, []);
  byRoom.get(r.code).push(r);
}
console.log("=== 16-3 每间房最近两笔读数与算出来的用量 ===");
let total = 0;
const out = [];
for (const [code, list] of byRoom) {
  const [cur, prev] = list;
  const usage = cur && prev && Number(cur.reading_value) > Number(prev.reading_value)
    ? Number(cur.reading_value) - Number(prev.reading_value) : 0;
  total += usage;
  out.push({
    room: code,
    上一笔: prev ? `${prev.reading_date} = ${prev.reading_value}` : "-",
    最新: cur ? `${cur.reading_date} = ${cur.reading_value}` : "-",
    用量: usage,
    间隔天数: cur && prev
      ? Math.round((Date.parse(cur.reading_date) - Date.parse(prev.reading_date)) / 86400000)
      : null,
  });
}
console.table(out);
console.log("合计", total.toLocaleString(), "kWh");

console.log("\n=== 对照：16-3 的全部抄表日 ===");
console.table(
  (await sql`
    SELECT m.reading_date, count(*)::int n
    FROM meter_readings m JOIN hostel_rooms r ON r.id = m.room_id
    JOIN hostel_units u ON u.id = r.unit_id WHERE u.unit_code = '16-3'
    GROUP BY 1 ORDER BY 1 DESC LIMIT 8`).map((x) => ({ ...x })),
);
await sql.end();
