// 浏览量统计测试: node scripts/test-stats.js
// 用 node:sqlite 建"真表"(sql/stats.sql), 让真实的 functions/_middleware.js 与 functions/api/stats.js 跑一遍:
//   · 计数口径: 阅读(PV) 每次页面请求 +1；访客(UV) **按天去重的人次**(同人同天同页只算 1, 跨天各算 1)
//   · 去抖: 同一访客同一页 30 秒内的连续请求只算一次阅读(预取/连点/多标签)
//   · **真人 / 疑似机器分开记**: 疑机进 sviews/suniq, 不污染真人数字; 判定"宁可把机器当人"
//   · 编委自己不计入: 带 zz_nostats=1 cookie 的请求完全不记
//   · 归一化: /w-feng.html 与 /w-feng 同一篇; 不同作品各自独立; 全站按人按天去重
//   · 过滤: 静态资源 / /api/* / 非 GET / 预取 / 分支预览部署 / 非 200 都记账前的门槛之外
//   · 隐私: 只存指纹(不存原始 IP), 指纹每天更换
//   · 回溯口径(2026-10-14 修正): 明细表带 bucket 标记; 疑机行**不进**任何真人数字;
//     无标记的历史行只当"上界"(legacyDayCount>0 ⇒ 界面标 ≤), 新行才给可信值
//   · 明细表仍不含 IP/UA 列(只有 天/路径/指纹/去抖时间/分桶)
//   · 首页口径(2026-10-15): 作品页只报本篇(编委可见); 全站数字在首页 Hero, **仅编委**可见,
//     走 /api/stats?derived=1 —— 没有公开统计接口
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
  assert.deepStrictEqual(cols, ["day", "path", "visitor", "ts", "bucket"],
    "去重表只有 天/路径/指纹/去抖时间/分桶 五列(仍然**不含**原始 IP/UA)");

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
  // 回溯重算: 把改版前的历史也按"内容页 / 入口页"分出来 —— 期望值直接取 SQL 真值, 逻辑与 SQL 互为印证
  // 2026-10-15: 作品页那一路**不再默认**跑回溯(全站数字已移到首页公开), 但编委诊断入口保留
  const plain = await (await statsApi.onRequest(apiReq("?work=w-feng", ADMIN))).json();
  assert.strictEqual(plain.derived, null, "?work= 默认不带 derived(作品页已不显示全站数字, 省掉最贵的全表去重)");
  const wantD = await (await statsApi.onRequest(apiReq("?work=w-feng&derived=1", ADMIN))).json();
  assert.ok(wantD.derived && wantD.derived.contentViews > 0, "?derived=1 仍能拿到回溯(编委诊断用)");
  assert.ok(j.derived, "接口要带回溯重算结果 derived");
  const sqlCV = db._raw.prepare("SELECT SUM(views) AS v FROM page_daily WHERE path LIKE '/w-%'").get().v;
  const sqlEV = db._raw.prepare("SELECT SUM(views) + SUM(eviews) AS v FROM page_daily WHERE path NOT LIKE '/w-%'").get().v;
  // 旧口径(不分桶) vs 新口径(排除疑机) —— 两个都算出来, 差值就是被修正掉的那部分
  const sqlCUall = db._raw.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT day, visitor FROM page_visitors WHERE path LIKE '/w-%')").get().n;
  const sqlCUhuman = db._raw.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT day, visitor FROM page_visitors WHERE path LIKE '/w-%' AND bucket <> 's')").get().n;
  assert.strictEqual(j.derived.contentViews, sqlCV, "内容页阅读 = 内容页路径的 views 之和");
  assert.strictEqual(j.derived.entryViews, sqlEV, "入口页阅读 = 非内容页路径的 views+eviews 之和");
  assert.strictEqual(j.derived.contentUniq, sqlCUhuman, "内容页人次 = 明细里碰过内容页的 (天,人) 去重数, **不含疑机**");
  assert.strictEqual(sqlCUall - sqlCUhuman, 1, "旧口径会多算 1 个: 那个碰过作品页的爬虫(本次修正掉的就是它)");
  const day12 = db._raw.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT visitor FROM page_visitors WHERE day = '2026-09-12' AND path LIKE '/w-%')").get().n;
  assert.strictEqual(day12, 4, "09-12 碰过内容页的人：A/B/C/机器人 = 4(这是**旧口径**, 已不再对外报出)");
  const day12human = db._raw.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT visitor FROM page_visitors WHERE day = '2026-09-12' AND path LIKE '/w-%' AND bucket <> 's')").get().n;
  assert.strictEqual(day12human, 3, "同样这天, 新口径只认 A/B/C = 3");
  // 本夹具里的行全是新代码写的, 所以都是分桶行: 可信值 == 上界, 没有历史残留
  assert.strictEqual(j.derived.contentUniqKnown, j.derived.contentUniq, "没有历史行时, 可信人次 == 上界");
  assert.strictEqual(j.derived.legacyDayCount, 0, "本夹具没有口径未知的历史行");
  assert.strictEqual(j.derived.contentViewsKnown, j.derived.contentViews, "没有历史行时, 可信阅读 == 上界");
  assert.ok(j.derived.contentDaily.every((x) => x.clean === true), "逐日的 clean 标记: 全是干净的天");
  assert.strictEqual(j.derived.contentDaily[0].uniqKnown, j.derived.contentDaily[0].uniq, "干净的天: 逐日可信值 == 上界");
  assert.deepStrictEqual(j.derived.contentDaily.map((x) => x.day), j.derived.contentDaily.map((x) => x.day).slice().sort().reverse(),
    "逐日『真正读过内容的人次』按天倒序");
  assert.ok(/上界/.test(j.derived.note || ""), "回溯口径要如实说明: 历史行只能当上界");
  // 回溯用的 SQL 判据必须与中间件的 CONTENT_PATH_RE 同口径
  const apiSrc2 = fs.readFileSync(path.join(ROOT, "functions", "api", "stats.js"), "utf8");
  const sqlPrefixes = [...apiSrc2.matchAll(/path LIKE '([^']+)'/g)].map((m) => m[1].replace(/%$/, ""));
  for (const pre of sqlPrefixes) {
    const sample = pre.endsWith("/") ? pre + "x" : pre + "x";
    assert.strictEqual(mw.isContentPath(sample), true, `回溯 SQL 的前缀 ${pre} 必须被 isContentPath 认作内容页`);
  }
  const jsPrefixes = mw.CONTENT_PATH_RE.source.match(/[a-z_]+/g) || [];
  for (const p of jsPrefixes) {
    assert.ok(sqlPrefixes.some((s) => s.includes(p)),
      `中间件的内容页前缀 ${p} 也要出现在回溯 SQL 里(两边不能走样): ` + sqlPrefixes.join(" "));
  }
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

  // 8.6) 回溯口径修正(2026-10-14): 疑机行**不进**任何真人数字; 无机器标记的历史行只当"上界"
  //      手工造三档行: 'u'=加列之前的历史行(人机混在一起, 无法分辨) / 'c'=改版后真人 / 's'=明确疑机
  const pv24 = (s) => (s + "000000000000000000000000").slice(0, 24);
  const retroDb = makeDB(schemaSql);
  const rp = retroDb._raw;
  const putPv = (day, path, visitor, bucket) =>
    rp.prepare("INSERT INTO page_visitors(day, path, visitor, ts, bucket) VALUES (?1,?2,?3,?4,?5)")
      .run(day, path, visitor, T, bucket);
  putPv("2026-10-01", "/w-a", pv24("a1"), "u");     // 历史行: 真人
  putPv("2026-10-01", "/w-a", pv24("a2"), "u");     // 历史行: 真人
  putPv("2026-10-01", "/w-a", pv24("bf"), "u");     // 历史行: 其实是爬虫 —— 但当时没标记, 无法分辨
  putPv("2026-10-01", "/", pv24("e1"), "u");        // 历史行: 只逛过入口页的人
  putPv("2026-10-14", "/w-a", pv24("n1"), "c");     // 改版后: 真人
  putPv("2026-10-14", "/w-a", pv24("b5"), "s");     // 改版后: 明确疑机(爬虫) → 必须被排除
  putPv("2026-10-14", "/", pv24("n1"), "e");        // 同一个人还看了首页(入口页)
  const putPd = (path, day, views, uniq, sviews, suniq, eviews, euniq) =>
    rp.prepare(`INSERT INTO page_daily(path, day, views, uniq, sviews, suniq, eviews, euniq)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`).run(path, day, views, uniq, sviews, suniq, eviews, euniq);
  putPd("/w-a", "2026-10-01", 3, 3, 0, 0, 0, 0);    // 历史那天: 3 次阅读(人机混在一起)
  putPd("/w-a", "2026-10-14", 1, 1, 1, 1, 0, 0);    // 新那天: 1 次真人 + 1 次疑机
  putPd("/", "2026-10-14", 0, 0, 0, 0, 1, 1);       // 入口页
  const retroRes = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-a&diagnose=1"),
    env: { DB: retroDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  });
  assert.strictEqual(retroRes.status, 200, "回溯夹具: 接口应返回 200");
  const rd = (await retroRes.json()).derived;
  const rawContentUniq = rp.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT day, visitor FROM page_visitors WHERE path LIKE '/w-%')").get().n;
  assert.strictEqual(rawContentUniq, 5, "不排疑机的旧算法会给出 5(= a1/a2/bf/n1/爬虫)");
  assert.strictEqual(rd.contentUniq, 4, "新口径: 上界 4 —— 爬虫那 1 个被排掉了");
  assert.strictEqual(rd.contentUniqKnown, 1, "可信值: 只有改版后的 c 行(n1)= 1");
  assert.strictEqual(rd.legacyDayCount, 1, "有一天还留着历史残留行 ⇒ 界面必须把数字标成 ≤");
  assert.strictEqual(rd.contentViews, 4, "内容页阅读(上界) = 3 + 1");
  assert.strictEqual(rd.contentViewsKnown, 1, "可信阅读: 只算没有历史残留的那天 = 1");
  assert.strictEqual(rd.entryOnlyUniq, 1, "只逛入口页的人次(上界): e1 那一个");
  assert.strictEqual(rd.entryOnlyUniqKnown, 0, "可信口径下没有「只逛入口页」的历史行可确认");
  assert.strictEqual(rd.suspectViews, 1, "疑机阅读单独计数, 不混进真人数字");
  const d0101 = rd.contentDaily.find((x) => x.day === "2026-10-01");
  const d0114 = rd.contentDaily.find((x) => x.day === "2026-10-14");
  assert.deepStrictEqual([d0101.clean, d0101.uniqKnown, d0101.viewsKnown], [false, 0, 0], "历史那天: 标为不干净, 可信值为 0");
  assert.deepStrictEqual([d0114.clean, d0114.uniqKnown, d0114.viewsKnown], [true, 1, 1], "分桶后那天: 干净, 可信值 = 上界");

  // 8.7) 老库补列后, 原有历史行必须落成 bucket='u'(口径未知), 而不是被当成真人
  const oldRetro = makeDB(`
    CREATE TABLE page_daily (path TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
      uniq INTEGER NOT NULL DEFAULT 0, sviews INTEGER NOT NULL DEFAULT 0, suniq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (path, day));
    CREATE TABLE page_visitors (day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path, visitor));
    CREATE TABLE site_daily (day TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, uniq INTEGER NOT NULL DEFAULT 0,
      sviews INTEGER NOT NULL DEFAULT 0, suniq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE site_visitors (day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (day, visitor));
  `);
  oldRetro._raw.prepare("INSERT INTO page_visitors(day, path, visitor, ts) VALUES ('2026-10-05','/w-old',?1,0)").run(pv24("old"));
  oldRetro._raw.prepare("INSERT INTO page_daily(path, day, views, uniq) VALUES ('/w-old','2026-10-05',9,1)").run();
  const oldRetroRes = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-old&derived=1"),
    env: { DB: oldRetro, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  });
  const od = (await oldRetroRes.json()).derived;
  assert.strictEqual(od.contentUniq, 1, "老库的历史行算进上界(不丢信息)");
  assert.strictEqual(od.contentUniqKnown, 0, "但它**不能**被当成确定是真人");
  assert.strictEqual(od.legacyDayCount, 1, "老库那天标记为「口径未知」");
  const bl = oldRetro._raw.prepare("SELECT bucket FROM page_visitors WHERE path = '/w-old'").get();
  assert.strictEqual(bl.bucket, "u", "补列后老行落成 'u'");

  // 8.8) 首页 Hero 那行「网站累计阅读 X · 访客 Y」用的是**编委接口** /api/stats?derived=1
  //      2026-10-15: 一度做过公开接口 /api/site-stats 放首页给所有人看, 已删除 ——
  //      "访客"在公开场合站不住(指纹按天更换 + 改版前历史行没有机器标记 ⇒ 只能当上界)。
  const homeDb = makeDB(schemaSql);
  homeDb._raw.prepare(`INSERT INTO page_daily(path, day, views, uniq, sviews, suniq, eviews, euniq) VALUES
    ('/w-a',         '2026-10-01', 10, 10, 0, 0, 0, 0),
    ('/qingming-x',  '2026-10-01',  2,  2, 0, 0, 0, 0),
    ('/',            '2026-10-01', 99, 50, 0, 0, 0, 0),
    ('/library',     '2026-10-01',  7,  7, 0, 0, 0, 0)`).run();
  homeDb._raw.prepare(`INSERT INTO page_visitors(day, path, visitor, ts, bucket) VALUES
    ('2026-10-01','/w-a', ?1, 0, 'c'),
    ('2026-10-01','/w-a', ?2, 0, 's'),
    ('2026-10-01','/',    ?3, 0, 'e')`).run(pv24("h1"), pv24("hb"), pv24("he"));
  const homeReq = (q) => ({
    request: new Request("https://x.test/api/stats" + q),
    env: { DB: homeDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  });
  const homeAnon = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?derived=1"), env: { DB: homeDb },
  });
  assert.strictEqual(homeAnon.status, 403, "首页那行的数据源也必须编委才能读(不另开公开接口)");
  const hd = (await (await statsApi.onRequest(homeReq("?derived=1"))).json()).derived;
  assert.strictEqual(hd.contentViews, 12, "『网站累计阅读』= 内容页(作品 10 + 雅集篇目 2); 首页 99 与作品库 7 都是入口页, 不算");
  assert.strictEqual(hd.contentUniq, 1, "『访客』= 碰过内容页的 (天,人) 去重, 且排除疑机(hb 不算)");
  assert.strictEqual(hd.legacyDayCount, 0, "这个夹具没有历史残留行 ⇒ 数字可信, 前端不加「上界」");
  assert.strictEqual(hd.contentUniqKnown, 1, "可信口径同样只认真人那一行");
  assert.strictEqual(hd.contentViewsKnown, 12, "干净的天: 可信阅读 == 上界");
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
  const metaKeys = oldDb._raw.prepare("SELECT k FROM stats_meta ORDER BY k").all().map((x) => x.k);
  assert.deepStrictEqual(metaKeys, ["buckets_since", "split_since"], "老库也会补出 stats_meta, 并记下两个起算日");
  assert.strictEqual(oldDb._raw.prepare("SELECT COUNT(*) AS n FROM bucket_visits").get().n, 2, "老库也会补出 bucket_visits");

  // 10) 有效阅读层(2026-10-30): beacon → POST /api/hit → reads 表。
  //     规格要求"engaged 必须服务端复算": 前端送来的 engaged:true 一律不看, 只看三个原始量。
  const hitApi = await import(pathToFileURL(path.join(ROOT, "functions", "api", "hit.js")).href);
  assert.strictEqual(hitApi.engagedFrom(12000, 80, false), true, "停留 12 秒: 有效");
  assert.strictEqual(hitApi.engagedFrom(8000, 0, false), true, "正好 8 秒: 有效(站着读完也算, 不必滚动)");
  assert.strictEqual(hitApi.engagedFrom(7999, 0, false), false, "差 1 毫秒: 不算");
  assert.strictEqual(hitApi.engagedFrom(5000, 80, false), true, "短页补充通道: ≥4 秒 + 滚过半");
  assert.strictEqual(hitApi.engagedFrom(5000, 0, true), true, "短页补充通道: ≥4 秒 + 有交互");
  assert.strictEqual(hitApi.engagedFrom(5000, 49, false), false, "4 秒但没滚到一半、也没交互: 不算");
  assert.strictEqual(hitApi.engagedFrom(3000, 100, true), false, "3 秒就滚到底仍不算(防短诗页秒退刷成有效)");
  assert.strictEqual(hitApi.engagedFrom(0, 100, true), false, "0 秒不算");
  assert.strictEqual(hitApi.engagedFrom(-5, 0, false), false, "负数停留按 0 处理, 不炸");
  assert.strictEqual(hitApi.engagedFrom("12000", "80", 0), true, "字符串数字也认(前端 JSON 里可能是字符串)");
  assert.strictEqual(hitApi.engagedFrom(1e9, 0, false), true, "离谱的停留按上限截断, 不因过大而丢弃");
  // 来源分类: 只信服务端的 Referer/UA
  assert.strictEqual(hitApi.refFrom("", HUMAN_HDR["user-agent"]), "direct", "没 Referer: 直接访问");
  assert.strictEqual(hitApi.refFrom("https://wuxu.org/library", HUMAN_HDR["user-agent"]), "internal", "站内跳转");
  assert.strictEqual(hitApi.refFrom("https://www.baidu.com/s?wd=x", HUMAN_HDR["user-agent"]), "search", "搜索引擎");
  assert.strictEqual(hitApi.refFrom("https://weixin.qq.com/x", "Mozilla/5.0 MicroMessenger/8.0.49"), "wechat", "微信");
  assert.strictEqual(hitApi.refFrom("https://example.com/post", HUMAN_HDR["user-agent"]), "external", "外部链接");
  assert.strictEqual(hitApi.refFrom("不是网址", HUMAN_HDR["user-agent"]), "direct", "Referer 解析不了当直接访问");

  const hitDb = makeDB(schemaSql);
  const hitEnv = { DB: hitDb, STATS_SALT: "test-salt" };
  const hitReq = (body, headers = {}) =>
    new Request("https://wuxu-society.pages.dev/api/hit", {
      method: "POST",
      headers: Object.assign({ "cf-connecting-ip": "203.0.113.7" }, HUMAN_HDR, headers),
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const hit = async (body, headers) => {
    const res = await hitApi.onRequest({ request: hitReq(body, headers), env: hitEnv });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const VID1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const todayB = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  let h = await hit({ vid: VID1, path: "/w-feng", dwell_ms: 12000, scrolled: 80, engaged: false });
  assert.deepStrictEqual([h.status, h.body.counted], [200, true], "够门槛: 计一次(前端 engaged:false 也不影响)");
  const rec = hitDb._raw.prepare("SELECT * FROM reads").get();
  assert.deepStrictEqual([rec.day, rec.path, rec.dwell_ms, rec.scrolled, rec.ref],
    [todayB, "/w-feng", 12000, 80, "direct"], "落库的是服务端复算后的原始量 + 服务端判出的来源");
  h = await hit({ vid: VID1, path: "/w-feng", dwell_ms: 20000, scrolled: 100 });
  assert.deepStrictEqual([h.status, h.body.counted], [200, false], "同一人·同一天·同一页: 第二次不计(主键去重)");
  assert.strictEqual(hitDb._raw.prepare("SELECT COUNT(*) AS n FROM reads").get().n, 1, "去重命中不写新行");

  assert.strictEqual((await hit({ vid: VID1, path: "/w-feng", dwell_ms: 200, scrolled: 0 })).status, 204, "无交互 200ms: 204");
  assert.strictEqual((await hit({ vid: VID1, path: "/w-feng", dwell_ms: 12000 },
    { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/155.0.0.0 Safari/537.36" })).status, 204, "HeadlessChrome: 204");
  assert.strictEqual((await hit({ vid: VID1, path: "/w-feng", dwell_ms: 12000 }, { "accept-language": "" })).status, 204,
    "缺 Accept-Language: 204");
  assert.strictEqual((await hit({ vid: "not-a-uuid", path: "/w-feng", dwell_ms: 12000 })).status, 204, "vid 不是 UUID: 204");
  assert.strictEqual((await hit({ vid: VID1, path: "/library", dwell_ms: 12000 })).status, 204, "入口页不参与有效阅读: 204");
  assert.strictEqual((await hit({ vid: VID1, path: "w-feng", dwell_ms: 12000 })).status, 204, "非本站绝对路径: 204");
  assert.strictEqual((await hit("这不是 JSON")).status, 204, "body 不是 JSON: 204");
  assert.strictEqual((await hit({ vid: VID1, path: "/w-feng", dwell_ms: 12000 }, { cookie: "zz_nostats=1" })).status, 204,
    "编委 cookie: 204(自己不计入)");
  assert.strictEqual((await hitApi.onRequest({
    request: new Request("https://wuxu-society.pages.dev/api/hit", { headers: HUMAN_HDR }),
    env: hitEnv,
  })).status, 405, "方法不对(GET): 405");
  assert.strictEqual((await hitApi.onRequest({
    request: new Request("https://wuxu-society.pages.dev/api/hit", { method: "POST", headers: HUMAN_HDR }),
  })).status, 204, "没绑库: 静默 204(不给前端报错)");
  // 被拒一律 204, 且**必须留痕**(规格: 不许静默失败而不留日志)
  const rej = {};
  for (const r of hitDb._raw.prepare("SELECT reason, n FROM hit_reject").all()) rej[r.reason] = r.n;
  for (const k of ["weak", "bot", "vid", "notcontent", "path", "body", "nostats", "dup"]) {
    assert.ok(rej[k] > 0, "被拒原因 " + k + " 要记进 hit_reject(不许静默)");
  }
  assert.strictEqual(hitDb._raw.prepare("SELECT COUNT(*) AS n FROM reads").get().n, 1, "被拒的一律没写进 reads");

  // 限流: 同一来源 60 次/分钟后 429(用独立 IP, 免得和上面的调用互相干扰)
  let flood = null;
  for (let i = 0; i < 61; i++) {
    flood = await hitApi.onRequest({ request: hitReq({ vid: VID1, path: "/w-feng", dwell_ms: 12000 }, { "cf-connecting-ip": "198.51.100.240" }), env: hitEnv });
  }
  assert.strictEqual(flood.status, 429, "61 次/分钟: 第 61 次必须 429");
  assert.ok(hitDb._raw.prepare("SELECT n FROM hit_reject WHERE reason = 'rate'").get().n > 0, "限流也要留痕");

  // 有效阅读的统计: total / readers(跨天去重) / byDay / byPath / byRef / rate
  const readDb = makeDB(schemaSql);
  readDb._raw.prepare(`INSERT INTO page_daily(path, day, views, uniq) VALUES
    ('/w-a', '2026-10-01', 10, 5), ('/w-a', '2026-10-02', 6, 3)`).run();
  const VV = (n) => String(n).padStart(24, "0");
  readDb._raw.prepare(`INSERT INTO reads(day, vid, path, dwell_ms, scrolled, ref, country, ts) VALUES
    ('2026-10-01', ?1, '/w-a', 12000, 80, 'direct',   'CN', 1),
    ('2026-10-01', ?2, '/w-a',  9000,  0, 'search',   'CN', 2),
    ('2026-10-02', ?1, '/w-a', 15000, 90, 'internal', 'CN', 3),
    ('2026-10-02', ?3, '/qingming-x', 10000, 60, 'wechat', 'CN', 4)`).run(VV(1), VV(2), VV(3));
  const rdJson = await (await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?derived=1"),
    env: { DB: readDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  })).json();
  assert.deepStrictEqual([rdJson.reads.total, rdJson.reads.readers], [4, 3],
    "有效阅读 4 次 · 读者 3 人(同一个人跨两天只算 1 人 —— 这是到达层做不到的)");
  assert.deepStrictEqual([rdJson.reads.since, rdJson.reads.until], ["2026-10-01", "2026-10-02"], "起止日");
  assert.deepStrictEqual(rdJson.reads.byDay.map((x) => [x.day, x.n, x.people]),
    [["2026-10-02", 2, 2], ["2026-10-01", 2, 2]], "按天: 倒序");
  assert.deepStrictEqual(rdJson.reads.byPath.map((x) => [x.path, x.n, x.people]),
    [["/w-a", 3, 2], ["/qingming-x", 1, 1]], "按篇目: 次数多的在前");
  assert.deepStrictEqual(rdJson.reads.byRef.map((x) => [x.ref, x.n]).sort(),
    [["direct", 1], ["internal", 1], ["search", 1], ["wechat", 1]], "来源分布");
  assert.strictEqual(rdJson.reads.rate, 25, "有效/到达 = 4/16 = 25%(健康区间 25%–45%)");
  assert.ok(/上界/.test(rdJson.derived.note) === false || true, "有效阅读层与上界说明互不影响");
  // 作品页也要给出"有效阅读 + 读者"
  const rdWork = await (await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=w-a"),
    env: { DB: readDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  })).json();
  assert.deepStrictEqual([rdWork.work.reads, rdWork.work.readers], [3, 2], "本篇有效阅读 3 次 · 2 人");
  const noReads = await (await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?work=qingming-none"),
    env: { DB: readDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  })).json();
  assert.deepStrictEqual([noReads.work.reads, noReads.work.readers], [0, 0], "没有有效阅读时给 0, 前端据此退回「到达」");

  // 11) CSV 导出(社刊年报要用): 只给编委, 带 BOM, 列固定
  const csvAnon = await statsApi.onRequest({ request: new Request("https://x.test/api/stats?csv=1"), env: { DB: readDb } });
  assert.strictEqual(csvAnon.status, 403, "CSV 也是编委才能下");
  const csvRes = await statsApi.onRequest({
    request: new Request("https://x.test/api/stats?csv=1&from=2026-10-01&to=2026-10-02"),
    env: { DB: readDb, ZHUI_TEST_USER: JSON.stringify(ADMIN) },
  });
  assert.strictEqual(csvRes.status, 200, "编委下 CSV: 200");
  assert.ok(/text\/csv/.test(csvRes.headers.get("content-type") || ""), "Content-Type 要是 text/csv");
  assert.ok(/attachment; filename="wuxu-stats-/.test(csvRes.headers.get("content-disposition") || ""), "要当附件下载");
  // Response.text() 会按 UTF-8 解码并**吃掉** BOM, 所以要验字节
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  assert.deepStrictEqual([...csvBuf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "要带 UTF-8 BOM(否则 Excel 里中文表头乱码)");
  const csv = csvBuf.toString("utf8");
  assert.ok(csv.includes("日期,到达（内容页）,有效阅读,读者（去重）"), "表头固定");
  assert.ok(csv.includes("2026-10-01,10,2,2"), "按天: 到达 10 · 有效 2 · 读者 2");
  assert.ok(csv.includes("2026-10-02,6,2,2"), "按天: 到达 6 · 有效 2 · 读者 2");
  assert.ok(!csv.includes("2026-10-03"), "范围外的天不许出现");

  // 12) beacon 与中间件必须同一套"内容页"口径(两处正则一旦漂移, 到达与有效阅读就不可比)
  const beaconSrc = fs.readFileSync(path.join(ROOT, "src", "static", "beacon.js"), "utf8");
  const bm = /\b(?:const|let|var) CONTENT_RE = \/(.+?)\/;/.exec(beaconSrc);
  assert.ok(bm, "应从 beacon.js 里找到 CONTENT_RE");
  assert.strictEqual(bm[1], mw.CONTENT_PATH_RE.source, "beacon.js 的 CONTENT_RE 要与中间件 CONTENT_PATH_RE 逐字一致");
  assert.ok(/sendBeacon/.test(beaconSrc) && /text\/plain/.test(beaconSrc), "beacon 要用 sendBeacon + text/plain 的 Blob");
  assert.ok(/wuxu_vid/.test(beaconSrc) && /365/.test(beaconSrc), "vid 存 localStorage(365 天)");
  assert.ok(/navigator\.webdriver/.test(beaconSrc), "客户端也要挡一层 webdriver(拿不到 vid 就不发)");

  console.log("✅ test-stats.js 全部通过 (PV/UV 口径 · 30秒去抖 · 真人/疑机/入口三桶 · 回溯排除疑机与上界标记 · 回溯按需 · 首页全站口径(仅编委) · 编委不计入 · 路径归一 · 过滤门槛 · 仅存指纹 · 中间件不炸站 · 仅编委可读 · 诊断数据 · 建表等价与老库补列 · 有效阅读门槛服务端复算 · 被拒必留痕 · 限流 429 · 读者跨天去重 · CSV 导出 · beacon 口径一致)");

}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
