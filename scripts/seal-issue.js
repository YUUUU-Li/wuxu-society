// 封期脚本: node scripts/seal-issue.js [--title 期名] [--type 类型] [--period 时间] [--epigraph 辑语] [--id issue-xxx] [--slug w-xxx ...] [--dry-run]
// 待辑名单 = src/works/*.md 里带 `pending: true` 的（投稿函数只写这个标记，不碰共享文件）
// 动作: 1) issues.json 末尾追加新期  2) 清掉这些作品的 pending 标记
// 改完仍需 git 提交推送（命令见输出）。--dry-run 只预览不落盘。
const fs = require("fs");
const path = require("path");
const { readWorks } = require("./works-registry.js");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "src/_data");
const worksPath = (slug) => path.join(ROOT, "src", "works", slug + ".md");

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1].trim() : "";
}
function argAll(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === "--" + name && process.argv[i + 1]) out.push(process.argv[i + 1].trim());
  });
  return out;
}
const dry = process.argv.includes("--dry-run");

function main() {
  // 指定 --slug 时按指定来; 否则取所有带 pending 标记的
  const typed = argAll("slug");
  const pending = typed.length ? typed : readWorks(ROOT).pending;
  if (!pending.length) {
    console.log("📭 待辑列表为空（没有 pending: true 的作品），无需封期。");
    return;
  }
  const now = new Date();
  const title = arg("title") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")} 投稿辑`;
  const type = arg("type") || "投稿辑";
  const period = arg("period") || `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
  const epigraph = arg("epigraph") || "";
  const id = arg("id") || "issue-" + now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

  const issuesPath = path.join(DATA, "issues.json");
  const issues = JSON.parse(fs.readFileSync(issuesPath, "utf8"));
  if (issues.some((i) => i.id === id)) {
    console.log(`⚠️ 已存在同 id(${id}) 的期。同月第二次封期请加 --id issue-<后缀> 区分。`);
    return;
  }
  const issue = { id, title, type, period, epigraph, slugs: pending.slice(), concepts: [] };
  issues.push(issue);

  // 清掉 pending 标记
  const cleared = [];
  for (const slug of pending) {
    const p = worksPath(slug);
    if (!fs.existsSync(p)) {
      console.log(`⚠️ 找不到作品文件，跳过: ${slug}`);
      continue;
    }
    const s = fs.readFileSync(p, "utf8");
    if (!/^pending:\s*true\s*$/m.test(s)) continue;
    cleared.push(slug);
    if (!dry) fs.writeFileSync(p, s.replace(/^pending:\s*true\s*\n/m, ""), "utf8");
  }

  console.log("新期预览:");
  console.log(JSON.stringify(issue, null, 2));
  console.log(`\n本期收入 ${pending.length} 篇：${pending.join(" ")}`);
  console.log(`清除 pending 标记：${cleared.length ? cleared.join(" ") : "（无）"}`);
  if (dry) {
    console.log("\n(--dry-run 仅预览, 未写盘)");
    return;
  }
  fs.writeFileSync(issuesPath, JSON.stringify(issues, null, 2) + "\n", "utf8");
  console.log("\n✅ 已封期。接下来提交推送:");
  console.log("  git add src/_data/issues.json src/works");
  console.log('  git -c core.autocrlf=false commit -m "feat(刊期): 封期 ' + title + '"');
  console.log("  git -c http.proxy=http://127.0.0.1:7890 -c http.sslBackend=openssl push origin main");
}

try {
  main();
} catch (e) {
  console.error("封期失败:", e.message);
  process.exit(1);
}
