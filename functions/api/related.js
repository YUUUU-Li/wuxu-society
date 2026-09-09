// 众注·相似标签(余弦归一) API —— Cloudflare Pages Functions + D1, ESM 自包含
// GET /api/related?work=<slug> -> { ok, related:[{slug,title,shared:[...],sim}] }
// 算法(方案定稿, 2026-09):
//   每篇作品 = 标签票数向量(维度=标签词)。冷启动回退: 无票的词若在作品 imageries 里按 1 票计,
//   已有点票的词用真实票数, 两者合并(意象词与票词维度共存)。
//   候选须与本作共享 >=2 个词(下限2), 余弦相似度 = dot/(|A||B|) 降序, 平票随机由前端处理。
// 作品元数据(title/imageries)读取构建产物 rel-meta.json(每页部署自带);
// 测试/自检时用 env.REL_META_JSON 传入, 避免依赖同源资源。
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });

async function loadMeta(context) {
  if (context.env.REL_META_JSON) return JSON.parse(context.env.REL_META_JSON);
  const origin = new URL(context.request.url).origin;
  const res = await fetch(origin + "/rel-meta.json", { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error("rel-meta.json 读取失败");
  return res.json();
}

export async function onRequest(context) {
  const db = context.env.DB;
  if (!db) return json(503, { ok: false, error: "数据库尚未配置。" });
  const work = String(new URL(context.request.url).searchParams.get("work") || "").trim().slice(0, 60);
  if (!work) return json(400, { ok: false, error: "缺少作品标识。" });

  let meta;
  try {
    meta = await loadMeta(context);
  } catch (e) {
    return json(503, { ok: false, error: "作品元数据未就绪。" });
  }

  try {
    // 全站标签票数: {workSlug: {word: count}}
    const voteRows = (await db.prepare(
      `SELECT tv.work_id AS w, t.word AS word, COUNT(*) AS c
       FROM tag_votes tv JOIN tags t ON t.id = tv.tag_id
       GROUP BY tv.work_id, t.word`
    ).all()).results || [];
    const votes = {};
    for (const r of voteRows) {
      (votes[r.w] = votes[r.w] || {})[r.word] = r.c;
    }

    // 每篇作品向量: 票数优先, imageries 词无票按 1 计
    const vec = (slug) => {
      const v = {};
      for (const word of (meta[slug] && meta[slug].imageries) || []) v[word] = Math.max(v[word] || 0, 1);
      for (const word of Object.keys(votes[slug] || {})) v[word] = Math.max(v[word] || 0, votes[slug][word]);
      return v;
    };
    const norm = (v) => Math.sqrt(Object.values(v).reduce((s, x) => s + x * x, 0));

    const selfV = vec(work);
    const selfMeta = meta[work];
    if (!selfMeta || !Object.keys(selfV).length) return json(200, { ok: true, related: [] });
    const selfN = norm(selfV);
    if (!selfN) return json(200, { ok: true, related: [] });

    const result = [];
    for (const slug of Object.keys(meta)) {
      if (slug === work) continue;
      const otherV = vec(slug);
      if (!Object.keys(otherV).length) continue;
      const shared = Object.keys(selfV).filter((w) => otherV[w] > 0);
      if (shared.length < 2) continue; // 共享下限 2
      const dot = shared.reduce((s, w) => s + selfV[w] * otherV[w], 0);
      const sim = dot / (selfN * norm(otherV));
      if (!(sim > 0)) continue;
      shared.sort((a, b) => (selfV[b] * otherV[b]) - (selfV[a] * otherV[a]));
      result.push({
        slug,
        title: meta[slug].title || slug,
        shared: shared.slice(0, 3),
        sim: Math.round(sim * 1000) / 1000,
      });
    }
    result.sort((a, b) => b.sim - a.sim || a.slug.localeCompare(b.slug));
    return json(200, { ok: true, related: result.slice(0, 12) });
  } catch (e) {
    return json(500, { ok: false, error: "相似标签计算失败。" });
  }
}
