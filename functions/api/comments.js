// 众注·评论 API（Cloudflare Pages Functions + D1）——平铺楼式（回帖也是一楼，reply_to 指向原楼）
// GET  /api/comments?work=<slug> -> { ok, floors:[{id,name,body,reply_to,created_at,likes,liked}] }
// POST /api/comments {work,name,body,reply_to?}   发表新楼/回帖
// POST /api/comments {like_comment_id, name}      同感 点赞/取消
// POST /api/comments {delete_id, key}             编委删除(需 env.ZHUI_ADMIN_KEY 匹配)
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function ipOf(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0";
}
function clean(s, n) {
  return String(s == null ? "" : s).trim().replace(/[\r\t]/g, "").slice(0, n);
}
function fmt(row) {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    reply_to: row.reply_to,
    created_at: row.created_at,
    likes: row.likes || 0,
    liked: !!row.liked,
  };
}

export async function onRequest(context) {
  const req = context.request;
  const db = context.env.DB;
  if (!db) return json(503, { ok: false, error: "数据库尚未配置。" });
  const u = new URL(req.url);

    if (req.method === "GET") {
      const work = clean(u.searchParams.get("work"), 60);
      if (!work) return json(400, { ok: false, error: "缺少作品标识。" });
      try {
        const rows = (await db.prepare(
          `SELECT c.id, c.name, c.body, c.reply_to, c.created_at,
                  (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS likes,
                  EXISTS(SELECT 1 FROM comment_likes cl2 WHERE cl2.comment_id = c.id AND cl2.liker_key = ?2) AS liked
           FROM comments c WHERE c.work_id = ?1 AND c.deleted_at IS NULL
           ORDER BY c.id ASC`
        ).bind(work, ipOf(req)).all()).results;
        return json(200, { ok: true, floors: rows.map(fmt) });
      } catch (e) {
        return json(500, { ok: false, error: "评论读取失败。" });
      }
    }

    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }
      try {
        // 同感
        if (body.like_comment_id != null) {
          const cid = Number(body.like_comment_id);
          const key = ipOf(req);
          const exist = (await db.prepare(`SELECT id FROM comment_likes WHERE comment_id = ?1 AND liker_key = ?2`).bind(cid, key).first());
          if (exist) {
            await db.prepare(`DELETE FROM comment_likes WHERE id = ?1`).bind(exist.id).run();
          } else {
            await db.prepare(`INSERT INTO comment_likes(comment_id, liker_key) VALUES (?1, ?2)`).bind(cid, key).run();
          }
          const n = (await db.prepare(`SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?1`).bind(cid).first());
          return json(200, { ok: true, comment_id: cid, liked: !exist, likes: n ? n.n : 0 });
        }
        // 编委删除(先显后删)
        if (body.delete_id != null) {
          if (!context.env.ZHUI_ADMIN_KEY || clean(body.key, 100) !== context.env.ZHUI_ADMIN_KEY) {
            return json(403, { ok: false, error: "无权删除。" });
          }
          await db.prepare(`UPDATE comments SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL`)
            .bind(Number(body.delete_id)).run();
          return json(200, { ok: true, deleted: Number(body.delete_id) });
        }
        // 发表评论/回帖
        const work = clean(body.work, 60);
        const name = clean(body.name, 20);
        const text = String(body.body || "").trim().slice(0, 500);
        if (!work) return json(400, { ok: false, error: "缺少作品标识。" });
        if (!name) return json(400, { ok: false, error: "请填写笔名/昵称。" });
        if (!text) return json(400, { ok: false, error: "写点什么吧。" });
        const replyTo = body.reply_to != null ? Number(body.reply_to) : null;
        if (replyTo != null && !(replyTo >= 1)) return json(400, { ok: false, error: "回帖目标无效。" });
        const r = await db.prepare(
          `INSERT INTO comments(work_id, name, body, reply_to, ip) VALUES (?1, ?2, ?3, ?4, ?5)`
        ).bind(work, name, text, replyTo, ipOf(req)).run();
        return json(200, { ok: true, id: r.meta.last_row_id, reply_to: replyTo });
      } catch (e) {
        return json(500, { ok: false, error: "评论操作失败。" });
      }
    }
    return json(405, { ok: false, error: "只接受 GET/POST" });
}
