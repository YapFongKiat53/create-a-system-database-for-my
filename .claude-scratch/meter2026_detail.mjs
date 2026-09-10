import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const file = JSON.parse(fs.readFileSync(".claude-scratch/meter2026.json", "utf8"));

const dbRooms = await sql`
  SELECT u.unit_code, r.room_label, h.code hostel FROM hostel_rooms r
  JOIN hostel_units u ON u.id=r.unit_id JOIN hostel_properties h ON h.id=u.hostel_id`;
const dbUnits = new Map();
for (const r of dbRooms) {
  if (!dbUnits.has(r.unit_code)) dbUnits.set(r.unit_code, new Set());
  dbUnits.get(r.unit_code).add(r.room_label);
}
const fileUnits = new Map();
for (const r of file) {
  const i = r.roomCode.lastIndexOf("-");
  const unit = r.roomCode.slice(0, i), label = r.roomCode.slice(i + 1);
  if (!fileUnits.has(unit)) fileUnits.set(unit, new Set());
  fileUnits.get(unit).add(label);
}

console.log("=== 房间数量对不上的 unit（两边都有这个 unit）===");
const diff = [];
for (const [unit, labels] of fileUnits) {
  const db = dbUnits.get(unit);
  if (!db) continue;
  const extra = [...labels].filter((l) => !db.has(l));
  const missing = [...db].filter((l) => !labels.has(l));
  if (extra.length || missing.length)
    diff.push({ unit, 系统: [...db].sort().join(""), 档案: [...labels].sort().join(""),
      档案多出: extra.sort().join(",") || "-", 档案没有: missing.sort().join(",") || "-" });
}
console.table(diff);

console.log("\n=== 档案有、系统没有的 unit ===");
const orphanUnits = [...fileUnits.keys()].filter((u) => !dbUnits.has(u)).sort();
console.log(orphanUnits.join(", "));
console.log("\n=== 系统有、档案完全没有的 unit ===");
const missingUnits = [...dbUnits.keys()].filter((u) => !fileUnits.has(u)).sort();
console.log(missingUnits.join(", ") || "（无）");

// 资料品质：读数倒退 / 长期不动
console.log("\n=== 读数倒退（换表或抄错）===");
const byRoom = new Map();
for (const r of file) {
  if (!byRoom.has(r.roomCode)) byRoom.set(r.roomCode, []);
  byRoom.get(r.roomCode).push(r);
}
let drops = 0, dropSample = [];
for (const [code, list] of byRoom) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < list.length; i++)
    if (list[i].value < list[i - 1].value) {
      drops++;
      if (dropSample.length < 12)
        dropSample.push({ room: code, 从: `${list[i-1].date} ${list[i-1].value}`, 到: `${list[i].date} ${list[i].value}` });
    }
}
console.table(dropSample);
console.log("倒退共", drops, "处");

console.log("\n=== 2026-08-21 这一轮 ===");
const aug = file.filter((r) => r.date === "2026-08-21");
console.log(`${aug.length} 笔；其中读数为 0 的 ${aug.filter(r=>r.value===0).length} 笔`);
const augZero = aug.filter(r=>r.value===0).map(r=>r.roomCode);
console.log("为 0 的房间:", augZero.slice(0,30).join(", "), augZero.length>30?`… 共 ${augZero.length}`:"");
await sql.end();
