// 有效阅读上报（Cloudflare Pages Functions 原生 ESM）
//   POST /api/hit   ← 由 src/static/beacon.js 用 navigator.sendBeacon() 发
//   body: { vid, path, dwell_ms, scrolled, interacted }
//   200 {ok:true,counted:true}   首次计入
//   200 {ok:true,counted:false}  去重命中（同一人·同一天·同一页已经记过）
//   204                          被过滤 / 不够门槛（**故意不返回 403**，不给爬虫任何反馈信号）
//   429                          同一来源刷太快
//   405                          非 POST
//
// 与"到达"层的关系（这两个数字各司其职，谁都不许冒充另一个）：
//   · 到达 = functions/_middleware.js 记的 views/uniq：服务端看到像真浏览器的 HTML 页面 GET 就记。
//     它**不依赖 JS**（微信内置浏览器、阅读模式、脚本被拦都还算），所以是诚实的分母；
//     但它含"点开就退"，也没法跨天认人（指纹里掺了 day）⇒ 只能算人次，且是上界。
//   · 有效阅读 = 本接口记的 reads：页面里 beacon 自报停留/滚动/交互，**服务端按下面规则复算**。
//     它只统计"真的读了东西"的人次，并且因为 vid 是持久的，**能算出跨天的人数**。
//     它依赖 JS ⇒ 天生是下界（无 JS 的读者看不到，这份差额由"到达"兜着）。
//
// 为什么不信任前端：客户端确实只有它自己知道"待了多久"，这一点无法在服务端验证；
// 但"够不够门槛"这个**判定**必须在服务端做 —— 前端送来的 engaged:true 一律不看，
// 只看 dwell_ms / scrolled / interacted 三个原始量，免得客户端一句话就把门槛废掉。
// 另外 vid 会被套用同一套"是不是机器"的请求头自检（跟到达层共用 isSuspect）：
// UA 是 HeadlessChrome / python-requests，或者压根没有 Accept-Language，一律当机器。
import { ensureStatsSchema, isSuspect, canonPath, isContentPath, hasNoStatsCookie, sha256Hex } from "../_middleware.js";

// —— 门槛（改口径就改这里，页面上的说明文字在 src/static/auth.js 的 title 里）——
const ENGAGED_MS = 8000;     // 可见停留 ≥ 8 秒：站着读完也算，不必滚动
const SHORT_MS   = 4000;     // 短页/短停留的补充通道：≥ 4 秒 **且**（滚过半 或 有过交互）
const SCROLL_MIN = 50;       // 滚动深度门槛（%）
const MAX_DWELL  = 6 * 3600 * 1000;   // 停留上限，超过就当离线的标签页，截断
const MAX_BODY   = 2048;     // 请求体上限（正常约 120 字节）
const RATE_MAX   = 60;       // 同一来源 60 次/分钟（只防刷，不做身份判断）
const RATE_WINDOW = 60 * 1000;

// UUID（任意版本都收，前端优先 crypto.randomUUID()）
const VID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

// 服务端复算"算不算读过"（**唯一判定处**；前端传什么 engaged 都不看）
// 为什么给短停留留一条"补充通道"：本站多是短诗，一页根本不可滚动 ⇒ 滚动比例恒等于 100%，
// 若照"或"的字面执行，点开 0.5 秒就跑的人也会被判成有效。所以短于 8 秒时必须再拿到一个信号。
export function engagedFrom(dwellMs, scrolledPct, interacted) {
  const dwell = clamp(Number(dwellMs), 0, MAX_DWELL);
  const scroll = clamp(Number(scrolledPct), 0, 100);
  if (dwell >= ENGAGED_MS) return true;
  if (dwell >= SHORT_MS && (scroll >= SCROLL_MIN || !!interacted)) return true;
  return false;
}

// 来源分类（服务端按 Referer 判，不信前端自报）
export function refFrom(referer, ua) {
  const u = String(ua || "");
  if (/micromessenger/i.test(u)) return "wechat";     // 微信内置浏览器通常不带 Referer
  let host = "";
  try { host = new URL(String(referer || "")).hostname.toLowerCase(); } catch { host = ""; }
  if (!host) return "direct";
  if (/(^|\.)(wuxu\.org|wuxu-society\.pages\.dev)$/.test(host)) return "internal";
  if (/(^|\.)(weixin\.qq\.com|mp\.weixin\.qq\.com|wechat\.com)$/.test(host)) return "wechat";
  if (/(^|\.)(baidu\.com|bing\.com|sogou\.com|so\.com|sm\.cn|yandex\.[a-z.]+|duckduckgo\.com)$/.test(host) ||
      /(^|\.)google\.[a-z.]+$/.test(host)) return "search";
  return "external";
}

