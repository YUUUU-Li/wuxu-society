-- 核对 A：词数
-- 期望：预设 94 / 候选 4（共 98）

SELECT kind, COUNT(*) AS n FROM tags GROUP BY kind;
