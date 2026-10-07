-- 浏览量统计（记：functions/_middleware.js；读：functions/api/stats.js）
--
-- 口径（2026-09 社内定，见 docs/网站自定义指南.md「浏览量统计」一节）：
--   · 浏览次数 views = 每次**页面**请求算一次（刷新也算）
--   · 访客人数 uniq = **按天去重的人次**：同一访客同一天同一页只算 1；跨天各算 1
--                     （所以"全站访客"= 每日 UV 之和，不是去重总人数）
--   · 只统计 HTML 页面：静态资源(js/css/图片)、/api/*、预取请求、爬虫、分支预览部署一律不计
--   · 隐私：**不存原始 IP**——把 IP + UA 加"当天日期 + 盐"做 SHA-256 得到访客指纹（每天换，无法跨天追踪）
--   · 数字只在作品页题下显示，且**只有编委登录后**由前端拉取；普通读者/其它账号看不到任何数字
--
-- 幂等：可反复执行；函数第一次用到统计时会自动建同样的表（两边一致，由 scripts/test-stats.js 守着）

CREATE TABLE IF NOT EXISTS page_daily (
  path  TEXT    NOT NULL,          -- 归一化路径, 如 '/w-feng'（/w-feng.html 也归到这里）
  day   TEXT    NOT NULL,          -- 北京时间的 'YYYY-MM-DD'
  views INTEGER NOT NULL DEFAULT 0,
  uniq  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (path, day)
);
CREATE INDEX IF NOT EXISTS idx_page_daily_day ON page_daily(day);

-- 当天去重明细：只存指纹，不存原始 IP/UA
CREATE TABLE IF NOT EXISTS page_visitors (
  day     TEXT NOT NULL,
  path    TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, path, visitor)
);

-- 全站按天（全站 UV = 每天在全站范围内去重的访客数）
CREATE TABLE IF NOT EXISTS site_daily (
  day   TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  uniq  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_visitors (
  day     TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
);
