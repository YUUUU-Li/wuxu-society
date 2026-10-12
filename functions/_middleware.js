// 浏览量统计：根中间件（functions/_middleware.js）
//
// 为什么用中间件：官方文档明说「要对整个站点生效（**包括静态文件**）就放 functions/_middleware.js」
// （https://developers.cloudflare.com/pages/functions/middleware/）。于是：
//   · 不需要在每个页面塞 JS，也不会被广告拦截器/无 JS 客户端漏掉；
//   · 页面响应先照常返回，计数用 context.waitUntil 异步写 D1，不拖慢访问；
//   · 任何统计异常都被吞掉 —— 统计绝不能把网站弄挂。
//
// 口径（社内定，详见 sql/stats.sql 顶部与 docs/网站自定义指南.md「浏览量统计」）：
//   · views  = 每次**页面**请求算一次（同一访客同一页 30 秒内的连续请求只算一次：防预取/连点/多标签）；
//   · uniq   = **按天去重的人次**（同一访客同一天同一页只算 1，跨天各算 1）；
//   · **真人 / 疑似机器分开记**：判定像机器人的记进 sviews/suniq，界面只展示真人数字，
//     同时如实标出"另被爬了多少" —— 不丢信息，也不污染读者数据；
//   · 只统计 HTML 页面：静态资源、/api/*、预取、爬虫、分支预览部署、非 200 错误页不计；
//   · 不存原始 IP：IP+UA 加「当天+盐」做 SHA-256，得到每天更换的访客指纹；
//   · **编委自己不计入**：编委登录后前端会种一个 zz_nostats=1 cookie（见 src/static/auth.js），
//     中间件见到直接跳过 —— 免得我们自己调试把数字刷高。
//
// 写入量：每次约写 5 行（两张去重明细 + 去抖时间戳 + 两张日表）。D1 免费额度 10 万行写/天。

// —— 建表（与 sql/stats.sql 完全一致，幂等） ——
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS page_daily (
     path   TEXT    NOT NULL,
     day    TEXT    NOT NULL,
     views  INTEGER NOT NULL DEFAULT 0,
     uniq   INTEGER NOT NULL DEFAULT 0,
     sviews INTEGER NOT NULL DEFAULT 0,
     suniq  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (path, day)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_page_daily_day ON page_daily(day)`,
  `CREATE TABLE IF NOT EXISTS page_visitors (
     day     TEXT    NOT NULL,
     path    TEXT    NOT NULL,
     visitor TEXT    NOT NULL,
     ts      INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, path, visitor)
   )`,
  `CREATE TABLE IF NOT EXISTS site_daily (
     day    TEXT PRIMARY KEY,
     views  INTEGER NOT NULL DEFAULT 0,
     uniq   INTEGER NOT NULL DEFAULT 0,
     sviews INTEGER NOT NULL DEFAULT 0,
     suniq  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS site_visitors (
     day     TEXT NOT NULL,
     visitor TEXT NOT NULL,
     PRIMARY KEY (day, visitor)
   )`,
  `CREATE TABLE IF NOT EXISTS stats_meta (
     k TEXT PRIMARY KEY,
     v TEXT NOT NULL
   )`,
];
// 老库补列（2026-10 改进之前建的库只有 views/uniq；已加过会报 duplicate column name，忽略）
// 注意: stats_meta 用 CREATE IF NOT EXISTS —— 老库没有这张表, 而补列语句管不了"建表"
const MIGRATE_SQL = [
  `CREATE TABLE IF NOT EXISTS stats_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `ALTER TABLE page_daily ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE page_daily ADD COLUMN suniq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE site_daily ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE site_daily ADD COLUMN suniq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE page_visitors ADD COLUMN ts INTEGER NOT NULL DEFAULT 0`,
];
// 建表/补列每个数据库只做一次。用 WeakSet 按"库句柄"记，而不是一个全局布尔：
// 一个 isolate 里正常只会用到 env.DB 这一个句柄，但测试里会拿多个内存库跑同一份代码。
const SCHEMA_READY = new WeakSet();
async function ensureStatsSchema(db) {
  if (SCHEMA_READY.has(db)) return;
  try {
    await db.prepare(`SELECT day FROM site_daily LIMIT 1`).first();   // 表已在
  } catch {
    for (const stmt of SCHEMA_SQL) {
      try { await db.prepare(stmt).run(); } catch (e) {
        if (!/already exists|duplicate/i.test(String((e && e.message) || ""))) throw e;
      }
    }
  }
  for (const stmt of MIGRATE_SQL) {                                  // 老库补列/补表(幂等)
    try { await db.prepare(stmt).run(); } catch (e) {
      if (!/duplicate column name|already exists/i.test(String((e && e.message) || ""))) throw e;
    }
  }
  SCHEMA_READY.add(db);
}

