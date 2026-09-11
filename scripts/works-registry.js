// 作品登记: 从 src/works/*.md 现场推导（不再有共享 JSON 登记表）
//
// 为什么改（2026-09）：原先投稿函数会往 groups.json / fulltext_order.json / pending_issue.json
// 各追加一行。两个投稿 PR 都从同一基线追加数组末尾 —— 合并第一个后，第二个必然冲突
// （GitHub 报 "This branch has conflicts that must be resolved"）。现在投稿 PR 只新增
// 一个作品文件（front matter 里带 pending: true 表示待辑），所有"名单"都在构建时推导：
//   · 全站篇目   = src/works 目录下的所有 .md
//   · 未入期散作 = 未出现在任何一期 issues.json 里的 slug
//   · 待辑       = front matter 写了 pending: true 的（封期脚本清掉标记）
// 于是并发投稿不再互相踩，PR 可以按任意顺序逐个合并。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readWorks(root = ROOT) {
  const dir = path.join(root, "src", "works");
  const slugs = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
  const created = {};
  const pending = [];
  for (const slug of slugs) {
    const s = fs.readFileSync(path.join(dir, slug + ".md"), "utf8");
    const m = /^created:\s*"?([^"\n]*)"?/m.exec(s);
    if (m && m[1].trim()) created[slug] = m[1].trim();
    if (/^pending:\s*true\s*$/m.test(s)) pending.push(slug);
  }
  return { slugs, created, pending };
}

function readIssues(root = ROOT) {
  const p = path.join(root, "src", "_data", "issues.json");
  try {
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function issuedSlugs(issues) {
  const set = new Set();
  for (const it of issues || []) for (const s of it.slugs || []) set.add(s);
  return set;
}

// 未入期(散作) = 全站篇目 − 已入期
function looseSlugs(root = ROOT) {
  const { slugs } = readWorks(root);
  const inIssue = issuedSlugs(readIssues(root));
  return slugs.filter((s) => !inIssue.has(s));
}

module.exports = { readWorks, readIssues, issuedSlugs, looseSlugs, ROOT };
