# PROJECT-NOTES · 婺需文学社官网（交接备忘）

> 用法：新会话里说一句「读 PROJECT-NOTES.md，按里面的任务继续」即可；本文件随仓库走，有改动请直接更新它。
> 最近校正：**2026-11-01**（按当前代码与数据核对）。⚠️ 仓库代码往往跑得比本文件快：动手前先 `ls` 与 `docs/` 校对一遍。

## 一、项目与部署现状

- **线上站点**：<https://wuxu.org>（Cloudflare Pages，Git 已连接；`www.wuxu.org` 与 `wuxu-society.pages.dev` 亦可访问）
- **旧站**：Netlify 已退役（免费额度耗尽，仅保留历史展示，不再作为部署目标）
- **仓库**：<https://github.com/YUUUU-Li/wuxu-society>（**public**，main 为生产分支；投稿 PR 与审稿附言公开可见）
- **技术栈**：**11ty（Eleventy）静态生成** + **Cloudflare Pages Functions（ESM）** + **D1**；`package.json` 中 `npm run build` = `eleventy`
- **部署流程**：本地/网页改 → push main → Cloudflare 自动构建发布（1~3 分钟）
- **改站规矩**：**push 必须由人点**（GitHub 凭据在账号持有人手里）；Agent 负责改文件、写 SQL、检查语法；提交信息按《docs/提交规范.md》

## 二、目录速查（以实际仓库为准，进仓库后先 `ls` 校对）

- `src/works/*.md` —— 作品正文（每篇一个 md，含 frontmatter）；名单全部由构建期从目录推导，**没有共享登记表**
- `src/_data/members.json` —— 社员名单（5 个分部 / 17 位社员）
- `src/_data/issues.json` —— 刊期档案（现 3 期：清明 7 / 回忆文会 9 / 九月投稿 2）
- `src/_data/concepts.json` —— 概念档案（清明、立社，题解均已补）
- `src/_data/tag_outline.json` —— 标签大纲（94 词；`npm run sync-tags` 编译进函数）
- `src/_data/site.json` —— 站名/网址/公众号/众注开关
- `src/_includes/` —— 布局、导航、页脚
- `src/static/work-jinghua.css` + `src/static/fonts/KingHwaOldSong-site.woff2` —— 作品页专用京华老宋体（只在 `layouts/work.njk` 加载；字体授权与子集说明见 `src/static/fonts/README.md`）
- `functions/_middleware.js` —— 浏览量中间件（三桶 + 有效阅读建表）
- `functions/api/` —— `submit` 投稿、`join` 入社、`preview` 预览、`auth` 账号、`tags`/`comments` 众注、`related` 相似标签、`stats`/`hit` 统计、`tag-outline`/`zhuzhu-config` 生成物
- `sql/` —— `zhuzhu.sql`（众注四表）、`stats.sql`、`accounts/`、`curation/`、`tags-v1/`、`backup/`
- `scripts/` —— 构建工具与本地测试；`npm test` 覆盖投稿、众注、账号、统计、日期、作品库、产物等 18 组断言
- `docs/` —— 13 份文档，入口见 `README.md`「文档」一节；提交信息规范见 `docs/提交规范.md`

## 三、当前状态与待办（按优先级）

