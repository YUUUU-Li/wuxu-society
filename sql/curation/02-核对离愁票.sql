-- 核对：跑完 01 之后执行本文件，看「离愁」还剩哪些
-- 预期结果（只有一行）：
--   w-liqiu | 离愁 | 2
-- 若还出现别的作品，说明 01 没执行成功（控制台一次只认一条语句，注意别把说明文字一起粘进去）。
SELECT tv.work_id, t.word, COUNT(*) AS c
  FROM tag_votes tv JOIN tags t ON t.id = tv.tag_id
 WHERE t.word = '离愁'
 GROUP BY tv.work_id
 ORDER BY tv.work_id;
