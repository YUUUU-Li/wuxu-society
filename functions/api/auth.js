// 众注·轻身份账号 API —— Cloudflare Pages Functions + D1, ESM 自包含
// 见 docs/账号系统方案.md。设计要点:
//   · 互动(打标签/评论/同感)一律要求登录; 浏览不需要。
//   · 口令 PBKDF2-SHA256(盐, 15 万次) —— 不存明文; 会话 cookie 只存 sha256(token) 到库里。
//   · 登录名 handle 与显示笔名 nick 都唯一(按归一化形式比对), 且保留社员缩写/笔名防抢注。
//   · 注册页勾「我是社员」=> member_state='待确认', 由编委确认后才成为社员。
// GET  /api/auth                                        -> { ok, user|null, showVoters }
// POST /api/auth {action:"register", handle, nick, pass, member}
// POST /api/auth {action:"login",    handle, pass}
// POST /api/auth {action:"logout"}
// POST /api/auth {action:"reset",    handle, code, pass}          用注册时给的恢复码重设口令
// 编委(role='编委' 或旧的 env.ZHUI_ADMIN_KEY, 过渡期两者都认):
// POST /api/auth {action:"pending"}                               待确认社员列表
// POST /api/auth {action:"confirm", user_id}                       确认社员(转 role='社员')
// POST /api/auth {action:"role", user_id, role}                    改角色(读者|社员|编委)
// POST /api/auth {action:"open", handle, nick, role}               编委开号(返回一次性口令)
import { RESERVED_NAMES, RESERVED_LABEL, SHOW_VOTERS } from "./zhuzhu-config.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
const COOKIE = "zz_sess";
const SESSION_DAYS = 90;
// PBKDF2 迭代数: 云端有两个硬约束 —— ① workerd 对 PBKDF2 迭代数有上限(超过会直接抛错,
// 见 workerd issue #1346: 上限 10 万) ② 免费版对每次请求有 CPU 限时。
// 所以不写死: 先用 1000 次探一下本环境的算力, 再挑一个"不超预算"的档位, 并把实际用的次数
// 写进哈希串(pbkdf2$<iter>$<hex>) —— 验证时照抄, 日后调强度也不会让老口令失效。
const PBKDF2_CANDIDATES = [90000, 25000, 5000];   // 由强到弱(90000 是生产环境验证过的档位)
const PBKDF2_BUDGET_MS = 8;                       // 自留余量, 免得撞上运行时 CPU 限时
const PBKDF2_MAX_ACCEPTED = 1000000;              // 校验时拒绝离谱的迭代数(防被伪造的哈希拖垮 CPU)
let PBKDF2_ITER = 0;                              // 本进程选定/探测出的档位(缓存)
const RESERVED = new Set(RESERVED_NAMES);

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({}, JSON_HEADERS, headers || {}) });
}
function clean(s, n) {
  return String(s == null ? "" : s).trim().replace(/[\r\n\t]/g, "").slice(0, n);
}
// 归一化: 去空白/标点、全角转半角、忽略大小写 —— 必须与 scripts/sync-zhuzhu-config.js 一致(单测交叉校验)
export function normName(s) {
  return String(s == null ? "" : s)
    .normalize("NFKC")
    .replace(/[\s·・.,，。、:：;；!！?？'"“”‘’()（）\[\]{}<>《》\-_/\\|]/g, "")
    .toLowerCase();
}
function ipOf(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0";
}
function uaOf(req) {
  return clean(req.headers.get("user-agent"), 120);
}
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return hex(a);
}
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
async function pbkdf2Hex(pass, saltHex, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, 256);
  return hex(bits);
}
export { pbkdf2Hex };
// 挑一个本环境跑得动的 PBKDF2 档位(探测一次, 进程内缓存)
export async function pickIterations(saltHex) {
  if (PBKDF2_ITER) return PBKDF2_ITER;
  let perIter = 0;
  try {
    const t0 = Date.now();
    await pbkdf2Hex("probe", saltHex, 1000);
    perIter = (Date.now() - t0) / 1000;          // 每次迭代的毫秒数(定时器精度不够时会得 0)
    if (perIter === 0) { PBKDF2_ITER = PBKDF2_CANDIDATES[0]; return PBKDF2_ITER; }   // 快到测不出 => 用最强档
  } catch (e) {
    // 探测本身被拒(例如该运行时连 1000 次都不允许?) -> 交给下面的循环挑最小档
    perIter = Infinity;
  }
  for (const iter of PBKDF2_CANDIDATES) {
    if (perIter * iter <= PBKDF2_BUDGET_MS) { PBKDF2_ITER = iter; return iter; }
  }
  PBKDF2_ITER = PBKDF2_CANDIDATES[PBKDF2_CANDIDATES.length - 1];
  return PBKDF2_ITER;
}
// 可选"胡椒": 服务器端秘密(env.ZHUI_PEPPER)参与哈希但不入库 —— 万一数据库泄露, 没有它也算不动。
// 免费版 CPU 预算小、PBKDF2 档位被迫压低, 有了胡椒等于给离线爆破再加一道门。
function withPepper(pass, pepper) {
  return pepper ? String(pass) + "\u0001" + String(pepper) : String(pass);
}
// 口令哈希: 形如 pbkdf2$90000$<hex> —— 迭代数随哈希一起存, 验证时按存的那个数重算
export async function hashPassword(pass, saltHex, pepper) {
  const want = await pickIterations(saltHex);
  const plain = withPepper(pass, pepper);
  let lastErr = null;
  for (const iter of [want, ...PBKDF2_CANDIDATES.filter((x) => x < want)]) {
    try {
      const h = await pbkdf2Hex(plain, saltHex, iter);
      PBKDF2_ITER = iter;                 // 记住这个运行时可用的档位
      return `pbkdf2$${iter}$${h}`;
    } catch (e) { lastErr = e; }          // 该档位被运行时拒绝 -> 降一档再试
  }
  throw lastErr || new Error("PBKDF2 不可用");
}
export async function verifyPassword(pass, saltHex, stored, pepper) {
  const m = /^pbkdf2\$(\d+)\$([0-9a-f]+)$/.exec(String(stored || ""));
  if (!m) return false;                   // 格式不对(旧数据/被改坏)一律不通过
  const iter = Number(m[1]);
  if (!(iter > 0) || iter > PBKDF2_MAX_ACCEPTED) return false;   // 防被离谱迭代数拖垮 CPU
  return (await pbkdf2Hex(withPepper(pass, pepper), saltHex, iter)) === m[2];
}
function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
// 恢复码: 形如 4F2A-91C3-B7E5 (去掉易混字符)
function newRecoverCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  const s = [...a].map((b) => abc[b % abc.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}
const recoverKey = (code) => sha256Hex(normName(code).toUpperCase());

// —— 当前登录者(供 tags.js / comments.js 共用) ——
export async function currentUser(context) {
  // 单测注入(与 related.js 的 REL_META_JSON 同一套路): 仅测试用, 线上不会设置
  if (context.env && context.env.ZHUI_TEST_USER) {
    try { return JSON.parse(context.env.ZHUI_TEST_USER); } catch { return null; }
  }
  const db = context.env.DB;
  if (!db) return null;
  const token = readCookie(context.request, COOKIE);
  if (!token) return null;
  try {
    const row = await db.prepare(
      `SELECT u.id, u.handle, u.nick, u.role, u.member_state
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?1 AND s.expires_at > datetime('now')`
    ).bind(await sha256Hex(token)).first();
    return row || null;
  } catch {
    return null;  // 表还没建时当作未登录, 不影响浏览
  }
}
// 编委判定: 账号角色优先, 过渡期仍认旧的共享钥匙
export function isAdmin(context, user, key) {
  if (user && user.role === "编委") return true;
  const k = context.env.ZHUI_ADMIN_KEY;
  return !!(k && clean(key, 100) === k);
}
function publicUser(u) {
  return u ? { id: u.id, handle: u.handle, nick: u.nick, role: u.role, member_state: u.member_state } : null;
}

async function startSession(db, userId) {
  const token = randHex(32);
  await db.prepare(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?1, ?2, datetime('now', '+${SESSION_DAYS} days'))`)
    .bind(await sha256Hex(token), userId).run();
  return token;
}

// 登录失败冷却(内存级, 单实例尽力而为; 与 submit.js 的限流同一思路)
const FAILS = new Map();
const MAX_FAILS = 5;
const COOLDOWN_MS = 15 * 60 * 1000;
function failKey(req, handle) {
  return ipOf(req) + ":" + normName(handle);
}
function cooling(req, handle) {
  const f = FAILS.get(failKey(req, handle));
  return !!(f && f.n >= MAX_FAILS && Date.now() - f.t < COOLDOWN_MS);
}
function noteFail(req, handle) {
  const k = failKey(req, handle);
  const f = FAILS.get(k) || { n: 0, t: 0 };
  f.n += 1; f.t = Date.now();
  FAILS.set(k, f);
}
function clearFail(req, handle) {
  FAILS.delete(failKey(req, handle));
}

// —— 账号表自建(幂等) ——
// 为什么放在函数里: 上线时"先部署代码、再手工去 D1 控制台粘 SQL"这一步最容易漏/最容易粘错;
// 让函数在第一次用到账号时自己把表建好, 上线就少一个环节。DDL 与 sql/accounts/01…04 完全一致,
// 想手工建表或排错时照旧可以粘那几个文件(两边都是幂等的)。
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     handle       TEXT NOT NULL,
     nick         TEXT NOT NULL,
     handle_key   TEXT NOT NULL UNIQUE,
     nick_key     TEXT NOT NULL UNIQUE,
     role         TEXT NOT NULL DEFAULT '读者',
     member_state TEXT NOT NULL DEFAULT '',
     pass_salt    TEXT NOT NULL,
     pass_hash    TEXT NOT NULL,
     recover_hash TEXT NOT NULL DEFAULT '',
     created_at   TEXT NOT NULL DEFAULT (datetime('now')),
     last_seen    TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `ALTER TABLE comments ADD COLUMN user_id INTEGER`,   // 已加过会报 duplicate column name, 下面容忍
];
let SCHEMA_READY = false;
export async function ensureSchema(db) {
  if (SCHEMA_READY) return;
  try {
    await db.prepare(`SELECT id FROM users LIMIT 1`).first();   // 表已在
  } catch (e) {
    for (const stmt of SCHEMA_SQL) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        if (!/duplicate column name|already exists/i.test(String((err && err.message) || ""))) throw err;
      }
    }
  }
  SCHEMA_READY = true;
}

export async function onRequest(context) {
  const req = context.request;
  const db = context.env.DB;
  if (!db) return json(503, { ok: false, error: "数据库尚未配置。" });
  try { await ensureSchema(db); } catch { /* 建表失败就按"未建表"处理, 下面会给提示 */ }

  if (req.method === "GET") {
    const me = await currentUser(context);
    return json(200, { ok: true, user: publicUser(me), showVoters: SHOW_VOTERS });
  }
  if (req.method !== "POST") return json(405, { ok: false, error: "只接受 GET/POST" });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }
  const action = clean(body.action, 20);
  const me = await currentUser(context);

  try {
    // ── 注册 ──
    if (action === "register") {
      const handle = clean(body.handle, 20);
      const nick = clean(body.nick, 20);
      const pass = String(body.pass || "");
      const member = !!body.member;
      if (handle.length < 2) return json(400, { ok: false, error: "登录名至少 2 个字符。" });
      if (nick.length < 2) return json(400, { ok: false, error: "昵称至少 2 个字符。" });
      if (pass.length < 8) return json(400, { ok: false, error: "口令至少 8 位。" });
      if (pass.length > 64) return json(400, { ok: false, error: "口令太长了。" });
      const hk = normName(handle), nk = normName(nick);
      if (!hk || !nk) return json(400, { ok: false, error: "登录名/昵称不能只有符号。" });
      // 保留名单(社员缩写与笔名): 防抢注
      for (const [k, label] of [[hk, handle], [nk, nick]]) {
        if (RESERVED.has(k)) {
          return json(409, { ok: false, reserved: true,
            error: `「${label}」是社员 ${RESERVED_LABEL[k] || ""} 的缩写/笔名，本站已保留；若你就是本人，请联系编委开号。` });
        }
      }
      // 唯一性(归一化后)
      const dupH = await db.prepare(`SELECT id FROM users WHERE handle_key = ?1`).bind(hk).first();
      if (dupH) return json(409, { ok: false, error: "该登录名已被占用，请修改。" });
      const dupN = await db.prepare(`SELECT id FROM users WHERE nick_key = ?1`).bind(nk).first();
      if (dupN) return json(409, { ok: false, error: "该昵称已被占用，请修改昵称。" });
      const salt = randHex(16);
      const code = newRecoverCode();
      const r = await db.prepare(
        `INSERT INTO users(handle, nick, handle_key, nick_key, role, member_state, pass_salt, pass_hash, recover_hash, last_seen)
         VALUES (?1, ?2, ?3, ?4, '读者', ?5, ?6, ?7, ?8, datetime('now'))`
      ).bind(handle, nick, hk, nk, member ? "待确认" : "", salt, await hashPassword(pass, salt, context.env.ZHUI_PEPPER), await recoverKey(code)).run();
      const token = await startSession(db, r.meta.last_row_id);
      const user = { id: r.meta.last_row_id, handle, nick, role: "读者", member_state: member ? "待确认" : "" };
      return json(200, {
        ok: true, user,
        recoverCode: code,
        note: member ? "已提交社员身份，待编委确认；恢复码请自己保存好。" : "恢复码请自己保存好（换设备/忘记口令时用）。",
      }, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }

    // ── 登录 ──
    if (action === "login") {
      const handle = clean(body.handle, 20);
      const pass = String(body.pass || "");
      if (cooling(req, handle)) return json(429, { ok: false, error: "尝试次数过多，请 15 分钟后再试。" });
      const row = await db.prepare(`SELECT id, handle, nick, role, member_state, pass_salt, pass_hash FROM users WHERE handle_key = ?1`)
        .bind(normName(handle)).first();
      if (!row || !(await verifyPassword(pass, row.pass_salt, row.pass_hash, context.env.ZHUI_PEPPER))) {
        noteFail(req, handle);
        return json(401, { ok: false, error: "登录名或口令不对。" });
      }
      clearFail(req, handle);
      await db.prepare(`UPDATE users SET last_seen = datetime('now') WHERE id = ?1`).bind(row.id).run();
      const token = await startSession(db, row.id);
      return json(200, { ok: true, user: publicUser(row) }, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }

    // ── 退出 ──
    if (action === "logout") {
      const token = readCookie(req, COOKIE);
      if (token) await db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(await sha256Hex(token)).run();
      return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    }

    // ── 用恢复码重设口令 ──
    if (action === "reset") {
      const handle = clean(body.handle, 20);
      const pass = String(body.pass || "");
      if (pass.length < 8) return json(400, { ok: false, error: "口令至少 8 位。" });
      const row = await db.prepare(`SELECT id, recover_hash FROM users WHERE handle_key = ?1`).bind(normName(handle)).first();
      const code = clean(body.code, 20);
      if (!row || !row.recover_hash || row.recover_hash !== (await recoverKey(code))) {
        return json(401, { ok: false, error: "登录名或恢复码不对。" });
      }
      const salt = randHex(16);
      const code2 = newRecoverCode();
      await db.prepare(`UPDATE users SET pass_salt = ?1, pass_hash = ?2, recover_hash = ?3 WHERE id = ?4`)
        .bind(salt, await hashPassword(pass, salt, context.env.ZHUI_PEPPER), await recoverKey(code2), row.id).run();
      await db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(row.id).run();   // 旧会话全部失效
      const token = await startSession(db, row.id);
      return json(200, { ok: true, recoverCode: code2, note: "口令已重设，恢复码已更新，请重新保存。" },
        { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }

    // ── 以下为编委动作 ──
    if (!isAdmin(context, me, body.key)) return json(403, { ok: false, error: "无权操作。" });

    // 一次性洗牌: 清空标签票/同感/评论与读者自造的候选词, **词表(94 预设 + 编委已采纳)保留**。
    // 与 sql/curation/05…08 等价, 只是省掉四次手工粘贴; 必须带确认字样, 防止误触。
    if (action === "wipe") {
      if (clean(body.confirm, 40) !== "清空标签票与评论") {
        return json(400, { ok: false, error: "危险操作：请在 confirm 字段里原样写「清空标签票与评论」。" });
      }
      const n = async (r) => (r && r.meta && r.meta.changes) || 0;
      const votes = await n(await db.prepare(`DELETE FROM tag_votes`).run());
      const likes = await n(await db.prepare(`DELETE FROM comment_likes`).run());
      const comments = await n(await db.prepare(`DELETE FROM comments`).run());
      const candidates = await n(await db.prepare(`DELETE FROM tags WHERE kind = '候选'`).run());
      const left = await db.prepare(`SELECT COUNT(*) AS n FROM tags`).first();
      return json(200, {
        ok: true, action: "wipe",
        removed: { votes, likes, comments, candidates },
        tagsLeft: left ? left.n : null,
        note: "词表已保留（预设词 + 编委已采纳词）。此操作不可撤销；改造前数据见 sql/backup 快照。",
      });
    }

    if (action === "pending") {
      const rows = (await db.prepare(
        `SELECT id, handle, nick, member_state, created_at FROM users WHERE member_state = '待确认' ORDER BY id`
      ).all()).results || [];
      return json(200, { ok: true, pending: rows });
    }
    if (action === "confirm") {
      const id = Number(body.user_id);
      const r = await db.prepare(`UPDATE users SET role = '社员', member_state = '已确认' WHERE id = ?1`).bind(id).run();
      if (!r.meta.changes) return json(404, { ok: false, error: "没有这个账号。" });
      return json(200, { ok: true, user_id: id, role: "社员" });
    }
    if (action === "role") {
      const id = Number(body.user_id);
      const role = clean(body.role, 10);
      if (!["读者", "社员", "编委"].includes(role)) return json(400, { ok: false, error: "角色只能是 读者/社员/编委。" });
      const r = await db.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(role, id).run();
      if (!r.meta.changes) return json(404, { ok: false, error: "没有这个账号。" });
      return json(200, { ok: true, user_id: id, role });
    }
    if (action === "open") {
      // 编委替社员开号: 生成一次性口令, 由编委转告本人(首次登录后请自行改口令 → P2 提供改密)
      const handle = clean(body.handle, 20);
      const nick = clean(body.nick, 20) || handle;
      if (handle.length < 2 || nick.length < 2) return json(400, { ok: false, error: "登录名/昵称至少 2 个字符。" });
      const role = ["读者", "社员", "编委"].includes(clean(body.role, 10)) ? clean(body.role, 10) : "社员";
      const hk = normName(handle), nk = normName(nick);
      const dup = await db.prepare(`SELECT id FROM users WHERE handle_key = ?1 OR nick_key = ?2`).bind(hk, nk).first();
      if (dup) return json(409, { ok: false, error: "该登录名或昵称已被占用。" });
      const pass = newRecoverCode().replace(/-/g, "");
      const salt = randHex(16);
      const code = newRecoverCode();
      const r = await db.prepare(
        `INSERT INTO users(handle, nick, handle_key, nick_key, role, member_state, pass_salt, pass_hash, recover_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, '已确认', ?6, ?7, ?8)`
      ).bind(handle, nick, hk, nk, role, salt, await hashPassword(pass, salt, context.env.ZHUI_PEPPER), await recoverKey(code)).run();
      return json(200, { ok: true, user_id: r.meta.last_row_id, handle, nick, role, tempPass: pass, recoverCode: code });
    }
    return json(400, { ok: false, error: "未知动作。" });
  } catch (e) {
    // 部署早于建表的过渡期: 给一句能照做的提示, 别只说"操作失败"
    if (/no such table/i.test(String((e && e.message) || ""))) {
      return json(503, { ok: false, error: "账号系统尚未建表：请编委先按 sql/accounts/01…04 建好 users 与 sessions。" });
    }
    return json(500, { ok: false, error: "账号操作失败。" });
  }
}
