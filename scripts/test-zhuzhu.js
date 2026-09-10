// 众注函数本地测试: scripts/test-zhuzhu.js
// 用"录制型"假 D1 覆盖 tags/comments 两函数的校验分支与调用形状
// (真实 D1 语义待 Functions+D1 绑定后线上 curl 验收)
const assert = require("assert");
const path = require("path");

function FakeDB(opts = {}) {
  const db = { calls: [], existsOverride: !!opts.existsOverride, rows: opts.rows || null, tagCountN: opts.tagCountN || 0 };
  db.prepare = (sql) => ({
    bind(...args) {
      db.calls.push({ sql, args });
      return this;
    },
    async first() {
      const last = db.calls[db.calls.length - 1].sql;
      if (/WHERE word =/.test(last)) return db.existsOverride ? { id: 7 } : null;
      if (/WHERE work_id = .*AND tag_id/.test(last)) return db.existsOverride ? { id: 99 } : null;
      if (/WHERE comment_id = .*AND liker_key/.test(last)) return db.existsOverride ? { id: 88 } : null;
      if (/AS n FROM comment_likes/.test(last)) return { n: 3 };
      if (/COUNT\(DISTINCT tag_id\)/.test(last)) return { n: db.tagCountN || 0 };
      return null;
    },
    async all() {
      const last = db.calls[db.calls.length - 1].sql;
      if (db.rows && /FROM comments c/.test(last)) return { results: db.rows };
      if (/COUNT\(DISTINCT tag_id\)/.test(last)) return { results: [{ n: db.tagCountN || 0 }] };
      return { results: /COUNT/.test(last) ? [{ n: 1 }] : [] };
    },
    async run() {
      return { meta: { last_row_id: 41 } };
    },
  });
  return db;
}

