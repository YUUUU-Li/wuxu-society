# 迁往 Cloudflare Pages 方案（构建/托管去 Netlify 化）

> **实施状态（2026-09）**：静态站已迁 CF Pages 并上线 `wuxu-society.pages.dev`；
> 投稿函数已放 `functions/api/submit.js`（路由 `/api/submit`），**待 CF 后台确认 Functions 目录后生效**；
> 域名 wuxu.org 绑定后把 `site.json` 的 `url` 换掉即可。
> **动机回顾**：Netlify 免费档"构建分钟"额度过小，投稿/日常 push 稍多即烧完，
> 账号进入 operational credits 模式 → **生产部署暂停**（已上线页面不受影响）。

## 0. 迁移前置（在朋友那边确认）

- [ ] 域名已买到（Spaceship），并已按《域名接入指南》把 NS 指到 Cloudflare；
- [ ] 朋友有 Cloudflare 账号，GitHub 仓库 `YUUUU-Li/wuxu-society` 授权给 Cloudflare Pages（登录 CF 时用 GitHub 授权即可）；
- [ ] `GITHUB_TOKEN_SUBMIT`（投稿钥匙）从 Netlify 后台取出，准备粘到 CF（也可在 CF 里新建一个同权限 token——见《编委操作手册》§6）。

## 1. 在 Cloudflare 建 Pages 项目（一次 ~10 分钟）

1. Cloudflare 控制台 → **Workers & Pages → Create → Pages → Connect to Git**；
2. 选仓库 `wuxu-society`，框架预设选 **None**（不用 Eleventy 预设），填：
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `/`（留空）
3. **Environment variables**（Advanced 区）→ 新增 `GITHUB_TOKEN_SUBMIT`（**Encrypt/secret** 勾上），粘贴 token；
4. Deploy。等第一次构建成功 → 得到临时域名 `xxx.pages.dev`；
5. 临时域名阶段**先只做内部验证**（大陆直连 pages.dev 可能不稳，属正常）：
   - 打开首页看版式；
   - 验证投稿函数：浏览器访问 `https://xxx.pages.dev/submit`（GET 应 405 或表单页 404 无碍），
     或直接 POST 测试（见 §4 验收清单）。

## 2. 代码侧已做的准备（无需再动）

- **`functions/api/submit.js`**（仓库根）：Cloudflare Pages Functions 适配器，复用
  `netlify/functions/submit.js` 同一份投稿逻辑（含 Buffer shim、CF 真实 IP 透传、
  env 桥接）。CF 部署后投稿路由为 `/api/submit`；
  ⚠️ 勿用 `functions/submit.js`：静态页 `submit.html` 会被 CF 规范化到 `/submit`，
  会占掉函数路由（函数不触发）——函数必须放不与任何页面同名的路径；
- **`src/_data/site.json` 的 `apiEndpoint`**：投稿页提交地址由此字段驱动，现已切为
  `/api/submit`（CF 函数路由）；域名换成自有域名时只改 `url` 字段即可；
- 验证命令（本仓库内跑）：`node scripts/cf-adapter-smoke.js`（模拟 CF 调用，400 校验路径通）。

> 仍缺：**入社申请**用的 Netlify Forms 在 CF 无对应物。二选一：
> ① 切 CF 后把入社表单改成"发邮件到 wuxuliterature@163.com"的引导（零后端，推荐）；
> ② 若想保留在线表单，需另配邮箱服务（Resend/Mailgun 等，需朋友注册并给 SMTP key），届时我照 §5 加函数。

## 3. 绑定自有域名（域名已到 CF 后）

1. Pages 项目 → **Custom domains** → Add：填主域名（如 `wuxu-literary.cn`）与 `www`；
2. 让 CF 自动建 DNS 记录（类型自动生成，橙色云）；
3. 等 SSL 证书签发（几分钟），访问主域名验证。
   → 大陆访问走 CF 境外边缘，速度尚可、**无需备案**（用 CF 免费版/境外线路）。
4. （可选）把 `src/_data/site.json` 的 `url` 改成新域名 → 提交 → sitemap/OG 全站自动跟随。

## 4. 切换与验收清单

1. 主域名确认正常后，把 `apiEndpoint` 改为 `/submit` 并推送；
2. 真机走一遍投稿（网页提交 → GitHub PR 出现 → Merge → 新篇上线）；
3. 检查：首页/作品库/期页/概念页/全文库、手机端菜单、入社表单（见 §2 选择）；
4. 旧 Netlify 处置（二选一）：
   - 停用：Netlify → Site configuration → Danger zone → Delete site（保守起见先保留一周）；
   - 或保留当镜像/回退（不再 push 即可，不耗额度？——Netlify 只在 push 时构建，保留不构建不耗分钟）。

## 5. 回退方案

代码无平台耦合（函数双平台并存），若 CF 不顺：把 `apiEndpoint` 改回
`/.netlify/functions/submit`，域名 DNS 指回 Netlify 即可（详见《域名接入指南》）。
GitHub 上 `netlify/functions/` 与 `functions/` 两个目录可长期共存，互不干扰。

## 6. 常用坑

- Pages 构建设置只在 **CF 后台**改，没有仓库内配置文件可被覆盖的问题（优于 Netlify UI 覆盖）；
- `functions/` 目录名是 CF 约定（区别于 `netlify/functions/`），勿改名；
- pages.dev 域名大陆直连不稳是预期，**验收以绑定后的自定义域名为准**；
- 每次 push main 自动构建；CF 免费 500 次/月，正常投稿节奏远用不完。
