// 打 standalone 伺服器 N 次，看资料库端的连线数会不会一直往上累积。
// 每次 GET /api/system 会呼叫 getDb() 两到三次，每个 pool max: 20，而且
// 程式里没有任何地方呼叫 .end()。
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
await sql`SET search_path TO public`;

const count = async () => {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND application_name <> 'psql'`;
  return row.n;
};

const PORT = process.argv[2] || "3105";
const hit = async () => {
  try {
    await fetch(`http://localhost:${PORT}/api/system`);
  } catch {
    /* 401 也算数，我们只在乎有没有开连线 */
  }
};

console.log("起始连线数:", await count());
for (const round of [1, 2, 3]) {
  await Promise.all([hit(), hit(), hit(), hit(), hit()]);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`第 ${round} 轮（各 5 个并发请求）之后:`, await count());
}
await new Promise((r) => setTimeout(r, 8000));
console.log("闲置 8 秒后:", await count());
await sql.end();
