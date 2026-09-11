// 回填/修改创作时间: node scripts/set-created.js <slug> <日期> [<slug> <日期> ...] [--dry-run]
// 例: node scripts/set-created.js w-feng 2024-04 w-chenmo 2025-06 --dry-run
//     日期写法很随意: 20240911 / 2024.9.11 / 2024/9/11 / 2024年9月11日 / 2024-09-11 / 202409 / 2024-09 / 2024
//     (统一归一化成 YYYY[-MM[-DD]] 再写入; 口径单一真相在 scripts/work-order.js)
// 作用: 在 src/works/<slug>.md 的 front matter 写入 created 字段(已有则更新)。
// 排序规则见 scripts/work-order.js: created 升序, 模糊的(只到月/只到年)排在当月具体日子之前, 未填者列于最后。
const fs = require("fs");
const path = require("path");
const { parseCreated } = require("./work-order.js");

const ROOT = path.join(__dirname, "..");
const USAGE = "日期可写 20240911 / 2024.9.11 / 2024年9月11日 / 2024-09-11 / 202409 / 2024-09 / 2024";

function setCreated(slug, date, opts = {}) {
  const root = opts.root || ROOT;
  const dry = !!opts.dryRun;
  const p = parseCreated(date);
  if (!p) throw new Error(`认不出「${date}」这个日期；${USAGE}`);
  date = p.text;
  const fp = path.join(root, "src", "works", slug + ".md");
  if (!fs.existsSync(fp)) throw new Error(`找不到作品文件 src/works/${slug}.md`);
  let s = fs.readFileSync(fp, "utf8");
  const had = /^created:/m.test(s);
  s = had
    ? s.replace(/^created:.*$/m, `created: "${date}"`)
    : s.replace(/^(genre:.*)$/m, `$1\ncreated: "${date}"`);
  if (!dry) fs.writeFileSync(fp, s, "utf8");
  return { slug, date, updated: had };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const rest = argv.filter((a) => !a.startsWith("--"));
  if (rest.length < 2 || rest.length % 2 !== 0) {
    console.log("用法: npm run set-created -- <slug> <日期> [<slug> <日期> ...] [--dry-run]");
    console.log("      " + USAGE);
    process.exit(1);
  }
  let ok = 0;
  try {
    for (let i = 0; i < rest.length; i += 2) {
      const r = setCreated(rest[i], rest[i + 1], { dryRun });
      console.log(`${dryRun ? "[干跑] " : "✅ "}${r.slug}: created = ${r.date}${r.updated ? "（更新）" : "（新增）"}`);
      ok++;
    }
    console.log(`共 ${ok} 篇${dryRun ? "（未写入）" : ""}；改完跑 npm test，构建时排序自动生效。`);
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
}

module.exports = { setCreated };
