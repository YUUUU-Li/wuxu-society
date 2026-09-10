-- 07a：秋 → 秋景，先删「同一作品同一投票人在 秋景 上已有票」的重复票（否则下面迁票会撞唯一约束）
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 `wuxu-database` → Console）→ 点执行；一次只粘一个文件（控制台一次只认一条语句），不要与说明文字混粘。
-- 期望：一般显示 0 行受影响（没有重复票）

DELETE FROM tag_votes WHERE tag_id = (SELECT id FROM tags WHERE word='秋') AND EXISTS (SELECT 1 FROM tag_votes v2
  WHERE v2.tag_id = (SELECT id FROM tags WHERE word='秋景') AND v2.work_id = tag_votes.work_id AND v2.voter_key = tag_votes.voter_key);
