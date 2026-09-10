import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const TODAY = "2026-09-10";
console.log("=== 在住租约里，入住日还在未来的 ===");
const future = await sql`
  SELECT s.full_name, u.unit_code || '-' || r.room_label AS room,
         a.check_in_date, a.checked_in_at, a.monthly_rental, a.status
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND a.check_in_date > ${TODAY}
  ORDER BY a.check_in_date`;
console.table(future.map((x) => ({ ...x })));

console.log("\n=== 在住但还没 check-in 的（converted 了，人没到）===");
const awaiting = await sql`
  SELECT s.full_name, u.unit_code || '-' || r.room_label AS room,
         a.check_in_date, a.monthly_rental, b.status AS bed_status
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND a.checked_in_at IS NULL AND b.status = 'reserved'
  ORDER BY a.check_in_date`;
console.table(awaiting.map((x) => ({ ...x })));
console.log(`共 ${awaiting.length} 位付了钱、租约已建立、但人还没到`);

console.log("\n=== 月结帐单会不会把他们算进去 ===");
const [{ n }] = await sql`
  SELECT count(*)::int n FROM accommodation_assignments a
  WHERE a.status = 'active' AND a.checked_in_at IS NULL`;
console.log(`billing 的条件是 status='active'，没有过滤 checked_in_at ——`);
console.log(`所以这 ${n} 位每个月都会被开房租帐单，不管人到了没。`);
await sql.end();
