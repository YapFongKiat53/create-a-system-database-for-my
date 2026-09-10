import fs from "node:fs";
const p = JSON.parse(fs.readFileSync(".claude-scratch/preview.json","utf8"));
const BLOCK = ["D1-0614","D1-0805","D3-0213","D3-0405","D3-0916","NE-1201","NE-13A05","NE-13A11A","NE-1503","NE-1509","NE-1512","NE-1711A","NE-1911","SR12","SR23","SR2A","SR3","SR31","SR5"];
const unitOf = (roomCode) => BLOCK.find((u) => (roomCode||"").startsWith(u + "-"));
let covered = 0, payerLines = 0, bad = [];
for (const r of p.rows) {
  const u = unitOf(r.roomCode);
  if (!u) continue;
  const e = r.items.find(i=>i.itemType==="electricity");
  const rent = r.items.find(i=>i.itemType==="room-rental")?.amount ?? 0;
  if (rent > 0) { if (e) payerLines++; }
  else { covered++; if (e && e.amount>0) bad.push({student:r.studentName, room:r.roomCode, amount:e.amount}); }
  if (e && !e.description.startsWith("Electricity — whole unit")) bad.push({student:r.studentName, room:r.roomCode, desc:e.description});
}
console.log(`block-let unit 内: 付款人开出电费行 ${payerLines} 条；零租住户仍有帐单 ${covered} 人`);
console.log("异常:", bad.length ? bad : "无");
// 一般 unit 完全没有被误判成整间出租
const wrong = p.rows.filter(r => !unitOf(r.roomCode) && r.items.some(i => i.itemType==="electricity" && i.description.includes("whole unit")));
console.log("非 block-let 却被当整间出租的:", wrong.length ? wrong.map(r=>r.roomCode) : "无");
