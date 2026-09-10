import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const rows = await sql`
  SELECT u.unit_code, u.id unit_id, s.full_name, a.id assignment_id,
         a.check_in_date, a.agreement_end_date
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id = a.student_id
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND COALESCE(a.monthly_rental, 0) <= 0`;

const payers = await sql`
  SELECT u.id unit_id, count(*)::int n
  FROM accommodation_assignments a
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND COALESCE(a.monthly_rental, 0) > 0
  GROUP BY u.id`;
const payerByUnit = new Map(payers.map((p) => [String(p.unit_id), p.n]));

const orphan = rows.filter((r) => !payerByUnit.get(String(r.unit_id)));
console.log("月租 0 的在住租约:", rows.length);
console.log("  属于整间出租（同 unit 有人付租）:", rows.length - orphan.length);
console.log("  同 unit 没有任何人付租 → 真的一毛都收不到:", orphan.length);
if (orphan.length)
  console.table(
    orphan.map((x) => ({
      unit: x.unit_code,
      name: String(x.full_name).slice(0, 26),
      assignment: x.assignment_id,
      入住: x.check_in_date,
    })),
  );

// 另外两种「这期收不到钱」的原因
const [{ n: noMeter }] = await sql`
  SELECT count(DISTINCT r.id)::int n
  FROM accommodation_assignments a
  JOIN bed_spaces b ON b.id = a.bed_space_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE a.status = 'active' AND u.electricity_billing <> 'tnb-direct'
    AND (SELECT count(*) FROM meter_readings m WHERE m.room_id = r.id) < 2`;
const [{ n: expired }] = await sql`
  SELECT count(*)::int n FROM accommodation_assignments
  WHERE status = 'active' AND agreement_end_date IS NOT NULL AND agreement_end_date < '2026-09-10'`;
const [{ n: noEnd }] = await sql`
  SELECT count(*)::int n FROM accommodation_assignments
  WHERE status = 'active' AND agreement_end_date IS NULL`;
console.log("\n其他「出帐前该被叫住」的情况:");
console.log("  房间抄表不足两笔，电费收不到:", noMeter, "间");
console.log("  合约已过期还在住:", expired, "位");
console.log("  合约没有结束日:", noEnd, "位");
await sql.end();
