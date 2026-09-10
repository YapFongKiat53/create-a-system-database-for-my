import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const records = JSON.parse(fs.readFileSync(".claude-scratch/owner-details.json", "utf8"));
const units = await sql`SELECT u.id, u.unit_code, h.code hostel FROM hostel_units u JOIN hostel_properties h ON h.id=u.hostel_id`;
const byCode = new Map(units.map(u => [u.unit_code.toUpperCase(), u]));
const matched = [], unmatched = [];
for (const rec of records) {
  const unit = byCode.get(rec.unitCode.toUpperCase());
  (unit ? matched : unmatched).push({ ...rec, unitId: unit?.id, hostel: unit?.hostel });
}
console.log(`Excel ${records.length} 笔 → 对到资料库 ${matched.length} 笔，对不到 ${unmatched.length} 笔`);
console.log("\n对不到的（资料库没有这个 unit，公司没在管）:");
console.log(unmatched.map(x=>x.unitCode).join(", "));
const covered = new Set(matched.map(x=>x.unitCode.toUpperCase()));
const missing = units.filter(u => !covered.has(u.unit_code.toUpperCase()));
const byHostel = new Map();
for (const u of missing) { if(!byHostel.has(u.hostel)) byHostel.set(u.hostel,[]); byHostel.get(u.hostel).push(u.unit_code); }
console.log(`\n这次之后仍然没有业主资料的 unit (${missing.length}/${units.length}):`);
for (const [h,l] of byHostel) console.log(`  ${h} (${l.length}): ${l.join(", ")}`);
fs.writeFileSync(".claude-scratch/owner-matched.json", JSON.stringify(matched, null, 1));
await sql.end();
