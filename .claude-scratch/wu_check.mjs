import fs from "node:fs";
const p = JSON.parse(fs.readFileSync(".claude-scratch/preview.json", "utf8"));
const elec = (r) => r.items.find((i) => i.itemType === "electricity");
const of = (prefix) => p.rows.filter((r) => (r.roomCode || "").startsWith(prefix));

console.log(`cycle ${p.cycleId} ${p.periodLabel}  发票 ${p.invoiceCount} 张  合计 RM ${p.totalBilled.toLocaleString()}  其中电费 RM ${p.electricityBilled.toLocaleString()}`);
console.log(`未抄表房间 ${p.unreadMeterRoomCount} 间`);

for (const [label, prefix] of [["【整间出租】NE-1512", "NE-1512"], ["【一般合租对照组】NE-1002", "NE-1002"]]) {
  console.log(`\n=== ${label} ===`);
  console.table(of(prefix).map((r) => {
    const e = elec(r);
    return { student: r.studentName, room: r.roomCode, rent: r.items.find(i=>i.itemType==="room-rental")?.amount ?? 0,
             kWh: e ? Number(e.quantity.toFixed(2)) : 0, elec: e ? e.amount : 0, total: r.total };
  }));
  const rows = of(prefix);
  console.log("电费合计 RM", rows.reduce((s,r)=>s+(elec(r)?.amount||0),0), " / kWh 合计", rows.reduce((s,r)=>s+(elec(r)?.quantity||0),0).toFixed(2));
  const withLine = rows.map(r=>elec(r)).filter(e=>e&&e.amount>0);
  for (const e of withLine) console.log("  明细:", e.description);
}
