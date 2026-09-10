// 众注·标签 API（Cloudflare Pages Functions + D1）
// GET  /api/tags?work=<slug> -> { tags:[{id,word,count,voted,hint,cat}], pool:[{word,hint,cat}], near:[[...]], ok:true }
// POST /api/tags  {work, word, device}          -> 点赞/取消；大纲内词=预设, 其它=候选
// POST /api/tags  {key, action, ...}            -> 编委动作(需 ZHUI_ADMIN_KEY):
//      seed                          词表落库(94 词 kind='预设', 幂等)
//      adopt {word}                  候选转正 -> '已采纳'
//      merge {from, to}              把 from 的票并入 to 后删除 from
//      delete {word}                 删除标签及其票
// 计票口径：同一「设备」(前端 localStorage 的 zz_dev, 缺省回退 IP) 对 同一作品+同一标签 一票。
//   ⚠️ 写入与查票必须同源：voter_key 一律用「设备号优先、无则 IP」(voteKey)，
//      否则再点一下取消时会查不到自己那行 → 撞唯一约束、取消不掉。
// 限流：同一设备(缺省回退 IP) 对同一作品最多赞同 3 个标签（讨论定）
import { TAG_OUTLINE, TAG_HINTS, TAG_NEAR, TAG_LEGACY } from "./tag-outline.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
const MAX_TAGS_PER_DEVICE = 3;
const CAT = {};
TAG_OUTLINE.forEach((o) => (CAT[o.w] = o.cat));

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function ipOf(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0";
}
// 投票人身份: 设备号优先(前端传 device), 无则回退 IP。写入/查票/取消三处必须都用它。
function voteKey(device, req) {
  return clean(device, 40) || ipOf(req);
}
function clean(s, n) {
  return String(s == null ? "" : s).trim().replace(/[\r\t]/g, "").slice(0, n);
}
function isOutline(word) {
  return Object.prototype.hasOwnProperty.call(CAT, word);
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
      // 与写入同源: 设备号优先(前端在 ?dev= 里带), 无则回退 IP —— 用于标记「我赞过的」
      const voterKey = voteKey(u.searchParams.get("dev"), req);
      const votedRows = await q(
        db,
        `SELECT tag_id FROM tag_votes WHERE work_id = ?1 AND voter_key = ?2`,
        work, voterKey
      );
      const voted = new Set(votedRows.map((r) => r.tag_id));
      // 联想池 = 库中非候选词 ∪ 大纲未落库的词（保证词表一上线即可用）
      const poolRows = await q(db, `SELECT word FROM tags WHERE kind != '候选' ORDER BY id`);
      const inDb = new Set(poolRows.map((r) => r.word));
      const pool = poolRows.map((r) => ({ word: r.word, hint: TAG_HINTS[r.word] || "", cat: CAT[r.word] || "" }));
      TAG_OUTLINE.forEach((o) => {
        if (!inDb.has(o.w)) pool.push({ word: o.w, hint: TAG_HINTS[o.w] || "", cat: o.cat });
      });
      return json(200, {
        ok: true,
        tags: rows.map((r) => ({
          id: r.id, word: r.word, kind: r.kind, count: r.c || 0, voted: voted.has(r.id),
          hint: TAG_HINTS[r.word] || "", cat: CAT[r.word] || "",
        })),
        pool,
        near: TAG_NEAR,
        maxPerDevice: MAX_TAGS_PER_DEVICE,
      });
    } catch (e) {
      return json(500, { ok: false, error: "标签读取失败。" });
    }
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }

    // —— 编委动作（需钥匙）——
    if (body.action) {
      const admin = context.env.ZHUI_ADMIN_KEY;
      if (!admin || clean(body.key, 80) !== admin) return json(403, { ok: false, error: "无权操作。" });
      try {
        if (body.action === "seed") {
          let n = 0;
          for (const o of TAG_OUTLINE) {
            // 注意: 必须把 kind 一起取回来, 否则 found.kind 恒为 undefined, 下面的「候选转正」永远不生效
            const found = await db.prepare(`SELECT id, kind FROM tags WHERE word = ?1`).bind(o.w).first();
            if (!found) {
              await db.prepare(`INSERT INTO tags(word, kind) VALUES (?1, '预设')`).bind(o.w).run();
              n++;
            } else if (found.kind === "候选") {
              await db.prepare(`UPDATE tags SET kind = '预设' WHERE id = ?1`).bind(found.id).run();
              n++;
            }
          }
          return json(200, { ok: true, action: "seed", added: n, total: TAG_OUTLINE.length });
        }
        if (body.action === "adopt") {
          const w = clean(body.word, 12);
          const t = await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(w).first();
          if (!t) return json(404, { ok: false, error: "没有这个标签。" });
          await db.prepare(`UPDATE tags SET kind = '已采纳' WHERE id = ?1`).bind(t.id).run();
          return json(200, { ok: true, action: "adopt", word: w });
        }
        if (body.action === "merge") {
          const from = clean(body.from, 12), to = clean(body.to, 12);
          if (!from || !to || from === to) return json(400, { ok: false, error: "合并需要两个不同的词。" });
          const a = await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(from).first();
          if (!a) return json(404, { ok: false, error: "没有被合并的词。" });
          let b = await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(to).first();
          if (!b) {
            const ins = await db.prepare(`INSERT INTO tags(word, kind) VALUES (?1, ?2)`).bind(to, isOutline(to) ? "预设" : "候选").run();
            b = { id: ins.meta.last_row_id };
          }
          // 先删掉"同一作品里 to 已有票"的重复行, 再迁移, 避免 UNIQUE 冲突
          await db.prepare(
            `DELETE FROM tag_votes WHERE tag_id = ?1 AND EXISTS (
               SELECT 1 FROM tag_votes v2 WHERE v2.tag_id = ?2 AND v2.work_id = tag_votes.work_id AND v2.voter_key = tag_votes.voter_key)`
          ).bind(a.id, b.id).run();
          const moved = await db.prepare(`UPDATE tag_votes SET tag_id = ?1 WHERE tag_id = ?2`).bind(b.id, a.id).run();
          await db.prepare(`DELETE FROM tags WHERE id = ?1`).bind(a.id).run();
          return json(200, { ok: true, action: "merge", from, to, moved: moved.meta.changes || 0 });
        }
        if (body.action === "cleanup") {
          // 按 TAG_LEGACY 把库里历史写法并入大纲词(幂等: 词已不存在就跳过)
          const done = [];
          for (const from of Object.keys(TAG_LEGACY)) {
            const to = TAG_LEGACY[from];
            const a = await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(from).first();
            if (!a) continue;
            if (from === to) continue;                  // 自映射 = 无事可做; 若硬做, from/to 同一行会把该词连同票一起删掉
            if (!to) {                                  // 只下架: 删词(票随之删)
              await db.prepare(`DELETE FROM tag_votes WHERE tag_id = ?1`).bind(a.id).run();
              await db.prepare(`DELETE FROM tags WHERE id = ?1`).bind(a.id).run();
              done.push(from + " → （弃用）");
              continue;
            }
            let b = await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(to).first();
            if (!b) {
              const ins = await db.prepare(`INSERT INTO tags(word, kind) VALUES (?1, '预设')`).bind(to).run();
              b = { id: ins.meta.last_row_id };
            }
            await db.prepare(
              `DELETE FROM tag_votes WHERE tag_id = ?1 AND EXISTS (
                 SELECT 1 FROM tag_votes v2 WHERE v2.tag_id = ?2 AND v2.work_id = tag_votes.work_id AND v2.voter_key = tag_votes.voter_key)`
            ).bind(a.id, b.id).run();
            await db.prepare(`UPDATE tag_votes SET tag_id = ?1 WHERE tag_id = ?2`).bind(b.id, a.id).run();
            await db.prepare(`DELETE FROM tags WHERE id = ?1`).bind(a.id).run();
            done.push(from + " → " + to);
          }
          return json(200, { ok: true, action: "cleanup", merged: done });
        }
        if (body.action === "delete") {
          const w = clean(body.word, 12);
          const t = await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(w).first();
          if (!t) return json(404, { ok: false, error: "没有这个标签。" });
          await db.prepare(`DELETE FROM tag_votes WHERE tag_id = ?1`).bind(t.id).run();
          await db.prepare(`DELETE FROM tags WHERE id = ?1`).bind(t.id).run();
          return json(200, { ok: true, action: "delete", word: w });
        }
        return json(400, { ok: false, error: "未知动作。" });
      } catch (e) {
        return json(500, { ok: false, error: "编委操作失败。" });
      }
    }

    // —— 普通点赞/取消 ——
    const work = clean(body.work, 60);
    const word = clean(body.word, 12);
    if (!work || !word) return json(400, { ok: false, error: "缺少作品标识或标签词。" });
    try {
      const found = (await db.prepare(`SELECT id FROM tags WHERE word = ?1`).bind(word).first());
      let tagId = found ? found.id : null;
      let candidate = false;
      if (!tagId) {
        const kind = isOutline(word) ? "预设" : "候选";   // 大纲内的词直接是预设
        const r = await db.prepare(`INSERT INTO tags(word, kind) VALUES (?1, ?2)`).bind(word, kind).run();
        tagId = r.meta.last_row_id;
        candidate = kind === "候选";
      }
      const dev = voteKey(body.device, req);   // 与写入时同一个身份, 否则取消找不到自己那行
      const exist = (await db.prepare(`SELECT id FROM tag_votes WHERE work_id = ?1 AND tag_id = ?2 AND voter_key = ?3`)
        .bind(work, tagId, dev).first());
      if (exist) {
        await db.prepare(`DELETE FROM tag_votes WHERE id = ?1`).bind(exist.id).run();
      } else {
        // 每设备每篇最多 3 个标签(取消不算); 顺带把历史上按 IP 存的票也算进来
        const mine = await q(
          db,
          `SELECT COUNT(DISTINCT tag_id) AS n FROM tag_votes WHERE work_id = ?1 AND (voter_key = ?2 OR voter_key = ?3)`,
          work, dev, ipOf(req)
        );
        const used = (mine[0] && mine[0].n) || 0;
        if (used >= MAX_TAGS_PER_DEVICE) {
          return json(429, { ok: false, error: `每篇最多赞同 ${MAX_TAGS_PER_DEVICE} 个标签，先取消一个再加吧。`, limit: MAX_TAGS_PER_DEVICE, used });
        }
        await db.prepare(`INSERT INTO tag_votes(work_id, tag_id, voter_key) VALUES (?1, ?2, ?3)`)
          .bind(work, tagId, dev).run();
      }
      const c = (await q(db, `SELECT COUNT(*) AS n FROM tag_votes WHERE work_id = ?1 AND tag_id = ?2`, work, tagId))[0];
      return json(200, {
        ok: true, word, id: tagId, candidate, voted: !exist, count: c ? c.n : 0,
        hint: TAG_HINTS[word] || "", cat: CAT[word] || "",
      });
    } catch (e) {
      return json(500, { ok: false, error: "标签操作失败。" });
    }
  }
  return json(405, { ok: false, error: "只接受 GET/POST" });
}
