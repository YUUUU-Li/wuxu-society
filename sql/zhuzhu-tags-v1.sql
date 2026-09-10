-- 众注·标签系统 v1: 受控词表落库 + 历史写法归并(随 Cloudflare Pages + D1 上线执行)
-- 前置: 先执行 sql/zhuzhu.sql (四表 + 15 条起步标签)
-- 执行方式: Cloudflare D1 控制台(数据库页 -> Console) —— **一段一段粘**, 每段都是一条完整语句, 见下方「段 N」;
--   或命令行一次跑完: npx wrangler d1 execute wuxu-database --remote --file=sql/zhuzhu-tags-v1.sql
-- 为什么分段: 控制台对"一次粘进超长多语句"偶发不执行(回显像成功但库里没变)。分段每段有回显, 出问题一眼看得见。
-- 幂等: 可重复执行; 跑第二遍不再改动任何数据(词已在库则跳过, 旧写法已归并则无匹配)。
-- 每段跑完可核对(这条也是判断"控制台到底有没有执行"的探针):
--   SELECT COUNT(*) AS n FROM tags;
--   段 1~4 跑完 => 100 上下(库里的旧写法还在); 段 6 归并跑完 => 94。

-- 词表真相在 src/_data/tag_outline.json (94 词):
--   改词 -> 改 JSON -> npm run sync-tags (生成 functions/api/tag-outline.js) -> npm test -> 重跑本文件;
--   或在作品页众注区「编委 -> 初始化/更新标签词表」点一次(与段 1~5 等价, 幂等)。
--   scripts/test-tags-sql.js 校验本文件的词表/转正表/归并表跟 JSON 一致, 防止两份漂移。

-- 两处与早期讨论稿不同、以 docs/标签大纲.md §2 定论为准的取舍:
--   1) 不落 category 列: 分类(cat)与释义(hint)随 tag-outline.js 编译下发, 库里不再存副本, 免得两处真相;
--      下面按四大类书写, 只为便于人读。
--   2) 不建 tag_aliases 吸附表: 同义词不做自动映射, 由编委「合并」动作处理(票数并入目标词)。

-- ══ 段 1/5: 意象(35 词) ══
INSERT OR IGNORE INTO tags(word, kind) VALUES
  ('春景','预设'), ('夏景','预设'), ('秋景','预设'), ('冬景','预设'), ('夜景','预设'),
  ('清明','预设'), ('重阳','预设'), ('元宵','预设'), ('月','预设'),   ('星','预设'),
  ('雨','预设'),   ('雪','预设'),   ('霜','预设'),   ('露','预设'),   ('风','预设'),
  ('灯','预设'),   ('酒','预设'),   ('舟','预设'),   ('窗','预设'),   ('楼','预设'),
  ('山','预设'),   ('水','预设'),   ('草木','预设'), ('城','预设'),   ('花','预设'),
  ('叶','预设'),   ('柳','预设'),   ('松','预设'),   ('梧桐','预设'), ('鸿雁','预设'),
  ('鱼','预设'),   ('书信','预设'), ('琴','预设'),   ('棋','预设'),   ('梦','预设');

-- ══ 段 2/5: 情感(19 词) ══
INSERT OR IGNORE INTO tags(word, kind) VALUES
  ('离愁','预设'), ('思乡','预设'), ('怀人','预设'), ('怀古','预设'), ('怅惘','预设'),
  ('旷达','预设'), ('羁旅','预设'), ('自省','预设'), ('知己','预设'), ('恋慕','预设'),
  ('忧郁','预设'), ('欣喜','预设'), ('勉励','预设'), ('豪情','预设'), ('闲适','预设'),
  ('孤寂','预设'), ('释然','预设'), ('悲痛','预设'), ('重逢','预设');

-- ══ 段 3/5: 手法(29 词) ══
INSERT OR IGNORE INTO tags(word, kind) VALUES
  ('用典','预设'),     ('化用','预设'),     ('比喻','预设'),     ('比拟','预设'),
  ('叠字','预设'),     ('通感','预设'),     ('对仗','预设'),     ('白描','预设'),
  ('虚实结合','预设'), ('动静结合','预设'), ('对比','预设'),     ('渲染','预设'),
  ('夸张','预设'),     ('顶针','预设'),     ('色彩','预设'),     ('点染','预设'),
  ('列锦','预设'),     ('双关','预设'),     ('借代','预设'),     ('象征','预设'),
  ('托物言志','预设'), ('侧面描写','预设'), ('想象','预设'),     ('直抒胸臆','预设'),
  ('借景抒情','预设'), ('起兴','预设'),     ('反问','预设'),     ('反讽','预设'),
  ('欲扬先抑','预设');

-- ══ 段 4/5: 题材·语境(11 词) ══
INSERT OR IGNORE INTO tags(word, kind) VALUES
  ('校园','预设'), ('成长','预设'), ('旅途','预设'), ('科幻','预设'), ('网络世代','预设'),
  ('打油诗','预设'), ('回忆','预设'), ('幽默','预设'), ('抽象','预设'), ('情节','预设'),
  ('炼字','预设');

