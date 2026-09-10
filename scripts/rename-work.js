// 作品改名: node scripts/rename-work.js <旧slug> <新slug> [--dry-run]
// 一次改全: 文件名 + groups.json + fulltext_order.json + pending_issue.json + issues.json
//           + 其他作品 front matter 的 related[].to + members.json 作品链接
//           + src/static/_redirects 补一条 301(旧网址自动跳新网址, 已发布的旧链接不会失效)
// 合并前改名: 在 PR 分支上跑(网址一开始就是雅名)。
// 合并后改名: 在 main 上跑亦可, 有了 _redirects 旧链接照常可用。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rel = (p) => path.join(ROOT, p);

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2).split("\n").join("\r\n") + "\r\n", "utf8"); }

// 校验: 小写字母开头, 只含小写字母/数字/连字符
function validSlug(s) { return /^[a-z][a-z0-9-]*$/.test(s); }

function renameWork(oldSlug, newSlug, opts = {}) {
  const root = opts.root || ROOT;
  const dry = !!opts.dryRun;
  const R = (p) => path.join(root, p);
  if (!validSlug(newSlug)) throw new Error("新标识名只能以小写字母开头，含小写字母/数字/连字符");
  const oldMd = R(`src/works/${oldSlug}.md`);
  const newMd = R(`src/works/${newSlug}.md`);
  if (!fs.existsSync(oldMd)) throw new Error(`找不到作品文件 src/works/${oldSlug}.md`);
  if (fs.existsSync(newMd)) throw new Error(`目标已存在: src/works/${newSlug}.md`);

  const touched = [];
  const plans = [];

  // 1) 文件名
  plans.push(`src/works/${oldSlug}.md -> src/works/${newSlug}.md`);
  if (!dry) fs.renameSync(oldMd, newMd);

  // 2) 登记表: groups / fulltext_order / pending_issue / issues
  const swap = (file, mutate) => {
    const p = R(file);
    if (!fs.existsSync(p)) return;
    const data = readJson(p);
    const next = mutate(data);
    if (JSON.stringify(next) !== JSON.stringify(data)) {
      touched.push(file);
      plans.push(`更新 ${file}`);
      if (!dry) writeJson(p, next);
    }
  };
  swap("src/_data/groups.json", (groups) => groups.map((g) => ({ ...g, slugs: (g.slugs || []).map((s) => (s === oldSlug ? newSlug : s)) })));
  swap("src/_data/fulltext_order.json", (arr) => arr.map((s) => (s === oldSlug ? newSlug : s)));
  swap("src/_data/pending_issue.json", (arr) => (Array.isArray(arr) ? arr.map((s) => (s === oldSlug ? newSlug : s)) : arr));
  swap("src/_data/issues.json", (issues) => issues.map((it) => ({ ...it, slugs: (it.slugs || []).map((s) => (s === oldSlug ? newSlug : s)) })));

  // 3) 其他作品的 related[].to
  const worksDir = R("src/works");
  for (const f of fs.readdirSync(worksDir)) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(worksDir, f);
    const s = fs.readFileSync(p, "utf8");
    if (!new RegExp(`to:\\s*"${oldSlug}"`).test(s)) continue;
    touched.push(`src/works/${f}`);
    plans.push(`更新 src/works/${f} 的 related 指向`);
    if (!dry) fs.writeFileSync(p, s.replace(new RegExp(`to:\\s*"${oldSlug}"`, "g"), `to: "${newSlug}"`), "utf8");
  }

  // 4) Cloudflare Pages 301 重定向: /旧.html -> /新.html (旧链接不失效)
  const rp = R("src/static/_redirects");
  const line = `/${oldSlug}.html    /${newSlug}.html    301`;
  const prev = fs.existsSync(rp) ? fs.readFileSync(rp, "utf8") : "";
  if (!prev.includes(`/${oldSlug}.html `) && !prev.includes(`/${oldSlug}.html\t`)) {
    touched.push("src/static/_redirects");
    plans.push(`追加 301 重定向: /${oldSlug}.html -> /${newSlug}.html`);
    if (!dry) {
      fs.mkdirSync(path.dirname(rp), { recursive: true });
      const head = "# 作品改名后的旧网址跳转（由 npm run rename-work 自动追加）\n";
      const body = prev ? prev.replace(/\s*$/, "\n") : head;
      fs.writeFileSync(rp, body + line + "\n", "utf8");
    }
  }

  // 5) members.json 里指向该作品页的链接
  const mp = R("src/_data/members.json");
  if (fs.existsSync(mp)) {
    const raw = fs.readFileSync(mp, "utf8");
    if (raw.includes(`"${oldSlug}.html"`)) {
      touched.push("src/_data/members.json");
      plans.push("更新 members.json 的作品链接");
      if (!dry) writeJson(mp, JSON.parse(raw));
      if (!dry) {
        const data = JSON.parse(raw);
        for (const sec of data) for (const m of sec.members) {
          for (const l of m.links || []) if (l.href === `${oldSlug}.html`) l.href = `${newSlug}.html`;
        }
        writeJson(mp, data);
      }
    }
  }

  return { oldSlug, newSlug, plans, touched, dry };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const [oldSlug, newSlug] = argv.filter((a) => !a.startsWith("--"));
  if (!oldSlug || !newSlug) {
    console.log("用法: npm run rename-work -- <旧标识名> <新标识名> [--dry-run]");
    console.log("例:   npm run rename-work -- w-20240404-01 w-zhuyingtai --dry-run");
    process.exit(1);
  }
  try {
    const r = renameWork(oldSlug, newSlug, { dryRun });
    console.log((r.dry ? "[干跑] " : "✅ ") + `改名 ${r.oldSlug} → ${r.newSlug}`);
    r.plans.forEach((p) => console.log("  · " + p));
    console.log(r.dry ? "（未改动任何文件；去掉 --dry-run 即执行）" : "下一步: npm test 通过后提交（合并前改名的旧网址未发布，不影响任何外链）。");
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
}

module.exports = { renameWork };
