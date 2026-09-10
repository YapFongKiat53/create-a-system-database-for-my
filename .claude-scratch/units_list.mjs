import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const rows = await sql`SELECT u.id, u.unit_code, h.code hostel FROM hostel_units u JOIN hostel_properties h ON h.id=u.hostel_id ORDER BY h.code, u.unit_code`;
const byHostel = new Map();
for (const r of rows) { if(!byHostel.has(r.hostel)) byHostel.set(r.hostel,[]); byHostel.get(r.hostel).push(r.unit_code); }
for (const [h,list] of byHostel) console.log(`${h} (${list.length}):`, list.join(", "));
console.log("\nunit_owner_details 笔数:", (await sql`SELECT count(*)::int n FROM unit_owner_details`)[0].n);
await sql.end();