// —— 工具 ——
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 北京时间的"今天"（与站内其它时间口径一致）
function beijingDay(now) {
  const ms = (now === undefined ? Date.now() : now) + 8 * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
const SKIP_EXT = /\.(js|mjs|css|map|json|txt|xml|webmanifest|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|pdf|zip|mp4|webm|mp3|wasm)$/i;
// 已知爬虫/脚本/扫描器（含主流 AI 爬虫与 SEO 工具）；命中即"疑似机器"
const BOT_RE = /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|pingdom|uptime|monitor|headlesschrome|lighthouse|curl|wget|python-requests|python-urllib|urllib|aiohttp|httpx|axios|got \(|undici|node-fetch|go-http-client|okhttp|java\/|libwww|scrapy|masscan|zgrab|nmap|expanse|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|yisou|sogou|ai2bot|gptbot|claudebot|ccbot|perplexity|amazonbot|applebot|dataprovider|leakix|censys|shodan|netsystemsresearch|paloalto|bitdiscovery|checkhost|driftnet|wpengine|safedns|proofpoint/i;
// 分支预览部署（abc123.wuxu-society.pages.dev）不计数；生产用的 pages.dev 域名与自定义域名照常算
const PROD_PAGES_HOST = "wuxu-society.pages.dev";

function canonPath(pathname) {
  let p = String(pathname || "/").split("?")[0];
  p = p.replace(/\/+$/, "");
  p = p.replace(/\/index\.html?$/i, "");
  p = p.replace(/\.html?$/i, "");
  if (p === "" || p === "/index") p = "/";
  return p || "/";
}

// 这一条请求要不要**记账**（注意：判为"疑似机器"的也会记，只是记到另一列）
export function shouldCount(request) {
  if (!request || request.method !== "GET") return false;
  let u;
  try { u = new URL(request.url); } catch { return false; }
  const host = u.hostname || "";
  if (host.endsWith(".pages.dev") && host !== PROD_PAGES_HOST) return false;   // 分支预览
  if (u.pathname.startsWith("/api/")) return false;
  if (SKIP_EXT.test(u.pathname)) return false;
  const h = request.headers;
  if (h.get("sec-purpose") || h.get("purpose") || h.get("x-purpose") || h.get("x-moz")) return false;   // 预取/预渲染
  if ((h.get("range") || "").length > 0) return false;
  const accept = h.get("accept") || "";
  const isHtmlPath = /\.html?$/i.test(u.pathname);
  if (!isHtmlPath && !accept.includes("text/html")) return false;   // 浏览器导航请求才算"看了一页"
  return true;
}

// 编委自己不计入: 前端(auth.js)在编委登录/开旧钥匙时种下 zz_nostats=1(非 HttpOnly, JS 可设可清)
export function hasNoStatsCookie(request) {
  const c = (request && request.headers.get("cookie")) || "";
  return /(?:^|;\s*)zz_nostats=1(?:;|$)/.test(c);
}

// 是不是"疑似机器"？
// 判定原则: **宁可把机器当人，也不要把人当机器** —— 只有拿到正向证据才算疑机：
//   · UA 命中已知爬虫/脚本黑名单，或干脆没有 UA；
//   · 没有 Accept-Language（真浏览器与微信 webview 都会带，脚本/扫描器基本不带）。
// 真人特征：有 Accept-Language，且（现代浏览器的 Sec-Fetch-Mode: navigate / Sec-Fetch-Dest: document，
//          或 老浏览器/微信 webview 的 Accept-Encoding 含 gzip/br）。
export function isSuspect(request) {
  const h = (request && request.headers) || new Headers();
  const ua = h.get("user-agent") || "";
  if (!ua) return true;
  if (BOT_RE.test(ua)) return true;
  const al = (h.get("accept-language") || "").trim();
  const ae = (h.get("accept-encoding") || "").toLowerCase();
  const sfDest = (h.get("sec-fetch-dest") || "").toLowerCase();
  const sfMode = (h.get("sec-fetch-mode") || "").toLowerCase();
  if (!al) return true;
  if (sfDest === "document" || sfMode === "navigate") return false;
  if (/gzip|br|deflate/.test(ae)) return false;              // 没 Sec-Fetch 但像浏览器(老 Safari/微信)
  return true;
}

function changesOf(r) {
  const m = (r && (r.meta || r)) || {};
  return Number(m.changes || 0);
}
// 去抖窗口: 同一访客对同一路径, 30 秒内的连续请求只算一次阅读（时间戳是毫秒!）
const DEBOUNCE_MS = 30 * 1000;

// 记一次页面访问（异步、可被 waitUntil 托管）
export async function countView(env, request, opts = {}) {
  const db = env && env.DB;
  if (!db) return null;
  await ensureStatsSchema(db);
  const u = new URL(request.url);
  const path = canonPath(u.pathname);
  const now = opts.now === undefined ? Date.now() : opts.now;
  const day = beijingDay(now);
  const suspect = opts.suspect === undefined ? isSuspect(request) : !!opts.suspect;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const ua = request.headers.get("user-agent") || "";
  const salt = (env && env.STATS_SALT) || "wuxu-stats-v1";
  const visitor = (await sha256Hex(day + "|" + ip + "|" + ua + "|" + salt)).slice(0, 24);

  // 1) 去重明细 + 去抖时间戳 + 记下"真人/机器可分辨"从哪天开始
  const first = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO page_visitors(day, path, visitor, ts) VALUES (?1, ?2, ?3, ?4)`).bind(day, path, visitor, now),
    db.prepare(`INSERT OR IGNORE INTO site_visitors(day, visitor) VALUES (?1, ?2)`).bind(day, visitor),
    db.prepare(`UPDATE page_visitors SET ts = ?4 WHERE day = ?1 AND path = ?2 AND visitor = ?3 AND ts <= ?4 - ?5`)
      .bind(day, path, visitor, now, DEBOUNCE_MS),
    db.prepare(`INSERT OR IGNORE INTO stats_meta(k, v) VALUES ('split_since', ?1)`).bind(day),
  ]);
  const newPage = changesOf(first && first[0]) === 1 ? 1 : 0;
  const newSite = changesOf(first && first[1]) === 1 ? 1 : 0;
  const afterGap = changesOf(first && first[2]) === 1 ? 1 : 0;
  // 同一个人同一页 30 秒内连续请求（预取/连点刷新/多标签）只算一次阅读
  if (!newPage && !afterGap) return { path, day, suspect, counted: false };

  const vc = suspect ? "sviews" : "views";
  const uc = suspect ? "suniq" : "uniq";
  await db.batch([
    db.prepare(
      `INSERT INTO page_daily(path, day, ${vc}, ${uc}) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(path, day) DO UPDATE SET ${vc} = ${vc} + 1, ${uc} = ${uc} + excluded.${uc}`
    ).bind(path, day, newPage),
    db.prepare(
      `INSERT INTO site_daily(day, ${vc}, ${uc}) VALUES (?1, 1, ?2)
         ON CONFLICT(day) DO UPDATE SET ${vc} = ${vc} + 1, ${uc} = ${uc} + excluded.${uc}`
    ).bind(day, newSite),
  ]);
  return { path, day, suspect, counted: true, newPage: !!newPage, newSite: !!newSite };
}

export async function onRequest(context) {
  const res = await context.next();
  try {
    // 只统计"正常打开的页面": 404/500 之类的错误页不算一次阅读; 编委自己(zz_nostats)也不算
    if (res && res.status === 200 && shouldCount(context.request) && !hasNoStatsCookie(context.request)) {
      const job = countView(context.env, context.request);
      if (typeof context.waitUntil === "function") context.waitUntil(job);
      else await job;
    }
  } catch {
    // 统计出任何问题都不影响页面（静默）
  }
  return res;
}
