// 众注·标签 API（Cloudflare Pages Functions + D1）
// GET  /api/tags?work=<slug>  -> { tags:[{id,word,count,voted}], pool:[word...], ok:true }
// POST /api/tags  {work, word} -> 点赞/取消该标签；word 不存在则新建"候选"再点赞
// 计票口径：同一 IP 对 同一作品+同一标签 一票（voter_key=cf-connecting-ip）
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

async function q(db, sql, ...b) {
  return (await db.prepare(sql).bind(...b).all()).results;
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
        const rows = await q(
          db,
          `SELECT t.id, t.word, t.kind, COUNT(tv.id) AS c FROM tags t
           LEFT JOIN tag_votes tv ON tv.tag_id = t.id AND tv.work_id = ?1
           GROUP BY t.id HAVING COUNT(tv.id) > 0
           ORDER BY c DESC, t.id ASC`,
          work
        );
        const votedRows = await q(
          db,
          `SELECT tag_id FROM tag_votes WHERE work_id = ?1 AND voter_key = ?2`,
          work, ipOf(req)
        );
        const voted = new Set(votedRows.map((r) => r.tag_id));
        const poolRows = await q(db, `SELECT word FROM tags WHERE kind != '候选' ORDER BY id`);
        return json(200, {
          ok: true,
          tags: rows.map((r) => ({ id: r.id, word: r.word, kind: r.kind, count: r.c || 0, voted: voted.has(r.id) })),
          pool: poolRows.map((r) => r.word),
        });
      } catch (e) {
        return json(500, { ok: false, error: "标签读取失败。" });
      }
    }

    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }
      const work = clean(body.work, 60);
      const word = clean(body.word, 12);
      if (!work || !word) return json(400, { ok: false, error: "缺少作品标识或标签词。" });
      try {
        const found = (await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(word).first());
        let tagId = found ? found.id : null;
        let candidate = false;
        if (!tagId) {
          const r = await db.prepare(`INSERT INTO tags(word, kind) VALUES (?1, '候选')`).bind(word).run();
          tagId = r.meta.last_row_id;
          candidate = true;
        }
        const key = ipOf(req);
        const exist = (await db.prepare(`SELECT id FROM tag_votes WHERE work_id = ?1 AND tag_id = ?2 AND voter_key = ?3`)
          .bind(work, tagId, key).first());
        if (exist) {
          await db.prepare(`DELETE FROM tag_votes WHERE id = ?1`).bind(exist.id).run();
        } else {
          await db.prepare(`INSERT INTO tag_votes(work_id, tag_id, voter_key) VALUES (?1, ?2, ?3)`)
            .bind(work, tagId, key).run();
        }
        const c = (await q(db, `SELECT COUNT(*) AS n FROM tag_votes WHERE work_id = ?1 AND tag_id = ?2`, work, tagId))[0];
        return json(200, { ok: true, word, id: tagId, candidate, voted: !exist, count: c ? c.n : 0 });
      } catch (e) {
        return json(500, { ok: false, error: "标签操作失败。" });
      }
    }
    return json(405, { ok: false, error: "只接受 GET/POST" });
}
