// 浏览量统计读取接口（Cloudflare Pages Functions 原生 ESM）
//   GET /api/stats?work=<标识名>[&days=7][&key=<旧编委钥匙>]
//     -> { ok, work:{path,views,uniq,since,last}, site:{views,uniq,since,last}, trend:[{day,views,uniq}] }
//
// 权限：**只给编委**（账号 role='编委'，或过渡期的旧钥匙 ZHUI_ADMIN_KEY）。
// 口径（与 functions/_middleware.js、sql/stats.sql 一致）：
//   views = 页面请求次数；uniq = 按天去重的访客**人次**（跨天各算一次，所以全站 uniq = 每日 uniq 之和）。
// 展示：作品页题下的一块小字，只有编委登录后由 src/static/zhuzhu.js 拉取填入；普通读者看不到。
import { currentUser, isAdmin } from "./auth.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const normWork = (s) => "/" + String(s || "").replace(/\.html?$/i, "").replace(/^\/+/, "");

async function doGet(context) {
  const db = context.env && context.env.DB;
  if (!db) return json(503, { ok: false, error: "统计尚未建表（缺 D1 绑定 DB）。" });

  const url = new URL(context.request.url);
  const key = url.searchParams.get("key") || "";
  const user = await currentUser(context);
  if (!isAdmin(context, user, key)) return json(403, { ok: false, error: "无权查看（仅编委）。" });

  const workRaw = (url.searchParams.get("work") || "").trim();
  const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days")) || 7));

  try {
    const site = await db.prepare(
      `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniq), 0) AS uniq,
              MIN(day) AS since, MAX(day) AS last
         FROM site_daily`
    ).first();

    let work = null;
    let trend = [];
    if (workRaw) {
      const path = normWork(workRaw);
      const row = await db.prepare(
        `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniq), 0) AS uniq,
                MIN(day) AS since, MAX(day) AS last
           FROM page_daily WHERE path = ?1`
      ).bind(path).first();
      work = {
        path,
        views: num(row && row.views),
        uniq: num(row && row.uniq),
        since: (row && row.since) || "",
        last: (row && row.last) || "",
      };
      const t = await db.prepare(
        `SELECT day, views, uniq FROM page_daily WHERE path = ?1 ORDER BY day DESC LIMIT ?2`
      ).bind(path, days).all();
      trend = (t && t.results) || [];
    }

    return json(200, {
      ok: true,
      work,
      site: {
        views: num(site && site.views),
        uniq: num(site && site.uniq),
        since: (site && site.since) || "",
        last: (site && site.last) || "",
      },
      trend,
    });
  } catch {
    return json(500, { ok: false, error: "读取统计失败。" });
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return doGet(context);
  return json(405, { ok: false, error: "只接受 GET" });
}
