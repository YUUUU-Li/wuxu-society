// 首页公开的「作品累计阅读」数字（Cloudflare Pages Functions 原生 ESM）
//   GET /api/site-stats   ->  { ok: true, reads: 118, since: "2026-10-07" }
//
// **这是全站唯一对所有人公开的统计接口**，所以它刻意只吐一个聚合数：
//   reads = 内容页（作品 / 雅集篇目 / 期页 / 概念页 / 全文库）的累计**阅读次数**。
//
// 为什么公开的是「阅读次数」而不是「人次」：
//   · 访客指纹是 sha256(当天|IP|UA|盐)、按天去重 —— 同一天换网络算 2 人次、一个 NAT 后多人算 1 人次，
//     而且指纹每天更换，"总共多少人"这套设计根本算不出来；
//   · 改版（2026-10-14）之前明细表没有机器标记，历史里混着未识别的爬虫，那个数字只能当**上界**；
//   · 公开页若写「56 人次」，不挂「≤」就是不诚实，挂了「≤」又像欲盖弥彰。
//   「页面被打开过多少次」则是字面事实 —— 不问是谁打开的，公开场合站得住。
//
// 不含任何路径、疑机、入口页数字（那些是编委的内部诊断项，去 /api/stats 看）。
// 出任何问题都返回 ok:false：宁可首页那行不显示，也不能显示一个假的 0。
import { ensureStatsSchema, isContentPath } from "../_middleware.js";

// 首页访问量远大于内页，浏览器端缓存 60 秒、边缘 5 分钟，避免每点开一次首页就读一次 D1
const CACHE_OK = "public, max-age=60, s-maxage=300";
const CACHE_NO = "no-store";

function json(status, body, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || CACHE_NO },
  });
}

async function doGet(context) {
  const db = context.env && context.env.DB;
  if (!db) return json(200, { ok: false }, CACHE_NO);
  try {
    // 与中间件同一份建表/补列逻辑（刚部署完还没有页面访问触发补列时，这里也不会 500）
    await ensureStatsSchema(db);
    // 用 isContentPath 在 JS 里判内容页 —— 直接复用中间件分桶用的那**同一个函数**，
    // 不在 SQL 里再抄一遍路径前缀，两边就不会走样。
    const rows = await db.prepare(`SELECT path, SUM(views) AS views FROM page_daily GROUP BY path`).all();
    let reads = 0;
    for (const r of (rows && rows.results) || []) {
      if (isContentPath(r.path)) reads += Number(r.views || 0);
    }
    const first = await db.prepare(`SELECT MIN(day) AS since FROM page_daily`).first();
    return json(200, { ok: true, reads, since: (first && first.since) || "" }, CACHE_OK);
  } catch {
    // 公开接口不吐内部错误信息，只让前端把那一行藏起来
    return json(200, { ok: false }, CACHE_NO);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return doGet(context);
  return json(405, { ok: false, error: "只接受 GET" }, CACHE_NO);
}
