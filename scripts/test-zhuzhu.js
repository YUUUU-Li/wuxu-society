// 众注函数本地测试: scripts/test-zhuzhu.js
// 用"录制型"假 D1 覆盖 tags/comments 两函数的校验分支与调用形状
// (真实 D1 语义待 Functions+D1 绑定后线上 curl 验收)
// 账号改造后: 打标签/评论/同感都要求登录 —— 测试用 env.ZHUI_TEST_USER 注入登录者。
const assert = require("assert");
const path = require("path");

function FakeDB(opts = {}) {
  const db = {
    calls: [], existsOverride: !!opts.existsOverride, rows: opts.rows || null,
    tagCountN: opts.tagCountN || 0, tagKind: opts.tagKind || "预设",
    commentUserId: opts.commentUserId === undefined ? 7 : opts.commentUserId,
    votersRows: opts.votersRows || [], aggregateRows: opts.aggregateRows || [],
  };
  db.prepare = (sql) => {
    const self = {
      bind(...args) { db.calls.push({ sql, args }); return self; },
      async first() {
        db.calls.push({ sql, args: [] });
        const last = sql;
        if (/SELECT id, user_id, ip FROM comments/.test(last)) return { id: 1, user_id: db.commentUserId, ip: "1.2.3.4" };
        if (/WHERE word =/.test(last)) return db.existsOverride ? { id: 7, kind: db.tagKind } : null;
        if (/WHERE work_id = .*AND tag_id/.test(last)) return db.existsOverride ? { id: 99 } : null;
        if (/WHERE comment_id = .*AND liker_key/.test(last)) return db.existsOverride ? { id: 88 } : null;
        if (/AS n FROM comment_likes/.test(last)) return { n: 3 };
        if (/COUNT\(DISTINCT tag_id\)/.test(last)) return { n: db.tagCountN || 0 };
        return null;
      },
      async all() {
        db.calls.push({ sql, args: [] });
        const last = sql;
        if (db.rows && /FROM comments c/.test(last)) return { results: db.rows };
        if (/u\.nick AS nick/.test(last)) return { results: db.votersRows };
        if (/SUM\(CASE WHEN/.test(last)) return { results: db.aggregateRows };
        if (/COUNT\(DISTINCT tag_id\)/.test(last)) return { results: [{ n: db.tagCountN || 0 }] };
        return { results: /COUNT/.test(last) ? [{ n: 1 }] : [] };
      },
      async run() { db.calls.push({ sql, args: [] }); return { meta: { last_row_id: 41, changes: 1 } }; },
    };
    return self;
  };
  return db;
}

const HDR = { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" };
const get = (u) => new Request("https://x.test" + u, { headers: { "cf-connecting-ip": "1.2.3.4" } });
const post = (u, body) => new Request("https://x.test" + u, { method: "POST", headers: HDR, body: JSON.stringify(body) });

const READER = { id: 7, handle: "reader", nick: "泊舟", role: "读者", member_state: "" };
const ADMIN = { id: 8, handle: "jwl", nick: "蓦流", role: "编委", member_state: "已确认" };

// user=null 表示"未登录"; 默认注入读者身份
const ctx = (request, env = {}, dbOpts = {}, user = READER) => ({
  request,
  env: Object.assign({ DB: FakeDB(dbOpts) }, user ? { ZHUI_TEST_USER: JSON.stringify(user) } : {}, env),
});
const newCtx = (request, dbOpts = {}, user = READER, env = {}) => ({
  request,
  env: Object.assign({ DB: (dbOpts instanceof Object && dbOpts.prepare) ? dbOpts : FakeDB(dbOpts) },
    user ? { ZHUI_TEST_USER: JSON.stringify(user) } : {}, env),
});

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
  assert.strictEqual(tg.showVoters, "admin", "默认投票人名单只给编委");

  // ── 未登录: 不能打标签 ──
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "疏影" }), {}, {}, null));
  assert.strictEqual(r.status, 401, "未登录打标签应 401");
  assert((await r.json()).needLogin === true, "应提示需要登录");

  // tags POST 新词 -> 建候选 + 点赞
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "疏影" })));
  const tp = await r.json();
  assert(tp.ok && tp.candidate && tp.voted === true, "新词应建候选并点赞");

  // 取消: 身份是账号(与查票同源)
  const dbDev = FakeDB({ existsOverride: true });
  r = await tags.onRequest(newCtx(post("/api/tags", { work: "w-feng", word: "离愁" }), dbDev));
  assert((await r.json()).voted === false, "已赞过则应取消");
  const selDev = dbDev.calls.find((c) => /SELECT id FROM tag_votes/.test(c.sql));
  assert(selDev && selDev.args[2] === "u:7", "查票身份应为 u:<账号id>, 实得 " + (selDev && selDev.args[2]));
  assert(dbDev.calls.some((c) => /DELETE FROM tag_votes WHERE id/.test(c.sql)), "取消应删掉自己那一行");
  assert(!dbDev.calls.some((c) => /voter_key = 'd:|body\.device/.test(c.sql)), "不应再有设备号逻辑");

  // 新赞同: 写入也用账号身份
  const dbNew = FakeDB({});
  r = await tags.onRequest(newCtx(post("/api/tags", { work: "w-feng", word: "明月" }), dbNew));
  const insCall = dbNew.calls.find((c) => /INSERT INTO tag_votes/.test(c.sql));
  assert(insCall && insCall.args[2] === "u:7", "写入应用账号身份, 实得 " + (insCall && insCall.args[2]));

  // GET 的 voted 也按账号查
  const dbGet = FakeDB();
  r = await tags.onRequest(newCtx(get("/api/tags?work=w-feng"), dbGet));
  const getSel = dbGet.calls.find((c) => /SELECT tag_id FROM tag_votes/.test(c.sql));
  assert(getSel && getSel.args[1] === "u:7", "GET 应按账号查 voted, 实得 " + (getSel && getSel.args[1]));
  r = await tags.onRequest(newCtx(get("/api/tags?work=w-feng"), FakeDB(), null));
  assert(!(await r.json()).voters.length, "未登录不该拿到投票人名单");

  // 编委可见名单: 编委查得到, 普通读者查不到
  const voters = [{ id: 3, nick: "蓦流" }, { id: 3, nick: "泊珩" }, { id: 5, nick: "新酒" }];
  r = await tags.onRequest(newCtx(get("/api/tags?work=w-feng"), FakeDB({ votersRows: voters }), ADMIN));
  const vj = (await r.json()).voters;
  assert.strictEqual(vj.length, 2, "应按标签聚合投票人: " + JSON.stringify(vj));
  assert.deepStrictEqual(vj.find((x) => x.id === 3).nicks, ["蓦流", "泊珩"], "同一标签的名单按序聚合");
  r = await tags.onRequest(newCtx(get("/api/tags?work=w-feng"), FakeDB({ votersRows: voters }), READER));
  assert.strictEqual((await r.json()).voters.length, 0, "普通读者看不到名单");

  // 三档策略都要能跑(默认 admin 已覆盖上; 这里直接测函数本身, 免得 aggregate/public 成为死代码)
  const aggRows = [{ id: 3, n: 4, members: 2 }];
  let v = await tags.votersOf(FakeDB({ aggregateRows: aggRows }), "w-feng", READER, "aggregate");
  assert.deepStrictEqual(v, [{ id: 3, n: 4, members: 2 }], "aggregate: 只给聚合人数");
  v = await tags.votersOf(FakeDB({ votersRows: voters }), "w-feng", null, "public");
  assert.strictEqual(v.length, 2, "public: 未登录也能看到完整名单");
  v = await tags.votersOf(FakeDB({ votersRows: voters }), "w-feng", READER, "admin");
  assert.strictEqual(v.length, 0, "admin: 读者拿不到");

  // 每账号每篇最多 3 个标签
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "明月" }), {}, { tagCountN: 3 }));
  assert.strictEqual(r.status, 429, "已达上限再加应 429");
  assert(/最多赞同 3 个标签/.test((await r.json()).error), "限流文案含上限值");
  const dbLim = FakeDB({ tagCountN: 0 });
  r = await tags.onRequest(newCtx(post("/api/tags", { work: "w-feng", word: "明月" }), dbLim));
  assert.strictEqual(r.status, 200, "账号名下 0 票时应可以赞同");
  const limCall = dbLim.calls.find((c) => /COUNT\(DISTINCT tag_id\)/.test(c.sql));
  assert.strictEqual(limCall.args.length, 2, "上限计数只应绑定 (work, 账号身份)");
  assert.strictEqual(limCall.args[1], "u:7", "上限计数按账号");

  // 编委动作: 无权限 403 / 编委角色 seed 与 adopt / 旧钥匙也能用 / 自映射不误删
  r = await tags.onRequest(newCtx(post("/api/tags", { action: "seed" }), FakeDB(), READER));
  assert.strictEqual(r.status, 403, "普通读者不能做编委动作");
  r = await tags.onRequest(ctx(post("/api/tags", { key: "wrong", action: "seed" }), { ZHUI_ADMIN_KEY: "k" }));
  assert.strictEqual(r.status, 403, "错钥匙应 403");
  r = await tags.onRequest(ctx(post("/api/tags", { key: "k", action: "seed" }), { ZHUI_ADMIN_KEY: "k" }));
  const seedJ = await r.json();
  assert(seedJ.ok && seedJ.total === 94 && seedJ.added === 94, "seed 应落库全部大纲词");
  r = await tags.onRequest(newCtx(post("/api/tags", { action: "seed" }), FakeDB({ existsOverride: true, tagKind: "候选" }), ADMIN));
  const dbSeed = (r && null) || null;   // (形状断言见下)
  assert((await r.json()).ok, "编委角色应能做 seed");
  r = await tags.onRequest(ctx(post("/api/tags", { key: "k", action: "adopt", word: "离愁" }), { ZHUI_ADMIN_KEY: "k" }, { existsOverride: true }));
  assert((await r.json()).action === "adopt", "adopt 应成功");

  // 编委 cleanup: 按归并表整理历史标签; 自映射必须跳过
  r = await tags.onRequest(ctx(post("/api/tags", { key: "k", action: "cleanup" }), { ZHUI_ADMIN_KEY: "k" }, { existsOverride: true }));
  const cln = await r.json();
  assert(cln.ok && Array.isArray(cln.merged), "cleanup 应返回合并清单");
  assert(!cln.merged.some((m) => { const [a, b] = m.split(" → "); return a === b; }), "cleanup 不得把词并到自己身上");

  // ── 评论 ──
  r = await comments.onRequest(ctx(get("/api/comments")));
  assert.strictEqual(r.status, 400, "comments GET 缺 work 应 400");

  // 未登录: 不能发评论 / 不能同感
  r = await comments.onRequest(ctx(post("/api/comments", { work: "w-feng", body: "好句。" }), {}, {}, null));
  assert.strictEqual(r.status, 401, "未登录发评论应 401");
  r = await comments.onRequest(ctx(post("/api/comments", { like_comment_id: 1 }), {}, {}, null));
  assert.strictEqual(r.status, 401, "未登录同感应 401");

  // 登录后: 缺正文 400; 合法 -> 署名取账号笔名 + 落 user_id
  r = await comments.onRequest(ctx(post("/api/comments", { work: "w-feng", body: "" })));
  assert.strictEqual(r.status, 400, "空正文应 400");
  const dbCm = FakeDB();
  r = await comments.onRequest(newCtx(post("/api/comments", { work: "w-feng", name: "冒名者", body: "> 引原句\n好句。", reply_to: 1 }), dbCm));
  const cp = await r.json();
  assert(cp.ok && cp.id === 41 && cp.reply_to === 1, "新楼/回帖应入库返回 id");
  assert.strictEqual(cp.name, "泊舟", "署名应取账号笔名, 无视客户端传的名字");
  const cmIns = dbCm.calls.find((c) => /INSERT INTO comments/.test(c.sql));
  assert(cmIns.args[1] === "泊舟" && cmIns.args[2] === 7, "应写入账号笔名与 user_id: " + JSON.stringify(cmIns.args));

  // 不能赞同自己的评论
  r = await comments.onRequest(newCtx(post("/api/comments", { like_comment_id: 1 }), FakeDB({ commentUserId: 7 })));
  assert.strictEqual(r.status, 400, "不能赞自己的评论");
  assert(/自己的评论/.test((await r.json()).error), "应给出友好提示");
  r = await comments.onRequest(newCtx(post("/api/comments", { like_comment_id: 1 }), FakeDB({ commentUserId: 999 })));
  const cl = await r.json();
  assert(cl.ok && cl.liked === true && cl.likes === 3, "别人的评论可以同感");

  // 编委删除: 普通读者 403; 编委角色 200
  r = await comments.onRequest(newCtx(post("/api/comments", { delete_id: 1 }), FakeDB(), READER));
  assert.strictEqual(r.status, 403, "普通读者不能删评论");
  r = await comments.onRequest(newCtx(post("/api/comments", { delete_id: 1 }), FakeDB(), ADMIN));
  assert((await r.json()).deleted === 1, "编委角色可删评论");
  r = await comments.onRequest(ctx(post("/api/comments", { delete_id: 1, key: "k" }), { ZHUI_ADMIN_KEY: "k" }));
  assert((await r.json()).deleted === 1, "旧钥匙仍可用(过渡期)");

  // comments GET: 已删楼占位 + own 标记 + 北京时间
  r = await comments.onRequest(newCtx(get("/api/comments?work=w-feng"), {
    rows: [
      { id: 1, name: "泊舟", user_id: 7, body: "好句。", reply_to: null, created_at: "2026-09-09 17:13:00", likes: 2, liked: 0, deleted_at: null },
      { id: 2, name: "蓦流", user_id: 8, body: "被删的楼", reply_to: null, created_at: "2026-09-10 10:05:00", likes: 0, liked: 0, deleted_at: "2026-09-10 11:00:00" },
      { id: 3, name: "新酒", user_id: null, body: "回第二楼", reply_to: 2, created_at: "2026-09-10 10:09:00", likes: 0, liked: 0, deleted_at: null },
    ],
  }));
  const gf = await r.json();
  assert.strictEqual(gf.floors.length, 3, "已删楼仍返回(供占位)");
  assert.strictEqual(gf.floors[1].deleted, true, "已删楼带 deleted 标记");
  assert.strictEqual(gf.floors[1].body, "", "已删楼内容不回传");
  assert.strictEqual(gf.floors[0].own, true, "自己的楼应带 own 标记(前端据此隐藏同感)");
  assert.strictEqual(gf.floors[1].own, false, "别人的楼不是 own");
  assert.strictEqual(gf.floors[0].created_at, "2026-09-10T01:13:00+08:00", "UTC 17:13 -> 北京次日 01:13");

  // 大纲词/表外词/联想池/近义/上限
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "离愁" })));
  const tPre = await r.json();
  assert(tPre.ok && tPre.candidate === false && tPre.hint, "大纲词应直接预设并带释义");
  r = await tags.onRequest(ctx(post("/api/tags", { work: "w-feng", word: "幽篁" })));
  assert((await r.json()).candidate === true, "表外词应建候选");
  r = await tags.onRequest(ctx(get("/api/tags?work=w-feng")));
  const tg2 = await r.json();
  assert(tg2.pool.length >= 94 && typeof tg2.pool[0] === "object" && tg2.pool[0].hint, "联想池=大纲词并带释义");
  assert(Array.isArray(tg2.near) && tg2.near.length >= 5 && tg2.maxPerDevice === 3, "返回近义组与每篇上限");

  // 方法限制
  r = await tags.onRequest(ctx(new Request("https://x.test/api/tags", { method: "DELETE" })));
  assert.strictEqual(r.status, 405, "DELETE 应 405");

  console.log("✅ test-zhuzhu.js 全部通过 (标签需登录/账号口径/名单仅编委/上限3, 评论需登录/署名取账号/禁止自赞/编委删除/已删占位/时区)");
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
