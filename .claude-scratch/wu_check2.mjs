import fs from "node:fs";
const p = JSON.parse(fs.readFileSync(".claude-scratch/preview.json","utf8"));
const elec = (r)=>r.items.find(i=>i.itemType==="electricity");
const rows = p.rows.filter(r=>(r.roomCode||"").startsWith("SR3-"));
console.log("=== SR3（两个付款人，按租金比例分摊）===");
console.table(rows.map(r=>({student:r.studentName, room:r.roomCode,
  rent:r.items.find(i=>i.itemType==="room-rental")?.amount??0,
  kWh:Number((elec(r)?.quantity??0).toFixed(2)), elec:elec(r)?.amount??0, total:r.total})));
for (const r of rows) { const e=elec(r); if(e) console.log(`\n${r.studentName}:\n  ${e.description}`); }
console.log("\nSR3 电费合计 RM", rows.reduce((s,r)=>s+(elec(r)?.amount||0),0));
console.log("\n全局: 发票", p.invoiceCount, "张 / 电费 RM", p.electricityBilled);
