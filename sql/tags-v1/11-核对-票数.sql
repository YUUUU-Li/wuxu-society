-- 核对 B：票数（应仍是 34 张，一张不丢）
-- 期望：离愁 10、春景 4、秋景 4、对仗 3，其余 2 或 1

SELECT t.word, COUNT(*) AS c FROM tag_votes tv JOIN tags t ON t.id = tv.tag_id GROUP BY t.id ORDER BY c DESC;
