import fs from "node:fs";
const p = JSON.parse(fs.readFileSync(".claude-scratch/bill_aug.json", "utf8"));
const elec = (r) => r.items.find((i) => i.itemType === "electricity");
const of = (prefix) => p.rows.filter((r) => (r.roomCode || "").startsWith(prefix));

console.log(`cycle ${p.cycleId} ${p.periodLabel}  发票 ${p.invoiceCount} 张`);
console.log(`总额 RM ${p.totalBilled.toLocaleString()} · 电费 RM ${p.electricityBilled.toLocaleString()}`);
console.log(`未抄表房间 ${p.unreadMeterRoomCount} 间（其中从没抄过 ${p.neverReadRoomCount} 间）`);

console.log("\n=== ① 换表的房间：NB-0809（整个 unit 换表）===");
console.table(
  of("NB-0809").map((r) => {
    const e = elec(r);
    return { student: r.studentName.slice(0, 22), room: r.roomCode,
      kWh: e ? Number(e.quantity.toFixed(2)) : 0, elec: e?.amount ?? 0 };
  }),
);
for (const r of of("NB-0809")) {
  const e = elec(r);
  if (e) { console.log("  说明:", e.description); break; }
}

console.log("\n=== ② TNB 直接计费：SR12 / SR31 ===");
const tnb = [...of("SR12-"), ...of("SR31-")];
console.log(`${tnb.length} 张发票；其中有电费行的 ${tnb.filter((r) => elec(r)).length} 张`);
console.table(
  tnb.slice(0, 5).map((r) => ({ student: r.studentName.slice(0, 24), room: r.roomCode,
    rent: r.items.find((i) => i.itemType === "room-rental")?.amount ?? 0,
    elec: elec(r)?.amount ?? "（无电费行）", total: r.total })),
);
console.log("未抄表清单里有没有 SR12/SR31:",
  p.unreadMeterRooms.some((x) => /^SR(12|31)-/.test(x.roomCode)) ? "有 ✗" : "没有 ✓");

console.log("\n=== ③ 一般合租对照：NE-1002 ===");
console.table(
  of("NE-1002").map((r) => {
    const e = elec(r);
    return { student: r.studentName.slice(0, 22), room: r.roomCode,
      kWh: e ? Number(e.quantity.toFixed(2)) : 0, elec: e?.amount ?? 0 };
  }),
);

console.log("\n=== ④ 整间出租：原本 0/N 没抄表的几间 ===");
for (const u of ["NE-13A05", "NE-13A11A", "NE-1711A"]) {
  const rows = of(u + "-");
  const payer = rows.find((r) => elec(r));
  console.log(`${u}: ${rows.length} 张发票`, payer
    ? `→ ${payer.studentName}: ${elec(payer).quantity.toFixed(2)} kWh / RM ${elec(payer).amount}`
    : "→ 没有电费行");
  if (payer) console.log("   ", elec(payer).description.slice(0, 150));
}
