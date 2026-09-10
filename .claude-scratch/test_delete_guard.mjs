// 跑跟 billing-invoice-delete 守卫一模一样的那段 SQL，看每一张发票会不会被挡。
// 不实际删除任何东西。
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const rows = await sql`
  SELECT i.id, i.invoice_no, c.period_label, c.status AS cycle_status,
         COALESCE(p.n, 0) AS payment_count,
         COALESCE(p.total, 0) AS payment_total
  FROM billing_invoices i
  LEFT JOIN billing_cycles c ON c.id = i.cycle_id
  LEFT JOIN (
    SELECT invoice_id, count(*) AS n, SUM(amount) AS total
    FROM billing_payment_records GROUP BY invoice_id
  ) p ON p.invoice_id = i.id
  ORDER BY i.id`;

if (!rows.length) {
  console.log("目前没有任何发票（三个帐期都还是空的 draft），所以拿现有资料测不到守卫。");
} else {
  console.table(
    rows.map((r) => ({
      invoice: r.invoice_no,
      cycle: r.period_label ? `${r.period_label} (${r.cycle_status})` : "move-in（无帐期）",
      收款: `${r.payment_count} 笔 / RM ${Number(r.payment_total).toLocaleString()}`,
      判定:
        Number(r.payment_count) > 0
          ? "⛔ 挡下（已收钱）"
          : r.cycle_status && r.cycle_status !== "draft"
            ? "⛔ 挡下（已过帐）"
            : "✅ 可以删",
    })),
  );
}

console.log("\n=== 反向确认：守卫用到的两个条件在资料库里都查得到 ===");
console.table(
  (await sql`
    SELECT c.period_label, c.status,
           (SELECT count(*)::int FROM billing_invoices i WHERE i.cycle_id = c.id) invoices,
           (SELECT count(*)::int FROM billing_payment_records p
              JOIN billing_invoices i2 ON i2.id = p.invoice_id WHERE i2.cycle_id = c.id) payments
    FROM billing_cycles c ORDER BY c.period_label`).map((x) => ({ ...x })),
);
await sql.end();
