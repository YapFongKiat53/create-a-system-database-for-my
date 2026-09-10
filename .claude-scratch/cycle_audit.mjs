import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
console.table((await sql`
  SELECT c.id, c.period_label, c.cutoff_date, c.due_date, c.status, c.created_at,
         (SELECT count(*)::int FROM billing_invoices i WHERE i.cycle_id=c.id) invoices,
         (SELECT count(*)::int FROM billing_items t JOIN billing_invoices i2 ON i2.id=t.invoice_id WHERE i2.cycle_id=c.id) items
  FROM billing_cycles c ORDER BY c.period_label`).map(x=>({...x})));
await sql.end();
