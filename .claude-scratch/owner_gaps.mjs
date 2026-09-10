import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
console.log("=== 有业主但没有合约条款 ===");
console.table((await sql`
  SELECT u.unit_code, o.owner_name, o.primary_contact_phone phone
  FROM unit_owner_details o JOIN hostel_units u ON u.id=o.unit_id
  WHERE o.lease_start_date IS NULL ORDER BY u.unit_code`).map(x=>({...x})));
console.log("=== 合约已过期（end date < 今天 2026-09-09）===");
const exp = await sql`
  SELECT u.unit_code, o.owner_name, o.lease_end_date
  FROM unit_owner_details o JOIN hostel_units u ON u.id=o.unit_id
  WHERE o.lease_end_date IS NOT NULL AND o.lease_end_date < '2026-09-09' ORDER BY o.lease_end_date`;
console.table(exp.map(x=>({...x})));
console.log("已过期", exp.length, "份 / 有日期的", (await sql`SELECT count(*)::int n FROM unit_owner_details WHERE lease_end_date IS NOT NULL`)[0].n, "份");
await sql.end();