1. **标签与关联系统 —— 已落地（本条的早期设计稿已被取代，一律以 `docs/标签大纲.md` 为准）**
   - 受控词表 v1 定稿 **94 词**（意象 35 / 情感 19 / 手法 29 / 题材·语境 11）；权威数据 `src/_data/tag_outline.json`，经 `npm run sync-tags` 编译进 `functions/api/tag-outline.js`（Worker 无 fs）。
   - **落库脚本已产出**：`sql/zhuzhu-tags-v1.sql`（94 词 seed + 历史写法归并，幂等，可反复跑）；也可在作品页众注区用编委入口「初始化/更新标签词表」，两者等价。
   - 与早期稿不同处（社内定论）：**不加权**（关联度用标签向量余弦，各类平权）、**不建 `tag_aliases` 吸附表**（同义由编委「合并」动作处理，票数并入）、`tags` 表**不加 `category` 列**（分类随函数下发，避免两份真相）、**每账号每篇最多赞同 3 个标签**（跨设备同计；服务端兜底）、手法类也开放给读者。
   - 关联输出次序：强关联（唱和/组诗，front matter `related`）→ 同作者 → 相似标签（`/api/related` 余弦，前端动态填充）→ 同时同源。
   - 已修 bug：`TAG_LEGACY` 里的 `夜景 → 夜景` 自映射会让「整理历史标签」把该词连同票一起删掉（已跳过自映射 + 加单测）。
   - **相似标签口径（2026-09 修订）**：只用**读者票**算余弦（删掉"用 frontmatter 意象按 1 票兜底"的老逻辑），共享 **1** 个标签即可上榜；没有票的作品不参与（该组自行隐藏）。
   - **账号化 P1 已上线（2026-09 从简版）**：登录只要**昵称 + 口令**（昵称即署名、即登录名，**唯一**）；口令 PBKDF2-SHA256（**迭代数自适应云端上限**，形如 `pbkdf2$<iter>$<hex>`；可选 `ZHUI_PEPPER` 胡椒）；会话 cookie HttpOnly + 库里只存 token 哈希；**登录入口在导航右上角**（全站脚本 `src/static/auth.js`；2026-09 改为页头按钮款 `.btn`，也就是原来「申请入社」那个样式——导航里其余项都是文字链，顺序：缘起·雅集·社员·作品库·申请入社·投稿）；**打标签与评论要求登录**，署名取昵称；**不能赞同自己的评论**；每篇 3 个标签按账号计；编委用 `role='编委'`（旧钥匙过渡期仍认）；投票人名单默认只给编委（`site.json → zhuzhu.showVoters`）。
     **刻意不做**：登录名/笔名两栏、社员勾选与待确认流程、保留昵称防抢注（小私人项目，靠群内提醒用缩写/笔名即可）。
     建表由函数首次用到账号时**自建**；编委身份：自己注册后跑一句 `UPDATE users SET role='编委' WHERE nick_key='你的昵称';`。方案与验收见 `docs/账号系统方案.md`、`docs/账号系统上线清单.md`。
2. **作品创作时间：字段已定，数据待补**
   - 字段就是 front matter 的 **`created`**，**不是 `date`**；标签沿用 **`imageries`**（必须是大纲词），另有 `source`（出处/期）、`related`（唱和·组诗）、`excerpt`（摘句）、`epigraph`（题记，楷体排开篇）、`selfNote`（自注，楷体排正文下方）。
   - **`created` 写法很宽松（2026-09 改）**：`20240911` / `2024.9.11` / `2024/9/11` / `2024年9月11日` / `2024-09-11`（到日）、`202409` / `2024.9` / `2024-09`（只到月）、`2024`（只到年）都认，统一归一化成 `YYYY[-MM[-DD]]`（`scripts/work-order.js` 的 `parseCreated`，投稿接口与投稿页各自同口径实现，单测 `scripts/test-dates.js` 逐例比对三方）。**排序 = 升序，且模糊的往前排**（`2024` < `2024.6` < `2024.6.7`，做法是补零成 8 位排序键）；认不出的按「年份待考」并在构建日志告警。投稿页「日」那一格现为文本框，可直接粘整串日期（自动拆到年、月）。
   - **收集表已生成**：`docs/作品时间收集表.md`（重跑 `node scripts/work-dates-report.js` 刷新）——现 **54 篇中已填 24 篇 / 待填 30 篇**，按刊期与出处分批，附干支/节令线索。
   - 已知锚点：清明首聚 7 篇 = **2024-04-04**；回忆文会《时间溯流》9 篇同批；四季组诗 4 篇（w-luochun/w-liuxia/w-liqiu/w-wangdong，作者 ylj/lfk/lys/hde）；《小重山》⇄《忆秦娥·和答蓦流〈小重山〉》是唱和（已在 `related`）。
   - 九月投稿辑两篇（`w-zhuyingtai` / `w-chenmo`）只知期时点 2026-09，**作品创作时间待作者确认**（社内已定：先不填，只在收集表里标注）。
   - **题记 / 自注已有专用字段（2026-09 加）**：front matter `epigraph`（题记，≤200 字）/ `selfNote`（自注，≤600 字），投稿页对应两栏（选填，可换行）；作品页把题记以**楷体排在正文开篇**、自注以**楷体排在正文下方**（`.work-epigraph` / `.work-selfnote`，见 `src/_includes/layouts/work.njk`）；换行由 `escLines` 过滤器转 `<br />`（`scripts/text-blocks.js`，与 `/api/preview` 逐字节同口径，单测 `scripts/test-blocks.js`）——**预览即发布**。
   - 正文内的前记/后记/序仍走行首 `&` 的楷体段（`<p class="stanza kaiti">`），赏析段仍 `class="analysis"`；概念题解另在 `concepts.json` 的 `note`（清明、立社已补，新概念随期补写）。旧稿不写这两栏即零影响。
