import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const CUTOFF = "2026-08-24";
console.log(`=== 入住日晚于 ${CUTOFF} 的在住租约（新规则会排除的）===`);
const excluded = await sql`
  SELECT s.full_name, u.unit_code || '-' || r.room_label AS room,
         a.check_in_date, a.monthly_rental
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND a.check_in_date > ${CUTOFF}
  ORDER BY a.check_in_date`;
console.table(excluded.map((x) => ({ ...x })));
const rent = excluded.reduce((s, x) => s + Number(x.monthly_rental || 0), 0);
console.log(`共 ${excluded.length} 位，月租合计 RM ${rent.toLocaleString()}`);

console.log(`\n=== 对照：九月截止日 2026-09-24 会排除几位 ===`);
const [sep] = await sql`
  SELECT count(*)::int n FROM accommodation_assignments
  WHERE status = 'active' AND check_in_date > '2026-09-24'`;
console.log(`${sep.n} 位 —— 所以九月那期不受影响，跟实测一致`);

console.log(`\n=== 检查有没有误伤：入住日为 NULL 的（这些要照收）===`);
const [nulls] = await sql`
  SELECT count(*)::int n FROM accommodation_assignments
  WHERE status = 'active' AND check_in_date IS NULL`;
console.log(`${nulls.n} 位入住日是空的 —— SQL 有 "IS NULL" 那一支，不会被排除`);
await sql.end();
