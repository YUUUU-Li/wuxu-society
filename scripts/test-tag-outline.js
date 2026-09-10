// 标签大纲单测: node scripts/test-tag-outline.js
// 校验: 词表完整性 / 生成物同步 / 作品意象收敛到大纲 / 历史写法映射
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalize } = require("./normalize-imageries.js");

const ROOT = path.join(__dirname, "..");
const O = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_data", "tag_outline.json"), "utf8"));
const words = O.categories.flatMap((c) => c.words);

// 1) 词表本身
assert.strictEqual(words.length, new Set(words).size, "词表不得重复");
assert(words.length >= 90, `词表规模应 ≥90, 实得 ${words.length}`);
assert(words.every((w) => O.hints[w]), "每个词都要有释义");
assert(O.categories.map((c) => c.key).join(",") === "imagery,emotion,technique,theme", "四大类齐全");
assert(O.near.every((g) => g.length >= 2 && g.every((w) => words.indexOf(w) !== -1)), "近义组词都在大纲内");
assert(JSON.stringify(O.categories.map((c) => c.words.length)) === JSON.stringify([35, 19, 29, 11]),
  `分类词数应为 35/19/29/11, 实得 ${O.categories.map((c) => c.words.length).join("/")}`);
// 归并表不得含自映射(夜景->夜景 这类): 自映射会让「整理历史标签」把该大纲词连同票一起删掉
assert(!Object.entries(O.legacy || {}).some(([k, v]) => k === v),
  "legacy 不得含自映射: " + Object.entries(O.legacy || {}).filter(([k, v]) => k === v).map(([k]) => k).join(" "));

// 2) 生成物与 JSON 同步(Worker 用的 modules)
const genPath = path.join(ROOT, "functions", "api", "tag-outline.js");
const before = fs.readFileSync(genPath, "utf8");
const { build } = require("./sync-tag-outline.js");
build();
assert.strictEqual(fs.readFileSync(genPath, "utf8"), before, "functions/api/tag-outline.js 应已同步(跑 npm run sync-tags)");
assert(before.includes(`${words.length} 个标签词`) === false && before.includes("TAG_HINTS"), "生成物含词表与释义");

// 3) 作品意象收敛到大纲词
const inv = new Set(words);
const bad = [];
for (const f of fs.readdirSync(path.join(ROOT, "src", "works"))) {
  if (!f.endsWith(".md")) continue;
  const m = /^imageries:\s*\[(.*?)\]/m.exec(fs.readFileSync(path.join(ROOT, "src", "works", f), "utf8"));
  if (!m) continue;
  m[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean)
    .forEach((w) => { if (!inv.has(w)) bad.push(`${f.slice(0, -3)}:${w}`); });
}
assert.strictEqual(bad.length, 0, "作品意象应全部是大纲词: " + bad.join(" "));

// 4) 历史写法映射(归一化)
assert.deepStrictEqual(normalize(["离别相思"]), ["离愁"]);
assert.deepStrictEqual(normalize(["月星"]), ["月", "星"]);
assert.deepStrictEqual(normalize(["春", "江"]), ["春景", "水"]);
assert.deepStrictEqual(normalize(["风物"]), [], "大纲外词应被丢弃");
assert.deepStrictEqual(normalize(["离愁", "离愁"]), ["离愁"], "去重");

console.log(`✅ test-tag-outline.js 全部通过 (${words.length} 词 · 释义齐 · 生成物同步 · 作品意象全在大纲内 · 历史写法映射)`);
