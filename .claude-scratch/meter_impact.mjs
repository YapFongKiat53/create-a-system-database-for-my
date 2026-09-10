import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

console.log("=== 电表编号登记状况 ===");
console.table((await sql`
  SELECT CASE WHEN COALESCE(r.meter_serial,'')='' THEN '没有电表编号' ELSE '有电表编号' END state,
         count(*)::int rooms,
         count(*) FILTER (WHERE (SELECT count(*) FROM meter_readings m WHERE m.room_id=r.id)=0)::int never_read
  FROM hostel_rooms r GROUP BY 1`).map(x=>({...x})));

console.log("\n=== 受影响的人数 ===");
const people = await sql`
  SELECT count(*)::int n FROM accommodation_assignments a
  JOIN bed_spaces b ON b.id=a.bed_space_id
  WHERE a.status='active' AND (SELECT count(*) FROM meter_readings m WHERE m.room_id=b.room_id)=0`;
const total = await sql`SELECT count(*)::int n FROM accommodation_assignments WHERE status='active'`;
console.log(`${people[0].n} 位住客住在没抄过表的房间 / 共 ${total[0].n} 位在住`);

console.log("\n=== 有抄表的房间，实际每月用电 ===");
const usage = await sql`
  WITH pairs AS (
    SELECT room_id, reading_value, reading_date,
           LAG(reading_value) OVER (PARTITION BY room_id ORDER BY reading_date, id) prev_val,
           LAG(reading_date)  OVER (PARTITION BY room_id ORDER BY reading_date, id) prev_date
    FROM meter_readings WHERE room_id IS NOT NULL
  )
  SELECT round(avg((reading_value-prev_val) / GREATEST(1,(reading_date::date - prev_date::date)) * 30)::numeric,1) avg_kwh_month,
         count(*)::int samples
  FROM pairs
  WHERE prev_val IS NOT NULL AND reading_value > prev_val
    AND (reading_date::date - prev_date::date) BETWEEN 20 AND 120`;
console.table(usage.map(x=>({...x})));

console.log("\n=== 这 97 间里，属于整间出租 (CENTEX/Weststar) 的 ===");
console.table((await sql`
  SELECT u.unit_code, count(*)::int rooms_never_read
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id
  WHERE (SELECT count(*) FROM meter_readings m WHERE m.room_id=r.id)=0
    AND u.unit_code IN ('SR12','SR31','SR3','NE-13A05','NE-13A11A','NE-1711A','NE-1201','NE-1503','NE-1509','NE-1512','NE-1911','SR2A','SR5','SR23','D1-0614','D1-0805','D3-0213','D3-0405','D3-0916')
  GROUP BY u.unit_code ORDER BY 2 DESC`).map(x=>({...x})));

console.log("\n=== 最近一次全面抄表 ===");
console.table((await sql`SELECT reading_date, count(*)::int n FROM meter_readings GROUP BY 1 ORDER BY 1 DESC LIMIT 3`).map(x=>({...x})));
await sql.end();