3. **作品库时间排序 —— 已定案并落地（缺的只是数据）**
   - 口径的单一真相在 **`scripts/work-order.js`**（`.eleventy.js` 与 `scripts/work-dates-report.js` 共用；单测 `scripts/test-work-order.js`）：`created` **升序**（早者在前），作品库/全文库/期页/关联组内同口径。**本条早期写的"倒序 + 按年分组"未采纳**（保持升序平铺 + 现有筛选）。
   - **未填者不猜日期**：一律排在已填者之后，作品库底部另立「**年份待考**」一节（标出篇数；被筛选筛空时标题自动收起）。旧口径"继承前一篇时点"已废弃——那份手工名单开头即 2024-04-04，会把未填作品一律算作那天（含后来的投稿）挤作一堆。同时间点或未填者按文件名稳定排列。
   - 待办只剩**收集数据**：照 `docs/作品时间收集表.md` 问作者，`npm run set-created` 写入即自动归位（2026 两篇已确认先不填）。
   - **浏览量统计（2026-09 上线；2026-10-13 改版为"三桶"口径，只给编委看）**：`functions/_middleware.js`（根中间件，官方支持"对整站生效含静态文件"）在**页面请求**上异步记一笔（`context.waitUntil`，不拖慢访问）。表：`page_daily`/`page_visitors`/`bucket_visits`/`site_daily`/`site_visitors`(旧)/`stats_meta`/`reads`/`hit_reject`（`sql/stats.sql`，函数首次计数时自动建表并给老库补列）。
   - **三个桶**（优先级从高到低）：`s` 疑机（UA 黑名单/无 UA/无 `Accept-Language`/机房 IP 且无 Sec-Fetch，含 Googlebot、GPTBot、ClaudeBot、ChatGPT-User、Claude-User、Playwright…）→ `sviews/suniq`；`c` **内容页**（`/w-*`、`/qingming-*`、`/issue-*`、`/concepts/*`、`/_fulltext`）→ **`views/uniq`＝内容页的"到达/人次"（服务端口径；2026-11 起界面主数字只显示"有效阅读/读者"，到达只进悬停说明/诊断）**；`e` 入口页（首页/作品库/社员/雅集/投稿/404）→ `eviews/euniq`（显示为"仅入口"，**不算进内容页数字**）。改口径只需改 `CONTENT_PATH_RE`。
   - **为什么改（实据 2026-10-13）**：旧口径下全站 247 个"访客"里 186 个只打了首页、225 个只看一页就走（每访客页数分布 1 页=225），首页占 75% —— 那是爬虫/预览抓取；按内容页口径真人只有几十人次/7 天。**"242" 从来不是读者数**。
   - **口径（到达层）**：到达=页面请求次数（同人同页 30 秒内连刷只算一次）；人次=**按天去重**，单页按 (天,路径,指纹) 去重、站点按 (天,桶,指纹) 去重（所以"先看首页再看作品页"的人两边各算 1 人次）；跨天各算一次；只记 HTML 且仅 200；`/w-feng` 与 `/w-feng.html` 归一；**不存原始 IP**（只存每天更换的指纹）。
   - **编委自己不计入**（编委态前端种 `zz_nostats=1` cookie，中间件跳过）；**自启用日起算**，历史补不回；改版前三个桶混在一起、拆不开（面板标注"真假分辨自 Y 起"）。单测 `scripts/test-stats.js`。
    - **回溯口径修正（2026-10-14，修掉一个真 bug）**：`page_visitors` 原本**不分桶**，爬虫与真人写在同一批行里，于是 `derived`（按内容页路径回溯"有多少人读过"）把碰过作品页的 GPTBot/Bytespider/扫描器也算成了读者。现在明细行带 `bucket`（`c` 内容页真人 / `e` 入口页真人 / `s` 疑机 / `u` 口径未知的历史行），回溯**一律排除 `s`**，`c` 为可信值、`c`+`u` 为上界。**历史行无法追溯补标** ⇒ 改版前的数字只能是"≤N"；界面据此显示 `人次 ≤56` 并注明"其中 X 人次可确认为真人"。另加 `page_visitors(path)` 索引（主键 `(day,path,visitor)` 的 `day` 在最前，回溯按 path 过滤会全表扫）。
    - **已知未修（按优先级）**：① 回访 304 漏计 —— **2026-10-15 线上实测已排除**：用 Edge 连打三次 `/w-shixi1`，三次文档响应全是 `200`、`cache-control: public, max-age=0, must-revalidate` **且没有 ETag**，浏览器一次 `If-None-Match`/`If-Modified-Since` 都没发 ⇒ 当前 `status===200` 的判断不会漏计回访。**但这是潜在脆弱点**：哪天 Pages/中间件给 HTML 加回 ETag，回访就会开始变 304 而不计数；② `site_daily.views/uniq` 是**混合口径列**（改版前=所有人、改版后=只有内容页），`diagnose.siteTrend` 直接读它 → 逐日序列中间有口径断崖；③ `split_since`/`buckets_since` 写在每次访问的 batch 里（写放大）；④ `page_visitors` 只增不减、无保留策略；⑤ `zz_nostats` 由前端 JS 种，编委换浏览器/清 cookie 就会被计入。
    - **有效阅读层（2026-10-30 新增，回答"有没有人真的读"）**：`src/static/beacon.js`（只在内容页、`defer`、全程 try/catch 静默）用 `sendBeacon` 把 `{vid, path, dwell_ms, scrolled, interacted}` 发 `POST /api/hit`；**判定只在服务端** `engagedFrom()`（`dwell≥8000` 或 `dwell≥4000 且（滚动≥50 或有交互）`），前端的 `engaged` 字段一律不看。短页补充通道的理由：短诗页根本不可滚 ⇒ 滚动比例恒等 100%，照字面执行会把秒退判成有效。落 `reads(day,vid,path,dwell_ms,scrolled,ref,country,ts)`，PK `(day,vid,path)` ⇒ 同人同天同页 1 行；`vid` 是 localStorage 随机 UUID（`wuxu_vid`，365 天，每 30 天续期）⇒ 换设备/清缓存算新读者，「读者」也是**下界**。被拒**一律 204**（故意不用 403，不给爬虫确认信号），原因计数进 `hit_reject(day,reason,n)`：`nostats/bot/rate/body/vid/path/notcontent/weak/dup/error`；`rate` 回 429（进程内 Map 令牌桶 60 次/分，跨 isolate 会漏，真正兜底是 PK）。`reads` **不删**（已是去重行、一年千行级），只按 90 天清 `hit_reject`（`pruneOldRejects()`，约每 500 次计数顺手跑，D1 无 cron）。编委 CSV：`GET /api/stats?csv=1&days=90`（或 `from`/`to`），表头 `日期,到达（内容页）,有效阅读,读者（去重）`，带 BOM，仅编委。
    - **三层口径别混**：**到达**（服务端见的页面请求次数，不依赖 JS，分母/上界）→ **有效阅读**（够门槛，依赖 JS，下界）→ **读者**（有效阅读里跨天去重的人 ⇒ **只有它能回答"多少人"**）。界面主数字只显示「有效阅读 N · 读者 M」；到达/页面打开只写进悬停 `title` 与诊断接口，含机器与预览，只作分母。健康度 `有效/到达` 正常 **25%–45%**（≈100% 说明有会跑 JS 的呆爬虫；<5% 查 beacon 404/CSP/门槛）。
   - **机器识别（2026-11 加强）**：UA 名单补入 ChatGPT-User / Claude-User / Playwright / Puppeteer 等（`bot` 改词尾匹配，CUBOT 机型不再误伤）；`isSuspect()` 新增「机房 ASN + 无 Sec-Fetch」判疑机（`request.cf.asn/asOrganization`，只对缺强浏览器信号的请求生效，避免误伤 VPN/云桌面里的真人）。历史行仍无法追溯重标。
    - **结构性限制**：`visitor = sha256(day|ip|ua|salt)`，同一天换网络算 2 人、同一 NAT 后同 UA 的多人算 1 人；`day` 参与哈希 ⇒ **"独立访客总数"在这套设计下永远算不出来**，只能给"人次"。UI 文案一律用"人次"。
    - **作品页只报本篇 / 首页一行全站数字（2026-10-15，2026-11 统一口径）**：跨页的全站数字从作品页**移出** —— 作品页只剩「本篇有效阅读 N · 读者 M【疑机 N】」（仅编委可见；没有 beacon 数据时显示 0，不再退回到达）；全站数字在首页 Hero 里、社名标语与社名 `<h1>` 之间，一行小字「网站累计有效阅读 N · 读者 M」，**同样仅编委可见**，数据走已有的 `GET /api/stats?derived=1`（取 `reads.total`/`reads.readers`；没有就整行隐藏），由 `src/static/auth.js` 统一判定编委后填入。
      **曾走过一次弯路**：先做成公开接口 `functions/api/site-stats.js` + 首页给所有人看，随后**删除** —— "访客/人次"在公开场合站不住（指纹按天更换 ⇒ 算不出"多少人"；改版前历史行没有机器标记 ⇒ 只能是上界；只公开"阅读次数"又会让人读成"多少人读过"）。现在**不再对外暴露任何统计接口**。
      顺带把 `derived` 改成**按需**（`&diagnose=1` / `&derived=1`）—— 作品页不再需要它，就不必每次打开都跑一遍全表去重。
      **CSS 教训**：那行曾放在 `.motto` 里当 `<p>`，被 `.motto p{font-size:clamp(1.7rem,4vw,2.7rem);font-weight:700}` 盖成 43px 粗体（比社训还大）。**父级有泛型标签选择器时，局部类选择器会被压过去。** 现用 `.hero-copy .site-stats` 兜底，`test-frontend.js` 有两条断言守着。
