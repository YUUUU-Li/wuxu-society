// 账号系统单测: node scripts/test-auth.js
// 用一个"小型内存 D1"跑真实语义(唯一约束、口令哈希、cookie、编委权限)。
// 模型(小私人项目, 刻意从简): 注册只要「昵称 + 口令」, 昵称唯一(登录靠它认人、也保证标签/评论来源可辨),
// 不查社员名册、不审身份、没有待确认流程。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");

/* ---------- 小型内存 D1: 只实现 auth.js 用到的那几条语句 ---------- */
function FakeDB() {
  const db = { users: [], sessions: [], seq: 0 };
  async function run(sql, args) {
    const S = sql.replace(/\s+/g, " ").trim();
    if (S.includes("FROM sessions s JOIN users u")) {
      const s = db.sessions.find((x) => x.token_hash === args[0]);
      if (!s) return null;
      return db.users.find((u) => u.id === s.user_id) || null;
    }
    if (S.includes("FROM users WHERE handle_key = ?1 OR nick_key = ?2")) {
      return db.users.find((u) => u.handle_key === args[0] || u.nick_key === args[1]) || null;
    }
    if (S.includes("FROM users WHERE nick_key = ?1")) {
      return db.users.find((u) => u.nick_key === args[0]) || null;
    }
    if (S.includes("INSERT INTO users")) {
      // 注册: (nick, nick_key, salt, hash, recover)  开号: (nick, nick_key, role, salt, hash, recover)
      const viaRole = !S.includes("'读者'");
      const u = {
        id: ++db.seq, handle: args[0], nick: args[0], handle_key: args[1], nick_key: args[1],
        role: viaRole ? args[2] : "读者", member_state: "",
        pass_salt: viaRole ? args[3] : args[2], pass_hash: viaRole ? args[4] : args[3],
        recover_hash: viaRole ? args[5] : args[4],
      };
      if (db.users.some((x) => x.nick_key === u.nick_key)) throw new Error("UNIQUE constraint failed");
      db.users.push(u);
      return { meta: { last_row_id: u.id, changes: 1 } };
    }
    if (S.includes("INSERT INTO sessions")) {
      db.sessions.push({ token_hash: args[0], user_id: args[1] });
      return { meta: { changes: 1 } };
    }
    if (S.includes("DELETE FROM sessions WHERE token_hash")) {
      const n = db.sessions.length;
      db.sessions = db.sessions.filter((s) => s.token_hash !== args[0]);
      return { meta: { changes: n - db.sessions.length } };
    }
    if (S.includes("DELETE FROM sessions WHERE user_id")) {
      db.sessions = db.sessions.filter((s) => s.user_id !== args[0]);
      return { meta: { changes: 1 } };
    }
    if (S.includes("UPDATE users SET last_seen")) return { meta: { changes: 1 } };
    if (S.includes("UPDATE users SET pass_salt")) {
      const u = db.users.find((x) => x.id === args[3]);
      if (u) { u.pass_salt = args[0]; u.pass_hash = args[1]; u.recover_hash = args[2]; }
      return { meta: { changes: u ? 1 : 0 } };
    }
    if (S.includes("UPDATE users SET role = ?1 WHERE id = ?2")) {
      const u = db.users.find((x) => x.id === args[1]);
      if (u) u.role = args[0];
      return { meta: { changes: u ? 1 : 0 } };
    }
    throw new Error("FakeDB 未实现的语句: " + S.slice(0, 70));
  }
  const stmt = (sql, args) => ({
    first: () => run(sql, args),
    all: async () => ({ results: await run(sql, args) }),
    run: () => run(sql, args),
  });
  return { _db: db, prepare: (sql) => Object.assign(stmt(sql, []), { bind: (...args) => stmt(sql, args) }) };
}

