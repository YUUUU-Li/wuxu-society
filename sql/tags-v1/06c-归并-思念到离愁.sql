-- 06c：删掉旧词 思念（票已迁走）
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 `wuxu-database` → Console）→ 点执行；一次只粘一个文件（控制台一次只认一条语句），不要与说明文字混粘。
-- 期望：tags 总数 -1

DELETE FROM tags WHERE word = '思念';
