-- 一次性校订：删掉「离愁」的误挂票，只保留《离秋》一篇
-- 背景：2026-09 做历史标签归并时把「思念」并进了「离愁」，事后判断语义不当（思念≠离别之愁），
--       故把《长相思·思乡》《小重山·秋漫红砖一寸深》《忆秦娥·和答蓦流〈小重山〉》《回忆》四篇上的离愁票删掉。
-- 操作：打开本文件 → 全选 Ctrl+A → 复制 Ctrl+C → 粘进 Cloudflare D1 控制台（库 wuxu-database → Console）→ 执行。
--       本文件只有一条语句，一次粘一条（控制台一次只认一条语句，别与说明文字混粘）。
-- 预期：全站票 36 → 28；「离愁」10 张 → 2 张（只剩 w-liqiu）。
--       删掉的 8 张 = w-changxiangsi 3 + w-xiaochongshan 2 + w-yiqinehe 1 + w-huishou2 2。
--       词「离愁」本身与其它作品的票不受影响。
DELETE FROM tag_votes
 WHERE tag_id = (SELECT id FROM tags WHERE word = '离愁')
   AND work_id IN ('w-changxiangsi', 'w-xiaochongshan', 'w-yiqinehe', 'w-huishou2');
