// 端到端集成测试: node scripts/test-e2e-accounts.js
// 用 node:sqlite(Node 22.5+) 建"真表"(sql/zhuzhu.sql + sql/accounts/01…04), 再让真实的
// auth/tags/comments 三个 handler 串起来跑一遍 —— 覆盖单测覆盖不到的地方:
//   真 SQL 语义(唯一索引/HAVING/子查询/JOIN)、真 cookie→会话→身份 的跨文件链路。
// 老版本 Node 没有 node:sqlite, 自动跳过(与 test-tags-sql.js 同一策略)。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");

let DatabaseSync = null;
try { ({ DatabaseSync } = require("node:sqlite")); } catch { /* 老 Node */ }
if (!DatabaseSync) {
  console.log("⏭  test-e2e-accounts.js 跳过(当前 Node 无 node:sqlite)");
  process.exit(0);
}

// —— 把 node:sqlite 包成 D1 的形状(prepare/bind/first/all/run) ——
function makeDB(opts = {}) {
  const db = new DatabaseSync(":memory:");
  const scripts = [path.join(ROOT, "sql", "zhuzhu.sql")];
  if (opts.accounts !== false) {
    scripts.push(...["01-建表-users.sql", "02-建表-sessions.sql", "03-评论表加账号列.sql", "04-索引.sql"]
      .map((f) => path.join(ROOT, "sql", "accounts", f)));
  }
  for (const p of scripts) {
    const body = fs.readFileSync(p, "utf8").split("\n")
      .map((l) => { const i = l.indexOf("--"); return i >= 0 ? l.slice(0, i) : l; }).join("\n");
    for (const stmt of body.split(";").map((s) => s.trim()).filter(Boolean)) db.exec(stmt + ";");
  }
  const mk = (sql, args) => ({
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() {
      const info = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
    },
  });
  return {
    _raw: db,
    prepare: (sql) => Object.assign(mk(sql, []), { bind: (...args) => mk(sql, args) }),
  };
}

// —— 极简 cookie 罐: 让请求之间能带上会话 ——
function client() {
  const jar = {};
  return {
    cookie: () => Object.keys(jar).map((k) => k + "=" + jar[k]).join("; "),
    save(res) {
      const sc = res.headers.get("set-cookie");
      if (!sc) return;
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = decodeURIComponent(pair.slice(i + 1).trim());
      if (/Max-Age=0/.test(sc)) delete jar[k]; else jar[k] = v;
    },
    req(url, body) {
      const headers = { "cf-connecting-ip": "203.0.113.9" };
      const ck = this.cookie();
      if (ck) headers.cookie = ck;
      if (body) headers["content-type"] = "application/json";
      return new Request("https://x.test" + url, {
        method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
      });
    },
  };
}
const call = async (mod, ctx) => { const r = await mod.onRequest(ctx); return { res: r, json: await r.json() }; };

