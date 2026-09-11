// 前端静态一致性单测: node scripts/test-frontend.js
// 本地没有浏览器环境, 所以把"只有运行时才会炸"的低级错误提前抓出来:
//   1) zhuzhu.js / auth.js 里用 gid("x")/getElementById("x")/querySelector("#x") 引用的元素,
//      必须在模板/布局里存在, 或由脚本自己动态创建(如登录弹窗) —— 防止改模板/改脚本后对不上;
//   2) 众注模板里不该再出现"读者自填昵称"的输入框(账号化后署名取账号笔名);
//   3) 账号化关键点位齐备: 导航右上角入口、全站加载 auth.js、弹窗要素、未登录引导、禁自赞;
//   4) 样式齐备(否则弹出来是裸的)。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const readf = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const nav = readf("src/_includes/partials/nav.njk");
const zzNjk = readf("src/_includes/partials/zhuzhu.njk");
const zhuzhu = readf("src/static/zhuzhu.js");
const auth = readf("src/static/auth.js");
const css = readf("src/static/site.css");

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
const jsIds = new Set(
  [zhuzhu, auth].flatMap((src) => [
    ...[...src.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/\.id\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
  ])
);
const known = new Set([...tplIds, ...jsIds]);

// 1) 引用一致性(两个脚本都要查)
const refs = new Set();
for (const src of [zhuzhu, auth]) {
  for (const re of [/(?:gid|getElementById)\("([^"]+)"\)/g, /querySelector\("#([\w-]+)/g, /\bA\("([\w-]+)"\)/g]) {
    for (const m of src.matchAll(re)) refs.add(m[1]);
  }
}
const missing = [...refs].filter((id) => !known.has(id));
assert.deepStrictEqual(missing, [], "脚本引用了模板/脚本里都不存在的元素: " + missing.join("、"));

// 2) 评论表单不得再有自填昵称
assert(!zzNjk.includes('id="zz-name"'), "众注模板仍有「笔名/昵称」输入框(账号化后应删除)");
assert(!zhuzhu.includes("zz-r-name"), "回帖表单仍有自填昵称输入框(应改为账号笔名)");
assert(!zhuzhu.includes("zfName"), "脚本里仍引用已删除的昵称输入框");
assert(!zhuzhu.includes("device") && !zhuzhu.includes("zz_dev"), "打标签不该再依赖设备号(身份已改为账号)");
assert(zhuzhu.includes("name: name") === false, "发表评论不该再传 name(署名由服务端取账号笔名)");

// 3) 账号化关键点位
assert(nav.includes('id="nav-auth"'), "导航缺账号态入口 #nav-auth(应在右上角)");
assert(/<script src="auth\.js\?v=\{\{ assetVer \}\}"><\/script>/.test(nav), "导航应加载全站脚本 auth.js(保证每个页面都有入口)");
assert(!zzNjk.includes('id="zz-auth"'), "众注区不该再放账号入口(已移到导航)");
assert(auth.includes("/auth") && auth.includes('"register"') && auth.includes('"login"') && auth.includes('"logout"'),
  "auth.js 应能注册/登录/退出");
assert(!auth.includes("我是社员") && !auth.includes("zz-a-member"), "账号从简后不该再有「我是社员」勾选");
assert(auth.includes('id="zz-a-nick"') && auth.includes('id="zz-a-pass"'), "注册/登录弹窗应只有昵称与口令两栏");
assert(!auth.includes("zz-a-handle"), "不该再有单独的「登录名」栏(昵称即登录名)");
assert(auth.includes('action: "register", nick: nick') && auth.includes('action: "login", nick: nick'),
  "注册与登录都应只提交 {nick, pass}");
assert(auth.includes("window.zzAuth") && auth.includes("onChange"), "auth.js 应对外提供 window.zzAuth(含 onChange)");
assert(zhuzhu.includes("window.zzAuth") && zhuzhu.includes("zzAuth.ready") && zhuzhu.includes("zzAuth.onChange"),
  "众注区应从 window.zzAuth 取登录态并跟随变化");
assert(!/fetch\(api \+ "\/auth"/.test(zhuzhu), "众注区不该自己再拉一份 /auth(账号态只由 auth.js 负责)");
assert(zhuzhu.includes("needLogin") && zhuzhu.includes("authFailed"), "未登录与过期会话都要有引导/兜底");
assert(/f\.own[\s\S]{0,80}z-like own/.test(zhuzhu), "自己的评论应渲染成不可点的「同感」");
assert(zhuzhu.includes("赞同者："), "编委 hover 标签应能看到赞同者名单");
assert(/if \(adminOn\(\)\) await loadAll\(\)/.test(zhuzhu), "编委投完票应重拉一次, 让名单立刻含自己");
assert(zhuzhu.includes("adminOn()"), "编委判定应走账号角色或旧钥匙");

// 4) 样式: 导航账号态 + 弹窗 + 自己评论的同感
for (const sel of [".nav-auth", ".nav-auth .nav-who", ".zz-authbox", ".zz-authpanel", ".zz-f", ".zz-msgline", ".z-like.own"]) {
  assert(css.includes(sel), "site.css 缺样式: " + sel);
}
assert(/@media \(max-width:760px\)[\s\S]*?\.nav-auth\{/.test(css), "移动端菜单里也要有账号态样式");

console.log("✅ test-frontend.js 全部通过 (元素引用一致/账号入口在导航/无自填昵称/账号化点位齐全/样式齐备)");
