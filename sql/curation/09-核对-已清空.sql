-- 重新洗牌后核对：跑完 05~08 执行本文件
-- 期望结果（一行四列）：票 = 0、同感 = 0、评论 = 0、词条 = 94
--   词条 94 = 94 个大纲预设词；若大于 94，多出来的是编委「已采纳」的表外词（正常，可保留）。
SELECT (SELECT COUNT(*) FROM tag_votes)     AS 票,
       (SELECT COUNT(*) FROM comment_likes) AS 同感,
       (SELECT COUNT(*) FROM comments)      AS 评论,
       (SELECT COUNT(*) FROM tags)          AS 词条;
