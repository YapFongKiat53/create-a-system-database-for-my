import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const APPLY = process.argv[2] === "apply";

// 抄表表有、系统缺的两间房。用同 unit 其他房间的设定当范本。
const ADD = [
  { unit: "NB-1210", label: "C" },
  { unit: "SR5", label: "B" },
];

console.log("=== 现况 ===");
for (const a of ADD) {
  const rows = await sql`
    SELECT r.room_label, r.bathroom_type, r.room_type, r.sales_rate,
           (SELECT count(*)::int FROM bed_spaces b WHERE b.room_id = r.id) beds
    FROM hostel_rooms r JOIN hostel_units u ON u.id = r.unit_id
    WHERE u.unit_code = ${a.unit} ORDER BY r.room_label`;
  console.log(
    `${a.unit}: ` +
      rows.map((r) => `${r.room_label}(${r.beds}床, rate ${r.sales_rate ?? "-"})`).join(" "),
  );
}

console.log("\n=== SR 各 unit 的电费方式 ===");
console.table(
  (await sql`
    SELECT unit_code, electricity_billing,
           (SELECT count(*)::int FROM hostel_rooms r WHERE r.unit_id = u.id) rooms,
           (SELECT count(*)::int FROM meter_readings m
              JOIN hostel_rooms r2 ON r2.id = m.room_id WHERE r2.unit_id = u.id) readings
    FROM hostel_units u WHERE unit_code LIKE 'SR%' ORDER BY unit_code`).map((x) => ({ ...x })),
);

if (!APPLY) {
  console.log("\n(dry run — 加 apply 才写入)");
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  await tx`SET search_path TO public`;
  for (const a of ADD) {
    const [unit] = await tx`SELECT id FROM hostel_units WHERE unit_code = ${a.unit}`;
    const [exists] =
      await tx`SELECT id FROM hostel_rooms WHERE unit_id = ${unit.id} AND room_label = ${a.label}`;
    if (exists) {
      console.log(`${a.unit}-${a.label} 已存在，跳过`);
      continue;
    }
    // 照同 unit 其他房间的设定建，别自己发明一套
    const [model] = await tx`
      SELECT bathroom_type, room_type, sales_rate FROM hostel_rooms
      WHERE unit_id = ${unit.id} ORDER BY room_label LIMIT 1`;
    const [room] = await tx`
      INSERT INTO hostel_rooms (unit_id, room_label, bathroom_type, room_type, sales_rate)
      VALUES (${unit.id}, ${a.label}, ${model.bathroom_type}, ${model.room_type}, ${model.sales_rate})
      RETURNING id, room_label`;
    // meter_readings.bed_space_id 不可为空，所以每间房至少要有一张床
    const [bed] = await tx`
      INSERT INTO bed_spaces (room_id, bed_label, legacy_code, status)
      VALUES (${room.id}, '1', ${`${a.unit}-${a.label}1`}, 'vacant')
      RETURNING id, legacy_code`;
    console.log(`建立 ${a.unit}-${a.label}:`, { room: room.id, bed: bed.legacy_code });
  }
  // CENTEX 的 SR12 / SR31 没有分房电表，电费直接照 TNB 帐单收
  const flipped = await tx`
    UPDATE hostel_units SET electricity_billing = 'tnb-direct'
    WHERE unit_code IN ('SR12','SR31') RETURNING unit_code`;
  console.log("改成 TNB 直接计费:", flipped.map((f) => f.unit_code).join(", "));
});

console.log("\n=== 结果 ===");
console.table(
  (await sql`
    SELECT u.unit_code, u.electricity_billing, count(r.id)::int rooms
    FROM hostel_units u LEFT JOIN hostel_rooms r ON r.unit_id = u.id
    WHERE u.unit_code IN ('NB-1210','SR5','SR12','SR31') GROUP BY 1, 2 ORDER BY 1`).map((x) => ({ ...x })),
);
await sql.end();
