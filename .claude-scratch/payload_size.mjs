import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

// 完整载入 GET /api/system 会一次送出的资料表
const tables = [
  "student_profiles", "accommodation_assignments", "bed_spaces", "hostel_rooms",
  "hostel_units", "reservations", "reservation_charges", "reservation_payments",
  "meter_readings", "maintenance_tickets", "ticket_messages",
  "billing_invoices", "billing_items", "billing_payment_records",
  "parking_rentals", "access_cards", "unit_services", "stored_attachments",
  "unit_owner_details", "student_rate_changes", "deposit_adjustments",
];

const rows = [];
let total = 0, totalBytes = 0;
for (const t of tables) {
  const [r] = await sql.unsafe(
    `SELECT count(*)::int AS n,
            COALESCE(pg_total_relation_size('${t}'), 0)::bigint AS bytes
     FROM ${t}`,
  );
  rows.push({ 资料表: t, 笔数: r.n, 约略大小: `${Math.round(Number(r.bytes) / 1024)} KB` });
  total += r.n;
  totalBytes += Number(r.bytes);
}
rows.sort((a, b) => b.笔数 - a.笔数);
console.table(rows);
console.log(`合计 ${total.toLocaleString()} 笔，资料库端约 ${Math.round(totalBytes / 1024 / 1024)} MB`);
console.log("（JSON 化之后通常比资料库端更大，因为栏位名称每一笔都重复一次）");
await sql.end();
