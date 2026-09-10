// 直接打真正的 POST /api/system —— 需要登入，所以改成呼叫守卫逻辑本身。
// 这里验的是：守卫在真实资料上会不会正确挡下来。
import postgres from "postgres";
import {
  checkMeterJump,
  checkOverpayment,
  checkRentOutlier,
  DEFAULT_GUARDS,
} from "../app/api/system/money.ts";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const run = (label, fn) => {
  try {
    fn();
    console.log(`  ${label}\n    → 放行`);
  } catch (e) {
    console.log(`  ${label}\n    → 挡下：${e.message}`);
  }
};

console.log("=== 抄表暴增 ===");
run("正常：89 度", () =>
  checkMeterJump(89, DEFAULT_GUARDS, { roomCode: "NE-1002-A", previous: 100, current: 189 }),
);
run("多打一位：11,160 度", () =>
  checkMeterJump(11160, DEFAULT_GUARDS, { roomCode: "NE-1002-A", previous: 1240, current: 12400 }),
);

console.log("\n=== 超收 ===");
run("刚好付清：欠 480 收 480", () =>
  checkOverpayment(480, DEFAULT_GUARDS, { outstanding: 480, invoiceNo: "INV-1-2" }),
);
run("多付一点：欠 480 收 500", () =>
  checkOverpayment(500, DEFAULT_GUARDS, { outstanding: 480, invoiceNo: "INV-1-2" }),
);
run("多一个 0：欠 480 收 4,800", () =>
  checkOverpayment(4800, DEFAULT_GUARDS, { outstanding: 480, invoiceNo: "INV-1-2" }),
);

console.log("\n=== 月租异常 ===");
run("正常：620", () => checkRentOutlier(620, DEFAULT_GUARDS, { label: "NE-1002-A" }));
run("整间出租：7,400", () => checkRentOutlier(7400, DEFAULT_GUARDS, { label: "SR12-A" }));

console.log("\n=== 删发票守卫：真实资料 ===");
const invoices = await sql`
  SELECT i.id, i.invoice_no, c.period_label, c.status cycle_status,
         COALESCE((SELECT count(*) FROM billing_payment_records p WHERE p.invoice_id = i.id), 0) payments
  FROM billing_invoices i JOIN billing_cycles c ON c.id = i.cycle_id ORDER BY i.id`;
console.table(
  invoices.map((x) => ({
    invoice: x.invoice_no,
    cycle: x.period_label,
    status: x.cycle_status,
    收款笔数: Number(x.payments),
    会被挡吗: Number(x.payments) > 0 ? "会（有收款）" : x.cycle_status !== "draft" ? "会（已过帐）" : "不会",
  })),
);
await sql.end();
