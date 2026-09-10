import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

// House rule (runScheduledBilling): cut off on day 24 of the billing month,
// due on day 5 of the month after. Both of these drafts predate that being
// enforced anywhere but the scheduler — 2026-10 was typed as 2026-09-28,
// four days after September's cut-off, which would have billed October with
// almost no electricity at all.
const fixes = [
  { period: "2026-08", cutoff: "2026-08-24", due: "2026-09-05" },
  { period: "2026-10", cutoff: "2026-10-24", due: "2026-11-05" },
];

const before = await sql`SELECT id, period_label, cutoff_date, due_date, status FROM billing_cycles ORDER BY period_label`;
console.log("修改前:"); console.table(before.map(x=>({...x})));

// Refuse to touch a cycle that has already billed somebody — changing the
// dates under existing invoices would restate what tenants were told.
for (const fix of fixes) {
  const [row] = await sql`SELECT id, status FROM billing_cycles WHERE period_label=${fix.period}`;
  if (!row) { console.log(fix.period, "不存在，跳过"); continue; }
  const [{ n }] = await sql`SELECT count(*)::int n FROM billing_invoices WHERE cycle_id=${row.id}`;
  if (n > 0 || row.status !== "draft") {
    console.log(`${fix.period} 已有 ${n} 张发票 / 状态 ${row.status} — 不动，需人工决定`);
    continue;
  }
  await sql`UPDATE billing_cycles SET cutoff_date=${fix.cutoff}, due_date=${fix.due} WHERE id=${row.id}`;
  console.log(`${fix.period} -> cut-off ${fix.cutoff}, due ${fix.due}`);
}

const after = await sql`SELECT id, period_label, cutoff_date, due_date, status FROM billing_cycles ORDER BY period_label`;
console.log("\n修改后:"); console.table(after.map(x=>({...x})));
await sql.end();
