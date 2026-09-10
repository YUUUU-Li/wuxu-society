# PROJECT-NOTES · 婺需文学社官网（交接备忘）

> 用法：新会话里说一句「读 PROJECT-NOTES.md，按里面的任务继续」即可；本文件随仓库走，有改动请直接更新它。
> ⚠️ **仓库代码往往跑得比本文件快**：动手前先 `ls` 与 `docs/` 校对一遍；下面「三」已按当前代码校正过一次。

## 一、项目与部署现状

- **线上站点**：https://wuxu-society.pages.dev （Cloudflare Pages，Git 已连接）
- **备用旧站**：https://wuxu-literary.netlify.app （Netlify 免费额度暂停新部署，仅在线展示旧版）
- **仓库**：https://github.com/YUUUU-Li/wuxu-society （**私有**，main 为生产分支）
- **技术栈**：**11ty（Eleventy）静态生成** + Netlify/CF Functions + D1；`package.json` 中 `npm run build` = `eleventy`
- **部署流程**：本地/网页改 → push main → Cloudflare 自动构建发布（1~3 分钟）
- **改站规矩**：**push 必须由人点**（GitHub 凭据在账号持有人手里）；Agent 负责改文件、写 SQL、检查语法

## 二、目录速查（以实际仓库为准，进仓库后先 `ls` 校对）

- `src/works/*.md` —— 作品正文（每篇一个 md，含 frontmatter）
- `src/_data/groups.json` —— 作品分组/顺序（slugs 列表）
- `src/_data/members.json` —— 社员名单
- `src/_includes/` —— 布局、导航、页脚
- `functions/api/submit.js` —— 投稿（GitHub API，需 env `GITHUB_TOKEN_SUBMIT`）
- `functions/api/comments.js`、`functions/api/tags.js` —— 众注系统（评论 + 标签），依赖 D1 绑定变量名 **`DB`**
- `sql/zhuzhu.sql` —— 众注四表（tags / tag_votes / comments / comment_likes）+ 15 条起步标签
- `sql/zhuzhu-tags-v1.sql` —— 标签 v1 落库脚本（94 词 seed + 历史写法归并，幂等）；与 `src/_data/tag_outline.json` 由 `scripts/test-tags-sql.js` 保证一致
- `scripts/` —— 本地测试（`npm test` 会跑 test-submit / test-zhuzhu / verify-dist）

## 三、当前待办（三天内完成，按优先级）

1. **标签与关联系统 —— 已落地（本条的早期设计稿已被取代，一律以 `docs/标签大纲.md` 为准）**
   - 受控词表 v1 定稿 **94 词**（意象 35 / 情感 19 / 手法 29 / 题材·语境 11）；权威数据 `src/_data/tag_outline.json`，经 `npm run sync-tags` 编译进 `functions/api/tag-outline.js`（Worker 无 fs）。
   - **落库脚本已产出**：`sql/zhuzhu-tags-v1.sql`（94 词 seed + 历史写法归并，幂等，可反复跑）；也可在作品页众注区用编委入口「初始化/更新标签词表」，两者等价。
   - 与早期稿不同处（社内定论）：**不加权**（关联度用标签向量余弦，各类平权）、**不建 `tag_aliases` 吸附表**（同义由编委「合并」动作处理，票数并入）、`tags` 表**不加 `category` 列**（分类随函数下发，避免两份真相）、**每设备每篇最多赞同 3 个标签**（服务端按 IP 兜底）、手法类也开放给读者。
   - 关联输出次序：强关联（唱和/组诗，front matter `related`）→ 同作者 → 相似标签（`/api/related` 余弦，前端动态填充）→ 同时同源。
   - 已修 bug：`TAG_LEGACY` 里的 `夜景 → 夜景` 自映射会让「整理历史标签」把该词连同票一起删掉（已跳过自映射 + 加单测）。
