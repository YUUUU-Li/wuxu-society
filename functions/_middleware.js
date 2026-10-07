// 浏览量统计：根中间件（functions/_middleware.js）
//
// 为什么用中间件：官方文档明说「要对整个站点生效（**包括静态文件**）就放 functions/_middleware.js」
// （https://developers.cloudflare.com/pages/functions/middleware/）。于是：
//   · 不需要在每个页面塞 JS，也不会被广告拦截器/无 JS 客户端漏掉；
//   · 页面响应先照常返回，计数用 context.waitUntil 异步写 D1，不拖慢访问；
//   · 任何统计异常都被吞掉 —— 统计绝不能把网站弄挂。
//
// 口径（社内定，详见 sql/stats.sql 顶部与 docs/网站自定义指南.md）：
//   · views  = 每次**页面**请求算一次；
//   · uniq   = **按天去重的人次**（同一访客同一天同一页只算 1，跨天各算 1）；
//   · 只统计 HTML 页面：静态资源、/api/*、预取、爬虫、分支预览部署不计；
//   · 不存原始 IP：IP+UA 加「当天+盐」做 SHA-256，得到每天更换的访客指纹。
//
// 写入量：每次计数约写 4 行（两张去重表 INSERT OR IGNORE + 两张日表 UPSERT）。
// D1 免费额度 10 万行写/天 → 约 2.5 万次页面访问/天，够用（超了只是停止计数，网站不受影响）。

// —— 建表（与 sql/stats.sql 完全一致，幂等） ——
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS page_daily (
     path  TEXT    NOT NULL,
     day   TEXT    NOT NULL,
     views INTEGER NOT NULL DEFAULT 0,
     uniq  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (path, day)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_page_daily_day ON page_daily(day)`,
  `CREATE TABLE IF NOT EXISTS page_visitors (
     day     TEXT NOT NULL,
     path    TEXT NOT NULL,
     visitor TEXT NOT NULL,
     PRIMARY KEY (day, path, visitor)
   )`,
  `CREATE TABLE IF NOT EXISTS site_daily (
     day   TEXT PRIMARY KEY,
     views INTEGER NOT NULL DEFAULT 0,
     uniq  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS site_visitors (
     day     TEXT NOT NULL,
     visitor TEXT NOT NULL,
     PRIMARY KEY (day, visitor)
   )`,
];
let SCHEMA_READY = false;
async function ensureStatsSchema(db) {
  if (SCHEMA_READY) return;
  try {
    await db.prepare(`SELECT day FROM site_daily LIMIT 1`).first();   // 表已在
  } catch {
    for (const stmt of SCHEMA_SQL) {
      try { await db.prepare(stmt).run(); } catch (e) {
        if (!/already exists|duplicate/i.test(String((e && e.message) || ""))) throw e;
      }
    }
  }
  SCHEMA_READY = true;
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
const BOT_RE = /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|pingdom|uptime|monitor|headlesschrome|lighthouse|curl|wget|python-requests|axios|go-http-client|node-fetch|okhttp|scrapy/i;
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

// 这一条请求要不要计数？
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
  const ua = h.get("user-agent") || "";
  if (!ua || BOT_RE.test(ua)) return false;
  const accept = h.get("accept") || "";
  const isHtmlPath = /\.html?$/i.test(u.pathname);
  if (!isHtmlPath && !accept.includes("text/html")) return false;   // 浏览器导航请求才算"看了一页"
  return true;
}

function changesOf(r) {
  const m = (r && (r.meta || r)) || {};
  return Number(m.changes || 0);
}

// 记一次页面访问（异步、可被 waitUntil 托管）
export async function countView(env, request, opts = {}) {
  const db = env && env.DB;
  if (!db) return null;
  await ensureStatsSchema(db);
  const u = new URL(request.url);
  const path = canonPath(u.pathname);
  const day = beijingDay(opts.now);
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const ua = request.headers.get("user-agent") || "";
  const salt = (env && env.STATS_SALT) || "wuxu-stats-v1";
  const visitor = (await sha256Hex(day + "|" + ip + "|" + ua + "|" + salt)).slice(0, 24);

  // 1) 去重明细：插得进去 = 今天这个访客第一次看这一页 / 第一次来本站
  const first = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO page_visitors(day, path, visitor) VALUES (?1, ?2, ?3)`).bind(day, path, visitor),
    db.prepare(`INSERT OR IGNORE INTO site_visitors(day, visitor) VALUES (?1, ?2)`).bind(day, visitor),
  ]);
  const newPage = changesOf(first && first[0]) === 1 ? 1 : 0;
  const newSite = changesOf(first && first[1]) === 1 ? 1 : 0;

  // 2) 累加日表（views 每次都加；uniq 只在"新访客"时加）
  await db.batch([
    db.prepare(
      `INSERT INTO page_daily(path, day, views, uniq) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(path, day) DO UPDATE SET views = views + 1, uniq = uniq + excluded.uniq`
    ).bind(path, day, newPage),
    db.prepare(
      `INSERT INTO site_daily(day, views, uniq) VALUES (?1, 1, ?2)
         ON CONFLICT(day) DO UPDATE SET views = views + 1, uniq = uniq + excluded.uniq`
    ).bind(day, newSite),
  ]);
  return { path, day, newPage: !!newPage, newSite: !!newSite };
}

export async function onRequest(context) {
  const res = await context.next();
  try {
    // 只统计"正常打开的页面": 404/500 之类的错误页不算一次阅读
    if (res && res.status === 200 && shouldCount(context.request)) {
      const job = countView(context.env, context.request);
      if (typeof context.waitUntil === "function") context.waitUntil(job);
      else await job;
    }
  } catch {
    // 统计出任何问题都不影响页面（静默）
  }
  return res;
}
