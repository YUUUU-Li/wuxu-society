-- 账号系统 P1 · 第 1 步：建 users 表（见 docs/账号系统方案.md）
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 wuxu-database → Console）→ 执行。
--       一次只粘一个文件（控制台一次只认一条语句，别把说明文字混进去）。
-- 期望：无报错；随后跑 SELECT COUNT(*) FROM users； 应为 0。
-- 说明：
--   handle/nick 是"显示用"的原文；handle_key/nick_key 是归一化结果（去空白标点、全角转半角、忽略大小写），
--   唯一约束加在 _key 上，这样「蓦 流」与「蓦流」、「JWL」与「jwl」不会同时注册成功。
--   member_state 用于"注册时勾了我是社员 → 待编委确认"的流程。
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  handle       TEXT NOT NULL,                       -- 登录名(原文)
  nick         TEXT NOT NULL,                       -- 显示笔名(原文)
  handle_key   TEXT NOT NULL UNIQUE,                -- 登录名归一化(唯一)
  nick_key     TEXT NOT NULL UNIQUE,                -- 笔名归一化(唯一)
  role         TEXT NOT NULL DEFAULT '读者',         -- 读者 | 社员 | 编委
  member_state TEXT NOT NULL DEFAULT '',            -- '' | 待确认 | 已确认
  pass_salt    TEXT NOT NULL,                       -- 口令盐(随机 16 字节, hex)
  pass_hash    TEXT NOT NULL,                       -- PBKDF2-SHA256, 形如 pbkdf2$<迭代数>$<hex>(迭代数自适应云端上限)
  recover_hash TEXT NOT NULL DEFAULT '',            -- 一次性恢复码的哈希(可选)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen    TEXT NOT NULL DEFAULT ''
);
