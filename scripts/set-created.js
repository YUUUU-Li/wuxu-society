// 回填/修改创作时间: node scripts/set-created.js <slug> <YYYY-MM|YYYY-MM-DD> [<slug> <日期> ...] [--dry-run]
// 例: node scripts/set-created.js w-feng 2024-04 w-chenmo 2025-06 --dry-run
// 作用: 在 src/works/<slug>.md 的 front matter 写入 created 字段(已有则更新)。
// 排序规则见 .eleventy.js: created 升序, 未填者继承前一篇时点(即保持原编排位置)。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function setCreated(slug, date, opts = {}) {
  const root = opts.root || ROOT;
  const dry = !!opts.dryRun;
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(date)) throw new Error(`日期格式应为 YYYY-MM 或 YYYY-MM-DD（收到 ${date}）`);
  const [, mm, dd] = date.split("-");
  if (+mm < 1 || +mm > 12 || (dd && (+dd < 1 || +dd > 31))) throw new Error(`日期不合法: ${date}`);
  const p = path.join(root, "src", "works", slug + ".md");
  if (!fs.existsSync(p)) throw new Error(`找不到作品文件 src/works/${slug}.md`);
  let s = fs.readFileSync(p, "utf8");
  const had = /^created:/m.test(s);
  s = had
    ? s.replace(/^created:.*$/m, `created: "${date}"`)
    : s.replace(/^(genre:.*)$/m, `$1\ncreated: "${date}"`);
  if (!dry) fs.writeFileSync(p, s, "utf8");
  return { slug, date, updated: had };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const rest = argv.filter((a) => !a.startsWith("--"));
  if (rest.length < 2 || rest.length % 2 !== 0) {
    console.log("用法: npm run set-created -- <slug> <YYYY-MM|YYYY-MM-DD> [<slug> <日期> ...] [--dry-run]");
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