const HDR = { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" };
const get = (u, cookie) => new Request("https://x.test" + u, { headers: cookie ? { cookie } : {} });
const post = (body, cookie) =>
  new Request("https://x.test/api/auth", { method: "POST", headers: Object.assign({}, HDR, cookie ? { cookie } : {}), body: JSON.stringify(body) });
const ctxOf = (db, env = {}) => (request) => ({ request, env: Object.assign({ DB: db }, env) });
const cookieOf = (res) => res.headers.get("set-cookie") || "";
// 从 Set-Cookie 串里取出会话令牌(形如 zz_sess=<64hex>; Path=/; ...)
const tokenOf = (setCookie) => decodeURIComponent(String(setCookie).split(";")[0].split("=")[1]);

async function main() {
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "api", "auth.js")).href);
  const sync = require("./sync-zhuzhu-config.js");

  /* 0) 归一化两边一致 + 生成物同步 */
  const names = ["jwl", "蓦流", "ｒｅａｄｅｒ３", "Reader1", "阿 白", "新酒（Hugo）"];
  for (const n of names) assert.strictEqual(auth.normName(n), sync.normName(n), "归一化不一致: " + n);
  const genPath = path.join(ROOT, "functions", "api", "zhuzhu-config.js");
  const before = fs.readFileSync(genPath, "utf8");
  sync.build();
  assert.strictEqual(fs.readFileSync(genPath, "utf8"), before, "functions/api/zhuzhu-config.js 应已同步(跑 npm run sync-zhuzhu)");
  assert(!before.includes("RESERVED"), "账号从简后不该再有保留名单");

  const db = FakeDB();
  const ctx = ctxOf(db);

  /* 1) 未登录 */
  let r = await auth.onRequest(ctx(get("/api/auth")));
  let j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.user, null, "未登录应为 null");
  assert.strictEqual(j.showVoters, "admin", "默认投票人名单只给编委");

  /* 2) 注册校验: 只要昵称与口令 */
  for (const [body, msg] of [
    [{ nick: "a", pass: "12345678" }, "昵称至少"],
    [{ nick: "阿白", pass: "1234" }, "口令至少 8 位"],
    [{ nick: "。。", pass: "12345678" }, "不能只有符号"],
  ]) {
    r = await auth.onRequest(ctx(post(Object.assign({ action: "register" }, body))));
    assert.strictEqual(r.status, 400, "非法注册应 400: " + JSON.stringify(body));
    assert((await r.json()).error.includes(msg), "报错文案: " + msg);
  }

  /* 3) 正常注册: 一个字段就够; 发会话 cookie、给恢复码、库里存哈希不存明文 */
  r = await auth.onRequest(ctx(post({ action: "register", nick: "阿白", pass: "hunter2hunter" })));
  j = await r.json();
  assert.strictEqual(r.status, 200, "注册应成功: " + JSON.stringify(j));
  const ck = cookieOf(r);
  assert(/^zz_sess=[0-9a-f]{64}/.test(ck), "应种下会话 cookie: " + ck);
  assert(/HttpOnly/.test(ck) && /SameSite=Lax/.test(ck) && /Secure/.test(ck), "cookie 属性: " + ck);
  assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(j.recoverCode), "恢复码格式: " + j.recoverCode);
  assert.strictEqual(j.user.nick, "阿白");
  assert.strictEqual(j.user.role, "读者");
  const u1 = db._db.users[0];
  assert.notStrictEqual(u1.pass_hash, "hunter2hunter", "不得存明文");
  assert(/^pbkdf2\$\d+\$[0-9a-f]{64}$/.test(u1.pass_hash), "口令哈希应含迭代数: " + u1.pass_hash.slice(0, 24));
  assert.strictEqual(u1.pass_salt.length, 32, "盐 16 字节 hex");
  assert.strictEqual(u1.recover_hash.length, 64, "恢复码也只存哈希");

  /* 3b) 验证按"存进去的迭代数"重算; 坏哈希安全失败 */
  {
    const salt = "a".repeat(32);
    const weak = "pbkdf2$1000$" + (await auth.pbkdf2Hex("legacy-pass-1", salt, 1000));
    db._db.users.push({ id: 900, nick: "老哈希", handle_key: "老哈希", nick_key: "老哈希",
      role: "读者", pass_salt: salt, pass_hash: weak, recover_hash: "" });
    r = await auth.onRequest(ctx(post({ action: "login", nick: "老哈希", pass: "legacy-pass-1" })));
    assert.strictEqual(r.status, 200, "应按哈希里记录的迭代数验证成功");
    const u900 = db._db.users.find((x) => x.id === 900);
    u900.pass_hash = "deadbeef";
    r = await auth.onRequest(ctx(post({ action: "login", nick: "老哈希", pass: "legacy-pass-1" })));
    assert.strictEqual(r.status, 401, "坏哈希应安全地判为不通过");
  }

  /* 3c) 可选"胡椒"(env.ZHUI_PEPPER) */
  {
    const dbP = FakeDB();
    r = await auth.onRequest({ request: post({ action: "register", nick: "胡椒测试", pass: "pepper-pass-1" }), env: { DB: dbP, ZHUI_PEPPER: "s3cret" } });
    assert.strictEqual(r.status, 200, "带胡椒注册应成功");
    r = await auth.onRequest({ request: post({ action: "login", nick: "胡椒测试", pass: "pepper-pass-1" }), env: { DB: dbP } });
    assert.strictEqual(r.status, 401, "没带胡椒应登不进去");
    r = await auth.onRequest({ request: post({ action: "login", nick: "胡椒测试", pass: "pepper-pass-1" }), env: { DB: dbP, ZHUI_PEPPER: "s3cret" } });
    assert.strictEqual(r.status, 200, "带胡椒应能登录");
  }

  /* 4) 昵称唯一(归一化后): 大小写/空格/全角都算同一个人 */
  r = await auth.onRequest(ctx(post({ action: "register", nick: "阿 白", pass: "12345678" })));
  assert.strictEqual(r.status, 409, "空格差异应视为已占用");
  assert(/换一个吧/.test((await r.json()).error), "应给出可照做的提示");
  r = await auth.onRequest(ctx(post({ action: "register", nick: "ＡＢ", pass: "12345678" })));
  assert.strictEqual(r.status, 200, "全角新昵称(不撞名)应可注册");

  /* 5) 带 cookie 取 me; 未登录/伪造 cookie 都是 null */
  r = await auth.onRequest(ctx(get("/api/auth", "zz_sess=" + tokenOf(ck))));
  j = await r.json();
  assert(j.user && j.user.nick === "阿白", "带 cookie 应返回登录者");
  r = await auth.onRequest({ request: get("/api/auth", "zz_sess=" + "f".repeat(64)), env: { DB: db } });
  assert.strictEqual((await r.json()).user, null, "伪造 cookie 应视为未登录");

  /* 6) 登录: 错口令 -> 401; 连错 5 次 -> 冷却(冷却期内正确口令也拒) */
  for (let i = 0; i < 5; i++) {
    r = await auth.onRequest(ctx(post({ action: "login", nick: "阿白", pass: "wrong-pass" })));
    assert.strictEqual(r.status, 401, "错口令应 401");
  }
  r = await auth.onRequest(ctx(post({ action: "login", nick: "阿白", pass: "wrong-pass" })));
  assert.strictEqual(r.status, 429, "第 6 次应冷却");
  r = await auth.onRequest(ctx(post({ action: "login", nick: "阿白", pass: "hunter2hunter" })));
  assert.strictEqual(r.status, 429, "冷却期内正确口令也应拒(防爆破)");

  r = await auth.onRequest(ctx(post({ action: "login", nick: "ＡＢ", pass: "12345678" })));
  const ckAB = cookieOf(r);
  assert.strictEqual(r.status, 200, "另一个账号应能正常登录");

  /* 7) 退出: 只退当前会话 */
  const uAB = db._db.users.find((x) => x.nick_key === "ab");
  assert.strictEqual(db._db.sessions.filter((s) => s.user_id === uAB.id).length, 2, "该账号此时应有 2 个会话(注册 + 登录)");
  r = await auth.onRequest(ctx(post({ action: "logout" }, tokenOf(ckAB) ? "zz_sess=" + tokenOf(ckAB) : "")));
  assert((await r.json()).ok && /Max-Age=0/.test(cookieOf(r)), "退出应清 cookie");
  assert.strictEqual(db._db.sessions.filter((s) => s.user_id === uAB.id).length, 1, "只该退掉当前会话");

  /* 8) 恢复码重设口令 */
  const uAB2 = db._db.users.find((x) => x.nick_key === "ab");
  r = await auth.onRequest(ctx(post({ action: "reset", nick: "ＡＢ", code: "AAAA-BBBB-CCCC", pass: "newpass12345" })));
  assert.strictEqual(r.status, 401, "错恢复码应 401");
  const code = "ZZZZ-YYYY-XXXX";
  uAB2.recover_hash = await (async () => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth.normName(code).toUpperCase()));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  })();
  r = await auth.onRequest(ctx(post({ action: "reset", nick: "ＡＢ", code, pass: "newpass12345" })));
  assert.strictEqual(r.status, 200, "对恢复码应可重设: " + JSON.stringify(await r.json()));
  assert.strictEqual(db._db.sessions.filter((s) => s.user_id === uAB2.id).length, 1, "重设后旧会话应作废, 只留新会话");

  /* 9) 编委动作权限: 无权限 403; 旧钥匙可以; 角色可以 */
  r = await auth.onRequest(ctx(post({ action: "role", user_id: 1, role: "编委" })));
  assert.strictEqual(r.status, 403, "非编委应 403");
  r = await auth.onRequest(ctxOf(db, { ZHUI_ADMIN_KEY: "k" })(post({ action: "role", key: "k", user_id: uAB2.id, role: "编委" })));
  assert((await r.json()).role === "编委", "旧钥匙应能改角色");
  r = await auth.onRequest(ctxOf(db, { ZHUI_ADMIN_KEY: "k" })(post({ action: "role", key: "k", user_id: uAB2.id, role: "皇上" })));
  assert.strictEqual(r.status, 400, "非法角色应 400");

  const adminUser = { id: 99, nick: "蓦流", role: "编委" };
  r = await auth.onRequest(ctxOf(db, { ZHUI_TEST_USER: JSON.stringify(adminUser) })(post({ action: "open", nick: "社员九", role: "社员" })));
  const openJ = await r.json();
  assert(openJ.ok && /^[A-Z0-9]{12}$/.test(openJ.tempPass) && openJ.role === "社员", "编委开号应给一次性口令: " + JSON.stringify(openJ));
  r = await auth.onRequest(ctxOf(db, { ZHUI_TEST_USER: JSON.stringify(adminUser) })(post({ action: "open", nick: "社员九" })));
  assert.strictEqual(r.status, 409, "重名开号应 409");

  /* 10) 部署早于建表: 给"先建表"的提示而不是含糊的"操作失败" */
  const dbNoTable = { prepare: () => { throw new Error("D1_ERROR: no such table: users"); } };
  r = await auth.onRequest({ request: post({ action: "login", nick: "nobody-here", pass: "12345678" }), env: { DB: dbNoTable } });
  assert.strictEqual(r.status, 503, "未建表时应 503");
  assert(/建表/.test((await r.json()).error), "应提示先按 sql/accounts 建表");

  console.log("✅ test-auth.js 全部通过 (昵称+口令注册/唯一性/口令哈希含迭代数/胡椒/会话cookie/冷却/退出/恢复码/编委权限/未建表提示)");
}
main().catch((e) => { console.error("FAIL:", e.message, "\n", (e && e.stack) || ""); process.exit(1); });
