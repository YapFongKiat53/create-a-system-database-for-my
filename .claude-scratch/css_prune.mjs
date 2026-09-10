import fs from "node:fs";

const CSS = "app/globals.css";
const DEAD = new Set(JSON.parse(fs.readFileSync(".claude-scratch/css-audit.json", "utf8")).dead);
const APPLY = process.argv[2] === "apply";
const src = fs.readFileSync(CSS, "utf8");

// 用字元位移扫一次，记下每条规则「选择器的第一个字」到「结尾大括号」的范围。
// 分组选择器常常跨好几行，所以不能只记 { 那一行。
const rules = [];
const stack = [];
let selStart = -1;
let inComment = false;
for (let i = 0; i < src.length; i++) {
  if (inComment) {
    if (src[i] === "*" && src[i + 1] === "/") { inComment = false; i++; }
    continue;
  }
  if (src[i] === "/" && src[i + 1] === "*") { inComment = true; i++; continue; }
  const ch = src[i];
  if (ch === "{") {
    const sel = src.slice(selStart, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    stack.push({ sel, selStart, braceAt: i });
    selStart = -1;
  } else if (ch === "}") {
    const open = stack.pop();
    if (open && !open.sel.startsWith("@")) rules.push({ ...open, endAt: i });
    selStart = -1;
  } else if (selStart === -1 && !/\s/.test(ch)) {
    selStart = i;
  }
}

const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
const edits = [];
for (const r of rules) {
  const parts = r.sel.split(",").map((s) => s.trim()).filter(Boolean);
  const deadParts = parts.filter((p) => classesOf(p).some((c) => DEAD.has(c)));
  if (!deadParts.length) continue;
  const liveParts = parts.filter((p) => !deadParts.includes(p));
  if (liveParts.length)
    edits.push({ kind: "trim", from: r.selStart, to: r.braceAt, text: liveParts.join(",\n  ") + " ", dropped: deadParts });
  else edits.push({ kind: "drop", from: r.selStart, to: r.endAt + 1, dropped: parts });
}

// 由后往前套用，位移才不会跑掉
edits.sort((a, b) => b.from - a.from);
let out = src;
for (const e of edits) {
  if (e.kind === "drop") {
    // 连同规则后面的空白一起吃掉，不留下一整片空行
    let end = e.to;
    while (end < out.length && /[ \t]/.test(out[end])) end++;
    if (out[end] === "\n") end++;
    while (end < out.length && /^[ \t]*\n/.test(out.slice(end, out.indexOf("\n", end) + 1))) {
      const nl = out.indexOf("\n", end);
      if (nl === -1) break;
      end = nl + 1;
      break; // 只吃掉一行空行，保留原本的段落间距
    }
    let start = e.from;
    while (start > 0 && /[ \t]/.test(out[start - 1])) start--;
    out = out.slice(0, start) + out.slice(end);
  } else {
    out = out.slice(0, e.from) + e.text + out.slice(e.to);
  }
}

const dropped = edits.filter((e) => e.kind === "drop").length;
const trimmed = edits.filter((e) => e.kind === "trim").length;
console.log(`整条删除 ${dropped} 条规则，修剪选择器 ${trimmed} 条`);
console.log(`档案 ${src.length.toLocaleString()} → ${out.length.toLocaleString()} bytes（少 ${(src.length - out.length).toLocaleString()}，${(((src.length - out.length) / src.length) * 100).toFixed(2)}%）`);
console.log(`行数 ${src.split("\n").length} → ${out.split("\n").length}`);
console.log("\n=== 修剪的选择器 ===");
for (const e of edits.filter((x) => x.kind === "trim").reverse())
  console.log(`  保留 ${e.text.replace(/\n\s+/g, " ").trim()}   ← 移除 ${e.dropped.join(", ")}`);

// 括号必须仍然配对
const count = (s, ch) => (s.match(new RegExp("\\" + ch, "g")) || []).length;
const bal = count(out.replace(/\/\*[\s\S]*?\*\//g, ""), "{") - count(out.replace(/\/\*[\s\S]*?\*\//g, ""), "}");
console.log(`\n大括号平衡: ${bal === 0 ? "OK ✓" : `不平衡 ${bal} ✗`}`);

if (!APPLY) { console.log("\n(dry run — 加 apply 才写入)"); process.exit(0); }
if (bal !== 0) { console.error("括号不平衡，中止"); process.exit(1); }
fs.writeFileSync(CSS, out);
console.log("\n已写入", CSS);
