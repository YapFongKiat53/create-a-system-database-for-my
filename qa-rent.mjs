import fs from "node:fs"; import postgres from "postgres";
const DIR="/private/tmp/claude-501/-Users-yapfongkiat-create-a-system-database-for-my/332348ac-d9bd-4786-8715-6c2178c06c4b/scratchpad";
const rows=JSON.parse(fs.readFileSync(`${DIR}/import/rows.json`,"utf8"));
const url = fs.readFileSync(".dev.vars","utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)[1];
const sql = postgres(url, { prepare: false });
const APPLY=process.argv.includes("--apply");
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z]/g,'');
const excelByBed=new Map(rows.filter(r=>r.kind==='tenant').map(r=>[r.bedCode,r]));

if(APPLY){
  const d=await sql`SELECT * FROM accommodation_assignments`;
  fs.writeFileSync(`${DIR}/backup/rent-assignments.json`, JSON.stringify(d,null,1));
  console.log("已备份 accommodation_assignments\n");
}

const db=await sql`
  SELECT a.id AS asg, b.legacy_code, s.full_name, h.name AS hostel,
         a.monthly_rental, a.security_deposit, a.access_card_deposit
  FROM accommodation_assignments a
  JOIN bed_spaces b ON b.id=a.bed_space_id
  JOIN hostel_rooms r ON r.id=b.room_id JOIN hostel_units u ON u.id=r.unit_id
  JOIN hostel_properties h ON h.id=u.hostel_id
  JOIN student_profiles s ON s.id=a.student_id
  WHERE a.status='active'`;

const fillRent=[], fixRent=[], fillDep=[], nameMismatch=[];
for(const d of db){
  const ex=excelByBed.get(d.legacy_code);
  if(!ex) continue;
  // 只在姓名对得上时才动金额，避免把钱套到错的人身上
  if(!(norm(d.full_name).includes(norm(ex.name).slice(0,12))||norm(ex.name).includes(norm(d.full_name).slice(0,12)))){
    nameMismatch.push({...d, ex}); continue;
  }
  const cur=d.monthly_rental===null?null:Number(d.monthly_rental);
  if(ex.rent!==null){
    if(cur===null||cur===0) fillRent.push({...d, ex});
    else if(Math.abs(cur-ex.rent)>0.5) fixRent.push({...d, ex});
  }
  const curDep=d.security_deposit===null?null:Number(d.security_deposit);
  if(ex.deposit!==null && (curDep===null||curDep===0) && ex.deposit>0) fillDep.push({...d, ex});
}
const sum=a=>a.reduce((s,x)=>s+(x.ex.rent||0),0);
console.log("=== 将要写入 ===");
console.log("  补租金（系统缺、Excel 有）   ", String(fillRent.length).padStart(4), " 月租合计 RM", sum(fillRent).toLocaleString());
console.log("  改租金（两边不同，以 Excel 为准）", String(fixRent.length).padStart(2));
console.log("  补押金（系统缺、Excel 有）   ", String(fillDep.length).padStart(4));
console.log("  姓名不符 → 跳过不动          ", String(nameMismatch.length).padStart(4));

console.log("\n=== 补租金：依 hostel ===");
const byH={};
fillRent.forEach(f=>{ const k=f.hostel; byH[k]=byH[k]||{n:0,sum:0}; byH[k].n++; byH[k].sum+=f.ex.rent||0; });
Object.entries(byH).forEach(([k,v])=>console.log(`  ${k.padEnd(20)} ${String(v.n).padStart(4)} 位   月租合计 RM ${v.sum.toLocaleString()}`));

console.log("\n=== 补租金：金额分布 ===");
const byR={}; fillRent.forEach(f=>{ byR[f.ex.rent]=(byR[f.ex.rent]||0)+1; });
Object.entries(byR).sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([r,n])=>console.log(`  RM ${String(r).padStart(6)}  × ${n}`));

if(fixRent.length){
  console.log("\n=== 改租金（以 Excel 为准）===");
  fixRent.forEach(f=>console.log(`  ${f.legacy_code.padEnd(14)} ${String(f.full_name).slice(0,26).padEnd(28)} 系统 ${String(f.monthly_rental).padStart(6)} → Excel ${String(f.ex.rent).padStart(6)}`));
}
if(nameMismatch.length){
  console.log("\n=== 姓名不符（不动，请你确认）===");
  nameMismatch.forEach(m=>console.log(`  ${m.legacy_code.padEnd(14)} 系统「${m.full_name}」  Excel「${m.ex.name}」`));
}

if(!APPLY){ console.log("\n[dry-run] 加 --apply 才会写入"); await sql.end(); process.exit(0); }
let n=0;
await sql.begin(async tx=>{
  for(const f of [...fillRent,...fixRent])
    { await tx`UPDATE accommodation_assignments SET monthly_rental=${f.ex.rent} WHERE id=${f.asg}`; n++; }
  for(const f of fillDep)
    await tx`UPDATE accommodation_assignments SET security_deposit=${f.ex.deposit},
      access_card_deposit=COALESCE(${f.ex.cardDeposit}, access_card_deposit) WHERE id=${f.asg}`;
});
console.log(`\n已更新租金 ${n} 笔、押金 ${fillDep.length} 笔`);
await sql.end();
