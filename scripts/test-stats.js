// 浏览量统计测试: node scripts/test-stats.js
// 用 node:sqlite 建"真表"(sql/stats.sql), 让真实的 functions/_middleware.js 与 functions/api/stats.js 跑一遍:
//   · 计数口径: 浏览次数(PV) 每次请求 +1；访客(UV) **按天去重的人次**(同人同天同页只算 1, 跨天各算 1)
//   · 归一化: /w-feng.html 与 /w-feng 归到同一篇；不同作品各自独立
//   · 全站去重: 同一人同一天看了两篇, 全站 UV 只 +1
//   · 过滤: 静态资源 / /api/* / 非 GET / 预取 / 爬虫 / 分支预览部署 都不计
//   · 隐私: 只存指纹(不存原始 IP), 且指纹每天更换
//   · 鉴权: /api/stats 只给编委(账号 role='编委' 或旧钥匙), 读者/未登录一律 403
//   · 建表: sql/stats.sql 与中间件内置的 DDL 完全等价(两边幂等, 不靠人记)
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

const HTML = { accept: "text/html,application/xhtml+xml" };
const req = (url, headers = {}, method = "GET") =>
  new Request("https://wuxu-society.pages.dev" + url, {
    method,
    headers: Object.assign({ "cf-connecting-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 (Windows NT 10.0)", accept: HTML.accept }, headers),
  });
const ADMIN = { id: 8, handle: "jwl", nick: "蓦流", role: "编委", member_state: "已确认" };
const READER = { id: 7, handle: "cty", nick: "泊珩", role: "读者", member_state: "" };
const D1 = Date.UTC(2026, 8, 12, 6, 0, 0);    // 北京时间 2026-09-12 14:00
const D2 = Date.UTC(2026, 8, 13, 6, 0, 0);    // 北京时间 2026-09-13 14:00

