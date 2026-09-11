// 账号系统单测: node scripts/test-auth.js
// 用一个"小型内存 D1"跑真实的注册/登录/会话语义(唯一约束、口令哈希、cookie、编委权限),
// 而不是只记录调用形状 —— 账号这块出错代价高, 值得用真语义测。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");

/* ---------- 小型内存 D1: 只实现 auth.js 用到的那几条语句 ---------- */
function FakeDB() {
  const db = { users: [], sessions: [], seq: 0 };
  const norm = (s) => String(s || "");
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
    if (S.includes("FROM users WHERE handle_key = ?1")) {
      return db.users.find((u) => u.handle_key === args[0]) || null;
    }
    if (S.includes("FROM users WHERE nick_key = ?1")) {
      return db.users.find((u) => u.nick_key === args[0]) || null;
    }
    if (S.includes("FROM users WHERE member_state = '待确认'")) {
      return db.users.filter((u) => u.member_state === "待确认");
    }
    if (S.includes("INSERT INTO users")) {
      if (db.users.some((u) => u.handle_key === args[2] || u.nick_key === args[3])) {
        throw new Error("UNIQUE constraint failed");
      }
      const memberFlow = S.includes("'读者'");   // 注册语句里 role 与 member_state 都是字面量/参数混排
      const u = memberFlow
        ? { id: ++db.seq, handle: args[0], nick: args[1], handle_key: args[2], nick_key: args[3],
            role: "读者", member_state: args[4], pass_salt: args[5], pass_hash: args[6], recover_hash: args[7] }
        : { id: ++db.seq, handle: args[0], nick: args[1], handle_key: args[2], nick_key: args[3],
            role: args[4], member_state: "已确认", pass_salt: args[5], pass_hash: args[6], recover_hash: args[7] };
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
    if (S.includes("UPDATE users SET role = '社员', member_state = '已确认'")) {
      const u = db.users.find((x) => x.id === args[0]);
      if (u) { u.role = "社员"; u.member_state = "已确认"; }
      return { meta: { changes: u ? 1 : 0 } };
    }
    if (S.includes("UPDATE users SET role = ?1 WHERE id = ?2")) {
      const u = db.users.find((x) => x.id === args[1]);
      if (u) u.role = args[0];
      return { meta: { changes: u ? 1 : 0 } };
    }
    throw new Error("FakeDB 未实现的语句: " + S.slice(0, 60));
  }
  const stmt = (sql, args) => ({
    first: () => run(sql, args),
    all: async () => ({ results: await run(sql, args) }),
    run: () => run(sql, args),
  });
  return {
    _db: db,
    prepare: (sql) => Object.assign(stmt(sql, []), { bind: (...args) => stmt(sql, args) }),
  };
}

