-- 众注系统 D1 建表脚本(随 Cloudflare Pages + D1 上线执行)
-- 执行方式(本地/CI): npx wrangler d1 execute zhuzhu --file=sql/zhuzhu.sql --remote
-- 说明: 先显后删; 昵称自由填写; 标签分 预设/候选/已采纳; 编委可删评论/合并候选标签

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
  voter_ip   TEXT NOT NULL DEFAULT '',
  voter_name TEXT NOT NULL DEFAULT '',       -- 昵称(可空=匿名计数)
  UNIQUE(work_id, tag_id, voter_ip, voter_name)  -- 一人一票(同一 IP+昵称 仅一次)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     TEXT NOT NULL,                 -- 作品 slug
  name        TEXT NOT NULL,                 -- 笔名/昵称
  body        TEXT NOT NULL,                 -- 正文(渲染时转义; > 引文/链接白名单)
  reply_to    INTEGER,                       -- 平铺楼式: 回复哪一楼(id), NULL=新开楼
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT                           -- 先显后删: 编委删除打时间戳, 前端隐藏
);

CREATE TABLE IF NOT EXISTS comment_likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  liker_ip   TEXT NOT NULL DEFAULT '',
  liker_name TEXT NOT NULL DEFAULT '',
  UNIQUE(comment_id, liker_ip, liker_name)
);

CREATE INDEX IF NOT EXISTS idx_tv_work   ON tag_votes(work_id);
CREATE INDEX IF NOT EXISTS idx_cm_work   ON comments(work_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cl_comment ON comment_likes(comment_id);

-- 起步预置标签(社里共拟后可增删; 展示与联想用 kind='预设' 且 word 唯一)
INSERT OR IGNORE INTO tags(word, kind) VALUES
  ('思念','预设'), ('明月','预设'), ('重逢','预设'), ('春景','预设'),
  ('怅惘','预设'), ('用典','预设'), ('夜','预设'), ('秋','预设'),
  ('雨','预设'), ('白描','预设'), ('叠字','预设'), ('旷达','预设'),
  ('怀古','预设'), ('离别','预设'), ('归乡','预设');
