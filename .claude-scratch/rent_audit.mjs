import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

// Every active tenancy, grouped by the unit it sits in, so a unit where one
// person carries the whole rent is distinguishable from one where the rent
// is simply missing.
const rows = await sql`
  SELECT u.unit_code,
         s.full_name,
         b.legacy_code,
         COALESCE(a.monthly_rental, 0) AS rent
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active'
  ORDER BY u.unit_code, b.legacy_code
`;

const byUnit = new Map();
for (const r of rows) {
  if (!byUnit.has(r.unit_code)) byUnit.set(r.unit_code, []);
  byUnit.get(r.unit_code).push(r);
}

const wholeUnit = [];   // someone carries a big rent, the rest are 0
const allZero = [];     // nobody in the unit has any rent at all
for (const [unit, list] of byUnit) {
  const zeros = list.filter((x) => Number(x.rent) === 0);
  if (!zeros.length) continue;
  const payers = list.filter((x) => Number(x.rent) > 0);
  const top = Math.max(0, ...payers.map((x) => Number(x.rent)));
  if (payers.length === 1 && top >= 1500)
    wholeUnit.push({ unit, payer: payers[0].full_name, rent: top, covered: zeros.length });
  else if (!payers.length)
    allZero.push({ unit, people: zeros.length });
  else
    wholeUnit.push({ unit, payer: `${payers.length} payers`, rent: top, covered: zeros.length, mixed: true });
}

const sum = (a, k) => a.reduce((s, x) => s + Number(x[k] || 0), 0);
console.log("=== 单位里有人租金为 0 的情况 ===\n");
console.log("A. 整间出租（一人扛整个 unit 的租金，其余为 0）:", wholeUnit.filter(x => !x.mixed).length, "个 unit,",
            sum(wholeUnit.filter(x => !x.mixed), "covered"), "人被涵盖");
console.table(wholeUnit.filter((x) => !x.mixed).slice(0, 12));
console.log("\nB. 混合（有人付、有人 0，但付款人不只一位或金额不像整间）:", wholeUnit.filter(x => x.mixed).length, "个 unit,",
            sum(wholeUnit.filter(x => x.mixed), "covered"), "人");
console.table(wholeUnit.filter((x) => x.mixed).slice(0, 12));
console.log("\nC. 整个 unit 都没有租金（没有人付）:", allZero.length, "个 unit,", sum(allZero, "people"), "人");
console.table(allZero.slice(0, 12));

await sql.end();
