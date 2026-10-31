-- 浏览量统计（记：functions/_middleware.js；读：functions/api/stats.js）
--
-- 口径（2026-10 社内定，见 docs/网站自定义指南.md「浏览量统计」一节）：
--   · 浏览次数 views  = 每次**页面**请求算一次（同一访客同一页 30 秒内的连续请求只算一次）
--   · 访客人数 uniq   = **按天去重的人次**：同一访客同一天同一页只算 1；跨天各算 1
--                       （所以"全站访客"= 每日 UV 之和，不是去重总人数）
--   · **真人 / 疑似机器分开记**：sviews / suniq 记"疑似机器"（爬虫、脚本、扫描器、AI 爬虫…）
--                       界面只展示真人数字，另标"疑机 N 次"，两边都不丢
--   · 只统计 HTML 页面：静态资源(js/css/图片)、/api/*、预取请求、分支预览部署、非 200 错误页不计
--   · 编委自己不计入：编委登录后前端种 zz_nostats=1 cookie，中间件见到直接跳过
--   · 隐私：**不存原始 IP**——把 IP + UA 加"当天日期 + 盐"做 SHA-256 得到访客指纹（每天换，无法跨天追踪）
--   · **改版前的历史数字是上界，不是测量值**：那时候明细表还没有机器标记，爬虫和真人混在一起、
--     无法追溯分离。所以"全站真人阅读/人次"在 2026-10-14 之前只能读作"不超过 N"。
--
-- 幂等：可反复执行；函数第一次用到统计时会自动建表/补列（两边一致，由 scripts/test-stats.js 守着）

CREATE TABLE IF NOT EXISTS page_daily (
  path   TEXT    NOT NULL,             -- 归一化路径, 如 '/w-feng'（/w-feng.html 也归到这里）
  day    TEXT    NOT NULL,             -- 北京时间的 'YYYY-MM-DD'
  views  INTEGER NOT NULL DEFAULT 0,   -- 内容页: 真人阅读次数(主口径)
  uniq   INTEGER NOT NULL DEFAULT 0,   -- 内容页: 真人访客(人次)
  sviews INTEGER NOT NULL DEFAULT 0,   -- 疑似机器阅读次数
  suniq  INTEGER NOT NULL DEFAULT 0,   -- 疑似机器访客(人次)
  eviews INTEGER NOT NULL DEFAULT 0,   -- 入口页(首页/作品库/社员/雅集/投稿…)打开次数
  euniq  INTEGER NOT NULL DEFAULT 0,   -- 入口页访客(人次, 基本是爬虫/预览/路过)
  PRIMARY KEY (path, day)
);
CREATE INDEX IF NOT EXISTS idx_page_daily_day ON page_daily(day);

-- 当天去重明细：只存指纹，不存原始 IP/UA；ts 用于"30 秒内连续请求只算一次"的去抖
-- bucket = 当次访问属于哪个桶（c=内容页真人 / e=入口页真人 / s=疑机 / u=口径未知的历史行）。
--   为什么明细也要记桶（2026-10-14 补）：回溯"有多少人读过内容页"全靠这张表，
--   而它原来不分桶 —— 爬虫只要碰过作品页就被算成一个"读者"。历史行没法追溯补标，
--   所以加列之前的行一律是 'u'，只配当上界。
CREATE TABLE IF NOT EXISTS page_visitors (
  day     TEXT    NOT NULL,
  path    TEXT    NOT NULL,
  visitor TEXT    NOT NULL,
  ts      INTEGER NOT NULL DEFAULT 0,
  bucket  TEXT    NOT NULL DEFAULT 'u',
  PRIMARY KEY (day, path, visitor)
);
-- 回溯按 path 过滤，而主键是 (day, path, visitor)：day 在最前，索引用不到 path
CREATE INDEX IF NOT EXISTS idx_page_visitors_path ON page_visitors(path);

-- 站点级去重**按桶分**（c=内容页真人 / e=入口页 / s=疑机）：
-- 同一个人先看首页(e)、再看作品页(c)，两边各算 1 个人次；不分桶会把内页那次吃掉。
CREATE TABLE IF NOT EXISTS bucket_visits (
  day     TEXT NOT NULL,
  bucket  TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, bucket, visitor)
);

-- 全站按天（views/uniq = 内容页真人；eviews/euniq = 入口页；sviews/suniq = 疑机）
CREATE TABLE IF NOT EXISTS site_daily (
  day    TEXT PRIMARY KEY,
  views  INTEGER NOT NULL DEFAULT 0,
  uniq   INTEGER NOT NULL DEFAULT 0,
  sviews INTEGER NOT NULL DEFAULT 0,
  suniq  INTEGER NOT NULL DEFAULT 0,
  eviews INTEGER NOT NULL DEFAULT 0,
  euniq  INTEGER NOT NULL DEFAULT 0
);

-- 早期版本的站点级去重表（已被 bucket_visits 取代, 保留只为兼容旧数据）
CREATE TABLE IF NOT EXISTS site_visitors (
  day     TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
);

-- 统计自身的元信息（如 'split_since' = 真人/机器可分辨的起始日）
CREATE TABLE IF NOT EXISTS stats_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- —— 有效阅读（2026-10-31 加）——
-- 上面那些表记的是「到达」：服务端看到一个像真浏览器的 HTML 页面 GET 就记一次，
-- 它含"点开就退"，也没法跨天认人。这张表记的是「有效阅读」：页面里的 beacon 自报
-- 停留时长/滚动深度/有无交互，**服务端复算**后够门槛才落库（判定见 functions/api/hit.js）。
--   · vid   = 浏览器 localStorage 里的随机 UUID（不是 IP、不连账号、不跨站）
--   · ref   = 来源分类 direct/internal/wechat/search/external（服务端按 Referer 判，不信前端）
--   · 主键(day, vid, path) ⇒ 同一人同一天同一页只记一次；又因此能算出跨天的**人数**
--     （到达层的指纹里掺了 day，天生只能算人次）
CREATE TABLE IF NOT EXISTS reads (
  day      TEXT    NOT NULL,
  vid      TEXT    NOT NULL,
  path     TEXT    NOT NULL,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  scrolled INTEGER NOT NULL DEFAULT 0,
  ref      TEXT    NOT NULL DEFAULT '',
  country  TEXT,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (day, vid, path)
);
CREATE INDEX IF NOT EXISTS idx_reads_path ON reads(path);
CREATE INDEX IF NOT EXISTS idx_reads_vid ON reads(vid);

-- 被拒绝的 beacon 按原因累计（原因是个封闭枚举；不许静默失败而不留痕）
CREATE TABLE IF NOT EXISTS hit_reject (
  day    TEXT    NOT NULL,
  reason TEXT    NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reason)
);

-- 老库升级（改进之前建的库缺列/缺表；已加过会报 duplicate column name，忽略即可）
-- CREATE TABLE IF NOT EXISTS stats_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
-- CREATE TABLE IF NOT EXISTS bucket_visits (day TEXT NOT NULL, bucket TEXT NOT NULL, visitor TEXT NOT NULL,
--   PRIMARY KEY (day, bucket, visitor));
-- ALTER TABLE page_daily    ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_daily    ADD COLUMN suniq  INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_daily    ADD COLUMN eviews INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_daily    ADD COLUMN euniq  INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE site_daily    ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE site_daily    ADD COLUMN suniq  INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE site_daily    ADD COLUMN eviews INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE site_daily    ADD COLUMN euniq  INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_visitors ADD COLUMN ts     INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_visitors ADD COLUMN bucket TEXT NOT NULL DEFAULT 'u';
-- CREATE INDEX IF NOT EXISTS idx_page_visitors_path ON page_visitors(path);

-- 口径修订（2026-10-14）：回溯"读过内容页的人次"时**排除 bucket='s'（疑机）**，
-- 并把 'c'（改版后确定是真人）当可信值、'c'+'u' 当上界。修订前的数字把爬虫算成了读者。
-- 历史行无法追溯补标 ⇒ 改版前的全站数字只能读作"不超过 N"，不是测量值。
