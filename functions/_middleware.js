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
// 明细表的分桶标记（2026-10-14 补，修掉一个回溯口径 bug）：
//   page_visitors 这张"每天·每个人·看过哪一页"的明细表，原来**不分桶**，爬虫和真人写在一起。
//   于是 functions/api/stats.js 的历史回溯（按内容页路径去重算"有多少人读过"）会把爬虫也算成人。
//   现在每行都记下当次的桶：
//     bucket='c' 内容页真人 / 'e' 入口页真人 / 's' 疑机 / 'u' 口径未知（本列存在之前的历史行）
//   回溯只认 'c' 为"确定是真人"，把 'c'+'u' 当上界，'s' **一律排除**。
//   注意：历史行无法追溯补标，所以改版前的数字永远是上界，不是测量值。
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
     eviews INTEGER NOT NULL DEFAULT 0,
     euniq  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (path, day)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_page_daily_day ON page_daily(day)`,
  `CREATE TABLE IF NOT EXISTS page_visitors (
     day     TEXT    NOT NULL,
     path    TEXT    NOT NULL,
     visitor TEXT    NOT NULL,
     ts      INTEGER NOT NULL DEFAULT 0,
     bucket  TEXT    NOT NULL DEFAULT 'u',
     PRIMARY KEY (day, path, visitor)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_page_visitors_path ON page_visitors(path)`,
  `CREATE TABLE IF NOT EXISTS site_daily (
     day    TEXT PRIMARY KEY,
     views  INTEGER NOT NULL DEFAULT 0,
     uniq   INTEGER NOT NULL DEFAULT 0,
     sviews INTEGER NOT NULL DEFAULT 0,
     suniq  INTEGER NOT NULL DEFAULT 0,
     eviews INTEGER NOT NULL DEFAULT 0,
     euniq  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS bucket_visits (
     day     TEXT NOT NULL,
     bucket  TEXT NOT NULL,
     visitor TEXT NOT NULL,
     PRIMARY KEY (day, bucket, visitor)
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
  // —— 有效阅读（2026-10-31 加）——
  // 上面那些表记的是「到达」：服务端看到一个像真浏览器的 HTML 页面 GET 就记一次。
  // 它含"点开就退"，也没法跨天认人。这张表记的是「有效阅读」：由页面里的 beacon 自报
  // 停留时长/滚动深度/有无交互，**服务端复算**后够门槛才落库（判定见 functions/api/hit.js）。
  //   · vid   = 浏览器 localStorage 里的随机 UUID（不是 IP、不连账号、不跨站）
  //   · ref   = 来源分类 direct/internal/wechat/search/external（服务端按 Referer 判，不信前端）
  //   · 主键(day, vid, path) ⇒ 同一人同一天同一页只记一次；又因此能算出跨天的**人数**
  //     （到达层的指纹里掺了 day，天生只能算人次）。
  `CREATE TABLE IF NOT EXISTS reads (
     day      TEXT    NOT NULL,
     vid      TEXT    NOT NULL,
     path     TEXT    NOT NULL,
     dwell_ms INTEGER NOT NULL DEFAULT 0,
     scrolled INTEGER NOT NULL DEFAULT 0,
     ref      TEXT    NOT NULL DEFAULT '',
     country  TEXT,
     ts       INTEGER NOT NULL,
     PRIMARY KEY (day, vid, path)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_reads_path ON reads(path)`,
  `CREATE INDEX IF NOT EXISTS idx_reads_vid ON reads(vid)`,
  // 被拒绝的 beacon 按原因累计（规格要求：不许静默失败而不留痕）
  `CREATE TABLE IF NOT EXISTS hit_reject (
     day    TEXT    NOT NULL,
     reason TEXT    NOT NULL,
     n      INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, reason)
   )`,
];
// 老库补列（已加过会报 duplicate column name，忽略）
// 注意: stats_meta 用 CREATE IF NOT EXISTS —— 老库没有这张表, 而补列语句管不了"建表"
const MIGRATE_SQL = [
  `CREATE TABLE IF NOT EXISTS stats_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bucket_visits (
     day     TEXT NOT NULL,
     bucket  TEXT NOT NULL,
     visitor TEXT NOT NULL,
     PRIMARY KEY (day, bucket, visitor)
   )`,
  `ALTER TABLE page_daily ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE page_daily ADD COLUMN suniq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE page_daily ADD COLUMN eviews INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE page_daily ADD COLUMN euniq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE site_daily ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE site_daily ADD COLUMN suniq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE site_daily ADD COLUMN eviews INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE site_daily ADD COLUMN euniq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE page_visitors ADD COLUMN ts INTEGER NOT NULL DEFAULT 0`,
  // 补分桶标记: 老行没法追溯, 一律落成 'u'(口径未知), 由回溯把它当"上界"而不是"真人"
  `ALTER TABLE page_visitors ADD COLUMN bucket TEXT NOT NULL DEFAULT 'u'`,
  // 回溯按 path 过滤, 而主键是 (day, path, visitor) —— day 在最前, 索引不到 path
  `CREATE INDEX IF NOT EXISTS idx_page_visitors_path ON page_visitors(path)`,
  // 有效阅读 + 拒绝原因（2026-10-31 加）。**必须在 MIGRATE 里也建一遍**：
  // 线上库早就有表了，ensureStatsSchema 探测到 site_daily 存在就跳过 SCHEMA_SQL，
  // 只跑 MIGRATE_SQL —— 只写在 SCHEMA_SQL 里的话，这两张表在老库上永远不会被创建。
  `CREATE TABLE IF NOT EXISTS reads (
     day      TEXT    NOT NULL,
     vid      TEXT    NOT NULL,
     path     TEXT    NOT NULL,
     dwell_ms INTEGER NOT NULL DEFAULT 0,
     scrolled INTEGER NOT NULL DEFAULT 0,
     ref      TEXT    NOT NULL DEFAULT '',
     country  TEXT,
     ts       INTEGER NOT NULL,
     PRIMARY KEY (day, vid, path)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_reads_path ON reads(path)`,
  `CREATE INDEX IF NOT EXISTS idx_reads_vid ON reads(vid)`,
  `CREATE TABLE IF NOT EXISTS hit_reject (
     day    TEXT    NOT NULL,
     reason TEXT    NOT NULL,
     n      INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, reason)
   )`,
];
// 建表/补列每个数据库只做一次。用 WeakSet 按"库句柄"记，而不是一个全局布尔：
// 一个 isolate 里正常只会用到 env.DB 这一个句柄，但测试里会拿多个内存库跑同一份代码。
const SCHEMA_READY = new WeakSet();
// 建表/补列（幂等）。中间件在计数前调它；functions/api/stats.js 读之前也调一次 ——
// **两处都要调**：否则"刚部署完、还没有任何页面访问"时，接口会去查还不存在的列而报 500。
export async function ensureStatsSchema(db) {
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
export async function sha256Hex(s) {
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

export function canonPath(pathname) {
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

// 内容页 vs 入口页：
//   内容页 = 读者真的"读东西"的页面（作品页/期页/概念页/全文库）→ 计入 views/uniq（主口径）
//   入口页 = 首页、作品库、社员、雅集、投稿、404 等"只是路过/被爬"的页面 → 单独记 eviews/euniq
// 为什么这么分（2026-10-13 实据）：全站 247 个"访客"里 186 个只打了首页、225 个只看了一页就
// 走 —— 那是爬虫/预览抓取/顺手点开的形状；真正读过作品的人次只有几十。
// 想调整口径就改这一条正则（其余代码不用动）。
export const CONTENT_PATH_RE = /^\/(w-|qingming-|issue-|concepts\/|_fulltext)/;
export function isContentPath(path) {
  return CONTENT_PATH_RE.test(String(path || ""));
}

function changesOf(r) {
  const m = (r && (r.meta || r)) || {};
  return Number(m.changes || 0);
}
// 日期平移（'YYYY-MM-DD' 加减天数，纯 UTC 运算避免时区借位）
function shiftDay(day, delta) {
  const t = Date.parse(day + "T00:00:00Z");
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}
// —— 保留策略（只有"运维遥测"会被清，测量数据一律不动）——
// 为什么要分两种：
//   · hit_reject 是**拒绝原因计数**（原因是个封闭枚举，正常每天 ≤10 行），90 天后没诊断价值 → 清掉；
//   · reads / page_visitors 是**测量数据**：清掉就等于把"累计阅读""读者人数""改版前上界"一起删了。
//     而且它们本来就不是原始事件流 —— reads 已经是 (天,人,页) 去重后的行，量级只随"真有人读"增长
//     （小站一年也就千行级），没有非清不可的理由。所以不做"90 天清明细"那一步，并如实写进文档。
// D1 没有 cron：Pages Functions 只能被动响应请求，所以用「约每 500 次计数顺手清一次」摊掉成本。
export async function pruneOldRejects(db, day, keepDays = 90) {
  const cut = shiftDay(day, -keepDays);
  await db.prepare(`DELETE FROM hit_reject WHERE day < ?1`).bind(cut).run();
  return cut;
}
const PRUNE_EVERY = 500;   // 平均每 500 次页面计数触发一次
// 去抖窗口: 同一访客对同一路径, 30 秒内的连续请求只算一次阅读（时间戳是毫秒!）
const DEBOUNCE_MS = 30 * 1000;

// 记一次页面访问（异步、可被 waitUntil 托管）
// 分桶（bucket）：s=疑似机器；c=内容页（真人阅读，主口径）；e=入口页（只路过/被爬）
export async function countView(env, request, opts = {}) {
  const db = env && env.DB;
  if (!db) return null;
  await ensureStatsSchema(db);
  const u = new URL(request.url);
  const path = canonPath(u.pathname);
  const now = opts.now === undefined ? Date.now() : opts.now;
  const day = beijingDay(now);
  // 顺手清理过期遥测（平均每 500 次才真做一次；失败无所谓，绝不冒泡）
  if (opts.prune !== false && Math.random() < 1 / PRUNE_EVERY) {
    try { await pruneOldRejects(db, day); } catch { /* 清理失败不影响计数 */ }
  }
  const suspect = opts.suspect === undefined ? isSuspect(request) : !!opts.suspect;
  const bucket = suspect ? "s" : (isContentPath(path) ? "c" : "e");
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const ua = request.headers.get("user-agent") || "";
  const salt = (env && env.STATS_SALT) || "wuxu-stats-v1";
  const visitor = (await sha256Hex(day + "|" + ip + "|" + ua + "|" + salt)).slice(0, 24);

  // 1) 去重明细 + 去抖时间戳 + 记下"真人/机器可分辨"从哪天开始
  //    注意: 站点级去重按 bucket 分开记(bucket_visits) —— 同一个人先看首页(e)、再看作品页(c),
  //    两边都该各算 1 个"人次", 用一张不分桶的表会把内页那次吃掉。
  //    明细行也带上 bucket: 回溯算"有多少人读过内容页"时要能排掉疑机(见 api/stats.js derived)。
  const first = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO page_visitors(day, path, visitor, ts, bucket) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(day, path, visitor, now, bucket),
    db.prepare(`INSERT OR IGNORE INTO bucket_visits(day, bucket, visitor) VALUES (?1, ?2, ?3)`).bind(day, bucket, visitor),
    db.prepare(`UPDATE page_visitors SET ts = ?4 WHERE day = ?1 AND path = ?2 AND visitor = ?3 AND ts <= ?4 - ?5`)
      .bind(day, path, visitor, now, DEBOUNCE_MS),
    db.prepare(`INSERT OR IGNORE INTO stats_meta(k, v) VALUES ('split_since', ?1)`).bind(day),
    db.prepare(`INSERT OR IGNORE INTO stats_meta(k, v) VALUES ('buckets_since', ?1)`).bind(day),
  ]);
  const newPage = changesOf(first && first[0]) === 1 ? 1 : 0;
  const newBucket = changesOf(first && first[1]) === 1 ? 1 : 0;
  const afterGap = changesOf(first && first[2]) === 1 ? 1 : 0;
  // 同一个人同一页 30 秒内连续请求（预取/连点刷新/多标签）只算一次阅读
  if (!newPage && !afterGap) return { path, day, bucket, suspect, counted: false };

  const vc = bucket === "s" ? "sviews" : bucket === "e" ? "eviews" : "views";
  const uc = bucket === "s" ? "suniq" : bucket === "e" ? "euniq" : "uniq";
  await db.batch([
    db.prepare(
      `INSERT INTO page_daily(path, day, ${vc}, ${uc}) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(path, day) DO UPDATE SET ${vc} = ${vc} + 1, ${uc} = ${uc} + excluded.${uc}`
    ).bind(path, day, newPage),        // 单页访客: 该访客当天第一次看"这一页"
    db.prepare(
      `INSERT INTO site_daily(day, ${vc}, ${uc}) VALUES (?1, 1, ?2)
         ON CONFLICT(day) DO UPDATE SET ${vc} = ${vc} + 1, ${uc} = ${uc} + excluded.${uc}`
    ).bind(day, newBucket),            // 站点访客(按桶): 该访客当天第一次出现在这个桶里
  ]);
  return { path, day, bucket, suspect, counted: true, newPage: !!newPage, newBucket: !!newBucket };
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
