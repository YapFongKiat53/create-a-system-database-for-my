import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const total = (await sql`SELECT count(*)::int n FROM meter_readings`)[0].n;
console.log("目前总笔数:", total.toLocaleString());

for (const keep of [2, 3, 4, 6, 8]) {
  const [r] = await sql.unsafe(`
    SELECT count(*)::int AS n FROM (
      SELECT ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY reading_date DESC, id DESC) rn
      FROM meter_readings WHERE room_id IS NOT NULL
    ) x WHERE rn <= ${keep}`);
  console.log(`  每间房保留最近 ${keep} 笔 → ${r.n.toLocaleString()} 笔（省下 ${Math.round((1 - r.n / total) * 100)}%）`);
}

console.log("\n可选月份共有:",
  (await sql`SELECT count(DISTINCT to_char(reading_date::date,'YYYY-MM'))::int n FROM meter_readings`)[0].n, "个");

// 我汇入时写的 notes 有多占空间
const [notes] = await sql`
  SELECT count(*) FILTER (WHERE notes <> '')::int with_notes,
         COALESCE(SUM(length(notes)), 0)::int total_len
  FROM meter_readings`;
console.log(`notes 栏位：${notes.with_notes.toLocaleString()} 笔有值，合计 ${Math.round(notes.total_len / 1024)} KB`);
await sql.end();
