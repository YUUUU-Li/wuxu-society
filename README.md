# 婺需文学社 · 网站源码 (Eleventy 静态站)

以诗会友，以文养心。公开站点：<https://wuxu-literary.netlify.app>

## 这是什么结构

```
仓库根 = 站点根（git 在此）
├─ src/                       # ★ 唯一需要手写的源码
│  ├─ works/*.md              # 每篇作品一个文件: YAML 元数据 + 正文片段（新增/改字都在这里）
│  ├─ index.njk               # 首页
│  ├─ members.njk             # 社员大全（由 src/_data/members.json 自动生成列表）
│  ├─ library.njk             # 作品库（由分组数据 + works 自动生成）
│  ├─ submit.njk              # 投稿页（表单 → 投稿函数自动开 PR）
│  ├─ _fulltext.njk           # 全文源库（构建时自动汇齐全部 43 篇正文）
│  ├─ _data/                  # groups.json 分组顺序 / members.json 社员档案 / site.json
│  ├─ _includes/              # 全站唯一的 head / 导航 / 页脚 / 作品页模板
│  └─ static/                 # site.css / site.js / 图标（原样复制进产物）
├─ dist/                      # 构建产物（git 忽略，Netlify 发布此目录）
├─ docs/作品上传指南.md        # ★ 给社员的投稿图文教程（clone/Obsidian 写作/Git/上线）
├─ docs/投稿功能方案.md        # ★ 网页投稿功能设计（表单→PR→预览审核→一键发布，代码已就绪）
├─ docs/修改网站速查.md        # ★ 维护者 Git 速查（clone→分支→提交→合并→推送→反悔药）
├─ docs/网站精进方案.md        # ★ 精进路线（关联轮换/筛选/评论系统/刊期概念化，P0-P2）
├─ docs/域名接入指南.md        # ★ 自有域名接入（Spaceship 买 → Cloudflare → Netlify，含 IP 优选）
├─ docs/网站自定义指南.md      # ★ 全站可自定义点地图（内容/样式/结构/功能/部署，去哪改）
├─ docs/刊期概念化方案.md      # ★ P2 草案: 投稿攒期 + 概念化关联（数据结构/三步落地/待拍板）
├─ netlify/functions/submit.js # 投稿接口: 表单→自动开 PR（需 GITHUB_TOKEN_SUBMIT 环境变量）
├─ scripts/migrate_extract.py # 一次性迁移脚本（旧站 → src/works），仅存档参考
├─ .eleventy.js / package.json
└─ netlify.toml
```

**不再手写的东西**：46 份重复的 `<head>`/导航/页脚、作品库列表、社员列表、全文源库——全部由 Eleventy 从数据自动生成。改一处导航，全站生效。

## 日常操作（给社员）

前置：装 [Node.js](https://nodejs.org) 后首次运行 `npm install`。

| 想做什么 | 怎么做 |
|---|---|
| 第一次接触 / 想投稿 | 先读 **[作品上传指南](docs/作品上传指南.md)**：clone → Obsidian 写作 → 提交推送，全程图解 |
| 改已有作品的字 | 编辑 `src/works/对应篇.md` 的正文片段（`<p>` 每段一段，改字只动这里） |
| 新增一篇作品 | ① 复制 `src/works/w-feng.md` 为 `src/works/新名字.md`，改 front matter（`title/author/genre/imageries/source`，唱和类再加 `related`）与正文；② 把文件名加进 `src/_data/groups.json` 相应分组的 `slugs`；③ 新社员需先在 `src/_data/members.json` 建档。关联自动生成，无需手填 |
| 改导航/页脚/字体 | 只改 `src/_includes/` 下对应文件 |
| 重新生成全站 | `npm run build`（产物在 `dist/`） |
| 本地预览 | `npm run serve`，浏览器开 <http://localhost:8080> |

作品页 `front matter` 只需这几项（其余全由构建器推导：页面路径=文件名、SEO 标题/描述、分部、署名缩写、关联作品）：

| 字段 | 含义 | 是否必填 |
|---|---|---|
| `title` | 题名 | 必填 |
| `author` | 署名（姓名缩写（笔名），如 `ylj（济枫）`） | 必填 |
| `genre` | 体裁（如 七律 / 词 / 散文） | 必填 |
| `imageries` | 意象标签列表，如 `["雨", "清明"]` | 推荐（自动关联用） |
| `source` | 出处/系列（如 甲辰清明首聚）→ 自动生成"同时同源" | 可选 |
| `related` | 唱和/组诗等**人工关系**（`to` + 一句 `label`）；同作者/同意象/同时同源**不需要填**，构建时自动计算 | 可选 |
| `fgenre` | 全文源库里展示的体裁（极少数需要，如"词 · 附赏析"） | 可选 |

正文片段放在 `---` 之后：`<p class="prose">` 散文、`stanza` 诗句（行间用 `<br />`）、`analysis` 赏析、`byline` 落款、`stanza kaiti` 楷体诗句，每段一个 `<p>`，改字只动这里。

新增一篇作品 = 复制任意一篇 `src/works/*.md` 改内容 → 把文件名（不含 `.md`）加进 `src/_data/groups.json` 对应分组的 `slugs` → `npm run build`。同作者/同意象/同时同源关联会**自动出现在所有相关页面**，无需手工维护。

## 发布

- Netlify 构建配置见 `netlify.toml`（命令 `npm run build`，发布目录 `dist/`）；GitHub 推送即自动部署。仓库根即站点根，无需填 base directory。

## 设计规范

沿用 taste-skill（design-taste-frontend）：微青纸色 + 墨色 + 朱砂单强调、全直角、单主题浅色。样式改动请保持一致；字体栈已含系统回退（Noto Serif SC → Songti SC/SimSun）。

## 迁移记录（2026-09）

旧站为 46 个手工 HTML（每个页面重复头部/页脚，正文存在 `_fulltext.html` 与页面两份且**缺清明 7 篇**）。现已整体迁移：正文统一收进 `src/works/*.md`（43/43 篇齐全），页面由模板生成，并与旧页面逐页比对一致后移除旧文件。历史内容如需找回可用 `git log`。

## 版权

本仓库内文字作品版权归各原作者（署名格式：姓名拼音缩写 + 笔名）。引用请注明出处。


## 版权与许可

仓库采用**双重许可**（详见根目录两个文件）：

- **代码/模板/样式**（.eleventy.js、模板、site.css/js、投稿函数等）→ LICENSE-CODE 文件（MIT）
- **原创作品与文字内容**（诗词、散文、档案、文档正文）→ LICENSE 文件（CC BY-NC-ND 4.0：署名 · 非商用 · 禁止演绎）；每篇作品著作权归作者本人

转载本站内容请注明「婺需文学社」及作者，非商用；商用或演绎请联系社长。
