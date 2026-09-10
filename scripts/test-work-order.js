// 作品排序口径单测: node scripts/test-work-order.js
// 校验 scripts/work-order.js(供 .eleventy.js 与 work-dates-report.js 共用):
//   1) 已填 created 者按 created 升序, 与 fulltext_order 位置无关;
//   2) 未填者不猜日期, 一律排在已填者之后, 组内保持原编排次序;
//   3) 同时对点稳定、空输入不炸;
//   4) 真仓库: 未填者恰好都在末尾, 已填部分确实升序, 不丢篇目/不重复。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { sortByCreated, undatedSlugs } = require("./work-order.js");

// 1) 与登记位置无关的升序
let order = ["a", "b", "c", "d"];
let created = { a: "2024-04", b: "2024-03-06", c: "2026-01", d: "2024-05-14" };
assert.deepStrictEqual(sortByCreated(order, created), ["b", "a", "d", "c"], "应按 created 升序");
assert.deepStrictEqual(undatedSlugs(order, created), [], "都填了就没有待考篇目");

// 2) 未填者列于其后, 且不继承前一篇的时点(旧口径的病根)
order = ["a", "b", "c", "d", "e"];
created = { a: "2024-04-04", c: "2024-03-06", e: "2026-06-05" };
assert.deepStrictEqual(sortByCreated(order, created), ["c", "a", "e", "b", "d"], "未填者应排在已填者之后");
assert.deepStrictEqual(undatedSlugs(order, created), ["b", "d"], "待考清单保持原次序");

// 3) 全未填 / 同时点 / 空输入
assert.deepStrictEqual(sortByCreated(["x", "y", "z"], {}), ["x", "y", "z"], "全未填应保持原次序");
assert.deepStrictEqual(sortByCreated(["p", "q", "r"], { p: "2024-04-04", q: "2024-04-04", r: "2024-04-04" }),
  ["p", "q", "r"], "同时点应稳定保持原次序");
assert.deepStrictEqual(sortByCreated([], {}), [], "空输入");
assert.deepStrictEqual(sortByCreated(null, null), [], "null 输入");
assert.deepStrictEqual(undatedSlugs(undefined, undefined), [], "undefined 输入");

// 4) 真仓库
const ROOT = path.join(__dirname, "..");
const ORDER = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_data", "fulltext_order.json"), "utf8"));
const files = new Set(fs.readdirSync(path.join(ROOT, "src", "works")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
const realCreated = {};
for (const slug of files) {
  const m = /^created:\s*"([^"]*)"/m.exec(fs.readFileSync(path.join(ROOT, "src", "works", slug + ".md"), "utf8"));
  if (m) realCreated[slug] = m[1];
}
const missingFile = ORDER.filter((s) => !files.has(s));
assert.deepStrictEqual(missingFile, [], "fulltext_order.json 里的标识都应有对应作品文件: " + missingFile.join(" "));
const sorted = sortByCreated(ORDER, realCreated);
const undated = undatedSlugs(ORDER, realCreated);
assert.strictEqual(sorted.length, ORDER.length, "排序不得增删篇目");
assert.strictEqual(new Set(sorted).size, ORDER.length, "排序不得重复篇目");
assert.deepStrictEqual(sorted.slice(sorted.length - undated.length), undated, "未填者应恰好排在末尾");
const dated = sorted.slice(0, sorted.length - undated.length);
for (let i = 1; i < dated.length; i++) {
  assert(realCreated[dated[i - 1]] <= realCreated[dated[i]],
    `已填部分应升序: ${dated[i - 1]}(${realCreated[dated[i - 1]]}) 排在 ${dated[i]}(${realCreated[dated[i]]}) 之前`);
}

console.log(`✅ test-work-order.js 全部通过 (升序 / 未填者列于其后 / 同时点稳定 / 空输入; 真仓库 ${ORDER.length} 篇: 已填 ${dated.length} · 待考 ${undated.length})`);
