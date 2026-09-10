import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

// Which units look like block lets right now (some payers, some zero-rent people)
const rows = await sql`
  SELECT u.id unit_id, u.unit_code, s.full_name, COALESCE(a.monthly_rental,0) rent, a.id assignment_id
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active'`;
const byUnit = new Map();
for (const r of rows) {
  if (!byUnit.has(r.unit_code)) byUnit.set(r.unit_code, []);
  byUnit.get(r.unit_code).push(r);
}
const block = [], normal = [];
for (const [code, list] of byUnit) {
  const payers = list.filter((x) => Number(x.rent) > 0);
  const zero = list.filter((x) => Number(x.rent) <= 0);
  (zero.length && payers.length ? block : normal).push({
    unit: code, people: list.length, payers: payers.length, zero: zero.length,
    unit_rent: list.reduce((s, x) => s + Number(x.rent), 0),
  });
}
console.log("=== 整间出租 (block let) 的 unit ===");
console.table(block);
console.log("block let 共", block.length, "个 unit；一般合租", normal.length, "个");

console.log("\n=== 现有 billing cycles ===");
console.table((await sql`SELECT id, period_label, cutoff_date, due_date, status FROM billing_cycles ORDER BY id DESC LIMIT 8`).map(x=>({...x})));

console.log("\n=== 电费费率 ===");
console.table((await sql`SELECT key, value FROM system_settings WHERE key LIKE '%electric%' OR key LIKE '%auto-billing%'`).map(x=>({...x})));

console.log("\n=== 最近抄表 ===");
console.table((await sql`SELECT reading_date, count(*) FROM meter_readings GROUP BY reading_date ORDER BY reading_date DESC LIMIT 6`).map(x=>({...x})));
await sql.end();
