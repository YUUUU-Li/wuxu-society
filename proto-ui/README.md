# proto-ui · UI 重构样张

> 这是设计样张，**不参与 Eleventy 构建、不进正式站导航**。确认方向后可整体删除。

## 怎么看

在仓库根目录起一个静态服务（file:// 也能看，但建议用 http）：

```bash
python -m http.server 8140
```

然后打开：

- 单品预览：<http://127.0.0.1:8140/proto-ui/>
- A / E 并排：<http://127.0.0.1:8140/proto-ui/compare.html>
- **主题板**：<http://127.0.0.1:8140/proto-ui/theme.html>
- **宋体试版**：<http://127.0.0.1:8140/proto-ui/font-test.html>
- **真实作品页试色**：
  - 原站：<http://127.0.0.1:8140/proto-ui/work-current.html>
  - 青瓷 v4：<http://127.0.0.1:8140/proto-ui/work-v4.html>
  - 全锦书宋（字号放大）：<http://127.0.0.1:8140/proto-ui/work-chill.html>
  - 全汇文明朝体（旧 7,468 字版）：<http://127.0.0.1:8140/proto-ui/work-huiwen.html>
  - 全汇文明朝体 GBK（23,655 字形）：<http://127.0.0.1:8140/proto-ui/work-huiwen-gbk.html>
  - 全京华老宋体（45,780 字形）：<http://127.0.0.1:8140/proto-ui/work-jinghua.html>
  - 京华最终截屏：<http://127.0.0.1:8140/proto-ui/work-jinghua-final.png>
  - 京华“同作者”行特写：<http://127.0.0.1:8140/proto-ui/work-jinghua-rel.png>
  - 京华页脚间距：<http://127.0.0.1:8140/proto-ui/work-jinghua-footer.png>
  - 三页并排：<http://127.0.0.1:8140/proto-ui/work-font-compare-3.png>

京华页是当前采用方向：正文 22px、诗行 24px、关联列表 19.5px，标题保持 3.8rem；“同作者 / 共 11 篇 / 换一批”这一行统一到 17px，不再继承 `.cnt` 的 0.8em 小字；页脚链接行距 2、列表 gap 5px、列表项 19px，比原稿略窄但不挤。

作品页试色只叠了 `work-v4.css`（颜色 / 字体 / 圆角 / 阴影 / 按压），没有改 logo、导航、正文与关联的布局。字体试版页再叠加 `work-type.css`（共用字号：正文 20px、诗行 22px、标题最大 3.8rem）与各自的字体覆盖：锦书宋用 400/700，汇文与京华只用 400。汇文两页再叠 `work-huiwen-size.css`，桌面端再大一档（正文 22px、诗行 24px）；手机端保持共用字号，避免断行。众注区在静态预览下没有 `/api`，会自动收起。

主题板只做“纸 / 墨 / 印 / 副色 / 字体 / 组件 / 材质”，不改页面布局：

- **青瓷·雨过**（主主题，v2：纸 `#F1F0E8`；行动色 `#2E4641`（墨青）；朱砂 `#9C4A3A` 只做印）
- **朱墨·双色**（期页 / 专题）
- **松烟·夜读**（深色模式）
- **藕荷·词笺**（春季 / 柔性）
- **海派·墨金**（特刊 / 周年）

字体已补**六级字阶**（Display / H1 / H2 / Body / Small / Meta）；组件已补**状态矩阵 v1**（按钮、输入、标签、链接的默认/hover/focus/active/disabled/loading/error）；另加**基础检查**（色彩比例 / 字阶 / 8pt 间距 / 圆角层级）与**动效映射**（按 StyleKit `/animations` 选用的 11 个模式）。

**素材组件**按 StyleKit 的 Editorial / Ink Wash / Wabi-Sabi / Japanese Fresh 配方改写成原生 CSS；标题用 Noto Serif SC，正文用寒蝉锦书宋 Text Regular（OFL 1.1，横画更实，适合 Windows 屏幕），楷体用 LXGW WenKai，元信息用 Noto Sans SC / IBM Plex Sans，数字与英文用 Fraunces。主题板走 fonts.loli.net / jsDelivr 镜像，正文与试版字体为本地子集；正式站需改为按页面字符集生成的自托管子集。

组件层次：卡片/按钮用 1px 纸边 + 短阴影浮起；按钮文字 14px / 最小高度 44px；标签 pill；弹簧借 open-claude-ui / CDS 的 `.cds-btn-squish`（0.975 按下、15 阶 `linear()` 450ms 回位），阴影借 CDS 的分层 shadow-sm/md/lg。

顶部可切主题、明暗；也支持直接带参数打开：

```text
theme.html?theme=celadon&mode=light
theme.html?theme=vermilion&mode=light
theme.html?theme=pine&mode=dark
theme.html?theme=lotus&mode=light
theme.html?theme=deco&mode=light
```

顶部可切换：

- **A 社刊** / **E 留白**：两套视觉方向；
- **首页 / 作品页 / 作品库 / 反馈**：四个画面；
- **夜**：深浅色；
- **并排对比**：两套同屏。

## 看什么

1. **首页 Hero**：主标题、社训、首屏信息密度；
2. **作品页**：正文行宽、题记/自注、标签、评论与关联；
3. **作品库**：筛选条、行版式、空状态、手机宽度；
4. **反馈**：登录/注册弹窗、标签投票、投稿提交、评论、Toast、复制。

## 说明

- 数据取自仓库真实作品（题名/作者/正文/标签）；
- 登录、投稿、评论均为前端模拟，不发请求；
- 所有动效尊重 `prefers-reduced-motion`；
- 手机可看，建议再用 375 / 390 / 768 三档检查。
