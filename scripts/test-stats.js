// 浏览量统计测试: node scripts/test-stats.js
// 用 node:sqlite 建"真表"(sql/stats.sql), 让真实的 functions/_middleware.js 与 functions/api/stats.js 跑一遍:
//   · 计数口径: 阅读(PV) 每次页面请求 +1；访客(UV) **按天去重的人次**(同人同天同页只算 1, 跨天各算 1)
//   · 去抖: 同一访客同一页 30 秒内的连续请求只算一次阅读(预取/连点/多标签)
//   · **真人 / 疑似机器分开记**: 疑机进 sviews/suniq, 不污染真人数字; 判定"宁可把机器当人"
//   · 编委自己不计入: 带 zz_nostats=1 cookie 的请求完全不记
//   · 归一化: /w-feng.html 与 /w-feng 同一篇; 不同作品各自独立; 全站按人按天去重
//   · 过滤: 静态资源 / /api/* / 非 GET / 预取 / 分支预览部署 / 非 200 都记账前的门槛之外
//   · 隐私: 只存指纹(不存原始 IP), 指纹每天更换
//   · 鉴权: /api/stats 只给编委(账号 role='编委' 或旧钥匙), 读者/未登录一律 403
//   · 诊断: ?diagnose=1 给出按天趋势 / 路径排行 / 每访客页数分布 / 疑机占比
//   · 建表: sql/stats.sql 与中间件内置 DDL 逐条等价; 老库(只有 views/uniq)能被自动补列
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
let DatabaseSync = null;
try { ({ DatabaseSync } = require("node:sqlite")); } catch { /* 老 Node */ }
if (!DatabaseSync) {
  console.log("⏭  test-stats.js 跳过(当前 Node 无 node:sqlite)");
  process.exit(0);
}

// —— 把 SQL 文件拆成一句句(去掉 -- 注释) ——
function statements(sql) {
  const body = sql.split("\n").map((l) => { const i = l.indexOf("--"); return i >= 0 ? l.slice(0, i) : l; }).join("\n");
  return body.split(";").map((s) => s.trim()).filter(Boolean).map((s) => s + ";");
}
// —— node:sqlite 包成 D1 形状(prepare/bind/first/all/run/batch) ——
function makeDB(schemaSql) {
  const db = new DatabaseSync(":memory:");
  for (const s of statements(schemaSql)) db.exec(s);
  return makeDBFrom(db);
}
// 把已有的 sqlite 句柄包成 D1 形状(全新库/旧库夹具用)
function makeDBFrom(db) {
  const mk = (sql, args) => ({
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() {
      const info = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
    },
  });
  return {
    _raw: db,
    prepare: (sql) => Object.assign(mk(sql, []), { bind: (...a) => mk(sql, a) }),
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  };
}
const row = (db, sql, ...args) => db._raw.prepare(sql).get(...args) || null;

// 真人浏览器(现代): 有语言偏好 + Sec-Fetch 导航头
const HUMAN_HDR = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "accept-encoding": "gzip, deflate, br",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-site": "none",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
const req = (url, headers = {}, method = "GET") =>
  new Request("https://wuxu-society.pages.dev" + url, {
    method,
    headers: Object.assign({ "cf-connecting-ip": "203.0.113.7" }, HUMAN_HDR, headers),
  });
// 典型脚本/爬虫: 没有 Accept-Language
const botReq = (url, headers = {}) =>
  new Request("https://wuxu-society.pages.dev" + url, {
    headers: Object.assign({ "cf-connecting-ip": "198.51.100.66", accept: "text/html,*/*", "accept-encoding": "gzip, deflate", "user-agent": "python-requests/2.31.0" }, headers),
  });

