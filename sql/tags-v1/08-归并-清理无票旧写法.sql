-- 第 8 步：没有读者票的旧写法直接下架（明月/夜/离别/归乡）
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 `wuxu-database` → Console）→ 点执行；一次只粘一个文件（控制台一次只认一条语句），不要与说明文字混粘。
-- 期望：tags 总数 -4（票数不变，这四个词本来没票）

DELETE FROM tag_votes WHERE tag_id IN (SELECT id FROM tags WHERE word IN ('明月','夜','离别','归乡'));

-- 紧接着再跑这一条（可与上一条分开粘）：
DELETE FROM tags WHERE word IN ('明月','夜','离别','归乡');
