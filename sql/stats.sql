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
--
-- 幂等：可反复执行；函数第一次用到统计时会自动建表/补列（两边一致，由 scripts/test-stats.js 守着）

CREATE TABLE IF NOT EXISTS page_daily (
  path   TEXT    NOT NULL,             -- 归一化路径, 如 '/w-feng'（/w-feng.html 也归到这里）
  day    TEXT    NOT NULL,             -- 北京时间的 'YYYY-MM-DD'
  views  INTEGER NOT NULL DEFAULT 0,   -- 真人阅读次数
  uniq   INTEGER NOT NULL DEFAULT 0,   -- 真人访客(人次)
  sviews INTEGER NOT NULL DEFAULT 0,   -- 疑似机器阅读次数
  suniq  INTEGER NOT NULL DEFAULT 0,   -- 疑似机器访客(人次)
  PRIMARY KEY (path, day)
);
CREATE INDEX IF NOT EXISTS idx_page_daily_day ON page_daily(day);

-- 当天去重明细：只存指纹，不存原始 IP/UA；ts 用于"30 秒内连续请求只算一次"的去抖
CREATE TABLE IF NOT EXISTS page_visitors (
  day     TEXT    NOT NULL,
  path    TEXT    NOT NULL,
  visitor TEXT    NOT NULL,
  ts      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, visitor)
);

-- 全站按天（全站 UV = 每天在全站范围内去重的访客数）
CREATE TABLE IF NOT EXISTS site_daily (
  day    TEXT PRIMARY KEY,
  views  INTEGER NOT NULL DEFAULT 0,
  uniq   INTEGER NOT NULL DEFAULT 0,
  sviews INTEGER NOT NULL DEFAULT 0,
  suniq  INTEGER NOT NULL DEFAULT 0
);

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

-- 老库升级（2026-10 改进之前的库只有 views/uniq；已加过会报 duplicate column name，忽略即可）
-- ALTER TABLE page_daily    ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_daily    ADD COLUMN suniq  INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE site_daily    ADD COLUMN sviews INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE site_daily    ADD COLUMN suniq  INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE page_visitors ADD COLUMN ts     INTEGER NOT NULL DEFAULT 0;
