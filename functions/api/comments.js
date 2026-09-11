// 众注·评论 API（Cloudflare Pages Functions + D1）——平铺楼式（回帖也是一楼，reply_to 指向原楼）
// GET  /api/comments?work=<slug> -> { ok, floors:[{id,name,body,reply_to,created_at,likes,liked,own}] }
// POST /api/comments {work,body,reply_to?}   发表新楼/回帖（**需登录**；署名一律取账号笔名，不可自填）
// POST /api/comments {like_comment_id}       同感（**需登录**；不能赞同自己的评论）
// POST /api/comments {delete_id, key}        编委删除（role='编委' 或旧钥匙 ZHUI_ADMIN_KEY，过渡期两者都认）
// 身份：liker_key = 'u:<user_id>'；评论落 user_id（name 保留作历史兼容/展示）
import { currentUser, isAdmin } from "./auth.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
const NOBODY = "\u0000none";   // 未登录时的占位身份, 保证不会误匹配到任何一行

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function ipOf(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0";
}
function clean(s, n) {
  return String(s == null ? "" : s).trim().replace(/[\r\t]/g, "").slice(0, n);
}
// D1 的 datetime('now') 是 UTC; 转为北京时间(+08:00)返回, 免得读者看到早 8 小时的时间
function bjISO(s) {
  if (!s) return s;
  const d = new Date(String(s).replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return s;
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate()) +
    "T" + p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds()) + "+08:00"
  );
}
function fmt(row, me) {
  const dead = !!row.deleted_at;
  return {
    id: row.id,
    name: row.name,
    body: dead ? "" : row.body,        // 已删楼: 内容不回传
    reply_to: row.reply_to,
    created_at: bjISO(row.created_at), // UTC -> 北京时间
    likes: row.likes || 0,
    liked: !!row.liked,
    own: !!(me && row.user_id && row.user_id === me.id),   // 自己的楼: 前端不显示「同感」
    deleted: dead,                      // 供前端显示「该楼已删」占位
  };
}

export async function onRequest(context) {
  const req = context.request;
  const db = context.env.DB;
  if (!db) return json(503, { ok: false, error: "数据库尚未配置。" });
  const u = new URL(req.url);
  const me = await currentUser(context);
  const who = me ? "u:" + me.id : NOBODY;

  if (req.method === "GET") {
    const work = clean(u.searchParams.get("work"), 60);
    if (!work) return json(400, { ok: false, error: "缺少作品标识。" });
    try {
      const rows = (await db.prepare(
        `SELECT c.id, c.name, c.user_id, c.body, c.reply_to, c.created_at, c.deleted_at,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS likes,
                EXISTS(SELECT 1 FROM comment_likes cl2 WHERE cl2.comment_id = c.id AND cl2.liker_key = ?2) AS liked
         FROM comments c WHERE c.work_id = ?1
         ORDER BY c.id ASC`
      ).bind(work, who).all()).results;
      // 已删楼也返回(带 deleted 标记): 前端不渲染其内容, 但被回复时显示「该楼已删」占位
      return json(200, { ok: true, floors: rows.map((r) => fmt(r, me)) });
    } catch (e) {
      return json(500, { ok: false, error: "评论读取失败。" });
    }
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }
    try {
      // 同感（需登录, 且不能赞自己）
      if (body.like_comment_id != null) {
        if (!me) return json(401, { ok: false, error: "登录后才能同感。", needLogin: true });
        const cid = Number(body.like_comment_id);
        const c = await db.prepare(`SELECT id, user_id, ip FROM comments WHERE id = ?1`).bind(cid).first();
        if (!c) return json(404, { ok: false, error: "没有这一楼。" });
        if ((c.user_id && c.user_id === me.id) || (!c.user_id && c.ip && c.ip === ipOf(req))) {
          return json(400, { ok: false, error: "自己的评论就不用同感啦。" });
        }
        const exist = (await db.prepare(`SELECT id FROM comment_likes WHERE comment_id = ?1 AND liker_key = ?2`).bind(cid, who).first());
        if (exist) {
          await db.prepare(`DELETE FROM comment_likes WHERE id = ?1`).bind(exist.id).run();
        } else {
          await db.prepare(`INSERT INTO comment_likes(comment_id, liker_key) VALUES (?1, ?2)`).bind(cid, who).run();
        }
        const n = (await db.prepare(`SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?1`).bind(cid).first());
        return json(200, { ok: true, comment_id: cid, liked: !exist, likes: n ? n.n : 0 });
      }
      // 编委删除(先显后删)
      if (body.delete_id != null) {
        if (!isAdmin(context, me, body.key)) return json(403, { ok: false, error: "无权删除。" });
        await db.prepare(`UPDATE comments SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL`)
          .bind(Number(body.delete_id)).run();
        return json(200, { ok: true, deleted: Number(body.delete_id) });
      }
      // 发表评论/回帖（需登录; 署名取账号笔名）
      if (!me) return json(401, { ok: false, error: "登录后才能发表评论。", needLogin: true });
      const work = clean(body.work, 60);
      const text = String(body.body || "").trim().slice(0, 500);
      if (!work) return json(400, { ok: false, error: "缺少作品标识。" });
      if (!text) return json(400, { ok: false, error: "写点什么吧。" });
      const replyTo = body.reply_to != null ? Number(body.reply_to) : null;
      if (replyTo != null && !(replyTo >= 1)) return json(400, { ok: false, error: "回帖目标无效。" });
      const r = await db.prepare(
        `INSERT INTO comments(work_id, name, user_id, body, reply_to, ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).bind(work, me.nick, me.id, text, replyTo, ipOf(req)).run();
      return json(200, { ok: true, id: r.meta.last_row_id, reply_to: replyTo, name: me.nick });
    } catch (e) {
      return json(500, { ok: false, error: "评论操作失败。" });
    }
  }
  return json(405, { ok: false, error: "只接受 GET/POST" });
}
