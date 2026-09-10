import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const rows = await sql`
  SELECT h.name hostel, u.unit_code, r.room_label,
         (SELECT count(*)::int FROM accommodation_assignments a JOIN bed_spaces b ON b.id=a.bed_space_id
           WHERE b.room_id=r.id AND a.status='active') people
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id JOIN hostel_properties h ON h.id=u.hostel_id
  WHERE (SELECT count(*) FROM meter_readings m WHERE m.room_id=r.id)=0
  ORDER BY h.name, u.unit_code, r.room_label`;
const byUnit = new Map();
for (const r of rows) {
  const k = `${r.hostel}|${r.unit_code}`;
  if (!byUnit.has(k)) byUnit.set(k, []);
  byUnit.get(k).push(r);
}
let lastHostel = "";
for (const [k, list] of byUnit) {
  const [hostel, unit] = k.split("|");
  if (hostel !== lastHostel) { console.log(`\n### ${hostel}`); lastHostel = hostel; }
  const people = list.reduce((s, r) => s + r.people, 0);
  const rooms = list.map((r) => r.room_label + (r.people ? "" : "(空)")).join(" ");
  console.log(`  ${unit.padEnd(11)} ${String(list.length).padStart(2)} 间  ${String(people).padStart(2)} 人   ${rooms}`);
}
console.log(`\n共 ${byUnit.size} 个 unit / ${rows.length} 间房 / ${rows.reduce((s,r)=>s+r.people,0)} 人`);
await sql.end();
