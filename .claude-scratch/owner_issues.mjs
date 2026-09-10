import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;

const all = JSON.parse(fs.readFileSync(".claude-scratch/owner-details.json", "utf8"));
const units = await sql`SELECT u.id, u.unit_code, h.code hostel, h.name hostel_name FROM hostel_units u JOIN hostel_properties h ON h.id=u.hostel_id`;
const byCode = new Map(units.map(u => [u.unit_code.toUpperCase(), u]));
const inDb = (c) => byCode.has(c.toUpperCase());

const issues = [];
const add = (severity, kind, unit, imported, detail, action) =>
  issues.push({ severity, kind, unit, imported, detail, action });

const NRIC = /^\d{6}-\d{2}-\d{4}$/;                 // 大马身分证
const COMPANY = /^\d{6,}-?[A-Z]?$|^\d{9,}-[A-Z]$/;  // 公司注册号
const PHONE = /^0\d{1,2}-?\s?\d{6,8}$/;

for (const r of all) {
  const imp = inDb(r.unitCode);
  const nric = r.ownerIdentityNo;
  // "A/L" and "A/P" (anak lelaki / anak perempuan) are part of one Malaysian
  // name, not a second owner — only a slash outside those means joint owners.
  const bare = r.ownerName.replace(/\bA\/[LP]\b/g, "");
  const multi = bare.includes("/");

  if (r.nameConflict)
    add("high", "两张表的业主名字不一致", r.unitCode, imp,
      `OWNER DETAILS: "${r.ownerName}" / AGREEMENT: "${r.nameConflict}"`,
      "确认哪一个才是登记业主");

  if (nric && nric === r.ownerName)
    add("high", "NRIC 栏填的是名字", r.unitCode, imp, `NRIC = "${nric}"`, "补上正确的身分证号");
  else if (nric && !multi && !NRIC.test(nric) && !COMPANY.test(nric))
    add("medium", "NRIC 格式不对", r.unitCode, imp, `"${nric}"`, "核对身分证/公司注册号");

  if (!nric) add("medium", "没有 NRIC", r.unitCode, imp, "空白", "补上身分证/公司注册号");
  if (!r.ownerName) add("high", "没有业主姓名", r.unitCode, imp, "空白", "补上业主姓名");

  const phone = r.contact;
  if (!phone) add("medium", "没有联络电话", r.unitCode, imp, "空白", "补上电话");
  else if (/^n\/?a$/i.test(phone)) add("medium", "电话写 N/A", r.unitCode, imp, `"${phone}"`, "补上电话");
  else if (!PHONE.test(phone.replace(/\s*\(.*\)$/, "")))
    add("low", "电话格式不寻常", r.unitCode, imp, `"${phone}"`, "核对号码");
  if (/\(.*\)/.test(phone))
    add("low", "电话带备注", r.unitCode, imp, `"${phone}"`, "确认是本人还是代理的号码");

  if (!r.address) add("medium", "没有通讯地址", r.unitCode, imp, "空白", "补上地址");
  else if (!/\b\d{5}\b/.test(r.address))
    add("low", "地址没有邮递区号", r.unitCode, imp, `"${r.address}"`, "补齐地址");

  if (multi)
    add("low", "一间 unit 多位业主", r.unitCode, imp, r.ownerName,
      "确认要不要拆成主要/次要联络人");

  if (imp && !r.leaseStartDate)
    add("medium", "有业主但没有合约条款", r.unitCode, imp, "没有租金、没有起讫日",
      "补上 AGREEMENT 那张表的资料");

  if (r.excelUnit.includes("/"))
    add("low", "一份合约涵盖多间 unit", r.unitCode, imp, `Excel 写 "${r.excelUnit}"`,
      "确认租金要不要分摊到各间");

  if (r.leaseEndDate && r.leaseEndDate < "2026-09-09" && imp)
    add("medium", "合约已过期", r.unitCode, imp, `到期日 ${r.leaseEndDate}`,
      "确认已续约还是资料没更新");
}

// Excel 有、系统没有的 unit
for (const r of all)
  if (!inDb(r.unitCode))
    add("info", "系统里没有这间 unit", r.unitCode, false,
      `Excel 写 "${r.excelUnit}"，业主 ${r.ownerName}`,
      "确认是不是公司管的；是的话要先建 unit");

// 系统有、Excel 没有的 unit
const covered = new Set(all.map(r => r.unitCode.toUpperCase()));
for (const u of units)
  if (!covered.has(u.unit_code.toUpperCase()))
    add("info", "这次的档案没有这间的业主", u.unit_code, false,
      `${u.hostel_name}`, "等后续的档案");

// 同一个身分证号，却留了不同的电话
const byNric = new Map();
for (const r of all) {
  if (!r.ownerIdentityNo || r.ownerIdentityNo === r.ownerName) continue;
  if (!byNric.has(r.ownerIdentityNo)) byNric.set(r.ownerIdentityNo, []);
  byNric.get(r.ownerIdentityNo).push(r);
}
for (const [nric, list] of byNric) {
  const phones = [...new Set(list.map((r) => r.contact).filter(Boolean))];
  if (phones.length > 1)
    add("medium", "同一人留了不同电话", list.map((r) => r.unitCode).join(", "),
      list.some((r) => inDb(r.unitCode)),
      `${list[0].ownerName}（${nric}）: ${phones.join(" / ")}`,
      "确认哪一个是现用号码");
  const names = [...new Set(list.map((r) => r.ownerName).filter(Boolean))];
  if (names.length > 1)
    add("medium", "同一个身分证号，名字不同", list.map((r) => r.unitCode).join(", "),
      list.some((r) => inDb(r.unitCode)), `${nric}: ${names.join(" / ")}`,
      "确认是同一人还是打错号码");
}

// 同一位业主持有多间
const byOwner = new Map();
for (const r of all) {
  if (!r.ownerName) continue;
  if (!byOwner.has(r.ownerName)) byOwner.set(r.ownerName, []);
  byOwner.get(r.ownerName).push(r.unitCode);
}
for (const [name, list] of byOwner)
  if (list.length > 1)
    add("info", "同一位业主持有多间", list.join(", "), list.some(inDb), name,
      "确认是同一人（不是同名）");

const order = { high: 0, medium: 1, low: 2, info: 3 };
issues.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || String(a.unit).localeCompare(String(b.unit)));
fs.writeFileSync(".claude-scratch/owner-issues.json", JSON.stringify(issues, null, 1));

const counts = new Map();
for (const i of issues) counts.set(`${i.severity} · ${i.kind}`, (counts.get(`${i.severity} · ${i.kind}`) || 0) + 1);
console.log("共", issues.length, "项：");
console.table([...counts].map(([k, n]) => ({ 类别: k, 笔数: n })));
await sql.end();
