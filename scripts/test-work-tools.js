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
console.log("✅ test-work-tools.js 全部通过 (改名五处登记+引用+名册链接 / 干跑 / 创作时间增改 / 非法输入)");