// —— 限流：进程内令牌桶 ——
// 为什么不落库：D1 每次写都要钱也要延迟，而限流只是"防刷的刹车"，不是统计量。
// 代价是"尽力而为"：一个 isolate 看不到别的 isolate 的计数，跨机房洪水会漏。
// 真正的兜底是 reads 的主键 (day, vid, path) —— 同一个 vid 每天每页最多 1 行。
const RATE = new Map();   // key: 哈希后的来源；value: { w: 窗口起点, n: 次数 }
// 内存里只留哈希、且最多活 60 秒；原始 IP 不落库、不进日志、不参与任何身份判断。
async function rateHit(env, request, now) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const salt = (env && env.STATS_SALT) || "wuxu-stats-v1";
  const key = (await sha256Hex("rate|" + ip + "|" + salt)).slice(0, 16);
  const cur = RATE.get(key);
  if (!cur || now - cur.w >= RATE_WINDOW) {
    RATE.set(key, { w: now, n: 1 });
    if (RATE.size > 5000) {                    // 防止 Map 无限长（洪水时）
      for (const [k, v] of RATE) if (now - v.w >= RATE_WINDOW) RATE.delete(k);
    }
    return false;
  }
  cur.n += 1;
  return cur.n > RATE_MAX;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
// 过滤一律 204：不给爬虫/脚本任何"你被认出来了"的信号
const silent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

// 记一条拒绝原因（**不许静默失败而不留痕**）。失败无所谓，绝不冒泡。
async function reject(db, day, reason) {
  try {
    await db.prepare(
      `INSERT INTO hit_reject(day, reason, n) VALUES (?1, ?2, 1)
         ON CONFLICT(day, reason) DO UPDATE SET n = n + 1`
    ).bind(day, reason).run();
  } catch { /* 遥测写失败不影响主流程 */ }
}

function beijingDay(now) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json(405, { ok: false, error: "只接受 POST" });
  const db = env && env.DB;
  if (!db) return silent();                       // 没绑库就当无事发生，别给前端报错

  const now = Date.now();
  const day = beijingDay(now);
  try {
    await ensureStatsSchema(db);
  } catch {
    return silent();
  }

  try {
    // 1) 编委自己不计入（与到达层同一个 cookie）
    if (hasNoStatsCookie(request)) { await reject(db, day, "nostats"); return silent(); }
    // 2) 机器自检（UA 黑名单 / 无 Accept-Language），与到达层共用同一套判定
    if (isSuspect(request)) { await reject(db, day, "bot"); return silent(); }
    // 3) 限流
    if (await rateHit(env, request, now)) { await reject(db, day, "rate"); return json(429, { ok: false }); }
    // 4) 读请求体（sendBeacon 用 text/plain 的 Blob，也兼容 application/json）
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY) { await reject(db, day, "body"); return silent(); }
    let body;
    try { body = JSON.parse(raw); } catch { await reject(db, day, "body"); return silent(); }
    if (!body || typeof body !== "object") { await reject(db, day, "body"); return silent(); }

    // 5) 访客标识
    const vid = String(body.vid || "").trim();
    if (!VID_RE.test(vid)) { await reject(db, day, "vid"); return silent(); }

    // 6) 路径：必须本站相对路径，且归一化后仍是内容页（首页/作品库那些入口页不参与"阅读"）
    const rawPath = String(body.path || "");
    if (!rawPath || rawPath.length > 200 || !rawPath.startsWith("/") || rawPath.startsWith("/api/")) {
      await reject(db, day, "path"); return silent();
    }
    const path = canonPath(rawPath);
    if (!isContentPath(path)) { await reject(db, day, "notcontent"); return silent(); }

    // 7) 门槛复算（**服务端判定**）
    if (!engagedFrom(body.dwell_ms, body.scrolled, body.interacted)) {
      await reject(db, day, "weak"); return silent();
    }

    // 8) 落库（唯一约束去重）
    const dwell = Math.round(clamp(Number(body.dwell_ms), 0, MAX_DWELL));
    const scroll = Math.round(clamp(Number(body.scrolled), 0, 100));
    const ref = refFrom(request.headers.get("referer"), request.headers.get("user-agent"));
    const country = (request.cf && request.cf.country) ? String(request.cf.country).slice(0, 2) : null;
    const r = await db.prepare(
      `INSERT OR IGNORE INTO reads(day, vid, path, dwell_ms, scrolled, ref, country, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(day, vid, path, dwell, scroll, ref, country, now).run();
    const counted = Number((r && (r.meta || r) && (r.meta || r).changes) || 0) === 1;
    if (!counted) { await reject(db, day, "dup"); return json(200, { ok: true, counted: false }); }
    return json(200, { ok: true, counted: true });
  } catch {
    // 上报接口绝不能把前端拖进错误路径：吞掉，但留一条原因
    await reject(db, day, "error");
    return silent();
  }
}
