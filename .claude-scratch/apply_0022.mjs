// 套用 0022：maintenance_tickets.turnover_stage，并补上两个工单分类。
// 纯新增，不改动任何既有资料。
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 2,
  idle_timeout: 10,
});
await sql`SET search_path TO public`;

const before = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'maintenance_tickets' AND column_name = 'turnover_stage'`;
if (before.length) {
  console.log("turnover_stage 已经存在，跳过");
} else {
  await sql`ALTER TABLE maintenance_tickets ADD COLUMN turnover_stage text`;
  console.log("已加上 turnover_stage");
}

for (const subcategory of ["Inspection", "Cleaning"]) {
  const [existing] = await sql`
    SELECT id FROM ticket_categories
    WHERE category = 'Turnover' AND subcategory = ${subcategory}`;
  if (existing) {
    console.log(`分类 Turnover / ${subcategory} 已经存在`);
    continue;
  }
  await sql`
    INSERT INTO ticket_categories (category, subcategory, status, sort_order)
    VALUES ('Turnover', ${subcategory}, 'active', 900)`;
  console.log(`已加入分类 Turnover / ${subcategory}`);
}

const [{ n }] = await sql`
  SELECT count(*)::int n FROM maintenance_tickets WHERE turnover_stage IS NOT NULL`;
console.log(`现有带 turnover_stage 的工单：${n} 张（应该是 0）`);
await sql.end();