const HDR = { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" };
const get = (u, cookie) => new Request("https://x.test" + u, { headers: cookie ? { cookie } : {} });
const post = (body, cookie) =>
  new Request("https://x.test/api/auth", { method: "POST", headers: Object.assign({}, HDR, cookie ? { cookie } : {}), body: JSON.stringify(body) });
const ctxOf = (db, env = {}) => (request) => ({ request, env: Object.assign({ DB: db }, env) });
const cookieOf = (res) => (res.headers.get("set-cookie") || "");

async function main() {
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "api", "auth.js")).href);
  const sync = require("./sync-zhuzhu-config.js");

  /* 0) 归一化函数两边必须一致(生成器 vs 函数), 否则保留名单会失效 */
  const members = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/members.json"), "utf8"));
  for (const sec of members) for (const m of sec.members) {
    const parts = [m.id, ...String(m.name || "").split("·").map((s) => s.trim())];
    for (const raw of parts) {
      const stripped = raw.replace(/[（(][^）)]*[）)]/g, "").trim();
      if (stripped) assert.strictEqual(auth.normName(stripped), sync.normName(stripped), "归一化不一致: " + stripped);
    }
  }
  /* 生成物与源码同步 */
  const genPath = path.join(ROOT, "functions", "api", "zhuzhu-config.js");
  const before = fs.readFileSync(genPath, "utf8");
  sync.build();
  assert.strictEqual(fs.readFileSync(genPath, "utf8"), before, "functions/api/zhuzhu-config.js 应已同步(跑 npm run sync-zhuzhu)");

  const db = FakeDB();
  const ctx = ctxOf(db);

  /* 1) 未登录: me 为空 */
  let r = await auth.onRequest(ctx(get("/api/auth")));
  let j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.user, null, "未登录应为 null");
  assert.strictEqual(j.showVoters, "admin", "默认投票人名单只给编委");

  /* 2) 注册: 各种校验 */
  const bad = [
    [{ handle: "a", nick: "阿白", pass: "12345678" }, "登录名至少"],
    [{ handle: "readerx", nick: "b", pass: "12345678" }, "昵称至少"],
    [{ handle: "readerx", nick: "阿白", pass: "1234" }, "口令至少 8 位"],
  ];
  for (const [body, msg] of bad) {
    r = await auth.onRequest(ctx(post(Object.assign({ action: "register" }, body))));
    assert.strictEqual(r.status, 400, "非法注册应 400: " + JSON.stringify(body));
    assert((await r.json()).error.includes(msg), "报错文案: " + msg);
  }

  /* 3) 保留名单: 社员缩写与笔名都不能被抢注 */
  for (const [field, body] of [["handle", { handle: "jwl", nick: "路人甲", pass: "12345678" }],
                              ["nick", { handle: "lurenjia", nick: "蓦流", pass: "12345678" }],
                              ["nick(别名)", { handle: "lurenjia2", nick: "Hugo", pass: "12345678" }]]) {
    r = await auth.onRequest(ctx(post(Object.assign({ action: "register" }, body))));
    const out = await r.json();
    assert.strictEqual(r.status, 409, `保留名(${field})应 409`);
    assert(out.reserved === true && /保留/.test(out.error), "保留名提示: " + out.error);
  }

  /* 4) 正常注册: 发会话 cookie、返回恢复码、库里存哈希不存明文 */
  r = await auth.onRequest(ctx(post({ action: "register", handle: "Reader1", nick: "阿白", pass: "hunter2hunter", member: true })));
  j = await r.json();
  assert.strictEqual(r.status, 200, "注册应成功: " + JSON.stringify(j));
  const ck = cookieOf(r);
  assert(/^zz_sess=[0-9a-f]{64}/.test(ck), "应种下会话 cookie: " + ck);
  assert(/HttpOnly/.test(ck) && /SameSite=Lax/.test(ck) && /Secure/.test(ck), "cookie 属性: " + ck);
  assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(j.recoverCode), "恢复码格式: " + j.recoverCode);
  assert.strictEqual(j.user.role, "读者");
  assert.strictEqual(j.user.member_state, "待确认", "勾了我是社员 -> 待确认");
  const u1 = db._db.users[0];
  assert.notStrictEqual(u1.pass_hash, "hunter2hunter", "不得存明文");
  assert.strictEqual(u1.pass_hash.length, 64, "PBKDF2-SHA256 -> 64 位 hex");
  assert.strictEqual(u1.pass_salt.length, 32, "盐 16 字节 hex");
  assert.strictEqual(u1.recover_hash.length, 64, "恢复码也只存哈希");

  /* 5) 唯一性按归一化比对(大小写/空格/全角都不算新名) */
  r = await auth.onRequest(ctx(post({ action: "register", handle: "reader1", nick: "另一个", pass: "12345678" })));
  assert.strictEqual(r.status, 409, "登录名大小写不同应视为占用");
  r = await auth.onRequest(ctx(post({ action: "register", handle: "reader2", nick: "阿 白", pass: "12345678" })));
  assert.strictEqual(r.status, 409, "空格差异应视为占用");
  r = await auth.onRequest(ctx(post({ action: "register", handle: "ｒｅａｄｅｒ３", nick: "小白", pass: "12345678" })));
  assert.strictEqual(r.status, 200, "全角登录名(不撞名)应可注册");

  /* 6) 用 cookie 取 me */
  const token = decodeURIComponent(ck.split(";")[0].split("=")[1]);
  r = await auth.onRequest(ctx(get("/api/auth", "zz_sess=" + token)));
  j = await r.json();
  assert(j.user && j.user.nick === "阿白", "带 cookie 应返回登录者");

  /* 7) 登录: 错口令 -> 401; 连错 5 次 -> 429 冷却; 冷却期内正确口令也拒 */
  for (let i = 0; i < 5; i++) {
    r = await auth.onRequest(ctx(post({ action: "login", handle: "Reader1", pass: "wrong-pass" })));
    assert.strictEqual(r.status, 401, "错口令应 401");
  }
  r = await auth.onRequest(ctx(post({ action: "login", handle: "Reader1", pass: "wrong-pass" })));
  assert.strictEqual(r.status, 429, "第 6 次应冷却");
  r = await auth.onRequest(ctx(post({ action: "login", handle: "Reader1", pass: "hunter2hunter" })));
  assert.strictEqual(r.status, 429, "冷却期内正确口令也应拒(防爆破)");

  r = await auth.onRequest(ctx(post({ action: "login", handle: "reader3", pass: "12345678" })));
  j = await r.json();
  assert.strictEqual(r.status, 200, "另一账号应能正常登录");
  const ck3 = cookieOf(r);

  /* 8) 退出: 删掉"这一个会话" + 清 cookie(同一账号可能有多个设备的会话, 只该退掉当前这个) */
  const u3id = db._db.users.find((x) => x.handle_key === "reader3").id;
  const sessBefore = db._db.sessions.filter((s) => s.user_id === u3id).length;
  assert.strictEqual(sessBefore, 2, "该账号此时应有 2 个会话(注册 + 登录)");
  r = await auth.onRequest(ctx(post({ action: "logout" }, "zz_sess=" + decodeURIComponent(ck3.split(";")[0].split("=")[1]))));
  j = await r.json();
  assert(j.ok && /Max-Age=0/.test(cookieOf(r)), "退出应清 cookie: " + cookieOf(r));
  assert.strictEqual(db._db.sessions.filter((s) => s.user_id === u3id).length, 1, "退出只该退掉当前会话, 别动别的设备");

  /* 9) 恢复码重设口令 */
  const u3 = db._db.users[1];
  r = await auth.onRequest(ctx(post({ action: "reset", handle: "reader3", code: "AAAA-BBBB-CCCC", pass: "newpass12345" })));
  assert.strictEqual(r.status, 401, "错恢复码应 401");
  // 用第 4 步那个账号的恢复码(recover_hash 已存, 这里直接重算一份新码来验证流程)
  const code = "ZZZZ-YYYY-XXXX";
  u3.recover_hash = await (async () => {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(auth.normName(code).toUpperCase()));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  })();
  r = await auth.onRequest(ctx(post({ action: "reset", handle: "reader3", code, pass: "newpass12345" })));
  j = await r.json();
  assert.strictEqual(r.status, 200, "对恢复码应可重设: " + JSON.stringify(j));
  assert.strictEqual(db._db.sessions.filter((s) => s.user_id === u3.id).length, 1, "重设后旧会话应作废, 只留新会话");

  /* 10) 编委动作权限: 无权限 403; 旧钥匙可; role='编委' 亦可 */
  r = await auth.onRequest(ctx(post({ action: "pending" })));
  assert.strictEqual(r.status, 403, "非编委应 403");
  r = await auth.onRequest(ctxOf(db, { ZHUI_ADMIN_KEY: "k" })(post({ action: "pending", key: "k" })));
  j = await r.json();
  assert(j.ok && Array.isArray(j.pending) && j.pending.length === 1, "旧钥匙应能看待确认列表");
  r = await auth.onRequest(ctxOf(db, { ZHUI_ADMIN_KEY: "k" })(post({ action: "confirm", key: "k", user_id: j.pending[0].id })));
  assert((await r.json()).role === "社员", "确认社员应转 role='社员'");

  const adminUser = { id: 99, handle: "jwl", nick: "蓦流", role: "编委", member_state: "已确认" };
  r = await auth.onRequest(ctxOf(db, { ZHUI_TEST_USER: JSON.stringify(adminUser) })(post({ action: "open", handle: "member9", nick: "社员九", role: "社员" })));
  j = await r.json();
  assert(j.ok && /^[A-Z0-9]{12}$/.test(j.tempPass) && j.role === "社员", "编委开号应给一次性口令: " + JSON.stringify(j));
  r = await auth.onRequest(ctxOf(db, { ZHUI_TEST_USER: JSON.stringify(adminUser) })(post({ action: "role", user_id: 99, role: "皇上" })));
  assert.strictEqual(r.status, 400, "非法角色应 400");

  /* 11) 部署早于建表的过渡期: 应提示"先建表"而不是含糊的"操作失败"
     (用没在前文出现过的账号名, 免得撞上第 7 步的登录冷却) */
  const dbNoTable = { prepare: () => { throw new Error("D1_ERROR: no such table: users"); } };
  r = await auth.onRequest({ request: post({ action: "login", handle: "nobody-here", pass: "12345678" }), env: { DB: dbNoTable } });
  assert.strictEqual(r.status, 503, "未建表时应 503");
  assert(/建表/.test((await r.json()).error), "应提示先按 sql/accounts 建表");

  console.log("✅ test-auth.js 全部通过 (注册校验/保留名单/归一化唯一/口令哈希/会话cookie/冷却/退出/恢复码/编委权限/未建表提示)");
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