2. **作品创作时间：字段已定，数据待补**
   - 字段就是 front matter 的 **`created`**（`YYYY-MM` / `YYYY-MM-DD`），**不是 `date`**；标签沿用 **`imageries`**（必须是大纲词），另有 `source`（出处/期）、`related`（唱和·组诗）、`excerpt`（摘句）。
   - **收集表已生成**：`docs/作品时间收集表.md`（重跑 `node scripts/work-dates-report.js` 刷新）——已填 11 篇 / 待填 38 篇，按刊期与出处分批，附干支/节令线索。
   - 已知锚点：清明首聚 7 篇 = **2024-04-04**；回忆文会《时间溯流》9 篇同批；四季组诗 4 篇（w-luochun/w-liuxia/w-liqiu/w-wangdong，作者 ylj/lfk/lys/hde）；《小重山》⇄《忆秦娥·和答蓦流〈小重山〉》是唱和（已在 `related`）。
   - 九月投稿辑两篇（`w-zhuyingtai` / `w-chenmo`）只知期时点 2026-09，**作品创作时间待作者确认**（社内已定：先不填，只在收集表里标注）。
   - 序/记/自注不设 `preface`/`note` 字段：正文楷体段 `<p class="stanza kaiti">`（投稿时行首写 `&`）承担前记/后记/序，赏析段用 `class="analysis"`；概念题解另在 `concepts.json` 的 `note`（待补）。
3. **作品库时间排序 —— 已定案并落地（缺的只是数据）**
   - 口径的单一真相在 **`scripts/work-order.js`**（`.eleventy.js` 与 `scripts/work-dates-report.js` 共用；单测 `scripts/test-work-order.js`）：`created` **升序**（早者在前），作品库/全文库/期页/关联组内同口径。**本条早期写的"倒序 + 按年分组"未采纳**（保持升序平铺 + 现有筛选）。
   - **未填者不猜日期**：一律排在已填者之后，作品库底部另立「**年份待考**」一节（标出篇数；被筛选筛空时标题自动收起）。旧口径"继承前一篇时点"已废弃——`fulltext_order.json` 开头即 2024-04-04，会把 38 篇未填作品一律算作那天（含 2026 年两篇投稿）挤作一堆。
   - 待办只剩**收集数据**：照 `docs/作品时间收集表.md` 问作者，`npm run set-created` 写入即自动归位（2026 两篇已确认先不填）。
4. **D1 / 函数现状（已完成部分）**
   - D1 数据库名 `wuxu-database`，四表已建、15 条预置标签已插入
   - 待办：Pages 项目 Settings → Functions → D1 binding，变量名必须是 `DB`
   - env：`GITHUB_TOKEN_SUBMIT`（Secret，需 Contents: Read and write；若 403 换 classic `repo` token）
   - 函数必须 **ESM 导出**（`export async function onRequest/onRequestPost`），CommonJS 的 `module.exports` 会导致路由 404

## 四、协作分工

- 同学（前端/后端主力）：负责 11ty 结构与函数实现
- 站长（YUUUU-Li）：负责 GitHub/Cloudflare/域名（wuxu.org，DNS 在 Cloudflare）、发布与验收
- Agent：改文件、写 SQL、调排序、算关联、写文档；**不代持凭据、不代点 Push**

## 五、域名与历史

- 自定义域名 `wuxu.org`（Cloudflare DNS，Full 模式）；Netlify 旧域名保留
- 旧版静态站（43 篇独立页 + `_fulltext.html` + `data-works.json`）在旧工作区 `taste-skill-main\wuxu-society-old`，仅作内容参考

## 六、验收方式

1. `npm test`（若有 Node 环境）或看 Cloudflare 部署日志
2. 线上检查：首页 / 作品库排序 / 作品详情标签与关联 / `/api/tags?work=w-feng` 返回 JSON
3. 每次改动让站长 Push 后由 Agent 远程核对
