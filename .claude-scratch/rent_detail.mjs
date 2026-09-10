import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const detail = async (unit) => {
  const rows = await sql`
    SELECT b.legacy_code, s.full_name, COALESCE(a.monthly_rental,0) rent,
           COALESCE(r.sales_rate,0) room_rate, a.check_in_date
    FROM accommodation_assignments a
    JOIN student_profiles s ON s.id = a.student_id
    JOIN bed_spaces b ON b.id = a.bed_space_id
    JOIN hostel_rooms r ON r.id = b.room_id
    JOIN hostel_units u ON u.id = r.unit_id
    WHERE a.status='active' AND u.unit_code = ${unit}
    ORDER BY b.legacy_code`;
  console.log(`\n### ${unit}`);
  console.table(rows.map((x) => ({ ...x })));
};

for (const u of ["SR3", "16-3", "NE-1512"]) await detail(u);

// Do the whole-unit payers actually get billed?
const payers = await sql`
  SELECT u.unit_code, s.full_name, a.monthly_rental
  FROM accommodation_assignments a
  JOIN student_profiles s ON s.id=a.student_id
  JOIN bed_spaces b ON b.id=a.bed_space_id
  JOIN hostel_rooms r ON r.id=b.room_id
  JOIN hostel_units u ON u.id=r.unit_id
  WHERE a.status='active' AND a.monthly_rental >= 1500
  ORDER BY a.monthly_rental DESC`;
console.log("\n### 整间出租的付款人（这些人会正常收到帐单）");
console.table(payers.map((x) => ({ ...x })));
console.log("整间出租月租总额 RM", payers.reduce((s, x) => s + Number(x.monthly_rental), 0).toLocaleString());

await sql.end();
