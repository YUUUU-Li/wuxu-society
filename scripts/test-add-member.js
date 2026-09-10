// 入册脚本单测: node scripts/test-add-member.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { addMember } = require("./add-member.js");

const src = path.join(__dirname, "..", "src", "_data", "members.json");
const tmp = path.join(os.tmpdir(), "members-test-" + Date.now() + ".json");
fs.copyFileSync(src, tmp);

const base = JSON.parse(fs.readFileSync(tmp, "utf8"));
const firstBranch = base[0].branch;
const before = base.reduce((n, s) => n + s.members.length, 0);

// 1) 正常入册(默认分部)
const r = addMember(tmp, { id: "zhenyue", penname: "枕月", note: "新社友" });
assert.strictEqual(r.id, "zhenyue");
assert.strictEqual(r.branch, firstBranch, "默认落在首个分部");
let data = JSON.parse(fs.readFileSync(tmp, "utf8"));
const after = data.reduce((n, s) => n + s.members.length, 0);
assert.strictEqual(after, before + 1, "名册多一人");
const added = data.find((s) => s.branch === firstBranch).members.find((m) => m.id === "zhenyue");
assert.strictEqual(added.name, "zhenyue · 枕月");
assert.strictEqual(added.role, "社员");
assert.deepStrictEqual(added.links, []);

// 2) 作品链接 + 新分部 + 自定义角色
addMember(tmp, { id: "moliu2", penname: "蓦流", branch: "兰溪分部", role: "编委", links: ["w-feng.html:作品：风"] });
data = JSON.parse(fs.readFileSync(tmp, "utf8"));
const newSec = data.find((s) => s.branch === "兰溪分部");
assert(newSec, "新分部自动建立");
assert.strictEqual(newSec.members[0].links[0].href, "w-feng.html");
assert.strictEqual(newSec.members[0].links[0].label, "作品：风");

// 3) 笔名与缩写相同 -> 不重复
addMember(tmp, { id: "anon", penname: "anon" });
data = JSON.parse(fs.readFileSync(tmp, "utf8"));
assert.strictEqual(data.flatMap((s) => s.members).find((m) => m.id === "anon").name, "anon");

// 4) 非法缩写 / 重复缩写 / 缺笔名
assert.throws(() => addMember(tmp, { id: "Zhen Yue", penname: "x" }), /缩写需以小写字母开头/);
assert.throws(() => addMember(tmp, { id: "zhenyue", penname: "枕月" }), /已有缩写/);
assert.throws(() => addMember(tmp, { id: "someone" }), /请给出笔名/);

fs.unlinkSync(tmp);
console.log("✅ test-add-member.js 全部通过 (入册/新分部/链接/去重/非法输入)");
