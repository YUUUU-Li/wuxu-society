-- 清理上线自测时创建的探针账号（只在需要时跑）
-- 背景：验收时用 `shangxian-zice / 上线自测` 注册过一个探针账号，它没有投过票、没有评论，
--       只是 users 表里多一行。想清掉就跑下面两条（先删会话，再删账号）。
-- 操作：打开本文件 → 只复制第 1 条 → 粘进 D1 控制台执行 → 再复制第 2 条执行。

-- 第 1 条：删掉它的会话
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE handle_key = 'shangxian-zice');

-- 第 2 条：删掉账号本身
DELETE FROM users WHERE handle_key = 'shangxian-zice';
