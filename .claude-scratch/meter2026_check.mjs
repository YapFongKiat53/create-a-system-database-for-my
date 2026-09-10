import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const file = JSON.parse(fs.readFileSync(".claude-scratch/meter2026.json", "utf8"));

const rooms = await sql`
  SELECT r.id room_id, u.unit_code || '-' || r.room_label code, h.name hostel,
         (SELECT count(*)::int FROM meter_readings m WHERE m.room_id=r.id) readings
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id JOIN hostel_properties h ON h.id=u.hostel_id`;
const byCode = new Map(rooms.map(r => [r.code.toUpperCase(), r]));

const existing = await sql`
  SELECT COALESCE(m.room_id, b.room_id) room_id, m.reading_date, m.reading_value
  FROM meter_readings m LEFT JOIN bed_spaces b ON b.id = m.bed_space_id`;
const have = new Set(existing.map(e => `${e.room_id}|${e.reading_date}`));

const matched = [], unmatched = new Map();
for (const row of file) {
  const room = byCode.get(row.roomCode.toUpperCase());
  if (room) matched.push({ ...row, roomId: room.room_id, hostel: room.hostel, dbReadings: room.readings });
  else unmatched.set(row.roomCode, (unmatched.get(row.roomCode) || 0) + 1);
}
console.log(`档案 ${file.length} 笔 → 对到系统房间 ${matched.length} 笔；对不到 ${unmatched.size} 个房间代号 / ${[...unmatched.values()].reduce((a,b)=>a+b,0)} 笔`);

const isNew = matched.filter(r => !have.has(`${r.roomId}|${r.date}`));
console.log(`其中系统还没有的: ${isNew.length} 笔`);
const byDate = new Map();
for (const r of isNew) byDate.set(r.date, (byDate.get(r.date) || 0) + 1);
console.log("\n=== 系统还没有的读数，按抄表日 ===");
console.table([...byDate].sort().map(([d, n]) => ({ 抄表日: d, 笔数: n })));

// 97 间从来没抄过表的，档案里有没有
const never = rooms.filter(r => r.readings === 0);
const fileCodes = new Set(matched.map(r => r.roomCode.toUpperCase()));
const covered = never.filter(r => fileCodes.has(r.code.toUpperCase()));
console.log(`\n=== 那 97 间从没抄过表的房间 ===`);
console.log(`档案里有资料的: ${covered.length} 间 / 还是没有的: ${never.length - covered.length} 间`);
const stillNone = never.filter(r => !fileCodes.has(r.code.toUpperCase()));
const g = new Map();
for (const r of stillNone) { const k=r.hostel; if(!g.has(k)) g.set(k,[]); g.get(k).push(r.code); }
for (const [h, l] of g) console.log(`  ${h} (${l.length}): ${l.join(", ")}`);

console.log("\n=== 对不到系统的房间代号（前 40）===");
console.log([...unmatched.keys()].sort().slice(0, 40).join(", "));
console.log("共", unmatched.size, "个");
fs.writeFileSync(".claude-scratch/meter2026-matched.json", JSON.stringify(matched));
fs.writeFileSync(".claude-scratch/meter2026-new.json", JSON.stringify(isNew));
await sql.end();
