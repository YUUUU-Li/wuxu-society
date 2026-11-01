# proto-ui/fonts

这些文件只服务 `proto-ui/` 的试版，不参与正式构建。**字体二进制不随仓库提交**，下表是本机试版时生成的文件；需要复现时按文末命令重新生成。

| 文件 | 用途 | 来源 / 授权 |
| --- | --- | --- |
| `ChillJinshuSongTextRegular-subset.woff2` | 主题板正文（GB2312 常用字子集） | [寒蝉锦书宋](https://github.com/Warren2060/ChillJinshuSong)，SIL OFL 1.1 |
| `ChillJinshuSongTextMedium-subset.woff2` | 试版对比用 Medium | 同上 |
| `ChillJinshuSongTextRegular-work.woff2` | 单页作品试色，按该页字符生成 | 同上 |
| `ChillJinshuSongBold-work.woff2` | 单页标题 700 | 同上 |
| `Huiwen-Mincho-work.woff2` | 全汇文明朝体旧版试版（7,468 cmap） | [汇文明朝体](https://github.com/bkbk258/front-Huiwen-Mincho)，免费商用（自定义许可，正式使用前核对） |
| `Huiwen-MinchoGBK-work.woff2` | 汇文明朝体 GBK v1.000（24,356 cmap） | 作者 TerryWang；免费商用，禁止转售字体文件 |
| `KingHwaOldSong-work.woff2` | 京华老宋体 v2.002（38,627 cmap） | 作者特里王；免费商用，禁止转售字体文件 |
| `OFL-ChillJinshuSong.txt` | 授权全文 | SIL OFL 1.1 |

- 子集用 `fontTools.subset` 生成（`--flavor=woff2 --with-zopfli`）。
- **作品页子集不能只扫静态 HTML**：登录/注册弹窗、评论、标签提示是 `auth.js` / `zhuzhu.js` 运行时注入的。只按 HTML 生成会让弹窗里的“昵称 / 口令 / 社员建议用笔名”等字回退到 Noto。当前 `*-work.woff2` 已把静态页 + 前端脚本 + 接口提示语一起纳入字符集。
- 正式站不要直接引用这些文件；应按页面实际字符集在构建时生成子集，或改为按 `unicode-range` 分片。
- 霞鹜新致宋只在本地做过对比，字体文件未放入仓库；对比截图见 `../font-test-all.png`。它为 IPA 1.0，网页嵌入有额外合规义务。
- 覆盖率（按 `cmap` 与通用规范汉字表/GBK 实测）：汇文明朝体 GBK 24,356 cmap，通用规范 7,908/8,105（97.6%），GBK 21,516/21,791（98.7%）；京华老宋体 38,627 cmap，通用规范 8,105/8,105（100%），GBK 21,672/21,791（99.5%）；寒蝉锦书宋 30,740 cmap，通用规范与 GBK 均 100%。
- 汇文/京华都是自有授权，不是 OFL；网页子集化属于修改/再分发前，正式上线前最好向作者确认。寒蝉锦书宋是 OFL，做网页子集最省事。
- 选型：**要最接近汇文旧铅字质感 → 汇文明朝体 GBK**；**要同气质且 100% 覆盖通用规范、字形更规整 → 京华老宋体**；**要 OFL、可自由子集 → 寒蝉锦书宋**。纳米老宋是汇文的补字字体（主要覆盖扩展区），不能单独做正文。
- 标题与英文/数字仍走 Noto Serif SC / IBM Plex Sans / Fraunces；主题板通过 fonts.loli.net 与 jsDelivr 加载，正式站需自托管。
