import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
console.log("残留测试读数:", (await sql`SELECT count(*)::int n FROM meter_readings WHERE submitted_by='TEST' OR notes LIKE '%delete me%'`)[0].n);
console.log("cycle 14 的发票数:", (await sql`SELECT count(*)::int n FROM billing_invoices WHERE cycle_id=14`)[0].n);
console.table((await sql`SELECT id, period_label, cutoff_date, due_date, status FROM billing_cycles ORDER BY id`).map(x=>({...x})));
console.table((await sql`SELECT reading_date, count(*)::int n FROM meter_readings GROUP BY reading_date ORDER BY reading_date DESC LIMIT 4`).map(x=>({...x})));
await sql.end();
