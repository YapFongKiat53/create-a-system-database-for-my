import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

// 用你给的例子验算：旧表 708 → 808，新表 0 → 4，应得 104 kWh
const [room] = await sql`
  SELECT r.id, u.unit_code || '-' || r.room_label code, h.electricity_rate rate
  FROM hostel_rooms r JOIN hostel_units u ON u.id = r.unit_id
  JOIN hostel_properties h ON h.id = u.hostel_id
  WHERE u.unit_code = 'NC-1812A' AND r.room_label = 'B'`;
const [bed] = await sql`SELECT id FROM bed_spaces WHERE room_id = ${room.id} ORDER BY id LIMIT 1`;
console.log("测试房间:", room.code, "费率", room.rate);

const MARK = "REPLACE UI TEST — delete me";
await sql`DELETE FROM meter_readings WHERE notes = ${MARK}`;

// 上一期 708
await sql`INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
          VALUES (${bed.id}, ${room.id}, '2026-11-20', 708, 'monthly', 'TEST', ${MARK})`;
// 这一期：旧表拆下来时 808，新表现在 4
await sql`INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, replaced_meter_final, submitted_by, notes)
          VALUES (${bed.id}, ${room.id}, '2026-12-20', 4, 'meter-reset', 808, 'TEST', ${MARK})`;

const rows = await sql`
  SELECT reading_date, reading_value, reading_type, replaced_meter_final
  FROM meter_readings WHERE notes = ${MARK} ORDER BY reading_date`;
console.table(rows.map((x) => ({ ...x })));

const [prev, cur] = [rows[0], rows[1]];
const carried = Math.max(0, Number(cur.replaced_meter_final) - Number(prev.reading_value));
const usage = carried + Math.max(0, Number(cur.reading_value));
const amount = Math.ceil(usage * Number(room.rate));
console.log(`\n旧表 ${prev.reading_value} → ${cur.replaced_meter_final} = ${carried} kWh`);
console.log(`新表 0 → ${cur.reading_value} = ${cur.reading_value} kWh`);
console.log(`合计 ${usage} kWh × ${room.rate} = RM ${(usage * Number(room.rate)).toFixed(3)} → 进位 RM ${amount}`);
console.log(`\n你的期望: 104 kWh / RM 78  →  ${usage === 104 && amount === 79 ? "kWh 对，金额进位到 79" : usage === 104 ? "kWh 对" : "不符 ✗"}`);

if (process.argv[2] === "clean") {
  const gone = await sql`DELETE FROM meter_readings WHERE notes = ${MARK} RETURNING id`;
  console.log("\n已清掉测试资料", gone.length, "笔");
}
await sql.end();
