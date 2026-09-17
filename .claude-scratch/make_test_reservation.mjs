// 建一笔明确标记的测试预订，验完就删。不碰任何真实资料。
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const MARK = "PROMOTE TEST — delete me";

if (process.argv[2] === "clean") {
  const ids = (await sql`SELECT id FROM reservations WHERE notes = ${MARK}`).map((r) => r.id);
  for (const id of ids) {
    const profiles = (
      await sql`SELECT id FROM student_profiles WHERE source_key = ${"reservation:" + id}`
    ).map((p) => p.id);
    for (const pid of profiles) {
      const invoices = (await sql`SELECT id FROM billing_invoices WHERE student_id = ${pid}`).map((i) => i.id);
      for (const iid of invoices) {
        await sql`DELETE FROM billing_payment_records WHERE invoice_id = ${iid}`;
        await sql`DELETE FROM billing_items WHERE invoice_id = ${iid}`;
        await sql`DELETE FROM billing_invoices WHERE id = ${iid}`;
      }
      const beds = (
        await sql`SELECT bed_space_id FROM accommodation_assignments WHERE student_id = ${pid}`
      ).map((a) => a.bed_space_id);
      await sql`DELETE FROM accommodation_assignments WHERE student_id = ${pid}`;
      for (const bed of beds)
        await sql`UPDATE bed_spaces SET status = 'vacant' WHERE id = ${bed}`;
      await sql`DELETE FROM student_profiles WHERE id = ${pid}`;
    }
    await sql`DELETE FROM reservation_payments WHERE reservation_id = ${id}`;
    await sql`DELETE FROM reservation_charges WHERE reservation_id = ${id}`;
    await sql`DELETE FROM reservations WHERE id = ${id}`;
  }
  console.log("已清掉", ids.length, "笔测试预订及其连带资料");
  await sql.end();
  process.exit(0);
}

// 找一张真正空着的床
const [bed] = await sql`
  SELECT b.id, u.unit_code || '-' || r.room_label AS code
  FROM bed_spaces b JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostel_units u ON u.id = r.unit_id
  WHERE b.status = 'vacant' ORDER BY b.id LIMIT 1`;
if (!bed) throw new Error("找不到空床可以测试");

const make = async (label, type, provisional) => {
  const [row] = await sql`
    INSERT INTO reservations
      (reference_no, student_name, reservation_type, status, target_move_in_date,
       provisional_bed_space_id, notes, total_payable, amount_paid, payment_status)
    VALUES (${"ZZTEST-" + Date.now() + "-" + label.length}, ${label}, ${type},
            'reserved', '2026-12-01', ${provisional},
            ${MARK}, 1000, 0, 'unpaid')
    RETURNING id`;
  return row.id;
};

const individual = await make("ZZ Promote Test", "individual", bed.id);
const noRoom = await make("ZZ No Room Test", "individual", null);
const group = await make("ZZ Group Test", "group", null);

// 个人那笔给它一笔收费，move-in 发票才有东西可列
await sql`
  INSERT INTO reservation_charges (reservation_id, charge_type, amount, paid_at)
  VALUES (${individual}, 'deposit', 1000, ${new Date().toISOString()})`;

console.log(JSON.stringify({ bed: bed.code, individual, noRoom, group }));
await sql.end();
