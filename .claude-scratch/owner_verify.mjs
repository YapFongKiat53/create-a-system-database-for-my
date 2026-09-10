import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
console.log("=== 现有维修单会不会找到业主 ===");
console.table((await sql`
  SELECT t.ticket_no, u.unit_code, t.cost_responsibility, COALESCE(o.owner_name,'(没有业主资料)') owner_name
  FROM maintenance_tickets t
  LEFT JOIN hostel_units u ON u.id = t.unit_id
  LEFT JOIN unit_owner_details o ON o.unit_id = t.unit_id
  ORDER BY t.id DESC LIMIT 12`).map(x=>({...x})));
const cov = await sql`
  SELECT h.code hostel, count(*)::int units, count(o.id)::int with_owner
  FROM hostel_units u JOIN hostel_properties h ON h.id=u.hostel_id
  LEFT JOIN unit_owner_details o ON o.unit_id=u.id
  GROUP BY h.code ORDER BY h.code`;
console.log("\n=== 业主资料覆盖率 ===");
console.table(cov.map(x=>({...x, missing: x.units - x.with_owner})));
console.log("总计:", cov.reduce((s,x)=>s+x.with_owner,0), "/", cov.reduce((s,x)=>s+x.units,0));
await sql.end();
