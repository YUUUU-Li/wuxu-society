// 浏览量统计读取接口（Cloudflare Pages Functions 原生 ESM）
//   GET /api/stats?work=<标识名>[&days=7][&diagnose=1][&key=<旧编委钥匙>]
//     -> { ok, work:{path,views,uniq,sviews,suniq,since,last}, site:{...}, trend:[{day,views,uniq,sviews,suniq}],
//          splitSince:"YYYY-MM-DD", diagnose?:{ siteTrend, topPaths, pagesPerVisitor, botRate } }
//
// 权限：**只给编委**（账号 role='编委'，或过渡期的旧钥匙 ZHUI_ADMIN_KEY）；其它一律 403。
// 口径（与 functions/_middleware.js、sql/stats.sql 一致）：
//   views/uniq   = 疑似**真人**的阅读次数 / 按天去重的人次；
//   sviews/suniq = 疑似**机器**（爬虫、脚本、AI 爬虫…）的同一口径 —— 分开记，界面只展示真人数字。
// 展示：作品页题下那块小字，只有编委登录后由 src/static/auth.js 拉取填入；普通读者看不到。
import { currentUser, isAdmin } from "./auth.js";
// 建表/补列的口径与中间件**同一份**（import 复用，避免两处走样）
import { ensureStatsSchema, isContentPath } from "../_middleware.js";

// 内容页的 SQL 判据（与中间件的 CONTENT_PATH_RE 同一口径，由 scripts/test-stats.js 守着不许走样）
const CONTENT_SQL = `(path LIKE '/w-%' OR path LIKE '/qingming-%' OR path LIKE '/issue-%' OR path LIKE '/concepts/%' OR path LIKE '/_fulltext%')`;

