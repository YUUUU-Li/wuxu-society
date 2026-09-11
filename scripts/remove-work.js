// 下架/撤稿脚本: node scripts/remove-work.js <slug> [--dry-run]
// 场景: 审核误合入、来稿要求撤下、内容问题需要删除。
// 自动做: 删 src/works/<slug>.md; 并从 issues.json 里摘除该 slug(若已入期)。
// 说明: groups / fulltext_order / pending 三张共享登记表已取消(见 scripts/works-registry.js),
//       名单由构建期从作品目录推导, 所以删掉文件即等于从所有名单中移除。
// 站点效果: 作品库行、刊期收录、首页拾读、筛选、sitemap、概念收录一并消失
//          (git 历史仍保留, 需要找回可 revert 本提交)。
// 用法示例: node scripts/remove-work.js w-sub-20260909-133804-31
// 干跑预览: node scripts/remove-work.js w-feng --dry-run
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORKS = path.join(ROOT, "src/works");
const DATA = path.join(ROOT, "src/_data");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const writeJson = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 2) + "\n", "utf8");

const args = process.argv.slice(2);
const slug = args.find((a) => /^[a-z][a-z0-9-]{1,59}$/.test(a)); // 任意位置取 slug(忽略选项)
const dry = args.includes("--dry-run");
if (!slug) {
  console.error("用法: node scripts/remove-work.js <slug> [--dry-run]\n  也支持 npm run remove-work -- --dry-run <slug>\n  slug 需为 src/works 下的文件名(不带 .md)");
  process.exit(1);
}
const mdPath = path.join(WORKS, slug + ".md");
if (!fs.existsSync(mdPath)) {
  console.error("❌ 未找到作品文件:", slug + ".md", "(src/works/ 下不存在)");
  process.exit(1);
}

const act = (s) => console.log((dry ? "[干跑] " : "") + s);
let touched = 0;
const groupMap = (f, name, mutate) => {
  const before = JSON.stringify(readJson(f));
  const after = mutate(readJson(f));
  if (JSON.stringify(after) !== before) {
    if (!dry) writeJson(f, after);
    act(`摘除于 ${name}`);
    touched++;
  }
};

// 1) 作品 md
act(`删除文件 ${slug}.md`);
if (!dry) fs.rmSync(mdPath);

// 2) issues.json(若已入期则摘除; 其余名单都是构建期推导, 删文件即等于摘除)
groupMap("issues.json", "issues.json", (iss) => iss.map((i) => ({ ...i, slugs: i.slugs.filter((s) => s !== slug) })));

console.log("");
if (touched === 0) {
  console.log("⚠️  该 slug 不在任何一期 issues.json 里(未入期散作, 删文件即已从名单移除)。");
}
console.log(dry ? "干跑完成(未改动任何文件)。" : "✅ 下架完成。请检查后提交推送:");
console.log('  git add -A && git -c core.autocrlf=false commit -m "chore: 下架 ' + slug + '"');
console.log("  git -c http.proxy=http://127.0.0.1:7890 -c http.sslBackend=openssl push origin main");
console.log("推送后 Cloudflare 自动重新部署, 约 1-2 分钟线上生效。");
