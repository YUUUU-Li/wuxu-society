-- 账号系统 P1 · 第 3 步：评论表加账号列
-- 操作：打开本文件 → Ctrl+A → Ctrl+C → 粘进 D1 控制台 → 执行（一次只粘一个文件）。
-- 期望：无报错（若报 "duplicate column name: user_id" 说明已经加过，可忽略）。
-- 说明：以后评论署名一律取账号笔名；name 列保留作历史兼容。
ALTER TABLE comments ADD COLUMN user_id INTEGER;