const HDR = { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" };
const get = (u) => new Request("https://x.test" + u, { headers: { "cf-connecting-ip": "1.2.3.4" } });
const post = (u, body) => new Request("https://x.test" + u, { method: "POST", headers: HDR, body: JSON.stringify(body) });

const ctx = (request, env = {}, dbOpts = {}) => ({ request, env: { DB: FakeDB(dbOpts), ...env } });

async function main() {
  const { pathToFileURL } = require("url");
  const importMod = (rel) => import(pathToFileURL(path.join(__dirname, "..", rel)).href);
  const tags = await importMod("functions/api/tags.js");
  const comments = await importMod("functions/api/comments.js");
  // tags GET 缺 work -> 400
  let r = await tags.onRequest(ctx(get("/api/tags")));
  assert.strictEqual(r.status, 400, "tags GET 缺 work 应 400");

  // tags GET 正常(空数据形状)
  r = await tags.onRequest(ctx(get("/api/tags?work=w-feng")));
  assert.strictEqual(r.status, 200, "tags GET 应 200");
  const tg = await r.json();
  assert(tg.ok && Array.isArray(tg.tags) && Array.isArray(tg.pool), "tags GET 形状");

  // tags POST 新词 -> 建候选 + 点赞
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "疏影" })));
  const tp = await r.json();
  assert(tp.ok && tp.candidate && tp.voted === true, "新词应建候选并点赞");

  // tags POST 已有词(已赞过) -> 取消
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "思念" }), {}, { existsOverride: true }));
  const tp2 = await r.json();
  assert(tp2.ok && tp2.voted === false, "已赞应取消");

  // comments GET 缺 work -> 400
  r = await comments.onRequest(ctx(get("/api/comments")));
  assert.strictEqual(r.status, 400, "comments GET 缺 work 应 400");

  // comments POST 校验: 缺昵称 / 缺正文 / 超长正文截断不报错
  for (const bad of [{ work: "w-feng", name: "", body: "x" }, { work: "w-feng", name: "甲", body: "" }, {}]) {
    r = await comments.onRequest(ctx(post("/api/comments", bad)));
    assert.strictEqual(r.status, 400, "评论缺项应 400");
  }

  // comments POST 合法(含回帖)
  r = await comments.onRequest(ctx(post("/api/comments", { work: "w-feng", name: "泊珩", body: "> 引原句\n好句。", reply_to: 1 })));
  const cp = await r.json();
  assert(cp.ok && cp.id === 41 && cp.reply_to === 1, "新楼/回帖应入库返回 id");

  // 同感 toggle(未赞过 -> 赞)
  r = await comments.onRequest(ctx(post("/api/comments", { like_comment_id: 1 })));
  const cl = await r.json();
  assert(cl.ok && cl.liked === true && cl.likes === 3, "同感点赞");

  // 编委删除: 错 key -> 403; 对 key -> 200
  r = await comments.onRequest(ctx(post("/api/comments", { delete_id: 1, key: "bad" }), { ZHUI_ADMIN_KEY: "sekrit" }));
  assert.strictEqual(r.status, 403, "错删除 key 应 403");
  r = await comments.onRequest(ctx(post("/api/comments", { delete_id: 1, key: "sekrit" }), { ZHUI_ADMIN_KEY: "sekrit" }));
  const cd = await r.json();
  assert(cd.ok && cd.deleted === 1, "编委删除成功");

  // comments GET: 已删楼也返回(带 deleted 标记, 内容不回传), 供前端显示「该楼已删」占位
  r = await comments.onRequest(ctx(get("/api/comments?work=w-feng"), {}, {
    rows: [
      { id: 1, name: "泊珩", body: "好句。", reply_to: null, created_at: "2026-09-09 17:13:00", likes: 2, liked: 0, deleted_at: null },
      { id: 2, name: "蓦流", body: "被删的楼", reply_to: null, created_at: "2026-09-10 10:05:00", likes: 0, liked: 0, deleted_at: "2026-09-10 11:00:00" },
      { id: 3, name: "新酒", body: "回第二楼", reply_to: 2, created_at: "2026-09-10 10:09:00", likes: 0, liked: 0, deleted_at: null },
    ],
  }));
  const gf = await r.json();
  assert.strictEqual(gf.floors.length, 3, "已删楼仍返回(供占位)");
  assert.strictEqual(gf.floors[1].deleted, true, "已删楼带 deleted 标记");
  assert.strictEqual(gf.floors[1].body, "", "已删楼内容不回传");
  assert.strictEqual(gf.floors[0].deleted, false, "正常楼不带标记");
  // 时区: 库里存 UTC, 返回北京时间(UTC+8)
  assert.strictEqual(gf.floors[0].created_at, "2026-09-10T01:13:00+08:00", "UTC 17:13 -> 北京 次日 01:13");

  // 大纲内词 -> 预设(非候选)
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "离愁", device: "dev-1" }), {}, {}));
  const tPre = await r.json();
  assert(tPre.ok && tPre.candidate === false && tPre.hint, "大纲词应直接预设并带释义");

  // 表外词 -> 候选
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "幽篁" })));
  assert((await r.json()).candidate === true, "表外词应建候选");

  // 联想池含全部大纲词(即使库里还没有)
  r = await tags.onRequest(ctx(get("/api/tags?work=w-feng")));
  const tg2 = await r.json();
  assert(tg2.pool.length >= 94 && typeof tg2.pool[0] === "object" && tg2.pool[0].hint, "联想池=大纲词并带释义");
  assert(Array.isArray(tg2.near) && tg2.near.length >= 5 && tg2.maxPerDevice === 3, "返回近义组与每设备上限");

  // 每设备每篇最多 3 个标签
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "明月", device: "dev-x" }), {}, { tagCountN: 3 }));
  assert.strictEqual(r.status, 429, "已达上限再加应 429");
  assert(/最多赞同 3 个标签/.test((await r.json()).error), "限流文案含上限值");

  // 编委动作: 无钥匙 403 / 有钥匙 seed 与 adopt
  r = await tags.onRequest(ctx(post("/api/tags", { key: "wrong", action: "seed" })));
  assert.strictEqual(r.status, 403, "错钥匙应 403");
  r = await tags.onRequest(ctx(post("/api/tags", { key: "k", action: "seed" }), { ZHUI_ADMIN_KEY: "k" }));
  const seedJ = await r.json();
  assert(seedJ.ok && seedJ.total === 94 && seedJ.added === 94, "seed 应落库全部大纲词");
  r = await tags.onRequest(ctx(post("/api/tags", { key: "k", action: "adopt", word: "离愁" }), { ZHUI_ADMIN_KEY: "k" }, { existsOverride: true }));
  assert((await r.json()).action === "adopt", "adopt 应成功");

  // 方法限制
  r = await tags.onRequest(ctx(new Request("https://x.test/api/tags", { method: "DELETE" })));
  assert.strictEqual(r.status, 405, "DELETE 应 405");

  console.log("✅ test-zhuzhu.js 全部通过 (tags 读取/点赞/候选/取消, comments 发表/回帖/同感/编委删除/已删占位/校验)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
