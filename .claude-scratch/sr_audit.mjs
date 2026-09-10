import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const rows = await sql`
  SELECT u.unit_code, b.legacy_code, s.full_name, s.school,
         COALESCE(a.monthly_rental,0) rent, COALESCE(r.sales_rate,0) room_rate,
         a.check_in_date, a.agreement_end_date
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  JOIN hostel_properties h ON h.id = u.hostel_id
  WHERE a.status = 'active' AND h.code = 'SR'
  ORDER BY u.unit_code, b.legacy_code`;

const byUnit = new Map();
for (const r of rows) {
  if (!byUnit.has(r.unit_code)) byUnit.set(r.unit_code, []);
  byUnit.get(r.unit_code).push(r);
}

console.log("=== Subang Residences：每个 unit 的收租状况 ===\n");
const summary = [];
for (const [unit, list] of byUnit) {
  const total = list.reduce((s, x) => s + Number(x.rent), 0);
  const payers = list.filter((x) => Number(x.rent) > 0);
  const schools = [...new Set(list.map((x) => x.school || "(空白)"))].join(", ");
  summary.push({
    unit,
    people: list.length,
    payers: payers.length,
    unit_rent: total,
    per_head: Math.round(total / list.length),
    schools,
  });
}
console.table(summary);

console.log("\n=== SR3 逐床明细（跟其他 SR unit 比较）===");
console.table(byUnit.get("SR3").map((x) => ({ ...x })));

console.log("\n=== 一个正常的 SR unit 作对照：SR5 ===");
console.table(byUnit.get("SR5").map((x) => ({ ...x })));

await sql.end();