const ADMIN = { id: 8, handle: "jwl", nick: "蓦流", role: "编委", member_state: "已确认" };
const READER = { id: 7, handle: "cty", nick: "泊珩", role: "读者", member_state: "" };
const T = Date.UTC(2026, 8, 12, 6, 0, 0);        // 北京时间 2026-09-12 14:00
const T2 = Date.UTC(2026, 8, 13, 6, 0, 0);       // 北京时间 2026-09-13 14:00
const SEC = 1000;

async function main() {
  const mw = await import(pathToFileURL(path.join(ROOT, "functions", "_middleware.js")).href);
  const statsApi = await import(pathToFileURL(path.join(ROOT, "functions", "api", "stats.js")).href);
  const schemaSql = fs.readFileSync(path.join(ROOT, "sql", "stats.sql"), "utf8");
  const db = makeDB(schemaSql);
  const env = { DB: db };
  const pageOf = (p, d) => row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", p, d);
  const siteOf = (d) => row(db, "SELECT * FROM site_daily WHERE day = ?1", d);

  // 1) 记账门槛(shouldCount): 页面算候选; 静态资源/接口/非 GET/预取/分支预览/非导航请求不进候选
  assert.strictEqual(mw.shouldCount(req("/w-feng.html")), true, "普通页面应进候选");
  assert.strictEqual(mw.shouldCount(req("/w-feng")), true, "无扩展名的页面 URL 也应进候选");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { "sec-purpose": "prefetch" })), false, "预取不进候选");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { purpose: "prefetch" })), false, "purpose:prefetch 不进候选");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { range: "bytes=0-99" })), false, "Range 请求不进候选");
  assert.strictEqual(mw.shouldCount(req("/api/stats?work=w-feng")), false, "接口不进候选");
  assert.strictEqual(mw.shouldCount(req("/site.css", { accept: "text/css,*/*;q=0.1" })), false, "样式表不进候选");
  assert.strictEqual(mw.shouldCount(req("/logo.png", { accept: "image/avif,image/webp,*/*" })), false, "图片不进候选");
  assert.strictEqual(mw.shouldCount(req("/zhuzhu.js", { accept: "*/*" })), false, "脚本不进候选");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", {}, "POST")), false, "非 GET 不进候选");
  assert.strictEqual(mw.shouldCount(req("/w-feng", { accept: "*/*" })), false, "非导航请求(accept 无 html)不进候选");
  assert.strictEqual(mw.shouldCount(new Request("https://abc123.wuxu-society.pages.dev/w-feng.html", { headers: Object.assign({}, HUMAN_HDR, { "cf-connecting-ip": "1.1.1.1" }) })), false, "分支预览部署不进候选");
  assert.strictEqual(mw.shouldCount(new Request("https://wuxu.org/w-feng.html", { headers: Object.assign({}, HUMAN_HDR, { "cf-connecting-ip": "1.1.1.1" }) })), true, "自定义域名照常计");

  // 2) 真人 / 疑似机器 的判定(宁可把机器当人, 也不要把人当机器)
  assert.strictEqual(mw.isSuspect(req("/w-feng.html")), false, "现代浏览器: 真人");
  assert.strictEqual(mw.isSuspect(new Request("https://wuxu.org/w-feng.html", { headers: {
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49",
    accept: "text/html", "accept-language": "zh-CN", "accept-encoding": "gzip, deflate, br" } })), false,
    "微信内置浏览器(没有 Sec-Fetch 但有语言+压缩)算真人");
  assert.strictEqual(mw.isSuspect(new Request("https://wuxu.org/w-feng.html", { headers: {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15",
    accept: "text/html", "accept-language": "zh-CN", "accept-encoding": "gzip, deflate" } })), false,
    "老 Safari(没有 Sec-Fetch)算真人");
  assert.strictEqual(mw.isSuspect(botReq("/w-feng.html")), true, "python-requests: 疑机");
  assert.strictEqual(mw.isSuspect(req("/w-feng.html", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" })), true, "Googlebot: 疑机");
  assert.strictEqual(mw.isSuspect(req("/w-feng.html", { "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot" })), true, "GPTBot: 疑机");
  assert.strictEqual(mw.isSuspect(req("/w-feng.html", { "user-agent": "" })), true, "没有 UA: 疑机");
  assert.strictEqual(mw.isSuspect(req("/w-feng.html", { "accept-encoding": "", "sec-fetch-mode": "", "sec-fetch-dest": "" })), true,
    "有语言偏好但既无 Sec-Fetch 又不接受压缩: 疑机");
  assert.strictEqual(mw.hasNoStatsCookie(req("/w-feng.html")), false, "默认没有 zz_nostats");
  assert.strictEqual(mw.hasNoStatsCookie(req("/w-feng.html", { cookie: "zz_nostats=1" })), true, "编委 cookie 要认出来");

  // 3) 真人计数: 去抖 + 按天去重
  await mw.countView(env, req("/w-feng.html"), { now: T });                       // A 第一次
  let p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq, p.sviews], [1, 1, 0], "首次访问: 真人 PV=1 UV=1");
  let r = await mw.countView(env, req("/w-feng.html"), { now: T + 10 * SEC });    // A 10 秒后又刷
  assert.strictEqual(r.counted, false, "30 秒内的连续请求不重复计数(去抖)");
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [1, 1], "去抖后 PV 不变");
  await mw.countView(env, req("/w-feng.html"), { now: T + 40 * SEC });            // 40 秒后
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [2, 1], "超过 30 秒: PV+1, 但还是同一个访客");
  await mw.countView(env, req("/w-feng"), { now: T + 80 * SEC });                 // 无扩展名同一篇
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [3, 1], "/w-feng 与 /w-feng.html 归到同一篇");
  await mw.countView(env, req("/w-feng.html", { "cf-connecting-ip": "198.51.100.9" }), { now: T + 90 * SEC });   // B 来了
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [4, 2], "第二个真人: PV+1 UV+1");
  let s = siteOf("2026-09-12");
  assert.deepStrictEqual([s.views, s.uniq, s.sviews], [4, 2, 0], "全站当天真人数字正确");

  // 同一人换一篇: 单篇 UV+1, 全站 UV 不变(全站按人按天去重)
  await mw.countView(env, req("/w-mei.html"), { now: T + 100 * SEC });
  const pMei = pageOf("/w-mei", "2026-09-12");
  assert.deepStrictEqual([pMei.views, pMei.uniq], [1, 1], "另一篇独立计数");
  s = siteOf("2026-09-12");
  assert.deepStrictEqual([s.views, s.uniq], [5, 2], "同一人看第二篇: 全站 PV+1 而 UV 不加");

  // 4) 疑机计数: 进 sviews/suniq, 不污染真人数字
  await mw.countView(env, botReq("/w-feng.html"), { now: T + 110 * SEC });
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq, p.sviews, p.suniq], [4, 2, 1, 1], "爬虫记进疑机列, 真人数字不变");
  s = siteOf("2026-09-12");
  assert.deepStrictEqual([s.views, s.uniq, s.sviews, s.suniq], [5, 2, 1, 1], "全站疑机列独立累计");
  r = await mw.countView(env, botReq("/w-feng.html"), { now: T + 120 * SEC });
  assert.strictEqual(r.counted, false, "疑机同样受 30 秒去抖约束");
  await mw.countView(env, botReq("/w-feng.html"), { now: T + 200 * SEC });
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.sviews, p.suniq], [2, 1], "疑机: PV 加、UV 去重");

  // 4.5) 入口页 vs 内容页: 首页/作品库这类"路过页"单独成桶, 不进真人阅读/访客
  assert.strictEqual(mw.isContentPath("/w-feng"), true, "作品页是内容页");
  assert.strictEqual(mw.isContentPath("/qingming-xu"), true, "雅集篇目是内容页");
  assert.strictEqual(mw.isContentPath("/issue-qingming-ji"), true, "期页是内容页");
  assert.strictEqual(mw.isContentPath("/concepts/lishe"), true, "概念页是内容页");
  assert.strictEqual(mw.isContentPath("/_fulltext"), true, "全文库是内容页");
  assert.strictEqual(mw.isContentPath("/"), false, "首页是入口页");
  assert.strictEqual(mw.isContentPath("/library"), false, "作品库是入口页");
  assert.strictEqual(mw.isContentPath("/submit"), false, "投稿页是入口页");
  await mw.countView(env, req("/"), { now: T + 210 * SEC });                 // A 打开首页
  const homeRow = pageOf("/", "2026-09-12");
  assert.deepStrictEqual([homeRow.views, homeRow.uniq, homeRow.eviews, homeRow.euniq], [0, 0, 1, 1],
    "首页只进「仅入口」桶, 不动真人阅读/访客");
  s = siteOf("2026-09-12");
  assert.deepStrictEqual([s.views, s.uniq, s.eviews, s.euniq], [5, 2, 1, 1], "入口页不污染全站真人数字");
  // 一个新人 C: 先落首页, 再点进作品页 —— 站点级去重**按桶分**, 内页那次必须照算
  const C = { "cf-connecting-ip": "198.51.100.12" };
  await mw.countView(env, req("/", C), { now: T + 300 * SEC });
  await mw.countView(env, req("/w-feng.html", C), { now: T + 310 * SEC });
  const homeRow2 = pageOf("/", "2026-09-12");
  assert.deepStrictEqual([homeRow2.eviews, homeRow2.euniq], [2, 2], "C 的首页访问计入入口桶");
  p = pageOf("/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [5, 3], "C 点进作品页: 内容页访客 +1(未被入口页面吃掉)");
  // A 再回作品库(入口页) —— 入口桶按人按天去重
  await mw.countView(env, req("/library"), { now: T + 320 * SEC });
  const libRow = pageOf("/library", "2026-09-12");
  assert.deepStrictEqual([libRow.eviews, libRow.euniq], [1, 1], "作品库也归入口桶");
  const buckets = db._raw.prepare("SELECT day, bucket, COUNT(*) AS n FROM bucket_visits GROUP BY day, bucket ORDER BY day, bucket").all()
    .map((x) => x.day + ":" + x.bucket + "=" + x.n);
  assert.deepStrictEqual(buckets, ["2026-09-12:c=3", "2026-09-12:e=2", "2026-09-12:s=1"],
    "站点级去重按桶分开记(c=内容页真人 / e=入口页 / s=疑机)");

  // 5) 跨天: 同一人再来 —— 人次口径 => 各天各算一次
  await mw.countView(env, req("/w-feng.html"), { now: T2 });
  const p2 = pageOf("/w-feng", "2026-09-13");
  assert.deepStrictEqual([p2.views, p2.uniq], [1, 1], "跨天重新计一个访客(人次口径)");
  const wTot = row(db, "SELECT SUM(views) AS v, SUM(uniq) AS u, SUM(sviews) AS sv, SUM(suniq) AS su FROM page_daily WHERE path = ?1", "/w-feng");
  assert.deepStrictEqual([wTot.v, wTot.u, wTot.sv, wTot.su], [6, 4, 2, 1], "本篇累计: 真人 6/4, 疑机 2/1");
  assert.strictEqual(row(db, "SELECT v FROM stats_meta WHERE k = 'split_since'").v, "2026-09-12", "记下「真假可分辨」的起始日");

  // 6) 隐私: 只有指纹
  const v = row(db, "SELECT visitor FROM page_visitors ORDER BY visitor LIMIT 1");
  assert(/^[0-9a-f]{24}$/.test(v.visitor), "访客是 24 位哈希指纹");
  assert(!/203\.0\.113\.7/.test(v.visitor) && !/198\.51\.100\.9/.test(v.visitor), "指纹里不该出现原始 IP");
  const cols = db._raw.prepare("SELECT name FROM pragma_table_info('page_visitors')").all().map((c) => c.name);
  assert.deepStrictEqual(cols, ["day", "path", "visitor", "ts"], "去重表只有 天/路径/指纹/去抖时间 四列");

  // 7) 中间件: 响应原样返回、编委不计入、出错不炸站、404 不计
  const viewSum = () => row(db, "SELECT COALESCE(SUM(views), 0) AS v FROM page_daily WHERE path = ?1", "/w-feng").v;
  const seen = [];
  const beforeMw = viewSum();
  const ctx = {
    request: req("/w-feng.html"),
    env,
    next: async () => new Response("<html>ok</html>", { status: 200 }),
    waitUntil: (p) => seen.push(p),
  };
  const res = await mw.onRequest(ctx);
  assert.strictEqual(res.status, 200, "中间件要原样返回页面响应");
  assert.strictEqual(await res.text(), "<html>ok</html>", "响应内容不被改动");
  assert.strictEqual(seen.length, 1, "计数走 waitUntil(不拖慢访问)");
  await Promise.all(seen);
  assert.strictEqual(viewSum(), beforeMw + 1, "中间件确实记了一笔");
  const seenNo = [];
  const resNo = await mw.onRequest({
    request: req("/w-mei.html", { cookie: "zz_nostats=1" }), env,
    waitUntil: (p) => seenNo.push(p),
    next: async () => new Response("ok"),
  });
  assert.strictEqual(await resNo.text(), "ok", "编委请求照常出页面");
  assert.strictEqual(seenNo.length, 0, "编委自己(zz_nostats=1)完全不计数");
  const missSeen = [];
  const before404 = viewSum();
  const res404 = await mw.onRequest({
    request: req("/w-feng.html"), env, waitUntil: (p) => missSeen.push(p),
    next: async () => new Response("nope", { status: 404 }),
  });
  assert.strictEqual(res404.status, 404, "错误页原样返回");
  await Promise.all(missSeen);
  assert.strictEqual(viewSum(), before404, "404 不该被算成一次阅读");
  const broken = { prepare() { throw new Error("boom"); } };
  const resBroken = await mw.onRequest({ request: req("/w-mei.html"), env: { DB: broken }, next: async () => new Response("ok") });
  assert.strictEqual(await resBroken.text(), "ok", "统计炸了也不影响页面");
  const resNoDb = await mw.onRequest({ request: req("/w-mei.html"), env: {}, next: async () => new Response("ok") });
  assert.strictEqual(await resNoDb.text(), "ok", "没有 D1 绑定时照常出页面");

  // 8) 接口鉴权 + 数字 + 诊断
  const apiReq = (q, user) => ({
    request: new Request("https://wuxu-society.pages.dev/api/stats" + q),
    env: Object.assign({ DB: db }, user ? { ZHUI_TEST_USER: JSON.stringify(user) } : {}),
  });
  assert.strictEqual((await statsApi.onRequest(apiReq("?work=w-feng"))).status, 403, "未登录看统计: 403");
  assert.strictEqual((await statsApi.onRequest(apiReq("?work=w-feng", READER))).status, 403, "读者看统计: 403");
  assert.strictEqual((await statsApi.onRequest({ request: new Request("https://x.test/api/stats", { method: "POST" }), env: { DB: db } })).status, 405, "非 GET: 405");
  const ok = await statsApi.onRequest(apiReq("?work=w-feng&days=30&diagnose=1", ADMIN));
  assert.strictEqual(ok.status, 200, "编委看统计: 200");
  const j = await ok.json();
  const sqlW = row(db, "SELECT SUM(views) AS v, SUM(uniq) AS u, SUM(sviews) AS sv, SUM(suniq) AS su FROM page_daily WHERE path = ?1", "/w-feng");
  const sqlS = row(db, "SELECT SUM(views) AS v, SUM(uniq) AS u, SUM(sviews) AS sv, SUM(suniq) AS su FROM site_daily");
  assert.deepStrictEqual([j.work.views, j.work.uniq, j.work.sviews, j.work.suniq], [sqlW.v, sqlW.u, sqlW.sv, sqlW.su], "接口本篇数字应与库一致");
  assert.deepStrictEqual([j.site.views, j.site.uniq, j.site.sviews, j.site.suniq], [sqlS.v, sqlS.u, sqlS.sv, sqlS.su], "接口全站数字应与库一致");
  assert.strictEqual(j.work.path, "/w-feng", "接口把标识名归一成路径");
  assert.strictEqual(j.work.since, "2026-09-12", "本篇起始日");
  assert.strictEqual(j.splitSince, "2026-09-12", "真假分辨起始日");
  assert.ok(j.diagnose, "diagnose=1 应带诊断数据");
  const siteDays = db._raw.prepare("SELECT COUNT(*) AS n FROM site_daily").get().n;
  assert.strictEqual(j.diagnose.siteTrend.length, Math.min(siteDays, 30), "全站按天应含全部有数据的日期(≤30)");
  assert.deepStrictEqual(j.diagnose.siteTrend.map((x) => x.day), j.diagnose.siteTrend.map((x) => x.day).slice().sort().reverse(), "按天倒序(最新在前)");
  assert.ok(j.diagnose.topPaths.length >= 2, "路径排行至少有两条");
  assert.strictEqual(j.diagnose.topPaths[0].path, "/w-feng", "排行第一条应是访问最多的那篇");
  const pagesTotal = j.diagnose.pagesPerVisitor.reduce((a, x) => a + x.visitors, 0);
  const distinctVisitors = db._raw.prepare("SELECT COUNT(DISTINCT visitor) AS n FROM page_visitors").get().n;
  assert.strictEqual(pagesTotal, distinctVisitors, "每访客页数分布应覆盖全部访客(同一人算一行, 按人计数)");
  assert.ok(j.diagnose.botRate > 0 && j.diagnose.botRate < 100, "疑机占比应在 0~100 之间");
  // 旧钥匙也认(过渡期)
  const byKey = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-feng&key=OLDKEY"),
    env: { DB: db, ZHUI_ADMIN_KEY: "OLDKEY" },
  });
  assert.strictEqual(byKey.status, 200, "旧编委钥匙也能看");
  const wrongKey = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-feng&key=nope"),
    env: { DB: db, ZHUI_ADMIN_KEY: "OLDKEY" },
  });
  assert.strictEqual(wrongKey.status, 403, "钥匙不对: 403");
  const noTable = await statsApi.onRequest({ request: new Request("https://x.test/api/stats?work=w-feng"), env: {} });
  assert.strictEqual(noTable.status, 503, "没有 D1 绑定时给 503 提示");
  // 8.5) 接口必须**自己会补表**: 否则"刚部署完、还没有任何页面访问触发中间件补列"时,
  //      接口去查还不存在的列 -> 500 -> 界面什么都不显示（这就是线上出过的故障）
  const emptyDb = new DatabaseSync(":memory:");   // 一张表都没有
  const emptyShim = makeDBFrom(emptyDb);
  const fresh = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-feng&diagnose=1"),
    env: { DB: emptyShim, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  });
  assert.strictEqual(fresh.status, 200, "全新库(没有表)时接口应自己建表并返回 200");
  const freshJson = await fresh.json();
  assert.deepStrictEqual([freshJson.site.views, freshJson.site.uniq, freshJson.site.eviews], [0, 0, 0], "空库返回 0 而不是报错");
  const freshCols = emptyDb.prepare("SELECT name FROM pragma_table_info('site_daily')").all().map((c) => c.name);
  assert.deepStrictEqual(freshCols.slice().sort(), ["day", "euniq", "eviews", "suniq", "sviews", "uniq", "views"], "接口把新列也建出来了");
  // 旧库(有 views/uniq/sviews/suniq, 但缺 eviews/euniq/bucket_visits) -> 接口也要能读
  const legacyDb = makeDB(`
    CREATE TABLE page_daily (path TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
      uniq INTEGER NOT NULL DEFAULT 0, sviews INTEGER NOT NULL DEFAULT 0, suniq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (path, day));
    CREATE TABLE page_visitors (day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path, visitor));
    CREATE TABLE site_daily (day TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, uniq INTEGER NOT NULL DEFAULT 0,
      sviews INTEGER NOT NULL DEFAULT 0, suniq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE site_visitors (day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (day, visitor));
  `);
  legacyDb._raw.prepare("INSERT INTO site_daily(day, views, uniq) VALUES ('2026-10-01', 12, 7)").run();
  const legacy = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-feng&diagnose=1"),
    env: { DB: legacyDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  });
  assert.strictEqual(legacy.status, 200, "缺新列的旧库, 接口应先补列再读");
  const legacyJson = await legacy.json();
  assert.deepStrictEqual([legacyJson.site.views, legacyJson.site.uniq], [12, 7], "旧数据照旧读得出来");
  assert.deepStrictEqual(legacyJson.diagnose.siteTrend[0].eviews, 0, "补出来的新列默认 0");

  // 9) 建表口径: sql/stats.sql 与中间件内置 DDL 等价 + 老库能自动补列
  const src = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8");
  const arrText = /const SCHEMA_SQL = (\[[\s\S]*?\n\]);/.exec(src);
  assert(arrText, "应从 _middleware.js 里找到 SCHEMA_SQL");
  const builtin = new Function("return " + arrText[1] + ";")();
  const norm = (s) => String(s).replace(/\s+/g, " ").replace(/;\s*$/, "").trim();
  assert.deepStrictEqual(statements(schemaSql).map(norm).slice().sort(), builtin.map(norm).slice().sort(),
    "sql/stats.sql 与 _middleware.js 的建表语句应逐条一致（两边都幂等）");
  // 老库(2026-10 之前): 没有 sviews/suniq/ts/stats_meta —— 跑一次计数应自动补列且不报错
  const oldDb = makeDB(`
    CREATE TABLE page_daily (path TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
      uniq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (path, day));
    CREATE TABLE page_visitors (day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL,
      PRIMARY KEY (day, path, visitor));
    CREATE TABLE site_daily (day TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, uniq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE site_visitors (day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (day, visitor));
  `);
  await mw.countView({ DB: oldDb }, req("/w-feng.html"), { now: T });
  await mw.countView({ DB: oldDb }, req("/"), { now: T + SEC });                 // 入口页也要能写进新列
  const oldRow = oldDb._raw.prepare("SELECT views, uniq, sviews, suniq, eviews, euniq FROM page_daily WHERE path = '/w-feng'").get();
  assert.deepStrictEqual([oldRow.views, oldRow.uniq, oldRow.sviews, oldRow.suniq, oldRow.eviews, oldRow.euniq],
    [1, 1, 0, 0, 0, 0], "老库补列后照常计数");
  const oldHome = oldDb._raw.prepare("SELECT eviews, euniq FROM page_daily WHERE path = '/'").get();
  assert.deepStrictEqual([oldHome.eviews, oldHome.euniq], [1, 1], "老库也能记入口页(补列 + 补 bucket_visits)");
  assert.strictEqual(oldDb._raw.prepare("SELECT COUNT(*) AS n FROM stats_meta").get().n, 1, "老库也会补出 stats_meta");
  assert.strictEqual(oldDb._raw.prepare("SELECT COUNT(*) AS n FROM bucket_visits").get().n, 2, "老库也会补出 bucket_visits");

  console.log("✅ test-stats.js 全部通过 (PV/UV 口径 · 30秒去抖 · 真人/疑机/入口三桶 · 编委不计入 · 路径归一 · 过滤门槛 · 仅存指纹 · 中间件不炸站 · 仅编委可读 · 诊断数据 · 建表等价与老库补列)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
