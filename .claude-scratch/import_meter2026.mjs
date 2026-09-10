import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const APPLY = process.argv[2] === "apply";
const file = JSON.parse(fs.readFileSync(".claude-scratch/meter2026.json", "utf8"));

// 系统里的房间 + 每间房的第一张床（meter_readings.bed_space_id 不可为空）
const rooms = await sql`
  SELECT r.id room_id, u.unit_code||'-'||r.room_label code,
         (SELECT id FROM bed_spaces b WHERE b.room_id=r.id ORDER BY b.legacy_code, b.id LIMIT 1) bed_id
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id`;
const byCode = new Map(rooms.map((r) => [r.code.toUpperCase(), r]));

// 已经在系统里的读数，避免重复
const existing = await sql`
  SELECT COALESCE(m.room_id, b.room_id) room_id, m.reading_date
  FROM meter_readings m LEFT JOIN bed_spaces b ON b.id=m.bed_space_id`;
const have = new Set(existing.map((e) => `${e.room_id}|${e.reading_date}`));

// 档案里同一间房同一天出现两个不同数字的，日期栏本身有问题，一律不汇入
const seen = new Map();
const ambiguous = new Set();
for (const r of file) {
  const k = `${r.roomCode}|${r.date}`;
  if (seen.has(k) && seen.get(k) !== r.value) ambiguous.add(k);
  seen.set(k, r.value);
}

const byRoom = new Map();
for (const r of file) {
  if (!byRoom.has(r.roomCode)) byRoom.set(r.roomCode, []);
  byRoom.get(r.roomCode).push(r);
}

const rows = [], skipped = { noRoom: 0, noBed: 0, already: 0, ambiguous: 0, negative: 0 };
const resets = [], suspect = [];
for (const [code, list] of byRoom) {
  const room = byCode.get(code.toUpperCase());
  if (!room) { skipped.noRoom += list.length; continue; }
  if (!room.bed_id) { skipped.noBed += list.length; continue; }
  list.sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (ambiguous.has(`${r.roomCode}|${r.date}`)) { skipped.ambiguous++; continue; }
    if (have.has(`${room.room_id}|${r.date}`)) { skipped.already++; continue; }
    if (r.value < 0) { suspect.push({ room: code, date: r.date, 值: r.value, 判断: "负数，不可能" }); skipped.negative++; continue; }
    const prev = list[i - 1];
    const dropped = prev && r.value < prev.value;
    // 换掉的表会从 0 重新走，所以新读数会远小于上一期。小幅下降不是换表，
    // 是抄错或打错一个数字 —— 两者要分开，不然会把打错的当成换表，
    // 凭空多算一整颗旧表的用量。
    const isReset = dropped && r.value <= prev.value * 0.25;
    if (isReset)
      resets.push({ room: code, date: r.date, 上一期: prev.value, 新表: r.value });
    else if (dropped)
      suspect.push({ room: code, date: r.date, 上一期: prev.value, 这一期: r.value,
        差: r.value - prev.value, 判断: "小幅下降，比较像打错字" });
    rows.push({
      roomId: room.room_id, bedId: room.bed_id, code,
      date: r.date, value: r.value,
      readingType: isReset ? "meter-reset" : "monthly",
      replacedMeterFinal: isReset ? prev.value : null,
      notes: dropped && !isReset
        ? `Reading is lower than the previous one but not by enough to be a new meter — likely a mis-keyed digit. Charged as no usage this month until it is checked. Imported from "Meter Reading 2026 (1).xlsx" (${r.sheet}).`
        : isReset
        ? `Meter replaced — new meter starts from zero. The outgoing meter's final reading was not recorded, so ${prev.value} (its ${prev.date} reading) is used as its final: this month's usage is a floor, not the exact figure. Imported from "Meter Reading 2026 (1).xlsx" (${r.sheet}).`
        : `Imported from "Meter Reading 2026 (1).xlsx" (${r.sheet}).`,
    });
  }
}

const byDate = new Map();
for (const r of rows) byDate.set(r.date, (byDate.get(r.date) || 0) + 1);
console.log(`要汇入 ${rows.length} 笔`);
console.log("跳过:", skipped);
console.log("\n=== 按抄表日 ===");
console.table([...byDate].sort().map(([d, n]) => ({ 抄表日: d, 笔数: n })));
console.log(`\n=== 判定为换表的 ${resets.length} 笔（新读数 <= 上一期的 25%）===`);
console.table(resets);
console.log(`\n=== 下降但不像换表的 ${suspect.length} 笔 —— 需要人工确认 ===`);
console.table(suspect);
fs.writeFileSync(".claude-scratch/meter2026-resets.json", JSON.stringify({ resets, suspect }, null, 1));

if (!APPLY) { console.log("\n(dry run — 加 apply 才写入)"); await sql.end(); process.exit(0); }

const before = (await sql`SELECT count(*)::int n FROM meter_readings`)[0].n;
await sql.begin(async (tx) => {
  await tx`SET search_path TO public`;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await tx`
      INSERT INTO meter_readings ${tx(
        chunk.map((r) => ({
          bed_space_id: r.bedId, room_id: r.roomId, reading_date: r.date,
          reading_value: r.value, reading_type: r.readingType,
          replaced_meter_final: r.replacedMeterFinal,
          submitted_by: "Excel import", notes: r.notes,
        })),
        "bed_space_id", "room_id", "reading_date", "reading_value",
        "reading_type", "replaced_meter_final", "submitted_by", "notes",
      )}`;
  }
});
const after = (await sql`SELECT count(*)::int n FROM meter_readings`)[0].n;
console.log(`\nmeter_readings: ${before} → ${after}`);
await sql.end();
