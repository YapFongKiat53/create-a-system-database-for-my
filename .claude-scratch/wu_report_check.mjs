import fs from "node:fs";
const units = JSON.parse(fs.readFileSync(".claude-scratch/report.json","utf8"));
console.log("=== 每个 unit 的总电费 ===");
console.table(units.map(u=>({unit:u.unitCode, hostel:u.hostelName, billedTo:u.billedTo,
  covered:u.covered, rooms:`${u.roomsRead}/${u.rooms.length}`, kWh:u.usage, rate:u.rate, total:u.amount})));
console.log("合计 RM", units.reduce((s,u)=>s+u.amount,0));

for (const code of ["NE-1512","SR3"]) {
  const u = units.find(x=>x.unitCode===code);
  console.log(`\n=== ${code} 逐间房 ===  (billed to ${u.billedTo})`);
  console.table(u.rooms.map(r=>({room:r.roomCode, prev:r.previousReading, prevDate:r.previousDate,
    curr:r.currentReading, currDate:r.currentDate, kWh:r.usage, amount:r.amount})));
  const sum = u.rooms.reduce((s,r)=>s+r.amount,0);
  console.log(`房间加总 RM ${sum} vs unit 总额 RM ${u.amount}  ->`, sum===u.amount ? "一致 ✓" : "不一致 ✗");
  console.log(`kWh 加总 ${u.rooms.reduce((s,r)=>s+r.usage,0)} vs ${u.usage}`);
}
const bad = units.filter(u=>u.rooms.reduce((s,r)=>s+r.amount,0)!==u.amount);
console.log("\n所有 unit 中房间加总 != unit 总额 的:", bad.length ? bad.map(u=>u.unitCode) : "无");
