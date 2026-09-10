import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const MARK = "WHOLEUNIT TEST — delete me";
console.log("SR3 住户:");
console.table((await sql`
  SELECT b.legacy_code, s.full_name, COALESCE(a.monthly_rental,0) rent
  FROM accommodation_assignments a JOIN student_profiles s ON s.id=a.student_id
  JOIN bed_spaces b ON b.id=a.bed_space_id JOIN hostel_rooms r ON r.id=b.room_id
  JOIN hostel_units u ON u.id=r.unit_id WHERE a.status='active' AND u.unit_code='SR3'
  ORDER BY b.legacy_code`).map(x=>({...x})));
const rooms = await sql`
  SELECT r.id room_id, u.unit_code||'-'||r.room_label code,
    (SELECT id FROM bed_spaces b WHERE b.room_id=r.id ORDER BY b.legacy_code LIMIT 1) bed_id,
    COALESCE((SELECT reading_value FROM meter_readings m WHERE m.room_id=r.id ORDER BY reading_date DESC, id DESC LIMIT 1),1000) last_val
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id WHERE u.unit_code='SR3' ORDER BY r.room_label`;
const out=[];
for (const [i,r] of rooms.entries()) {
  const add = 200 + i*10;
  await sql`INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
            VALUES (${r.bed_id}, ${r.room_id}, '2026-09-20', ${Number(r.last_val)+add}, 'monthly','TEST',${MARK})`;
  out.push({code:r.code, usage:add});
}
console.table(out);
console.log("SR3 总用电 kWh:", out.reduce((s,x)=>s+x.usage,0));
await sql.end();
