-- 账号系统 P1 · 第 4 步：索引
-- 操作：打开本文件 → Ctrl+A → Ctrl+C → 粘进 D1 控制台 → 执行（一次只粘一个文件）。
-- 说明：登录时按 user_id 清理过期会话、编委查"待确认社员"都会用到。
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
