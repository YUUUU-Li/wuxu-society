// 封期脚本: node scripts/seal-issue.js [--title 期名] [--type 类型] [--period 时间] [--epigraph 辑语] [--dry-run]
// 将 pending_issue.json 中的待辑投稿归为"一期":
//   1) issues.json 末尾追加新期  2) 从 groups.json 的 other(散作) 中移出这些 slug
// 改完文件后仍需 git 提交推送(命令见输出)。--dry-run 只预览不落盘。
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "src/_data");
const pendingPath = path.join(DATA, "pending_issue.json");
const issuesPath = path.join(DATA, "issues.json");
const groupsPath = path.join(DATA, "groups.json");

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1].trim() : "";
}
const dry = process.argv.includes("--dry-run");

function main() {
  const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  if (!Array.isArray(pending) || !pending.length) {
    console.log("📭 待辑列表为空，无需封期。");
    return;
  }
  const now = new Date();
  const title = arg("title") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")} 投稿辑`;
  const type = arg("type") || "投稿辑";
  const period = arg("period") || `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
  const epigraph = arg("epigraph") || "";
  const id =
    arg("id") ||
    "issue-" + now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

  const issue = { id, title, type, period, epigraph, slugs: pending.slice(), concepts: [] };

  const issues = JSON.parse(fs.readFileSync(issuesPath, "utf8"));
  if (issues.some((i) => i.id === id)) {
    console.log(`⚠️ 已存在同 id(${id}) 的期。同月第二次封期请加 --id issue-<后缀> 区分。`);
    return;
  }
  issues.push(issue);

  // 从散作组 other 移出
  const groups = JSON.parse(fs.readFileSync(groupsPath, "utf8"));
  let removed = 0;
  for (const g of groups) {
    if (g.key === "other") {
      const before = g.slugs.length;
      g.slugs = g.slugs.filter((s) => !pending.includes(s));
      removed = before - g.slugs.length;
    }
  }

  console.log("新期预览:");
  console.log(JSON.stringify(issue, null, 2));
  console.log(`\n从「散作」组移出 ${removed} 篇, 剩余 ${groups.find((g) => g.key === "other").slugs.length} 篇。`);
  if (dry) {
    console.log("\n(--dry-run 仅预览, 未写盘)");
    return;
  }
  fs.writeFileSync(issuesPath, JSON.stringify(issues, null, 2) + "\n", "utf8");
  fs.writeFileSync(groupsPath, JSON.stringify(groups, null, 2) + "\n", "utf8");
  fs.writeFileSync(pendingPath, "[]\n", "utf8");
  console.log("\n✅ 已封期。接下来提交推送:");
  console.log("  git add src/_data/issues.json src/_data/groups.json src/_data/pending_issue.json");
  console.log('  git -c core.autocrlf=false commit -m "feat(刊期): 封期 ' + title + '"');
  console.log("  git -c http.proxy=http://127.0.0.1:7890 -c http.sslBackend=openssl push origin main");
}

try {
  main();
} catch (e) {
  console.error("封期失败:", e.message);
  process.exit(1);
}
