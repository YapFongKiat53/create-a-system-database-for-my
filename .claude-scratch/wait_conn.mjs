// 等 Supavisor 释放掉那些没被关闭的 client 连线，然后回报现况。
import postgres from "postgres";

for (let attempt = 1; attempt <= 12; attempt++) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    await sql`SET search_path TO public`;
    const [r] = await sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database()`;
    console.log(`第 ${attempt} 次尝试：连上了，资料库端 ${r.n} 条连线`);
    await sql.end();
    process.exit(0);
  } catch (e) {
    console.log(`第 ${attempt} 次尝试：${String(e.message).slice(0, 60)}`);
    await sql.end({ timeout: 1 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 15000));
  }
}
console.log("十二次都连不上 —— 连线池仍然是满的。");
