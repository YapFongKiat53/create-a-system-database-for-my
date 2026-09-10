import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
console.log("=== settings ===");
console.table((await sql`SELECT setting_key, setting_value FROM system_settings WHERE setting_key ILIKE '%elect%' OR setting_key ILIKE '%billing%'`).map(x=>({...x})));
console.log("\n=== 最近抄表日期 ===");
console.table((await sql`SELECT reading_date, count(*)::int n FROM meter_readings GROUP BY reading_date ORDER BY reading_date DESC LIMIT 6`).map(x=>({...x})));
console.log("\n=== NE-1512 房间 / 最后读数 ===");
console.table((await sql`
  SELECT r.id room_id, u.unit_code||'-'||r.room_label code,
    (SELECT id FROM bed_spaces b WHERE b.room_id=r.id ORDER BY b.legacy_code LIMIT 1) bed_id,
    (SELECT reading_value FROM meter_readings m WHERE m.room_id=r.id ORDER BY reading_date DESC, id DESC LIMIT 1) last_val,
    (SELECT reading_date FROM meter_readings m WHERE m.room_id=r.id ORDER BY reading_date DESC, id DESC LIMIT 1) last_date
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id WHERE u.unit_code='NE-1512' ORDER BY r.room_label`).map(x=>({...x})));
console.log("\n=== 对照组：一般合租 unit（有人付租、无零租）===");
console.table((await sql`
  SELECT u.unit_code, count(*)::int people, count(*) FILTER (WHERE COALESCE(a.monthly_rental,0)>0)::int payers
  FROM accommodation_assignments a
  JOIN bed_spaces b ON b.id=a.bed_space_id JOIN hostel_rooms r ON r.id=b.room_id JOIN hostel_units u ON u.id=r.unit_id
  WHERE a.status='active' GROUP BY u.unit_code HAVING count(*)=count(*) FILTER (WHERE COALESCE(a.monthly_rental,0)>0)
  ORDER BY people DESC LIMIT 5`).map(x=>({...x})));
await sql.end();
