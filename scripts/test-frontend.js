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

// 3.5) 导航版式: 申请入社 = 普通文字链(与缘起/社员同款)且排在投稿之前; 登录/注册 = 原「申请入社」那款按钮
{
  const links = [...nav.matchAll(/<a class="(txt|btn)[^"]*"\s+href="([^"]*)"[^>]*>([^<]+)<\/a>/g)]
    .map((m) => ({ cls: m[1], href: m[2], text: m[3] }));
  const texts = links.map((l) => l.text);
  assert.deepStrictEqual(texts, ["缘起", "雅集", "社员", "作品库", "申请入社", "投稿"],
    "导航文字链顺序应为 缘起·雅集·社员·作品库·申请入社·投稿(申请入社与投稿已交换位置): 实得 " + texts.join("·"));
  const join = links.find((l) => l.text === "申请入社");
  assert.strictEqual(join.cls, "txt", "申请入社应与缘起/社员同款(文字链), 不再是按钮");
  assert(links.every((l) => l.cls === "txt"), "导航里不该再有写死的按钮(按钮位留给登录/注册)");
  assert(nav.includes('id="nav-auth"'), "导航缺账号态入口 #nav-auth(应在右上角)");
  assert(/id="nav-login">登录 \/ 注册</.test(auth) && /class="btn nav-login"/.test(auth),
    "未登录的「登录 / 注册」入口应沿用页头按钮样式(.btn)");
  assert(auth.includes('placeholder="社员建议用笔名"'), "昵称栏提示词应为「社员建议用笔名」");
  assert(/id="zz-a-switch">/.test(auth) && !/btn ghost" type="button" id="zz-a-switch"/.test(auth),
    "弹窗底部两个按钮应同为 .btn(颜色格式统一), 不再一实一虚");
}

// 4) 样式: 导航账号态 + 弹窗 + 自己评论的同感 + 题记/自注
for (const sel of [".nav-auth", ".nav-auth .nav-who", ".zz-authbox", ".zz-authpanel", ".zz-f", ".zz-msgline", ".z-like.own", ".work-epigraph", ".work-selfnote"]) {
  assert(css.includes(sel), "site.css 缺样式: " + sel);
}
assert(/@media \(max-width:760px\)[\s\S]*?\.nav-auth\{/.test(css), "移动端菜单里也要有账号态样式");
// 登录/注册弹窗: 两栏等宽等高、字体随正文; 底部两按钮同宽同高、轴对称、颜色统一; 手机端竖排通栏
assert(css.includes(".nav-auth .btn{"), "登录/注册入口应沿用页头按钮(.btn)的样式");
assert(/\.zz-f\{display:grid;grid-template-columns:56px 1fr/.test(css), "昵称/口令两栏应等宽(grid 两列)");
// 注意: 昵称框没有 type 属性, 选择器必须是不带 type 的 .zz-f input(写 [type=text] 会漏掉昵称框)
assert(/\.zz-f input\{[^}]*height:44px/.test(css), "两栏输入框应等高(44px)");
assert(/\.zz-f\{[^}]*font-size:15px/.test(css) && /\.zz-f input\{[^}]*font:inherit/.test(css),
  "弹窗里的字体应与正文一致(15px, 不用输入框自带小字号)");
assert(/\.zz-authacts \.btn\{[^}]*flex:1 1 0[^}]*height:46px/.test(css), "底部两按钮应同宽(flex:1 1 0)同高(46px)");
// 口令栏: 右侧显示/隐藏切换(眼睛)按钮
assert(/id="zz-a-eye"/.test(auth) && /class="zz-eye"/.test(auth), "口令栏应有显示/隐藏切换按钮(#zz-a-eye)");
assert(auth.includes('passEl.type = show ? "text" : "password"'), "切换按钮应真实切换 input.type(而非只改样式)");
assert(/\.zz-eye\{position:absolute/.test(css) && /\.zz-passwrap input\{padding-right:40px\}/.test(css),
  "切换按钮应绝对定位在框内右侧, 且输入框留出右内距(字不压图标)");
assert(/@media \(max-width:640px\)\{\s*\.zz-authacts\{flex-direction:column/.test(css), "手机端两按钮应竖向通栏");
assert(/\.nav-auth \.btn\{margin:4px 0 2px/.test(css), "移动端菜单里的登录/注册按钮也要对齐");

// 5) 题记/自注: 投稿表单 -> 接口 -> 作品页 三处齐备(少一处就会出现"填了不显示")
const submitNjk = readf("src/submit.njk");
const workNjk = readf("src/_includes/layouts/work.njk");
assert(submitNjk.includes('name="epigraph"') && submitNjk.includes('name="selfNote"'), "投稿表单缺题记/自注栏");
assert(submitNjk.includes('for="sub-epigraph"') && submitNjk.includes('for="sub-selfnote"'), "题记/自注栏缺 label");
assert(/name="epigraph"[^>]*maxlength="200"/.test(submitNjk) && /name="selfNote"[^>]*maxlength="600"/.test(submitNjk),
  "题记/自注要各自限长(200 / 600)");
const epCount = (submitNjk.match(/epigraph: form\.epigraph\.value\.trim\(\)/g) || []).length;
const snCount = (submitNjk.match(/selfNote: form\.selfNote\.value\.trim\(\)/g) || []).length;
assert(epCount >= 2 && snCount >= 2, "题记/自注既要随投稿送出, 也要发给 /api/preview 预览");
assert(workNjk.includes('class="work-epigraph kaiti"'), "作品页开篇缺题记(楷体)");
assert(workNjk.includes('class="work-selfnote kaiti"'), "作品页正文下方缺自注(楷体)");
assert(workNjk.indexOf("work-epigraph") < workNjk.indexOf("content | safe") && workNjk.indexOf("content | safe") < workNjk.indexOf("work-selfnote"),
  "作品页顺序必须是 题记 → 正文 → 自注");

// 6) 创作时间: 「日」一栏接受整串日期(20240911 / 2024.6.7 / 2024年6月7日), 自动拆到年、月里
assert(submitNjk.includes('id="sub-created-day"') && /id="sub-created-day"[^>]*inputmode="numeric"/.test(submitNjk),
  "「日」应是文本框(才能粘整串日期), 且带 inputmode=numeric");
assert(submitNjk.includes("function parseLooseDate") && submitNjk.includes("function absorbLooseDate"),
  "投稿页应能把整串日期拆到年、月(parseLooseDate/absorbLooseDate)");
assert(/RE_DATE\s*=\s*\/\^\(\\d\{4\}\)-\(\\d\{1,2\}\)/.test(submitNjk),
  "整串日期应先归一再严格匹配(RE_DATE: YYYY-M[-D])");
assert(submitNjk.includes("s.length === 6") && submitNjk.includes("s.length === 8"),
  "纯数字要按位数判断(6=年月 / 8=年月日), 否则 202409 会被切成 0 月 9 日");
assert(submitNjk.includes("20240911") && submitNjk.includes("2024.6.7"), "提示文案里要给出 20240911 / 2024.6.7 这类例子");
assert(submitNjk.includes("absorbLooseDate();"), "提交时要先把「日」里的整串日期拆开再校验");
assert(css.includes(".created-row #sub-created-day{"), "site.css 应按 id 给「日」栏样式(已不是 input[type=number])");
assert(!/\.created-row input\[type="number"\]/.test(css), "旧的三控件选择器应已换掉");

// 7) 页面内联脚本必须语法正确(本地没浏览器, 靠解析器把关)
//    只查"纯 JS"的脚本块: 里面若出现 {% … %} 说明这段是模板在拼 JS, 抹平后没法当语法样本, 跳过;
//    {{ … }} 都在字符串里(如 "{{ site.apiBase }}/preview"), 统一换成 0 即可。
{
  const njkFiles = walk(path.join(ROOT, "src")).filter((f) => f.endsWith(".njk"));
  let checked = 0;
  let skipped = 0;
  for (const f of njkFiles) {
    const html = fs.readFileSync(f, "utf8");
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const raw = m[1];
      if (!raw.trim()) continue;
      if (/\{%/.test(raw)) { skipped++; continue; }   // 模板拼 JS, 不作为语法样本
      const code = raw.replace(/\{\{[\s\S]*?\}\}/g, "0");
      try {
        new Function(code);
      } catch (e) {
        throw new Error(`内联脚本语法错误: ${path.relative(ROOT, f)} — ${e.message}`);
      }
      checked++;
    }
  }
  assert(checked >= 2, "内联脚本至少应检查到 2 段, 实得 " + checked);
  console.log(`（内联脚本语法检查: 通过 ${checked} 段 · 模板拼 JS 跳过 ${skipped} 段）`);
}

// 8) 登录/注册弹窗的 HTML 模板: 把 auth.js 里那段字符串拼出来真跑一遍(本地没浏览器, 只能这样验结构)
{
  const seg = /box\.innerHTML =([\s\S]*?);\r?\n\s*document\.body\.appendChild/.exec(auth);
  assert(seg, "应从 auth.js 里找到弹窗模板(box.innerHTML = …)");
  const build = new Function("isReg", "return " + seg[1].trim() + ";");
  for (const isReg of [false, true]) {
    const html = build(isReg);
    assert(html.includes('id="zz-a-nick"') && html.includes('id="zz-a-pass"'), "弹窗应有昵称与口令两栏");
    assert(html.includes('placeholder="社员建议用笔名"'), "昵称栏提示词应为「社员建议用笔名」");
    assert(/class="zz-authacts"><button class="btn" type="button" id="zz-a-ok">[^<]*<\/button><button class="btn" type="button" id="zz-a-switch">/.test(html),
      "底部两个按钮应同为 .btn、成对放在 .zz-authacts 里(颜色格式统一)");
    assert(html.includes('id="zz-a-cancel"'), "弹窗要有关闭按钮");
  }
  assert(build(true).includes("注册并登录") && build(false).includes('id="zz-a-ok">登录<'),
    "注册/登录两种模式的按钮文案应各自正确");
  // 昵称栏曾经没写 type, 而样式是按 input[type=text] 写的 -> 整条规则漏掉它, 两栏一大一小。
  // 现在样式已不挑 type, 但"写显式 type"仍作为硬规矩由第 9 条守着。
  for (const tag of build(true).matchAll(/<input\b[^>]*>/g)) {
    assert(/\stype\s*=/.test(tag[0]), "弹窗里的 <input> 都要写显式 type: " + tag[0]);
  }
}

// 9) 全站防呆: 任何 <input> 都必须写显式 type —— 否则按 type 写的样式会整条漏掉它,
//    表现就是"两个输入框一个正常一个没样式"(昵称栏就这么坑过一次)
{
  const files = walk(path.join(ROOT, "src")).filter((f) => /\.(njk|js)$/.test(f));
  const naked = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/<input\b[^>]*>/g)) {
      if (!/\stype\s*=/.test(m[0])) {
        naked.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": " + m[0].slice(0, 80));
      }
    }
  }
  assert.deepStrictEqual(naked, [], "这些 <input> 没写 type: " + naked.join(" ｜ "));
}

// 10) 浏览量: 只在作品页题下给编委看 —— 页面里不留数字(默认 hidden), 由 auth.js 判定编委后才去向 /api/stats 取
{
  const statsNjk = readf("src/_includes/layouts/work.njk");
  assert(/id="work-stats"[^>]*data-work="\{\{ page\.fileSlug \}\}"[^>]*hidden/.test(statsNjk),
    "作品页题下应有 hidden 的 #work-stats 占位(带 data-work)");
  assert(!/work-stats[^>]*>\s*\{/.test(statsNjk), "占位里不该在构建期渲染任何数字(普通读者看不到)");
  assert(statsNjk.includes("work-stats"), "作品页要有浏览量占位");
  assert(auth.includes('getElementById("work-stats")'), "auth.js 应负责填浏览量(全站脚本, 每页都有)");
  assert(!/^\s*var\s+\w+\s*=\s*document\.getElementById\("work-stats"\)/m.test(auth),
    "不许在脚本开头就抓 #work-stats —— auth.js 在导航里执行, 那时 <main> 还没解析, 抓到的永远是 null");
  assert(/function statsNode\(\)/.test(auth) && /statsWhenReady/.test(auth) && auth.includes("DOMContentLoaded"),
    "元素要现查 + DOM 解析完再补一次(否则作品页永远拉不到数字)");
  assert(/statsOn\(\)[\s\S]{0,200}role === "编委"/.test(auth), "只有编委账号(或旧钥匙)才去取数字");
  assert(auth.includes("/stats?work=") && auth.includes('"&key="'), "取数走 /api/stats, 且旧钥匙从 sessionStorage 带上");
  assert(auth.includes("statsRefresh"), "对外要给 zhuzhu.js 一个刷新入口(开关旧钥匙后立即生效)");
  assert(zhuzhu.includes("zzAuth.statsRefresh"), "编委开关旧钥匙时应叫 auth.js 刷新浏览量");
  assert(/\.work-stats\{/.test(css) && /\.work-stats\[hidden\]\{display:none\}/.test(css), "site.css 要有 .work-stats(含 hidden 兜底)");
  // 后端两件套与建表脚本齐备
  assert(fs.existsSync(path.join(ROOT, "functions", "_middleware.js")), "缺根中间件 functions/_middleware.js(全站计数)");
  assert(fs.existsSync(path.join(ROOT, "functions", "api", "stats.js")), "缺读取接口 functions/api/stats.js");
  assert(fs.existsSync(path.join(ROOT, "sql", "stats.sql")), "缺建表脚本 sql/stats.sql");
  const mwSrc = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8");
  assert(mwSrc.includes("context.waitUntil"), "计数要走 waitUntil, 不能拖慢页面");
  assert(/INSERT OR IGNORE INTO page_visitors/.test(mwSrc) && /ON CONFLICT\(path, day\) DO UPDATE/.test(mwSrc),
    "中间件要写去重明细 + 日表累加");
  assert(!/ip\s+TEXT|ip\s+NOT NULL/.test(mwSrc), "统计表不许存原始 IP");
  const apiSrc = fs.readFileSync(path.join(ROOT, "functions", "api", "stats.js"), "utf8");
  assert(apiSrc.includes("isAdmin") && apiSrc.includes("403"), "读取接口必须做编委鉴权");
}

// 11) 外部前端脚本必须能解析(语法错会让整块功能静默失效, 浏览器里只报一行错)
{
  const dir = path.join(ROOT, "src", "static");
  const scripts = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert(scripts.length >= 3, "src/static 下的前端脚本数不对: " + scripts.length);
  for (const f of scripts) {
    const code = fs.readFileSync(path.join(dir, f), "utf8");
    try {
      new Function(code);
    } catch (e) {
      throw new Error(`前端脚本语法错误: src/static/${f} — ${e.message}`);
    }
  }
}

// 12) 作品库筛选状态存 URL —— 四个下拉写回地址栏(?author=&genre=&imagery=&source=), 且"返回本页"时以 URL 为准重算。
//     起因的 bug: 筛完进单篇再后退, 浏览器会自己还原下拉框的值却不重算列表(也不触发 change),
//     于是"下拉框显示已筛、列表却是全量", 看着就是对不上。本地没浏览器, 所以把 readURL/writeURL 抠出来真跑。
{
  const lib = readf("src/library.njk");
  for (const k of ["author", "genre", "imagery", "source"]) {
    assert(lib.includes(`id="f-${k}"`), "作品库缺下拉框 #f-" + k);
  }
  assert(/var KEYS = \["author", "genre", "imagery", "source"\]/.test(lib),
    "四个筛选维度的 URL 参数名与顺序应固定为 author/genre/imagery/source");
  assert(/function apply\(\)[\s\S]*?writeURL\(\);/.test(lib), "apply() 里应把当前筛选写回地址栏");
  assert(!lib.includes("history.pushState"), "改选筛选不该新增历史条目(否则要按很多次返回才出得去)");
  assert(/try\s*\{[^}]*history\.replaceState/.test(lib),
    "写地址栏要包 try/catch —— 直接双击 dist/library.html(file://) 时浏览器会拒绝改地址栏, 不该让它抛错");
  assert(/addEventListener\("pageshow"[\s\S]{0,160}readURL\(\);\s*apply\(\);/.test(lib),
    "pageshow(含 bfcache 恢复) 时应按 URL 重新对齐下拉框与列表");
  // 进场那次调用必须在 pageshow 之外单独存在 —— 只在事件里调的话, 带参数的链接打开不会预选
  assert(/^\s{2}readURL\(\);/m.test(lib.replace(/\n\s*window\.addEventListener\("pageshow"[\s\S]{0,200}?\}\);/g, "")),
    "进场时应先调一次 readURL() 再 apply()(顺序: fill() → readURL() → apply())");

  // 把 var KEYS … writeURL() 这段抠出来, 用造出来的假 <select> 与假 location/history 真跑一遍
  const head = lib.slice(lib.indexOf("var KEYS = ["), lib.indexOf("  function apply() {"));
  assert(head.includes("function readURL") && head.includes("function writeURL"), "应从库页脚本里抠到 readURL/writeURL");
  const build = new Function("author", "genre", "imagery", "source", "location", "history", "URLSearchParams",
    head + "return {readURL: readURL, writeURL: writeURL};");

  // 假 <select>: options 是真 DOM 那个形状; 赋一个不存在的值会落回空(真 select 就是这样, selectedIndex = -1)
  const mkSel = (opts) => {
    const o = { options: opts.map((v) => ({ value: v })), _v: "" };
    Object.defineProperty(o, "value", {
      get: () => o._v,
      set: (v) => { o._v = o.options.some((x) => x.value === v) ? v : ""; },
    });
    return o;
  };
  const nav = { urls: [] };
  const fakeHistory = { state: null, replaceState: (s, t, u) => nav.urls.push(u) };

  function run(search, hash, opts) {
    const o = opts || {};
    const sels = {
      author: mkSel(o.author || ["ylj（济枫）", "jwl（蓦流）"]),
      genre: mkSel(o.genre || ["七言古风", "五言律诗"]),
      imagery: mkSel(o.imagery || ["山", "水"]),
      source: mkSel(o.source || ["清明雅集", "(无出处)"]),
    };
    const loc = { search: search, pathname: "/library", hash: hash || "" };
    const api = build(sels.author, sels.genre, sels.imagery, sels.source, loc, fakeHistory, URLSearchParams);
    api.readURL();
    return { api, sels, loc };
  }

  // 读: 参数预选下拉框(作者 + 体裁同时生效)
  {
    const { sels } = run("?author=jwl（蓦流）&genre=七言古风");
    assert.strictEqual(sels.author.value, "jwl（蓦流）", "?author=… 应预选作者");
    assert.strictEqual(sels.genre.value, "七言古风", "?genre=… 应预选体裁");
    assert.strictEqual(sels.imagery.value, "", "没给的维度应保持「全部」");
  }
  // 读: 老写法 ?category= 也认; 认不出的值落回「全部」而不是筛成一空页
  {
    const { sels } = run("?category=七言古风&author=查无此人");
    assert.strictEqual(sels.genre.value, "七言古风", "体裁的兼容别名 category 应同样生效");
    assert.strictEqual(sels.author.value, "", "URL 里认不出的值应落回「全部」");
  }
  // 读: 手写的简写也能命中 —— ?author=jwl 落到唯一以 jwl 开头的「jwl（蓦流）」
  {
    const { sels } = run("?author=jwl&imagery=山");
    assert.strictEqual(sels.author.value, "jwl（蓦流）", "?author=jwl 应唯一前缀命中「jwl（蓦流）」");
    assert.strictEqual(sels.imagery.value, "山", "本来就是完整值的不受影响");
  }
  // 读: 前缀撞车(两个作者都以 jwl 开头)就不猜, 落回「全部」
  {
    const { sels } = run("?author=jwl", null, { author: ["jwl（蓦流）", "jwl2（某人）"] });
    assert.strictEqual(sels.author.value, "", "前缀有歧义时应落回「全部」(不瞎猜某一个)");
  }
  // 写: 固定顺序、丢空值、别名归一、别的参数(如 utm_*)原样保留
  {
    const { api, sels } = run("?author=jwl&category=七言古风&utm_source=wx");
    sels.imagery.value = "山";
    api.writeURL();
    assert.strictEqual(nav.urls[0],
      "/library?author=" + encodeURIComponent("jwl（蓦流）") + "&genre=" + encodeURIComponent("七言古风") +
      "&imagery=" + encodeURIComponent("山") + "&utm_source=wx",
      "写回的 URL 应是 author→genre→imagery 固定顺序 + 原样保留的 utm_, 且老写法 category 归一成 genre");
  }
  // 写: 「清除筛选」把四个下拉清空 → 回到干净的 /library(不留 ?); 锚点不丢
  {
    const { api, sels } = run("?author=jwl&genre=七言古风", "#lib-list");
    ["author", "genre", "imagery", "source"].forEach((k) => { sels[k].value = ""; });
    api.writeURL();
    assert.strictEqual(nav.urls[1], "/library#lib-list", "清空筛选后应回到不带参数的地址(锚点保留)");
  }
  console.log("（作品库筛选入 URL: 读写/别名/自愈/顺序 逐例通过）");
}

console.log("✅ test-frontend.js 全部通过 (元素引用一致/账号入口在导航/无自填昵称/账号化点位齐全/样式齐备/题记·自注贯通/创作时间整串日期/导航版式/弹窗结构/内联脚本可解析/input 必写 type/浏览量仅编委可见/作品库筛选入 URL 且后退不错位)");