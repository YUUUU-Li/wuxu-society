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
  since: (r && r.since) || "",
  last: (r && r.last) || "",
});

const SITE_SUM = `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniq), 0) AS uniq,
                         COALESCE(SUM(sviews), 0) AS sviews, COALESCE(SUM(suniq), 0) AS suniq,
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
    const siteRow = await db.prepare(SITE_SUM).first();
    let splitSince = "";
    try {
      const m = await db.prepare(`SELECT v FROM stats_meta WHERE k = 'split_since'`).first();
      splitSince = (m && m.v) || "";
    } catch { /* 老库还没有 stats_meta, 忽略 */ }

    let work = null;
    let trend = [];
    if (workRaw) {
      const path = normWork(workRaw);
      const row = await db.prepare(
        `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniq), 0) AS uniq,
                COALESCE(SUM(sviews), 0) AS sviews, COALESCE(SUM(suniq), 0) AS suniq,
                MIN(day) AS since, MAX(day) AS last
           FROM page_daily WHERE path = ?1`
      ).bind(path).first();
      work = Object.assign({ path }, totals(row));
      const t = await db.prepare(
        `SELECT day, views, uniq, sviews, suniq FROM page_daily WHERE path = ?1 ORDER BY day DESC LIMIT ?2`
      ).bind(path, days).all();
      trend = (t && t.results) || [];
    }

    const out = { ok: true, work, site: totals(siteRow), trend, splitSince };

    if (wantDiagnose) {
      // 按天（全站）——看是不是某天突然飙起来
      const st = await db.prepare(
        `SELECT day, views, uniq, sviews, suniq FROM site_daily ORDER BY day DESC LIMIT ?1`
      ).bind(days).all();
      // 各路径排行（真人 + 疑机一起排）——榜首若是首页且量畸高，基本是机器人打首页
      const tp = await db.prepare(
        `SELECT path, SUM(views) AS views, SUM(uniq) AS uniq, SUM(sviews) AS sviews, SUM(suniq) AS suniq
           FROM page_daily GROUP BY path ORDER BY (SUM(views) + SUM(sviews)) DESC LIMIT 20`
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
  } catch {
    return json(500, { ok: false, error: "读取统计失败。" });
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return doGet(context);
  return json(405, { ok: false, error: "只接受 GET" });
}