// —— 回溯重算 ——
// 为什么需要：改版（2026-10-13）之前，所有访问都记在老列里，"入口页围观"和"真读者"混在一起。
// 但明细表 page_visitors 里存着「每天 · 每个人 · 看过哪一页」，于是可以按**页面路径**把历史重算一遍：
//   · 内容页阅读次数 = page_daily 里路径属于内容页的行之和
//   · 内容页访客(人次) = page_visitors 里"当天碰过至少一个内容页"的 (天,人) 去重计数
//   · 只逛入口页的访客 = 全部 (天,人) − 上面那个
//
// **口径修订（2026-10-14）**：上面这套原来有个 bug —— page_visitors 当时**不分桶**，爬虫和真人写在
// 同一批行里，于是"当天碰过内容页的人"里混着 GPTBot / Bytespider / 扫描器，被当成读者报出去。
// 现在每行带 bucket 标记，本函数按它分三档：
//   · bucket='c'  内容页真人          → **可信**（contentUniqKnown / contentViewsKnown）
//   · bucket='u'  本列存在之前的历史行 → 只配当**上界**（无机器标记，无法分离）
//   · bucket='s'  疑机                → **一律排除**，任何口径都不进
// 所以对外的"全站真人"数字有两层：可信值，和不含疑机的上界。历史行无法追溯补标，
// 改版前的上界就永远是上界 —— 界面上必须标成 "≤N"，不能当成测量值。
async function derived(db, days) {
  const perPath = await db.prepare(
    `SELECT path, SUM(views) AS views, SUM(eviews) AS eviews, SUM(sviews) AS sviews FROM page_daily GROUP BY path`
  ).all();
  let contentViews = 0, entryViews = 0, suspectViews = 0;
  for (const r of (perPath && perPath.results) || []) {
    const v = Number(r.views || 0);
    const ev = Number(r.eviews || 0);   // 改版后入口页记在这里; 改版前入口页的阅读还在 views 里
    const sv = Number(r.sviews || 0);
    if (isContentPath(r.path)) contentViews += v; else entryViews += v + ev;
    suspectViews += sv;
  }

  // 还有哪些天留着"口径未知"的历史行 —— 有 u 行的天，数字就只能是上界
  const legacyRows = await db.prepare(
    `SELECT day FROM page_visitors WHERE bucket = 'u' GROUP BY day`
  ).all();
  const legacyDays = new Set(((legacyRows && legacyRows.results) || []).map((r) => r.day));

  // (天,人) 去重计数。**一律排除 bucket='s'（疑机）** —— 这就是本次修正的要点
  const uniqWhere = async (where) => {
    const r = await db.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT day, visitor FROM page_visitors WHERE ${where})`
    ).first();
    return num(r && r.n);
  };
  const contentUniqKnown = await uniqWhere(`${CONTENT_SQL} AND bucket = 'c'`);          // 可信
  const contentUniq = await uniqWhere(`${CONTENT_SQL} AND bucket IN ('c','u')`);        // 上界(已排除疑机)
  const totalKnown = await uniqWhere(`bucket IN ('c','e')`);
  const totalUpper = await uniqWhere(`bucket IN ('c','e','u')`);

  // 逐日：真正读过内容的人次（并标出这天是不是还夹着历史行）
  const cDaily = await db.prepare(
    `SELECT day, COUNT(*) AS uniq, SUM(is_known) AS uniqKnown FROM (
       SELECT day, visitor, MAX(CASE WHEN bucket = 'c' THEN 1 ELSE 0 END) AS is_known
         FROM page_visitors
        WHERE ${CONTENT_SQL} AND bucket IN ('c','u')
        GROUP BY day, visitor
     ) GROUP BY day ORDER BY day DESC LIMIT ?1`
  ).bind(Math.min(90, Math.max(1, days || 30))).all();
  const vDaily = await db.prepare(
    `SELECT day, SUM(views) AS views FROM page_daily WHERE ${CONTENT_SQL} GROUP BY day`
  ).all();
  const vByDay = {};
  for (const r of (vDaily && vDaily.results) || []) vByDay[r.day] = num(r.views);
  const contentDaily = ((cDaily && cDaily.results) || []).map((r) => {
    const clean = !legacyDays.has(r.day);          // 这天没有历史残留行 ⇒ 数字可信
    const v = vByDay[r.day] || 0;
    return { day: r.day, uniq: num(r.uniq), uniqKnown: num(r.uniqKnown), views: v, viewsKnown: clean ? v : 0, clean };
  });
  // 阅读次数同理: 干净的天才计入"可信阅读"
  let contentViewsKnown = 0;
  for (const day of Object.keys(vByDay)) if (!legacyDays.has(day)) contentViewsKnown += vByDay[day];

  return {
    contentViews,                        // 内容页阅读次数(全历史) —— 改版前含未识别机器人 ⇒ 上界
    contentViewsKnown,                   // 只算"没有历史残留行"的天 ⇒ 可信
    contentUniq,                         // 读过内容页的人次(上界; 已排除疑机)
    contentUniqKnown,                    // 读过内容页的人次(只算改版后的 c 行 ⇒ 可信)
    entryViews,
    entryOnlyUniq: Math.max(0, totalUpper - contentUniq),                 // 只逛入口页的人次(上界)
    entryOnlyUniqKnown: Math.max(0, totalKnown - contentUniqKnown),       // 同上(可信)
    suspectViews,
    contentDaily,
    legacyDayCount: legacyDays.size,     // >0 就说明还有历史残留行 ⇒ 界面要标 "≤"
    note: "改版前的历史行没有机器标记、无法分离，只能当上界；改版后的数字才是真人/疑机分开的",
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const normWork = (s) => "/" + String(s || "").replace(/\.html?$/i, "").replace(/^\/+/, "");
const totals = (r) => ({
  views: num(r && r.views),
  uniq: num(r && r.uniq),
  sviews: num(r && r.sviews),
  suniq: num(r && r.suniq),
  eviews: num(r && r.eviews),
  euniq: num(r && r.euniq),
  since: (r && r.since) || "",
  last: (r && r.last) || "",
});

const SITE_SUM = `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniq), 0) AS uniq,
                         COALESCE(SUM(sviews), 0) AS sviews, COALESCE(SUM(suniq), 0) AS suniq,
                         COALESCE(SUM(eviews), 0) AS eviews, COALESCE(SUM(euniq), 0) AS euniq,
                         MIN(day) AS since, MAX(day) AS last
                    FROM site_daily`;

async function doGet(context) {
  const db = context.env && context.env.DB;
  if (!db) return json(503, { ok: false, error: "统计尚未建表（缺 D1 绑定 DB）。" });

  const url = new URL(context.request.url);
  const key = url.searchParams.get("key") || "";
  const user = await currentUser(context);
  if (!isAdmin(context, user, key)) return json(403, { ok: false, error: "无权查看（仅编委）。" });

  const workRaw = (url.searchParams.get("work") || "").trim();
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const wantDiagnose = ["1", "true", "yes"].includes((url.searchParams.get("diagnose") || "").toLowerCase());

  try {
    // 读之前先把表建好/补齐（幂等）：这样"刚部署完还没人访问过"时接口也能正常工作
    try { await ensureStatsSchema(db); } catch { /* 建表失败就让下面的查询自己报错 */ }
    const siteRow = await db.prepare(SITE_SUM).first();
    let splitSince = "";
    let bucketsSince = "";
    try {
      const m = await db.prepare(`SELECT v FROM stats_meta WHERE k = 'split_since'`).first();
      splitSince = (m && m.v) || "";
      const m2 = await db.prepare(`SELECT v FROM stats_meta WHERE k = 'buckets_since'`).first();
      bucketsSince = (m2 && m2.v) || "";
    } catch { /* 老库还没有 stats_meta, 忽略 */ }

    let work = null;
    let trend = [];
    if (workRaw) {
      const path = normWork(workRaw);
      const row = await db.prepare(
        `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniq), 0) AS uniq,
                COALESCE(SUM(sviews), 0) AS sviews, COALESCE(SUM(suniq), 0) AS suniq,
                COALESCE(SUM(eviews), 0) AS eviews, COALESCE(SUM(euniq), 0) AS euniq,
                MIN(day) AS since, MAX(day) AS last
           FROM page_daily WHERE path = ?1`
      ).bind(path).first();
      work = Object.assign({ path }, totals(row));
      const t = await db.prepare(
        `SELECT day, views, uniq, sviews, suniq, eviews, euniq FROM page_daily WHERE path = ?1 ORDER BY day DESC LIMIT ?2`
      ).bind(path, days).all();
      trend = (t && t.results) || [];
    }

    // 回溯重算（把改版前的历史也按"内容页 / 入口页"分出来）
    // 2026-10-15 起**改成按需**：作品页已不再显示跨页数字（全站数字挪到首页 Hero，仅编委可见，
    // 由 auth.js 带 derived=1 来取），所以作品页那一路没必要求每次打开都跑一遍全表去重 ——
    // 那是这个接口里最贵的一次查询（page_visitors 上的 DISTINCT）。
    // 编委的诊断入口照旧：?diagnose=1 或 ?derived=1 时返回（首页那行也走这条）。
    const wantDerived = wantDiagnose || ["1", "true", "yes"].includes((url.searchParams.get("derived") || "").toLowerCase());
    const retro = wantDerived ? await derived(db, days).catch(() => null) : null;

    const out = {
      ok: true, work, site: totals(siteRow), trend, splitSince, bucketsSince,
      derived: retro,     // 仅 ?diagnose=1 / ?derived=1 时有值；{ contentViews, contentUniq, … }
    };

    if (wantDiagnose) {
      // 按天（全站）——看是不是某天突然飙起来； buckets: c=内容页真人 / e=入口页 / s=疑机
      const st = await db.prepare(
        `SELECT day, views, uniq, sviews, suniq, eviews, euniq FROM site_daily ORDER BY day DESC LIMIT ?1`
      ).bind(days).all();
      // 各路径排行（三个桶一起排）
      const tp = await db.prepare(
        `SELECT path, SUM(views) AS views, SUM(uniq) AS uniq, SUM(sviews) AS sviews, SUM(suniq) AS suniq,
                SUM(eviews) AS eviews, SUM(euniq) AS euniq
           FROM page_daily GROUP BY path ORDER BY (SUM(views) + SUM(sviews) + SUM(eviews)) DESC LIMIT 20`
      ).all();
      // 每个访客当天看了几个页面——真人通常 2+，扫描器几乎都只 1
      const pv = await db.prepare(
        `SELECT pages, COUNT(*) AS visitors FROM (
           SELECT visitor, COUNT(DISTINCT path) AS pages FROM page_visitors GROUP BY visitor
         ) GROUP BY pages ORDER BY pages`
      ).all();
      const s = totals(siteRow);
      const all = s.views + s.sviews;
      out.diagnose = {
        siteTrend: (st && st.results) || [],
        topPaths: (tp && tp.results) || [],
        pagesPerVisitor: (pv && pv.results) || [],
        botRate: all ? Math.round((s.sviews / all) * 1000) / 10 : 0,   // 疑似机器占比 %
      };
    }
    return json(200, out);
  } catch (e) {
    // 这是**编委专属**接口, 把真实原因带回去, 排错时不用猜
    return json(500, {
      ok: false,
      error: "读取统计失败。",
      detail: String((e && e.message) || e || "未知错误"),
    });
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return doGet(context);
  return json(405, { ok: false, error: "只接受 GET" });
}