4. **D1 / 函数现状**
   - D1 数据库名 `wuxu-database`；四表已建；词表 94 词已落库并完成历史写法归并；D1 绑定 `DB` ✅ 已配置（`/api/tags`、`/api/related` 线上可用）
   - env：`GITHUB_TOKEN_SUBMIT`（Secret，需 Contents: Read and write；若 403 换 classic `repo` token）；`ZHUI_ADMIN_KEY` 为编委旧钥匙（账号化后仅过渡期使用）
   - 函数必须 **ESM 导出**（`export async function onRequest/onRequestPost`），CommonJS 的 `module.exports` 会导致路由 404
5. **账号化 P1 上线记录（2026-09 已完成，步骤留档）—— 逐条照 `docs/账号系统上线清单.md` 做**
   1. 备份 ✅ `sql/backup/2026-09-11-众注数据快照.json`
   2. **部署代码**：push → CF 部署（此后打标签/评论需登录；⚠️ 服务端与前端必须**一起**推，只推一半会让众注不可用）
      - **建表不用手工**：`auth.js` 首次用到账号时自动建 `users`/`sessions`/`comments.user_id`（幂等；排错时仍可粘 `sql/accounts/01…04`）
   3. 开第一个编委号：`python scripts/zhuzhu-admin.py open jwl --role 编委 --key <旧钥匙>`
   4. 洗牌：`python scripts/zhuzhu-admin.py wipe --key <旧钥匙>`（等价于 `sql/curation/05…08`；**94 词词表保留**）
   5. 验收：`sql/curation/09` 或洗牌命令的返回（票 0 / 同感 0 / 评论 0 / 词条 94）+ 按《账号系统方案.md》第九节逐条走
   - `scripts/zhuzhu-admin.py` 的四个动作：`open` / `pending` / `confirm` / `role` / `wipe`（**自动从名册取笔名，不用在命令行敲中文**）

## 四、协作分工

- 同学（前端/后端主力）：负责 11ty 结构与函数实现
- 站长（YUUUU-Li）：负责 GitHub/Cloudflare/域名（wuxu.org，DNS 在 Cloudflare）、发布与验收
- Agent：改文件、写 SQL、调排序、算关联、写文档；**不代持凭据、不代点 Push**

## 五、域名与历史

- 自定义域名 `wuxu.org`（Cloudflare DNS，Full 模式）；`www.wuxu.org` 与 `wuxu-society.pages.dev` 作为备用入口；Netlify 旧站已退役
- 旧版静态站（43 篇独立页 + `_fulltext.html` + `data-works.json`）在旧工作区 `taste-skill-main\wuxu-society-old`，仅作内容参考

## 六、验收方式

1. `npm test`（若有 Node 环境）或看 Cloudflare 部署日志
2. 线上检查：首页 / 作品库排序 / 作品详情标签与关联 / `/api/tags?work=w-feng` 返回 JSON
3. 每次改动让站长 Push 后由 Agent 远程核对
