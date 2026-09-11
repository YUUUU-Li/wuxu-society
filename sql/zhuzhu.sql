-- 众注系统 D1 建表脚本(随 Cloudflare Pages + D1 上线执行)
-- 执行方式(推荐): Cloudflare D1 控制台(数据库页 -> Console)整段粘贴本文件内容
-- 或命令行: npx wrangler d1 execute <库名> --remote --file=sql/zhuzhu.sql
-- 计票口径:
--   标签 tag_votes.voter_key = 访问者「设备号」(前端 localStorage 的 zz_dev), 无设备号时回退 IP —— 一人一票；
--     写入/查票/取消三处必须同源, 否则再点一下取消不掉(tags.js 的 voteKey)。
--   评论/同感 liker_key = 访问者 IP(与 comments.js 一致)。

CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT NOT NULL UNIQUE,          -- 标签词
  kind        TEXT NOT NULL DEFAULT '候选',  -- 预设 | 候选 | 已采纳
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tag_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id    TEXT NOT NULL,                  -- 作品 slug
  tag_id     INTEGER NOT NULL REFERENCES tags(id),
  voter_key  TEXT NOT NULL DEFAULT '',       -- 设备号(无则 IP): 一人一票
  UNIQUE(work_id, tag_id, voter_key)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     TEXT NOT NULL,                 -- 作品 slug
  name        TEXT NOT NULL,                 -- 笔名/昵称
  body        TEXT NOT NULL,                 -- 正文(渲染时转义； > 引文/链接白名单)
  reply_to    INTEGER,                       -- 平铺楼式: 回复哪一楼(id), NULL=新开楼
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT                           -- 先显后删: 编委删除打时间戳, 前端隐藏
);

CREATE TABLE IF NOT EXISTS comment_likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  liker_key  TEXT NOT NULL DEFAULT '',       -- 访问者 IP(一人一票)
  UNIQUE(comment_id, liker_key)
);

CREATE INDEX IF NOT EXISTS idx_tv_work    ON tag_votes(work_id);
CREATE INDEX IF NOT EXISTS idx_cm_work    ON comments(work_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cl_comment ON comment_likes(comment_id);

-- 起步预置标签(社里共拟后可增删； 联想候选用 kind='预设' 的词)
INSERT OR IGNORE INTO tags(word, kind) VALUES
  ('思念','预设'), ('明月','预设'), ('重逢','预设'), ('春景','预设'),
  ('怅惘','预设'), ('用典','预设'), ('夜','预设'), ('秋','预设'),
  ('雨','预设'), ('白描','预设'), ('叠字','预设'), ('旷达','预设'),
  ('怀古','预设'), ('离别','预设'), ('归乡','预设');
