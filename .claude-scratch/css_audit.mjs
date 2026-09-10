import fs from "node:fs";
import path from "node:path";

const CSS = "app/globals.css";
const src = fs.readFileSync(CSS, "utf8");

// 逐字扫过整份档案，追踪目前在第几层大括号、以及是不是在 @media 里面。
// 缩排在这份档案里只是排版习惯，不代表巢状，所以不能靠缩排判断。
const lines = src.split("\n");
const rules = []; // { selector, line, inMedia, mediaCond }
let depth = 0;
const stack = []; // 每一层是 { type: 'media'|'rule', cond }
let buffer = "";

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  // 去掉整行注解与行内注解，避免把注解里的 { } 算进去
  const line = raw.replace(/\/\*.*?\*\//g, "");
  for (const ch of line) {
    if (ch === "{") {
      const sel = buffer.trim().replace(/\s+/g, " ");
      const isAt = sel.startsWith("@");
      if (depth === 0 || stack.every((s) => s.type === "media")) {
        if (!isAt)
          rules.push({
            selector: sel,
            line: i + 1,
            inMedia: stack.some((s) => s.type === "media"),
            mediaCond: stack.filter((s) => s.type === "media").map((s) => s.cond).join(" & "),
          });
      }
      stack.push({ type: isAt && sel.startsWith("@media") ? "media" : "rule", cond: sel });
      depth++;
      buffer = "";
    } else if (ch === "}") {
      stack.pop();
      depth--;
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  buffer += " ";
}

// 从选择器里抽出 class 名称
const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

const base = new Map(); // class -> [line]
const media = new Map(); // class -> [{line, cond}]
for (const r of rules)
  for (const c of new Set(classesOf(r.selector)))
    if (r.inMedia) {
      if (!media.has(c)) media.set(c, []);
      media.get(c).push({ line: r.line, cond: r.mediaCond, selector: r.selector });
    } else {
      if (!base.has(c)) base.set(c, []);
      base.get(c).push(r.line);
    }

// 有没有在程式里被用到
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?|html)$/.test(entry.name)) files.push(full);
  }
};
walk("app");
if (fs.existsSync("components")) walk("components");
const code = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const used = (c) => new RegExp(`["'\`\\s{(:,]${c.replace(/[-]/g, "\\-")}["'\`\\s})\\,\\$]`).test(code);

const mediaOnly = [...media.keys()].filter((c) => !base.has(c)).sort();
const dead = mediaOnly.filter((c) => !used(c));
const live = mediaOnly.filter((c) => used(c));

console.log(`class 总数（有 base 规则的）: ${base.size}`);
console.log(`只出现在 @media 里的: ${mediaOnly.length}`);
console.log(`  其中程式里还有用到: ${live.length}`);
console.log(`  其中程式里完全没用: ${dead.length}\n`);

console.log("=== 还在用、但只有手机版样式 ===");
for (const c of live) {
  const decls = media.get(c);
  console.log(`.${c}`);
  for (const d of decls) console.log(`    line ${d.line}  ${d.cond}  →  ${d.selector}`);
}
console.log("\n=== 死 CSS（程式里搜不到）===");
for (const c of dead) {
  const decls = media.get(c);
  console.log(`.${c}  (${decls.map((d) => `line ${d.line}`).join(", ")})`);
}
fs.writeFileSync(
  ".claude-scratch/css-audit.json",
  JSON.stringify({ live, dead, media: Object.fromEntries(media) }, null, 1),
);
