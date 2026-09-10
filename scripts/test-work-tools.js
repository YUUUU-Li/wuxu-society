// 作品工具单测(改名 + 创作时间): node scripts/test-work-tools.js
// 用临时目录造一份迷你仓库, 验证两处登记都能一次改干净。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renameWork } = require("./rename-work.js");
const { setCreated } = require("./set-created.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wuxu-tools-"));
const mk = (p, content) => {
  const f = path.join(tmp, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content, "utf8");
};
const read = (p) => fs.readFileSync(path.join(tmp, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

// —— 迷你仓库 ——
mk("src/works/w-20240404-01.md", '---\ntitle: "清明雨"\nauthor: "cty（泊珩）"\ngenre: "现代诗"\ncreated: "2024-04-04"\n---\n<p>正文</p>\n');
mk("src/works/w-yiqinehe.md", '---\ntitle: "忆秦娥·和答"\nauthor: "lfk（谰予）"\ngenre: "词"\nrelated:\n  - to: "w-20240404-01"\n    label: "唱和"\n---\n<p>正文</p>\n');
mk("src/_data/groups.json", JSON.stringify([{ key: "other", h2: "其余社员作品", slugs: ["w-20240404-01", "w-yiqinehe"] }], null, 2));
mk("src/_data/fulltext_order.json", JSON.stringify(["w-20240404-01", "w-yiqinehe"], null, 2));
mk("src/_data/pending_issue.json", JSON.stringify(["w-20240404-01"], null, 2));
mk("src/_data/issues.json", JSON.stringify([{ id: "issue-x", slugs: ["w-20240404-01"] }], null, 2));
mk("src/_data/members.json", JSON.stringify([{ branch: "金华总部", members: [{ id: "cty", notes: [{ href: "w-20240404-01.html", label: "评注：清明雨（诗评）" }] }] }], null, 2));

// 1) 干跑不改动
const dry = renameWork("w-20240404-01", "w-qingmingyu", { root: tmp, dryRun: true });
assert(dry.plans.length >= 5, "干跑应列出各项改动: " + dry.plans.length);
assert(fs.existsSync(path.join(tmp, "src/works/w-20240404-01.md")), "干跑不得改名");

// 2) 正式改名: 五处登记 + 引用 + 名册链接全跟着走
const r = renameWork("w-20240404-01", "w-qingmingyu", { root: tmp });
assert.strictEqual(r.newSlug, "w-qingmingyu");
assert(fs.existsSync(path.join(tmp, "src/works/w-qingmingyu.md")), "文件名已改");
assert(!fs.existsSync(path.join(tmp, "src/works/w-20240404-01.md")), "旧文件已不在");
assert.deepStrictEqual(readJson("src/_data/groups.json")[0].slugs, ["w-qingmingyu", "w-yiqinehe"], "groups 已更新");
assert.deepStrictEqual(readJson("src/_data/fulltext_order.json"), ["w-qingmingyu", "w-yiqinehe"], "全文库顺序已更新");
assert.deepStrictEqual(readJson("src/_data/pending_issue.json"), ["w-qingmingyu"], "待辑登记已更新");
assert.deepStrictEqual(readJson("src/_data/issues.json")[0].slugs, ["w-qingmingyu"], "期册已更新");
assert(read("src/works/w-yiqinehe.md").includes('to: "w-qingmingyu"'), "related 指向已更新");
assert.strictEqual(readJson("src/_data/members.json")[0].members[0].notes[0].href, "w-qingmingyu.html", "名册编委链接已随改名更新");
// 旧网址 301 重定向(合并后改名也不失效)
const redir = read("src/static/_redirects");
assert(redir.includes("/w-20240404-01.html") && redir.includes("/w-qingmingyu.html") && redir.includes("301"), "_redirects 生成 301: " + redir.trim());

// 3) 非法/冲突
assert.throws(() => renameWork("w-qingmingyu", "Bad Name", { root: tmp }), /新标识名/);
assert.throws(() => renameWork("w-qingmingyu", "w-yiqinehe", { root: tmp }), /目标已存在/);
assert.throws(() => renameWork("w-nope", "w-x", { root: tmp }), /找不到作品文件/);

// 4) 创作时间: 新增 / 更新 / 干跑 / 非法
setCreated("w-yiqinehe", "2025-06", { root: tmp });
assert(/^created: "2025-06"$/m.test(read("src/works/w-yiqinehe.md")), "created 新增在 genre 之后");
setCreated("w-yiqinehe", "2025-06-18", { root: tmp });
assert(/^created: "2025-06-18"$/m.test(read("src/works/w-yiqinehe.md")), "created 原地更新");
const before = read("src/works/w-yiqinehe.md");
setCreated("w-yiqinehe", "2025-07", { root: tmp, dryRun: true });
assert.strictEqual(read("src/works/w-yiqinehe.md"), before, "干跑不写入");
assert.throws(() => setCreated("w-yiqinehe", "2025-13", { root: tmp }), /日期格式|不合法/);
assert.throws(() => setCreated("w-nope", "2025-06", { root: tmp }), /找不到作品文件/);

fs.rmSync(tmp, { recursive: true, force: true });

// 5) 作品时间收集表(读真仓库, 只校验口径自洽, 不依赖"还缺多少篇"这种会变的数)
const { build } = require("./work-dates-report.js");
const ROOT = path.join(__dirname, "..");
const sheet = build();
const mdCount = fs.readdirSync(path.join(ROOT, "src", "works")).filter((f) => f.endsWith(".md")).length;
assert.strictEqual(sheet.total, mdCount, `收集表应覆盖全部作品(${mdCount} 篇), 实得 ${sheet.total}`);
assert.strictEqual(sheet.dated + sheet.missing, sheet.total, "已填 + 待填 = 总数");
for (const head of ["## 一、怎么补填", "## 二、已填创作时间", "## 三、待填创作时间", "## 四、当前排序实际落点"]) {
  assert(sheet.md.includes(head), "收集表缺小节: " + head);
}
// 表里每一行都要对应真作品, 且"待填"的确实没有 created 字段(反之亦然)
const parts = sheet.md.split(/\n## /);
const datedSec = parts.find((p) => p.startsWith("二、已填创作时间")) || "";
const missingSec = parts.find((p) => p.startsWith("三、待填创作时间")) || "";
assert(datedSec && missingSec, "收集表应含已填/待填两节");
const inRepo = new Set();
for (const f of fs.readdirSync(path.join(ROOT, "src", "works"))) {
  if (!f.endsWith(".md")) continue;
  const slug = f.slice(0, -3);
  inRepo.add(slug);
  const row = "| `" + slug + "` |";
  const hasCreated = /^created:\s*"/m.test(fs.readFileSync(path.join(ROOT, "src", "works", f), "utf8"));
  assert(datedSec.includes(row) || missingSec.includes(row), `收集表漏了 ${slug}`);
  if (datedSec.includes(row)) assert(hasCreated, `${slug} 列在"已填"但文件里没有 created`);
  if (missingSec.includes(row)) assert(!hasCreated, `${slug} 列在"待填"但文件里已有 created`);
}
assert(inRepo.size === sheet.total, "作品数对不上");

console.log("✅ test-work-tools.js 全部通过 (改名五处登记+引用+名册链接 / 干跑 / 创作时间增改 / 非法输入 / 收集表口径自洽)");
