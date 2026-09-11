// 前端静态一致性单测: node scripts/test-frontend.js
// 本地没有浏览器环境, 所以把"只有运行时才会炸"的低级错误提前抓出来:
//   1) zhuzhu.js 里用 gid("x")/getElementById("x")/querySelector("#x") 引用的元素,
//      必须在 zhuzhu.njk 里存在, 或由脚本自己动态创建(如登录弹窗) —— 防止改模板/改脚本后对不上;
//   2) 众注模板里不该再出现"读者自填昵称"的输入框(账号化后署名取账号笔名);
//   3) 关键账号化点位必须齐全: 账号态入口、登录/注册弹窗、我是社员勾选、禁自赞留痕。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const njk = fs.readFileSync(path.join(ROOT, "src", "_includes", "partials", "zhuzhu.njk"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "src", "static", "zhuzhu.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src", "static", "site.css"), "utf8");

// 所有模板/布局里写死的 id(众注容器在 partial, 相似标签容器在 layouts/work.njk)
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const tplFiles = walk(path.join(ROOT, "src", "_includes")).filter((f) => f.endsWith(".njk"));
const tplIds = new Set(tplFiles.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/id="([^"]+)"/g)].map((m) => m[1])));
// 脚本自己动态创建的 id(innerHTML 里的 id="..." 与 xxx.id = "...")
const jsIds = new Set([
  ...[...js.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
  ...[...js.matchAll(/\.id\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
]);
const known = new Set([...tplIds, ...jsIds]);

// 1) 引用一致性
const refs = new Set();
for (const re of [/(?:gid|getElementById)\("([^"]+)"\)/g, /querySelector\("#([\w-]+)/g, /\bA\("([\w-]+)"\)/g]) {
  for (const m of js.matchAll(re)) refs.add(m[1]);
}
const missing = [...refs].filter((id) => !known.has(id));
assert.deepStrictEqual(missing, [], "zhuzhu.js 引用了模板/脚本里都不存在的元素: " + missing.join("、"));

// 2) 评论表单不得再有自填昵称
assert(!njk.includes('id="zz-name"'), "众注模板仍有「笔名/昵称」输入框(账号化后应删除)");
assert(!js.includes("zz-r-name"), "回帖表单仍有自填昵称输入框(应改为账号笔名)");
assert(!js.includes("zfName"), "脚本里仍引用已删除的昵称输入框");
assert(!js.includes("device") && !js.includes("zz_dev"), "打标签不该再依赖设备号(身份已改为账号)");
assert(js.includes('name: name') === false, "发表评论不该再传 name(署名由服务端取账号笔名)");

// 3) 账号化关键点位
assert(njk.includes('id="zz-auth"'), "模板缺账号态入口 #zz-auth");
assert(js.includes("/auth") && js.includes('"register"') && js.includes('"login"') && js.includes('"logout"'),
  "脚本应能注册/登录/退出");
assert(js.includes("我是社员") && js.includes("请用名字缩写或笔名") && js.includes("推荐使用名字缩写或笔名"),
  "注册弹窗应有「我是社员」勾选与两套提示文案");
assert(js.includes("needLogin"), "未登录时应引导登录(打标签/评论/同感)");
assert(js.includes("authFailed"), "会话过期时应自动切回未登录并弹登录框");
{
  const i = js.indexOf('id="zz-a-nick"');
  assert(i > 0 && js.slice(Math.max(0, i - 160), i).includes("isReg ?"), "笔名输入框应只在注册模式出现(登录不需要)");
}
assert(/f\.own[\s\S]{0,80}z-like own/.test(js), "自己的评论应渲染成不可点的「同感」");
assert(js.includes("adminOn()"), "编委判定应走账号角色或旧钥匙");
// 4) 样式: 弹窗与账号态必须有样式, 否则弹出来是裸的
for (const sel of [".zz-authbox", ".zz-authpanel", ".zz-f", ".zz-msgline", ".z-like.own"]) {
  assert(css.includes(sel), "site.css 缺样式: " + sel);
}

console.log("✅ test-frontend.js 全部通过 (元素引用一致/无自填昵称/账号化点位齐全/样式齐备)");