-- ══ 段 5/5: 候选转正(大纲词若曾被读者以「候选」落库, 一并转正; 与编委「初始化/更新标签词表」同一动作) ══
UPDATE tags SET kind = '预设' WHERE kind = '候选' AND word IN (
  '春景','夏景','秋景','冬景','夜景','清明','重阳','元宵','月','星','雨','雪','霜','露','风','灯','酒','舟','窗','楼',
  '山','水','草木','城','花','叶','柳','松','梧桐','鸿雁','鱼','书信','琴','棋','梦',
  '离愁','思乡','怀人','怀古','怅惘','旷达','羁旅','自省','知己','恋慕','忧郁','欣喜','勉励','豪情','闲适','孤寂','释然','悲痛','重逢',
  '用典','化用','比喻','比拟','叠字','通感','对仗','白描','虚实结合','动静结合','对比','渲染','夸张','顶针','色彩','点染','列锦','双关','借代','象征',
  '托物言志','侧面描写','想象','直抒胸臆','借景抒情','起兴','反问','反讽','欲扬先抑',
  '校园','成长','旅途','科幻','网络世代','打油诗','回忆','幽默','抽象','情节','炼字'
);

-- ══ 段 6: 历史写法归并(一次清洗; 与函数 /api/tags 的 cleanup 动作同一张表) ══
-- 左=历史写法(含 sql/zhuzhu.sql 那 15 条起步标签里的 6 条), 右=大纲词; 空串 = 弃用(仅下架不合并)
-- 6.1 建归并表(临时表, 段末即删)
DROP TABLE IF EXISTS _tag_legacy_map;
CREATE TABLE _tag_legacy_map (from_word TEXT PRIMARY KEY, to_word TEXT NOT NULL);
INSERT INTO _tag_legacy_map(from_word, to_word) VALUES
  ('思念','离愁'),     ('离别','离愁'),     ('离别相思','离愁'),
  ('明月','月'),       ('月亮','月'),       ('月星','月'),
  ('夜','夜景'),       ('秋','秋景'),       ('春','春景'),       ('夏','夏景'),       ('冬','冬景'),
  ('归乡','思乡'),     ('思乡归途','思乡'),
  ('江','水'),         ('山水','山'),
  ('花木','花'),       ('梅','花'),
  ('征人','怀人'),     ('修身','自省'),     ('高中','校园'),
  ('棋局','棋'),       ('星际','星'),       ('凄冷','孤寂'),     ('累','忧郁'),
  ('恋','恋慕'),       ('爱','恋慕'),
  ('风物','');         -- 弃用: 只下架, 不并入任何词
-- 注: tag_outline.json 里 '夜景'->'夜景' 属自映射, 此处不收; 若收, 会把大纲词『夜景』连同票一起删掉。

-- 6.2 目标词先确保在库且为预设(离愁/月/春景…可能还没落库)
INSERT OR IGNORE INTO tags(word, kind)
  SELECT DISTINCT to_word, '预设' FROM _tag_legacy_map
   WHERE to_word <> '' AND to_word <> from_word;

-- 6.3 同一作品、同一投票人在目标词上已有票的, 先删旧写法那张重复票(否则撞 UNIQUE(work_id,tag_id,voter_key))
DELETE FROM tag_votes WHERE id IN (
  SELECT tv.id FROM tag_votes tv
    JOIN tags tf ON tf.id = tv.tag_id
    JOIN _tag_legacy_map m ON m.from_word = tf.word AND m.to_word <> '' AND m.to_word <> m.from_word
    JOIN tags tt ON tt.word = m.to_word
    JOIN tag_votes v2 ON v2.work_id = tv.work_id AND v2.voter_key = tv.voter_key AND v2.tag_id = tt.id
);

-- 6.4 余票并入目标词
UPDATE tag_votes
   SET tag_id = (SELECT tt.id FROM tags tf
                   JOIN _tag_legacy_map m ON m.from_word = tf.word
                   JOIN tags tt ON tt.word = m.to_word
                  WHERE tf.id = tag_votes.tag_id)
 WHERE EXISTS (SELECT 1 FROM tags tf JOIN _tag_legacy_map m ON m.from_word = tf.word
                WHERE tf.id = tag_votes.tag_id AND m.to_word <> '' AND m.to_word <> m.from_word);

-- 6.5 删旧写法(票已迁走; 弃用词的票随之删)
DELETE FROM tag_votes WHERE tag_id IN (SELECT tf.id FROM tags tf JOIN _tag_legacy_map m ON m.from_word = tf.word);
DELETE FROM tags WHERE word IN (SELECT from_word FROM _tag_legacy_map);

-- 6.6 归并表用后即弃, 不留在业务 schema 里
DROP TABLE _tag_legacy_map;

-- ══ 索引(联想池按 kind 过滤) ══
CREATE INDEX IF NOT EXISTS idx_tags_kind ON tags(kind);

-- ══ 核对(可选) ══
-- SELECT kind, COUNT(*) AS n FROM tags GROUP BY kind;                    -- 全跑完: 预设 = 94
-- SELECT t.word, COUNT(*) AS c FROM tag_votes tv JOIN tags t ON t.id = tv.tag_id GROUP BY t.id ORDER BY c DESC;
