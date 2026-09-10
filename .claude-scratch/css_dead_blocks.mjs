import fs from "node:fs";

const DEAD = new Set(JSON.parse(fs.readFileSync(".claude-scratch/css-audit.json", "utf8")).dead);
const src = fs.readFileSync("app/globals.css", "utf8");
const lines = src.split("\n");

// 找出每一条规则的起讫行与选择器
let stack = [], buf = "";
const rules = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].replace(/\/\*.*?\*\//g, "");
  for (const ch of line) {
    if (ch === "{") {
      const sel = buf.trim().replace(/\s+/g, " ");
      stack.push({ sel, start: i });
      buf = "";
    } else if (ch === "}") {
      const open = stack.pop();
      if (open && !open.sel.startsWith("@")) rules.push({ ...open, end: i });
      buf = "";
    } else buf += ch;
  }
  buf += " ";
}

const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
const touched = rules.filter((r) => classesOf(r.sel).some((c) => DEAD.has(c)));

let wholeRule = 0, partial = 0;
for (const r of touched) {
  const parts = r.sel.split(",").map((s) => s.trim());
  const deadParts = parts.filter((p) => classesOf(p).some((c) => DEAD.has(c)));
  const liveParts = parts.filter((p) => !deadParts.includes(p));
  const kind = liveParts.length ? "只删其中一段" : "整条删掉";
  if (liveParts.length) partial++; else wholeRule++;
  console.log(`\n--- line ${r.start + 1}-${r.end + 1}  [${kind}]`);
  console.log(lines.slice(r.start, r.end + 1).join("\n"));
  if (liveParts.length) console.log(`    ↑ 保留: ${liveParts.join(", ")}   删除: ${deadParts.join(", ")}`);
}
console.log(`\n共 ${touched.length} 条规则：整条删 ${wholeRule}，只删一段 ${partial}`);
