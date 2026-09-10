-- 第 9 步：给联想池的 kind 过滤加索引（可选，不影响功能）
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 `wuxu-database` → Console）→ 点执行；一次只粘一个文件（控制台一次只认一条语句），不要与说明文字混粘。

CREATE INDEX IF NOT EXISTS idx_tags_kind ON tags(kind);
