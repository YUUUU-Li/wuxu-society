# 婺需文学社 · 网站源码 (Eleventy 静态站)

以诗会友，以文养心。公开站点：<https://wuxu-literary.netlify.app>

## 这是什么结构

```
wuxu-society/                 # 仓库根（git 在此）
├─ src/                       # ★ 唯一需要手写的源码
│  ├─ works/*.md              # 每篇作品一个文件: YAML 元数据 + 正文片段（新增/改字都在这里）
│  ├─ index.njk               # 首页
│  ├─ members.njk             # 社员大全（由 src/_data/members.json 自动生成列表）
│  ├─ library.njk             # 作品库（由分组数据 + works 自动生成）
│  ├─ _fulltext.njk           # 全文源库（构建时自动汇齐全部 43 篇正文）
│  ├─ _data/                  # groups.json 分组顺序 / members.json 社员档案 / site.json
│  ├─ _includes/              # 全站唯一的 head / 导航 / 页脚 / 作品页模板
│  └─ static/                 # site.css / site.js / 图标（原样复制进产物）
├─ dist/                      # 构建产物（git 忽略，Netlify 发布此目录）
├─ scripts/migrate_extract.py # 一次性迁移脚本（旧站 → src/works），仅存档参考
├─ .eleventy.js / package.json
└─ netlify.toml
```

**不再手写的东西**：46 份重复的 `<head>`/导航/页脚、作品库列表、社员列表、全文源库——全部由 Eleventy 从数据自动生成。改一处导航，全站生效。

## 日常操作（给社员）

前置：装 [Node.js](https://nodejs.org) 后首次运行 `npm install`。

| 想做什么 | 怎么做 |
|---|---|
| 改已有作品的字 | 编辑 `src/works/对应篇.md` 的正文片段（`<p>` 每段一段，改字只动这里） |
| 新增一篇作品 | ① 复制 `src/works/w-feng.md` 为 `src/works/新名字.md`，改 front matter（标题/作者/体裁/意象/关联）与正文；② 把 slug 加进 `src/_data/groups.json` 相应分组的 `slugs` 列表；③ 有需要再更新 `members.json`/首页摘句 |
| 改导航/页脚/字体 | 只改 `src/_includes/` 下对应文件 |
| 重新生成全站 | `npm run build`（产物在 `dist/`） |
| 本地预览 | `npm run serve`，浏览器开 <http://localhost:8080> |

作品页 `front matter` 字段说明：`title` 题名 / `author` 署名（含笔名）/ `ak` 姓名缩写（锚点）/ `branch` 分部 / `genre` 体裁 / `source` 出处（可选）/ `group` 所属分组 / `imageries` 意象 / `excerpt` 首页卡片摘句 / `related` 相关联作品（`cat`: `strong` 本作关联、`author` 同作者、`imagery` 同意象、`source` 同时同源）。正文片段里 `<p class="prose">` 散文、`stanza` 诗句（行间用 `<br />`）、`analysis` 赏析、`byline` 落款、`stanza kaiti` 楷体诗句。

## 发布

- Netlify 构建配置见 `netlify.toml`（命令 `npm run build`，发布目录 `dist/`）；GitHub 推送即自动部署。
- 老成员注意：仓库根在 `wuxu-society/` 这一层，连 Netlify 时 base directory 填 `wuxu-society`。

## 设计规范

沿用 taste-skill（design-taste-frontend）：微青纸色 + 墨色 + 朱砂单强调、全直角、单主题浅色。样式改动请保持一致；字体栈已含系统回退（Noto Serif SC → Songti SC/SimSun）。

## 迁移记录（2026-09）

旧站为 46 个手工 HTML（每个页面重复头部/页脚，正文存在 `_fulltext.html` 与页面两份且**缺清明 7 篇**）。现已整体迁移：正文统一收进 `src/works/*.md`（43/43 篇齐全），页面由模板生成，并与旧页面逐页比对一致后移除旧文件。历史内容如需找回可用 `git log`。

## 版权

本仓库内文字作品版权归各原作者（署名格式：姓名拼音缩写 + 笔名）。引用请注明出处。
