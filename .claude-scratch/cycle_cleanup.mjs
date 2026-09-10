import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const [row] = await sql`SELECT id FROM billing_cycles WHERE period_label='TEST-OLD'`;
if (row) {
  const [{ n }] = await sql`SELECT count(*)::int n FROM billing_invoices WHERE cycle_id=${row.id}`;
  if (n) { console.log("TEST-OLD 有发票，不删"); }
  else { await sql`DELETE FROM billing_cycles WHERE id=${row.id}`; console.log("已删除测试期别 TEST-OLD"); }
}
console.log("残留测试读数:", (await sql`SELECT count(*)::int n FROM meter_readings WHERE submitted_by='TEST'`)[0].n);
console.table((await sql`
  SELECT id, period_label, cutoff_date, due_date, status,
    (SELECT count(*)::int FROM billing_invoices i WHERE i.cycle_id=billing_cycles.id) invoices
  FROM billing_cycles ORDER BY period_label`).map(x=>({...x})));
await sql.end();
