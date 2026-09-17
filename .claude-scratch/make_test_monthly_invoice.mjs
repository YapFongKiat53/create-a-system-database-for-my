// 建一笔明确标记的测试月费发票（挂在测试学生 testing 11 身上），验完就删。
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const MARK = "ZZTEST-CYCLE";

if (process.argv[2] === "clean") {
  const cycles = (await sql`SELECT id FROM billing_cycles WHERE period_label = ${MARK}`).map((c) => c.id);
  for (const cycleId of cycles) {
    const invoices = (await sql`SELECT id FROM billing_invoices WHERE cycle_id = ${cycleId}`).map((i) => i.id);
    for (const id of invoices) {
      await sql`DELETE FROM billing_payment_records WHERE invoice_id = ${id}`;
      await sql`DELETE FROM billing_items WHERE invoice_id = ${id}`;
      await sql`DELETE FROM billing_invoices WHERE id = ${id}`;
    }
    await sql`DELETE FROM billing_cycles WHERE id = ${cycleId}`;
  }
  console.log("已清掉测试帐单周期：", cycles.length);
  await sql.end();
  process.exit(0);
}

const [student] = await sql`
  SELECT p.id, p.full_name, a.id AS assignment_id
  FROM student_profiles p
  JOIN accommodation_assignments a ON a.student_id = p.id AND a.status = 'active'
  WHERE p.full_name = 'testing 11' LIMIT 1`;
if (!student) throw new Error("找不到测试学生 testing 11");

const [cycle] = await sql`
  INSERT INTO billing_cycles (period_label, cutoff_date, due_date, status)
  VALUES (${MARK}, '2026-09-24', '2026-10-05', 'draft')
  RETURNING id`;

const [invoice] = await sql`
  INSERT INTO billing_invoices
    (invoice_no, cycle_id, student_id, assignment_id, due_date, status, total_amount, amount_paid, invoice_frequency)
  VALUES (${"ZZTEST-INV-" + Date.now().toString().slice(-6)}, ${cycle.id}, ${student.id},
          ${student.assignment_id}, '2026-10-05', 'partial', 1250, 400, 'monthly')
  RETURNING id, invoice_no`;

await sql`
  INSERT INTO billing_items (invoice_id, item_type, description, amount)
  VALUES (${invoice.id}, 'room-rental', 'Room rental — September 2026', 1000),
         (${invoice.id}, 'electricity', 'Electricity 120 kWh @ 0.751', 90.12),
         (${invoice.id}, 'parking', 'Parking — September 2026', 159.88)`;

await sql`
  INSERT INTO billing_payment_records
    (invoice_id, amount, verified_amount, status, reference, receipt_no, submitted_at, verified_at, verified_by)
  VALUES (${invoice.id}, 400, 400, 'verified', 'TRX-778899', 'RCPT-0042',
          '2026-09-05T02:00:00Z', '2026-09-05T06:00:00Z', 'Accounts')`;

console.log(JSON.stringify({ student: student.full_name, studentId: student.id, invoice: invoice.invoice_no }));
await sql.end();