async function main() {
  const mw = await import(pathToFileURL(path.join(ROOT, "functions", "_middleware.js")).href);
  const statsApi = await import(pathToFileURL(path.join(ROOT, "functions", "api", "stats.js")).href);
  const schemaSql = fs.readFileSync(path.join(ROOT, "sql", "stats.sql"), "utf8");
  const db = makeDB(schemaSql);
  const env = { DB: db };

  // 1) 过滤规则(shouldCount)
  assert.strictEqual(mw.shouldCount(req("/w-feng.html")), true, "普通页面应计数");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { "sec-purpose": "prefetch" })), false, "预取不计数");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { purpose: "prefetch" })), false, "purpose:prefetch 不计数");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" })), false, "爬虫不计数");
  assert.strictEqual(mw.shouldCount(req("/api/stats?work=w-feng")), false, "接口不计数");
  assert.strictEqual(mw.shouldCount(req("/site.css", { accept: "text/css,*/*;q=0.1" })), false, "样式表不计数");
  assert.strictEqual(mw.shouldCount(req("/logo.png", { accept: "image/avif,image/webp,*/*" })), false, "图片不计数");
  assert.strictEqual(mw.shouldCount(req("/zhuzhu.js", { accept: "*/*" })), false, "脚本不计数");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", {}, "POST")), false, "非 GET 不计数");
  assert.strictEqual(mw.shouldCount(req("/w-feng.html", { "user-agent": "" })), false, "无 UA 不计数");
  assert.strictEqual(mw.shouldCount(new Request("https://abc123.wuxu-society.pages.dev/w-feng.html", { headers: Object.assign({ "cf-connecting-ip": "1.1.1.1" }, HTML, { "user-agent": "Mozilla/5.0" }) })), false, "分支预览部署不计数");
  assert.strictEqual(mw.shouldCount(new Request("https://wuxu.org/w-feng.html", { headers: Object.assign({ "cf-connecting-ip": "1.1.1.1" }, HTML, { "user-agent": "Mozilla/5.0" }) })), true, "自定义域名要计数");
  assert.strictEqual(mw.shouldCount(req("/w-feng", { accept: "*/*" })), false, "不是导航请求(accept 无 html)不计数");

  // 2) PV/UV 口径
  await mw.countView(env, req("/w-feng.html"), { now: D1 });                                  // A 看第一篇
  let p = row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", "/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [1, 1], "首次访问: PV=1 UV=1");
  await mw.countView(env, req("/w-feng.html"), { now: D1 });                                  // A 刷新
  p = row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", "/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [2, 1], "同一人刷新: PV+1 但 UV 不变");
  await mw.countView(env, req("/w-feng"), { now: D1 });                                       // 无扩展名 URL 同一篇
  p = row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", "/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [3, 1], "/w-feng 与 /w-feng.html 归到同一篇");
  await mw.countView(env, req("/w-feng.html", { "cf-connecting-ip": "198.51.100.9" }), { now: D1 });   // B 来了
  p = row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", "/w-feng", "2026-09-12");
  assert.deepStrictEqual([p.views, p.uniq], [4, 2], "换一个人: PV+1 UV+1");
  const s1 = row(db, "SELECT * FROM site_daily WHERE day = ?1", "2026-09-12");
  assert.deepStrictEqual([s1.views, s1.uniq], [4, 2], "全站当天 PV/UV 正确");

  // 同一人(ip A)换一篇作品: 单篇 UV+1, 全站 UV 不变(全站按人按天去重)
  await mw.countView(env, req("/w-mei.html"), { now: D1 });
  const pMei = row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", "/w-mei", "2026-09-12");
  assert.deepStrictEqual([pMei.views, pMei.uniq], [1, 1], "另一篇独立计数");
  const s2 = row(db, "SELECT * FROM site_daily WHERE day = ?1", "2026-09-12");
  assert.deepStrictEqual([s2.views, s2.uniq], [5, 2], "同一人看第二篇: 全站 PV+1 但 UV 不加");

  // 跨天: 同一人再来 —— 人次口径 => 单篇 UV 各天各算一次
  await mw.countView(env, req("/w-feng.html"), { now: D2 });
  const p2 = row(db, "SELECT * FROM page_daily WHERE path = ?1 AND day = ?2", "/w-feng", "2026-09-13");
  assert.deepStrictEqual([p2.views, p2.uniq], [1, 1], "跨天重新计一个访客(人次口径)");
  const totals = row(db, "SELECT SUM(views) AS v, SUM(uniq) AS u FROM page_daily WHERE path = ?1", "/w-feng");
  assert.deepStrictEqual([totals.v, totals.u], [5, 3], "单篇累计: PV=5, 访客=3 人次");

  // 3) 隐私: 只有指纹, 没有原始 IP
  const v = row(db, "SELECT visitor FROM page_visitors ORDER BY visitor LIMIT 1");
  assert(/^[0-9a-f]{24}$/.test(v.visitor), "访客是 24 位哈希指纹");
  assert(!/203\.0\.113\.7/.test(v.visitor) && !/198\.51\.100\.9/.test(v.visitor), "指纹里不该出现原始 IP");
  const cols = db._raw.prepare("SELECT name FROM pragma_table_info('page_visitors')").all().map((c) => c.name);
  assert.deepStrictEqual(cols, ["day", "path", "visitor"], "去重表只有 天/路径/指纹 三列");
  const other = makeDB(schemaSql);   // 同一天换个盐/另一份库, 指纹不同(说明不能跨库追踪)
  await mw.countView({ DB: other }, req("/w-feng.html", {}, "GET"), { now: D1 });
  assert.notStrictEqual(row(other, "SELECT visitor FROM page_visitors LIMIT 1").visitor, v.visitor, "换库/换盐则指纹不同");

  // 4) 中间件: 响应原样返回 + 出错不炸站
  //    注意: 中间件走的是"真实当天"(不注入 now), 所以这里只比对"计数有没有 +1", 不假定具体日期
  const seen = [];
  const viewSum = () => row(db, "SELECT COALESCE(SUM(views), 0) AS v FROM page_daily WHERE path = ?1", "/w-feng").v;
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
  const broken = { prepare() { throw new Error("boom"); } };
  const res2 = await mw.onRequest({ request: req("/w-mei.html"), env: { DB: broken }, next: async () => new Response("ok") });
  assert.strictEqual(await res2.text(), "ok", "统计炸了也不影响页面");
  const noDb = await mw.onRequest({ request: req("/w-mei.html"), env: {}, next: async () => new Response("ok") });
  assert.strictEqual(await noDb.text(), "ok", "没有 D1 绑定时照常出页面");
  // 404/500 之类的错误页不算一次阅读
  const missSeen = [];
  const beforeMiss = viewSum();
  const res404 = await mw.onRequest({
    request: req("/w-feng.html"), env, waitUntil: (p) => missSeen.push(p),
    next: async () => new Response("nope", { status: 404 }),
  });
  assert.strictEqual(res404.status, 404, "错误页原样返回");
  await Promise.all(missSeen);
  assert.strictEqual(viewSum(), beforeMiss, "404 不该被算成一次阅读");

  // 5) 接口鉴权: 只给编委
  const apiReq = (q, user) => ({
    request: new Request("https://wuxu-society.pages.dev/api/stats" + q),
    env: Object.assign({ DB: db }, user ? { ZHUI_TEST_USER: JSON.stringify(user) } : {}),
  });
  assert.strictEqual((await statsApi.onRequest(apiReq("?work=w-feng"))).status, 403, "未登录看统计: 403");
  assert.strictEqual((await statsApi.onRequest(apiReq("?work=w-feng", READER))).status, 403, "读者看统计: 403");
  assert.strictEqual((await statsApi.onRequest({ request: new Request("https://x.test/api/stats", { method: "POST" }), env: { DB: db } })).status, 405, "非 GET: 405");
  const ok = await statsApi.onRequest(apiReq("?work=w-feng", ADMIN));
  assert.strictEqual(ok.status, 200, "编委看统计: 200");
  const j = await ok.json();
  // 期望值直接取 SQL 真值(上面中间件那一步走的是"真实当天", 具体加到哪天由运行日期决定)
  const sqlW = row(db, "SELECT SUM(views) AS v, SUM(uniq) AS u FROM page_daily WHERE path = ?1", "/w-feng");
  const sqlS = row(db, "SELECT SUM(views) AS v, SUM(uniq) AS u FROM site_daily");
  assert.deepStrictEqual([j.work.views, j.work.uniq], [sqlW.v, sqlW.u], "接口返回本篇 PV/访客(人次) 应与库一致");
  assert.deepStrictEqual([j.site.views, j.site.uniq], [sqlS.v, sqlS.u], "接口返回全站 PV/访客(跨天人次合计) 应与库一致");
  assert.strictEqual(j.work.path, "/w-feng", "接口把标识名归一成路径");
  assert.strictEqual(j.work.since, "2026-09-12", "本篇统计起始日");
  const newest = row(db, "SELECT day, views, uniq FROM page_daily WHERE path = ?1 ORDER BY day DESC LIMIT 1", "/w-feng");
  assert.deepStrictEqual(j.trend[0], { day: newest.day, views: newest.views, uniq: newest.uniq }, "趋势最新一天在最前");
  const dayCount = db._raw.prepare("SELECT COUNT(DISTINCT day) AS n FROM page_daily WHERE path = '/w-feng'").get().n;
  assert.strictEqual(j.trend.length, Math.min(dayCount, 7), "趋势应含全部（≤7）有数据的日期(默认 days=7)");
  assert.deepStrictEqual(j.trend.map((x) => x.day), j.trend.map((x) => x.day).slice().sort().reverse(), "趋势按天倒序");
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

  // 6) 建表口径: sql/stats.sql 与中间件内置 DDL 等价
  const src = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8");
  const arrText = /const SCHEMA_SQL = (\[[\s\S]*?\n\]);/.exec(src);
  assert(arrText, "应从 _middleware.js 里找到 SCHEMA_SQL");
  const builtin = new Function("return " + arrText[1] + ";")();
  const norm = (s) => String(s).replace(/\s+/g, " ").replace(/;\s*$/, "").trim();
  const names = (sqls) => sqls.map((s) => norm(s));
  const fromFile = statements(schemaSql).map(norm);
  const fromMw = names(builtin);
  assert.deepStrictEqual(fromFile.slice().sort(), fromMw.slice().sort(),
    "sql/stats.sql 与 _middleware.js 的建表语句应逐条一致（两边都幂等）");

  console.log("✅ test-stats.js 全部通过 (PV/UV 口径 · 按天人次 · 路径归一 · 过滤规则 · 仅存指纹 · 中间件不炸站 · 仅编委可读 · 建表等价)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
