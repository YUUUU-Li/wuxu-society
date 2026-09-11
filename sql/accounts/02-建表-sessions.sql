-- 账号系统 P1 · 第 2 步：建 sessions 表
-- 操作：打开本文件 → Ctrl+A → Ctrl+C → 粘进 D1 控制台 → 执行（一次只粘一个文件）。
-- 期望：无报错。
-- 说明：只存 token 的 sha256，库被看到也拿不到登录态；cookie 为 HttpOnly + Secure + SameSite=Lax，90 天。
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,                      -- sha256(会话令牌)
  user_id    INTEGER NOT NULL,                      -- 对应 users.id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL                          -- ISO 时间； 过期即视为未登录
);
