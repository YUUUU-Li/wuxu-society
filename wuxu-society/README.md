# 婺需文学社 · 官方网站

以诗会友，以文养心。本仓库为婺需文学社官网的全部源码（静态站点），公开主页：<https://wuxu-literary.netlify.app>

## 目录说明

| 内容 | 说明 |
|---|---|
| `index.html` | 首页（缘起 / 雅集档案 / 同题作品 / 邀君入社） |
| `members.html` | 社员大全（各分部 + 笔名 + 作品索引） |
| `library.html` | 作品库目录（每篇作品一个独立页） |
| `qingming-*.html` | 清明首聚 7 篇作品页 |
| `w-*.html` | 其余 36 篇作品页（词、诗、散文、小说） |
| `site.css` / `site.js` | 全站共享样式与脚本（含站点图标注入） |
| `favicon.png` | 站点图标（浏览器标签页） |
| `_fulltext.html` | **全文源库**：所有作品的正文都收在这里，新增/改字先改这里 |
| `data-works.json` | **作品元数据**：作者、笔名、意象、时间归属（用于自动生成关联） |
| `deploy-kit/`（仓库外） | 本地预览与临时分享工具（见下） |

## 设计规范

页面由 taste-skill（design-taste-frontend）规范生成：微青纸色 + 墨色 + 朱砂单强调、全直角、单主题浅色。风格改动请保持一致。

## 如何本地预览

```
python -m http.server 8000 --directory .     # 然后浏览器打开 http://127.0.0.1:8000
```

## 如何修改内容（重要）

- **改已有文字/图片**：优先改 `_fulltext.html` 里对应篇目（这是正文唯一事实源），然后重新生成作品页；
- **新增一篇作品**：在 `_fulltext.html` 增加一个条目 + 在 `data-works.json` 增加一条元数据，再重新生成；
- **作品页 `w-*.html` / `qingming-*.html` 属于生成产物**：直接手改它们可以，但下次重新生成会被覆盖；
- 重生成与关联计算可由 DeepSeek Harness 协助完成（打开本文件夹后直接吩咐即可）。

## 发布

- 当前托管于 Netlify：<https://wuxu-literary.netlify.app>
- 已与 GitHub 连接后可实现"推送即自动部署"；
- 备用：`deploy-kit/1-start-server.cmd` + `2-start-tunnel.cmd`（临时公网分享，无需账号）。

## 协作流程（给成员）

```
git clone <本仓库地址>
# 编辑本地文件...
git add .
git commit -m "本次改动说明"
git push
git pull     # 动手前先拉取最新版，减少冲突
```

## 版权

本仓库内文字作品版权归各原作者（署名格式：姓名拼音缩写 + 笔名）。引用请注明出处。
