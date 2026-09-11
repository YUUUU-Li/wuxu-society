// 由 src/_data/tag_outline.json 生成 functions/api/tag-outline.js (Worker 无 fs, 词表须编译进函数)
// 用法: node scripts/sync-tag-outline.js   (npm run sync-tags)
// 生成物勿手改; 改词表请改 JSON 后重跑本脚本。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "_data", "tag_outline.json");
const OUT = path.join(__dirname, "..", "functions", "api", "tag-outline.js");

function build() {
  const o = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const words = o.categories.flatMap((c) => c.words);
  const dup = words.filter((w, i) => words.indexOf(w) !== i);
  if (dup.length) throw new Error("词表有重复: " + [...new Set(dup)].join(","));
  const noHint = words.filter((w) => !o.hints || !o.hints[w]);
  if (noHint.length) throw new Error("缺释义: " + noHint.join(","));
  const js = `// 由 scripts/sync-tag-outline.js 生成, 勿手改(改 src/_data/tag_outline.json 后重跑)
export const TAG_OUTLINE = ${JSON.stringify(wordList(o), null, 0)};
export const TAG_HINTS = ${JSON.stringify(o.hints, null, 0)};
export const TAG_NEAR = ${JSON.stringify(o.near || [], null, 0)};
export const TAG_LEGACY = ${JSON.stringify(o.legacy || {}, null, 0)};
`;
  fs.writeFileSync(OUT, js, "utf8");
  return { count: words.length };
}
// 扁平词表(保留分类, 便于编委界面按类展示)
function wordList(o) {
  return o.categories.flatMap((c) => c.words.map((w) => ({ w, cat: c.key })));
}

if (require.main === module) {
  try {
    const r = build();
    console.log(`✅ 已生成 functions/api/tag-outline.js (${r.count} 个标签词)`);
    console.log("   ⚠️ 词表改动还需同步落库脚本(以 SQL 为准): sql/zhuzhu-tags-v1.sql 与 sql/tags-v1/ 的落库/转正/归并三段");
    console.log("      (npm test 里的 test-tags-sql.js 会校验两者是否漂移)");
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
}
module.exports = { build };
