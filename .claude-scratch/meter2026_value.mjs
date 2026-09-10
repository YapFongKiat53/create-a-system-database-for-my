import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const file = JSON.parse(fs.readFileSync(".claude-scratch/meter2026-matched.json", "utf8"));

const rates = new Map((await sql`SELECT h.code, h.electricity_rate rate FROM hostel_properties h`).map(r => [r.code, Number(r.rate)]));
const rooms = await sql`
  SELECT r.id room_id, u.unit_code||'-'||r.room_label code, h.code hostel,
         (SELECT count(*)::int FROM meter_readings m WHERE m.room_id=r.id) db_readings
  FROM hostel_rooms r JOIN hostel_units u ON u.id=r.unit_id JOIN hostel_properties h ON h.id=u.hostel_id`;
const info = new Map(rooms.map(r => [r.code.toUpperCase(), r]));

const byRoom = new Map();
for (const r of file) {
  const k = r.roomCode.toUpperCase();
  if (!byRoom.has(k)) byRoom.set(k, []);
  byRoom.get(k).push(r);
}

let billable = 0, kwh = 0, money = 0, newlyBillable = 0, newKwh = 0, newMoney = 0;
for (const [code, list] of byRoom) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  const aug = list.find(x => x.date === "2026-08-21");
  if (!aug) continue;
  const prev = list[list.indexOf(aug) - 1];
  if (!prev || aug.value <= prev.value) continue;
  const room = info.get(code);
  const rate = rates.get(room.hostel) || 0;
  const use = aug.value - prev.value;
  billable++; kwh += use; money += use * rate;
  if (room.db_readings === 0) { newlyBillable++; newKwh += use; newMoney += use * rate; }
}
console.log(`如果汇入，2026-07/08 这一期可以收的电费：`);
console.log(`  ${billable} 间房 · ${Math.round(kwh).toLocaleString()} kWh · 约 RM ${Math.round(money).toLocaleString()}`);
console.log(`  其中原本从没抄过表的 ${newlyBillable} 间 · ${Math.round(newKwh).toLocaleString()} kWh · 约 RM ${Math.round(newMoney).toLocaleString()}`);

const never = rooms.filter(r => r.db_readings === 0);
const covered = never.filter(r => byRoom.has(r.code.toUpperCase()));
const twoPlus = covered.filter(r => (byRoom.get(r.code.toUpperCase()) || []).length >= 2);
console.log(`\n那 97 间从没抄过表的：档案里有 ${covered.length} 间，其中 ${twoPlus.length} 间已经有两笔以上读数`);
console.log("→ 汇入后立刻就能收费，不用再等两轮");
await sql.end();
