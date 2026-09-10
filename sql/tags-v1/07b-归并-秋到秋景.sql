-- 07b：把 秋 的票迁到 秋景
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 `wuxu-database` → Console）→ 点执行；一次只粘一个文件（控制台一次只认一条语句），不要与说明文字混粘。
-- 期望：思念=7 行 / 秋=4 行受影响

UPDATE tag_votes SET tag_id = (SELECT id FROM tags WHERE word='秋景') WHERE tag_id = (SELECT id FROM tags WHERE word='秋');