async function main() {
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "api", "auth.js")).href);
  const tags = await import(pathToFileURL(path.join(ROOT, "functions", "api", "tags.js")).href);
  const comments = await import(pathToFileURL(path.join(ROOT, "functions", "api", "comments.js")).href);
  const db = makeDB();
  const SITE = { DB: db, ZHUI_ADMIN_KEY: "site-key" };   // 旧钥匙: 用于开第一个编委号
  const env = () => Object.assign({}, SITE);
  const ctxOf = (c, req) => ({ request: req, env: env() });

  // ── 0.0 自建表: 只跑过 zhuzhu.sql 的库(账号表还没有), 第一次用到账号应自动建好 ──
  // (这一条必须最先跑: ensureSchema 是模块级一次性开关)
  {
    const bare = makeDB({ accounts: false });
    const c0 = client();
    const out = await call(auth, { request: c0.req("/api/auth", { action: "register", handle: "auto1", nick: "自测一号", pass: "12345678" }), env: { DB: bare } });
    assert.strictEqual(out.res.status, 200, "账号表应被函数自动建好: " + JSON.stringify(out.json));
    c0.save(out.res);
    const tables = bare._raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    assert(tables.includes("users") && tables.includes("sessions"), "users/sessions 应已建: " + tables.join(","));
    const cols = bare._raw.prepare("PRAGMA table_info(comments)").all().map((r) => r.name);
    assert(cols.includes("user_id"), "comments 应已补上 user_id 列");
    assert.strictEqual((await call(auth, { request: c0.req("/api/auth"), env: { DB: bare } })).json.user.nick, "自测一号", "自建表后会话应可用");
  }

  // ── 0. 未登录: 能看, 不能动手 ──
  let c = client();
  let { res, json } = await call(tags, ctxOf(c, c.req("/api/tags?work=w-mei")));
  assert.strictEqual(res.status, 200, "未登录也能读标签");
  assert.strictEqual(json.voters.length, 0, "未登录/读者拿不到投票人名单");
  assert.strictEqual((await call(tags, ctxOf(c, c.req("/api/tags", { work: "w-mei", word: "春景" })))).res.status, 401, "未登录不能打标签");
  assert.strictEqual((await call(comments, ctxOf(c, c.req("/api/comments", { work: "w-mei", body: "好" })))).res.status, 401, "未登录不能评论");

  // ── 1. 社员注册(勾了我是社员) ──
  ({ res, json } = await call(auth, ctxOf(c, c.req("/api/auth", { action: "register", handle: "jwl", nick: "蓦流", pass: "hunter2hunter", member: true }))));
  assert.strictEqual(res.status, 409, "社员缩写应被保留(防抢注): " + JSON.stringify(json));
  assert(json.reserved === true, "应给出保留提示");

  ({ res, json } = await call(auth, ctxOf(c, c.req("/api/auth", { action: "register", handle: "reader1", nick: "泊舟", pass: "hunter2hunter", member: true }))));
  c.save(res);
  assert.strictEqual(res.status, 200, "普通昵称应可注册: " + JSON.stringify(json));
  assert.strictEqual(json.user.member_state, "待确认", "勾了社员 -> 待确认");
  const me1 = json.user;
  const rc1 = json.recoverCode;

  // ── 2. 同名(归一化)不能重复注册 ──
  const c2 = client();
  ({ res } = await call(auth, ctxOf(c2, c2.req("/api/auth", { action: "register", handle: "Reader1", nick: "别的人", pass: "12345678" }))));
  assert.strictEqual(res.status, 409, "登录名大小写不同视为占用(真唯一索引)");
  ({ res } = await call(auth, ctxOf(c2, c2.req("/api/auth", { action: "register", handle: "reader2", nick: "泊 舟", pass: "12345678" }))));
  assert.strictEqual(res.status, 409, "笔名空格差异视为占用");

  // ── 3. 打标签: 红/灰、取消、每篇 3 个上限(全按账号) ──
  ({ res, json } = await call(tags, ctxOf(c, c.req("/api/tags", { work: "w-mei", word: "春景" }))));
  assert(json.voted === true && json.count === 1, "第一次点应赞同");
  ({ res, json } = await call(tags, ctxOf(c, c.req("/api/tags?work=w-mei"))));
  let hit = json.tags.find((t) => t.word === "春景");
  assert(hit && hit.voted === true, "刷新后应仍是我的票(红) —— 这正是之前反复出问题的地方");
  // 换浏览器(新罐、同账号需重新登录) -> 仍然认得出来
  const c1b = client();
  ({ res, json } = await call(auth, ctxOf(c1b, c1b.req("/api/auth", { action: "login", handle: "reader1", pass: "hunter2hunter" }))));
  c1b.save(res);
  assert.strictEqual(res.status, 200, "同账号在另一个浏览器登录");
  ({ json } = await call(tags, ctxOf(c1b, c1b.req("/api/tags?work=w-mei"))));
  assert(json.tags.find((t) => t.word === "春景").voted === true, "换设备登录后仍认得自己那一票");
  // 凑满 3 个 -> 第 4 个应 429
  for (const w of ["秋景", "雨"]) await call(tags, ctxOf(c1b, c1b.req("/api/tags", { work: "w-mei", word: w })));
  ({ res, json } = await call(tags, ctxOf(c1b, c1b.req("/api/tags", { work: "w-mei", word: "风" }))));
  assert.strictEqual(res.status, 429, "每篇最多 3 个(按账号): " + JSON.stringify(json));
  // 取消一个 -> 立刻能再加
  ({ json } = await call(tags, ctxOf(c1b, c1b.req("/api/tags", { work: "w-mei", word: "雨" }))));
  assert(json.voted === false, "再点一下应取消");
  ({ res, json } = await call(tags, ctxOf(c1b, c1b.req("/api/tags", { work: "w-mei", word: "风" }))));
  assert.strictEqual(res.status, 200, "取消后额度立刻释放");
  ({ json } = await call(tags, ctxOf(c1b, c1b.req("/api/tags?work=w-mei"))));
  const mine = json.tags.filter((t) => t.voted).map((t) => t.word).sort();
  assert.deepStrictEqual(mine, ["春景", "秋景", "风"].sort(), "高亮的正好是我投的三个: " + mine.join("/"));

  // ── 4. 评论: 署名取账号笔名; 不能赞自己; 别人可以赞 ──
  ({ res, json } = await call(comments, ctxOf(c1b, c1b.req("/api/comments", { work: "w-mei", name: "冒名者", body: "> 引原句\n好句。" }))));
  assert.strictEqual(json.name, "泊舟", "署名应取账号笔名");
  const cid = json.id;
  ({ json } = await call(comments, ctxOf(c1b, c1b.req("/api/comments?work=w-mei"))));
  const myFloor = json.floors.find((f) => f.id === cid);
  assert(myFloor.own === true, "自己的楼带 own 标记");
  ({ res, json } = await call(comments, ctxOf(c1b, c1b.req("/api/comments", { like_comment_id: cid }))));
  assert.strictEqual(res.status, 400, "不能赞同自己的评论: " + JSON.stringify(json));
  assert(/自己的评论/.test(json.error), "提示文案应友好");
  // 另一个人来赞
  ({ res } = await call(auth, ctxOf(c2, c2.req("/api/auth", { action: "register", handle: "reader3", nick: "溪云", pass: "12345678" }))));
  c2.save(res);
  ({ res, json } = await call(comments, ctxOf(c2, c2.req("/api/comments", { like_comment_id: cid }))));
  assert(json.ok && json.liked === true && json.likes === 1, "别人可以同感");
  ({ json } = await call(comments, ctxOf(c1b, c1b.req("/api/comments?work=w-mei"))));
  assert(json.floors.find((f) => f.id === cid).liked === false, "自己的楼不应显示「已赞」");

  // ── 5. 编委: 旧钥匙开号 -> 编委账号登录 -> 管理动作 + 拿到投票人名单 ──
  ({ res, json } = await call(auth, ctxOf(c2, c2.req("/api/auth", { action: "open", handle: "jwl", nick: "蓦流", role: "编委", key: "site-key" }))));
  assert(json.ok && json.tempPass, "旧钥匙应能开编委号: " + JSON.stringify(json));
  const cAdmin = client();
  ({ res, json } = await call(auth, ctxOf(cAdmin, cAdmin.req("/api/auth", { action: "login", handle: "jwl", pass: json.tempPass }))));
  cAdmin.save(res);
  assert(json.user.role === "编委", "编委账号登录");
  // 待确认社员列表 + 确认
  ({ json } = await call(auth, ctxOf(cAdmin, cAdmin.req("/api/auth", { action: "pending" }))));
  assert(json.pending.some((u) => u.id === me1.id), "待确认列表应含刚注册的社员申请");
  ({ json } = await call(auth, ctxOf(cAdmin, cAdmin.req("/api/auth", { action: "confirm", user_id: me1.id }))));
  assert(json.role === "社员", "确认后转为社员");
  // 编委看得到投票人名单; 普通读者看不到
  ({ json } = await call(tags, ctxOf(cAdmin, cAdmin.req("/api/tags?work=w-mei"))));
  const vs = json.voters.find((v) => v.nicks && v.nicks.includes("泊舟"));
  assert(vs && vs.nicks.length >= 1, "编委能看到「谁赞同了这个标签」: " + JSON.stringify(json.voters));
  ({ json } = await call(tags, ctxOf(c2, c2.req("/api/tags?work=w-mei"))));
  assert.strictEqual(json.voters.length, 0, "普通读者看不到名单");
  // 编委删评论(软删) + 已删占位
  ({ res, json } = await call(comments, ctxOf(cAdmin, cAdmin.req("/api/comments", { delete_id: cid }))));
  assert(json.deleted === cid, "编委应能删评论");
  ({ json } = await call(comments, ctxOf(c1b, c1b.req("/api/comments?work=w-mei"))));
  assert(json.floors.find((f) => f.id === cid).deleted === true, "已删楼带标记, 内容不回传");

  // ── 6. 恢复码重设口令 -> 旧会话作废, 新口令可登录 ──
  const cReset = client();
  ({ res, json } = await call(auth, ctxOf(cReset, cReset.req("/api/auth", { action: "reset", handle: "reader1", code: rc1, pass: "brandnewpass1" }))));
  assert.strictEqual(res.status, 200, "用恢复码重设口令: " + JSON.stringify(json));
  cReset.save(res);
  const cOld = client();
  ({ res } = await call(auth, ctxOf(cOld, cOld.req("/api/auth", { action: "login", handle: "reader1", pass: "hunter2hunter" }))));
  assert.strictEqual(res.status, 401, "旧口令应失效");
  ({ res } = await call(auth, ctxOf(cOld, cOld.req("/api/auth", { action: "login", handle: "reader1", pass: "brandnewpass1" }))));
  assert.strictEqual(res.status, 200, "新口令可登录");

  // ── 6.5 会话边界: 过期 / 伪造 / 退出后 ──
  const cBad = client();
  // 伪造的 cookie: 库里没有这个 token -> 视为未登录
  ({ json } = await call(auth, { request: new Request("https://x.test/api/auth", { headers: { cookie: "zz_sess=" + "f".repeat(64) } }), env: env() }));
  assert.strictEqual(json.user, null, "伪造 cookie 应视为未登录");
  ({ res } = await call(tags, { request: (() => { const q = new Request("https://x.test/api/tags", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", cookie: "zz_sess=" + "f".repeat(64) }, body: JSON.stringify({ work: "w-mei", word: "春景" }) }); return q; })(), env: env() }));
  assert.strictEqual(res.status, 401, "伪造 cookie 不能打标签");
  // 真实会话, 但已过期 -> 同样视为未登录
  const { res: rLogin, json: jLogin } = await call(auth, ctxOf(c1b, c1b.req("/api/auth", { action: "login", handle: "reader1", pass: "brandnewpass1" })));
  assert.strictEqual(rLogin.status, 200, "重新登录以拿到会话");
  c1b.save(rLogin);
  const ckName = c1b.cookie();
  db._raw.exec("UPDATE sessions SET expires_at = datetime('now','-1 minute')");
  ({ json } = await call(auth, { request: new Request("https://x.test/api/auth", { headers: { cookie: ckName } }), env: env() }));
  assert.strictEqual(json.user, null, "过期会话应视为未登录");
  // 退出后旧 cookie 立即失效
  db._raw.exec("UPDATE sessions SET expires_at = datetime('now','+90 days')");
  ({ res } = await call(auth, ctxOf(c1b, c1b.req("/api/auth", { action: "logout" }))));
  ({ json } = await call(auth, { request: new Request("https://x.test/api/auth", { headers: { cookie: ckName } }), env: env() }));
  assert.strictEqual(json.user, null, "退出后旧 cookie 应失效");

  // ── 7. 相似标签(只用读者票, 共享 1 即上榜)仍能跑 ──
  // 让 reader3 也给《离秋》投一个「秋景」=> 与《梅》共享秋景, 应当上榜
  await call(tags, ctxOf(c2, c2.req("/api/tags", { work: "w-liqiu", word: "秋景" })));
  const related = await import(pathToFileURL(path.join(ROOT, "functions", "api", "related.js")).href);
  const meta = { "w-mei": { title: "梅", imageries: [] }, "w-liqiu": { title: "离秋", imageries: [] } };
  const rr = await related.onRequest({
    request: new Request("https://x.test/api/related?work=w-mei"),
    env: { DB: db, REL_META_JSON: JSON.stringify(meta) },
  });
  const rj = await rr.json();
  assert(rr.status === 200 && rj.ok, "related 应 200");
  assert(rj.related.some((x) => x.slug === "w-liqiu"), "共享「秋景」应让《离秋》上榜: " + JSON.stringify(rj.related));

  // ── 8. 一键洗牌(编委动作, 与 sql/curation/05~08 等价) ──
  // 先造点数据: 新注册一个人 -> 投一票 + 留一句评论
  const cW = client();
  ({ res } = await call(auth, ctxOf(cW, cW.req("/api/auth", { action: "register", handle: "wiper1", nick: "洗牌测试", pass: "12345678" }))));
  cW.save(res);
  await call(tags, ctxOf(cW, cW.req("/api/tags", { work: "w-mei", word: "春景" })));
  await call(tags, ctxOf(cW, cW.req("/api/tags", { work: "w-mei", word: "幽篁" })));   // 表外词 -> 候选, 洗牌时应被清掉
  await call(comments, ctxOf(cW, cW.req("/api/comments", { work: "w-mei", body: "洗牌前留一句。" })));
  const beforeWipe = db._raw.prepare("SELECT (SELECT COUNT(*) FROM tag_votes) a,(SELECT COUNT(*) FROM comments) b").get();
  assert(beforeWipe.a > 0 && beforeWipe.b > 0, "洗牌前应有点数据");
  // 确认字样不对 -> 400; 无权限 -> 403
  ({ res, json } = await call(auth, ctxOf(cAdmin, cAdmin.req("/api/auth", { action: "wipe" }))));
  assert.strictEqual(res.status, 400, "缺确认字样应 400: " + JSON.stringify(json));
  ({ res } = await call(auth, ctxOf(cW, cW.req("/api/auth", { action: "wipe", confirm: "清空标签票与评论" }))));
  assert.strictEqual(res.status, 403, "非编委不能洗牌");
  // 编委账号(已登录)直接洗, 连钥匙都不用
  ({ res, json } = await call(auth, ctxOf(cAdmin, cAdmin.req("/api/auth", { action: "wipe", confirm: "清空标签票与评论" }))));
  assert(json.ok && json.removed.votes >= 1 && json.removed.comments >= 1, "洗牌应报告删除条数: " + JSON.stringify(json));
  assert(json.removed.candidates >= 1, "自造候选词也应被清掉: " + JSON.stringify(json.removed));
  // 这个 e2e 库只有 zhuzhu.sql 的 15 条起步标签(线上另有 94 词 seed), 关键是"词表在、候选清"
  assert(json.tagsLeft >= 15 && json.tagsLeft < json.removed.votes + 15 + 1, "词表应保留(只去掉候选), 实得 " + json.tagsLeft);
  assert.strictEqual(db._raw.prepare("SELECT COUNT(*) AS n FROM tags WHERE kind='候选'").get().n, 0, "候选词应清空");
  assert(db._raw.prepare("SELECT COUNT(*) AS n FROM tags WHERE word='春景'").get().n === 1, "大纲预设词应保留");
  const afterWipe = db._raw.prepare("SELECT (SELECT COUNT(*) FROM tag_votes) a,(SELECT COUNT(*) FROM comments) b,(SELECT COUNT(*) FROM comment_likes) c").get();
  assert.deepStrictEqual([afterWipe.a, afterWipe.b, afterWipe.c], [0, 0, 0], "洗牌后应为空");

  // ── 9. 洗牌脚本(05~08)再跑一遍: 空库上应幂等/无报错, 词表保留 ──
  for (const f of ["05-清空-标签票.sql", "06-清空-评论同感.sql", "07-清空-评论.sql", "08-清空-候选词.sql"]) {
    const body = fs.readFileSync(path.join(ROOT, "sql", "curation", f), "utf8").split("\n")
      .map((l) => { const i = l.indexOf("--"); return i >= 0 ? l.slice(0, i) : l; }).join("\n");
    for (const stmt of body.split(";").map((s) => s.trim()).filter(Boolean)) db._raw.exec(stmt + ";");
  }
  const counts = db._raw.prepare(
    "SELECT (SELECT COUNT(*) FROM tag_votes) a, (SELECT COUNT(*) FROM comment_likes) b, (SELECT COUNT(*) FROM comments) c, (SELECT COUNT(*) FROM tags) d"
  ).get();
  assert.deepStrictEqual([counts.a, counts.b, counts.c], [0, 0, 0], "洗牌后票/同感/评论应为 0");
  assert(counts.d >= 15, "词表应保留(未被清空), 实得 " + counts.d);
  const kept = db._raw.prepare("SELECT COUNT(*) AS n FROM tags WHERE word IN ('春景','秋景','风')").get().n;
  assert.strictEqual(kept, 3, "落库的大纲词(预设)应保留: " + kept);

  console.log("✅ test-e2e-accounts.js 全部通过 (真 SQL + 真 cookie: 注册/保留名/唯一/打标红灰与取消/上限3/换设备认人/评论署名/禁自赞/编委开号与名单/软删/恢复码/相似标签/洗牌)");
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
