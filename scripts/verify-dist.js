// 站点产物断言: node scripts/verify-dist.js (先 npm run build)
// 对 dist/ 做全站结构性回归, 防模板/登记表/CSS 改坏
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const D = path.join(__dirname, "..", "dist");
const siteUrl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/site.json"), "utf8")).url;
const read = (f) => fs.readFileSync(path.join(D, f), "utf8");
const exists = (f) => fs.existsSync(path.join(D, f));
const files = fs.readdirSync(D);

// —— 产物数量与泄漏(以 src 数据源推导, 投稿合入/封期自动跟随) ——
const htmls = files.filter((f) => f.endsWith(".html"));
const nWorksSrc = fs.readdirSync(path.join(__dirname, "..", "src/works")).filter((f) => f.endsWith(".md")).length;
const nIssuesSrc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/issues.json"), "utf8")).length;
const expectHtml = 6 + nWorksSrc + nIssuesSrc + (files.includes("proto-note.html") ? 1 : 0); // 6 基础页+作品+期页+原型
assert.strictEqual(htmls.length, expectHtml, `应 ${expectHtml} html(基础6+作品${nWorksSrc}+期${nIssuesSrc}+原型1), 实得 ${htmls.length}`);
for (const f of htmls) {
  const s = read(f);
  assert(!s.includes("{{") && !s.includes("{%"), `模板泄漏: ${f}`);
}

const home = read("index.html");
const css = read("site.css");
const lib = read("library.html");

// —— 页脚合并行 + 旧尾巴清除 + 许可证随站 ——
assert(home.includes('class="foot-note"') && home.includes("© 2024–2026 婺需文学社"), "页脚合并行含 ©");
assert(!home.includes("taste-skill") && !home.includes("站点构建器依"), "机器尾巴已清除");
for (const f of ["LICENSE.txt", "LICENSE-CODE.txt", "_headers"]) assert(exists(f), `${f} 缺失`);
for (const f of ["LICENSE.txt", "LICENSE-CODE.txt"]) {
  const b = fs.readFileSync(path.join(D, f));
  assert(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, `${f} 缺 UTF-8 BOM`);
}

// —— 首页结构 ——
assert(home.includes('<p class="motto-lines"><span>“文章千古事，</span><span>得失寸心知。”</span></p>'), "社训自适应结构");
assert(home.includes("hero-qingming.jpg") && !/<img[^>]+src="https?:\/\/picsum/.test(home), "hero 本地图");
assert(home.includes('id="home-picks"') && home.includes('id="home-pool"'), "随机拾读区");
assert(home.includes('id="wechat"') && home.includes("wechat-qr.jpg") && home.includes("婺需文学社"), "公众号名片区(二维码+名称)");
assert(home.includes('class="brand-logo"') && home.includes('src="logo.png"'), "顶栏品牌 logo");
assert(home.includes('id="theme-toggle"') && home.includes("prefers-color-scheme"), "深色模式开关与首屏主题初始化");
assert(home.includes("M20.5 14.6A8.6") && home.includes("site.css?v="), "月亮图标按钮 + 静态资源版本号");
assert(read("submit.html").includes("分割线") && read("submit.html").includes("楷体文段"), "投稿页格式提示含行首标记说明");
assert(read("submit.html").includes('id="sub-sample"') && read("submit.html").includes('id="sub-preview"') && read("submit.html").includes("/api/preview"), "投稿页含示例按钮与左写右预览");
// —— 创作时间排序: 库池顺序 = created 升序(未填者继承前一篇) ——
const regOrder = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/fulltext_order.json"), "utf8"));
const createdOf = {};
for (const f of fs.readdirSync(path.join(__dirname, "..", "src/works"))) {
  if (!f.endsWith(".md")) continue;
  const m = /^created:\s*"([^"]*)"/m.exec(fs.readFileSync(path.join(__dirname, "..", "src/works", f), "utf8"));
  if (m) createdOf[f.slice(0, -3)] = m[1];
}
{
  let carry = "";
  const key = {};
  for (const s of regOrder) { if (createdOf[s]) carry = createdOf[s]; key[s] = carry; }
  const expected = regOrder.map((s, i) => ({ s, i }))
    .sort((a, b) => String(key[a.s] || "").localeCompare(String(key[b.s] || "")) || a.i - b.i)
    .map((x) => x.s);
  const actual = JSON.parse(/id="lib-pool">([\s\S]*?)<\/script>/.exec(read("library.html"))[1].trim())
    .map((w) => w.h.replace(/^\//, "").replace(/\.html$/, ""));
  assert.deepStrictEqual(actual, expected, "作品库顺序应按创作时间升序");
  assert(regOrder.some((s) => createdOf[s]), "至少应有作品填了 created(回填后排序才生效)");
}
assert(read("submit.html").includes('type="month"') && !read("submit.html").includes('name="slug"'), "投稿页含创作时间、已去掉手填标识名");
assert(css.includes(".lib-body hr.rule") && css.includes(".lib-body blockquote.quote"), "正文分割线/引文块样式");
assert(css.includes('[data-theme="dark"]') && css.includes("invert(1) brightness(1.02)") && css.includes("--nav-bg"), "深色变量/logo 反白/顶栏深色");
assert(exists("logo.png"), "logo.png 随站发布");
assert(home.includes("微信扫一扫关注"), "公众号引导语");
assert.strictEqual((home.match(/愿旧诗与新声都有人听/g) || []).length, 1, "社训句全页只保留一处(公众号简介)");
// 旧托管平台(已弃用)的引用应彻底消失; 用拼接避免本文件自身命中关键词
const OLD_HOST = "net" + "lify";
assert(home.includes('id="join-form"') && !new RegExp("data-" + OLD_HOST, "i").test(home), "入社表单已改走本站接口");
assert(home.includes('name="region"') && home.includes("branch-list"), "入社表单含地区字段(带分部候选)");
assert(home.includes("/api/join"), "入社表单指向 CF 函数");
assert(!new RegExp(OLD_HOST, "i").test(home) && !read("site.js").toLowerCase().includes(OLD_HOST), "站内无旧托管平台残留引用");
const pool = JSON.parse(/<script type="application\/json" id="home-pool">(.*?)<\/script>/.exec(home)[1]);
assert(pool.length >= 36, `拾读池应 ≥36, 实得 ${pool.length}`);
assert.strictEqual(new Set(pool.map((c) => c.href)).size, pool.length, "拾读池无重复作品");
const wy = pool.find((c) => c.href.includes("wenyib"));
assert(wy && wy.line.startsWith("这是我第几次为你扫墓"), `行号跳过失效: ${wy && wy.line}`);

// —— CSS 关键规则 ——
const flat = css.replace(/\n/g, "");
assert(flat.includes('.duo-acts{display:flex;justify-content:center') && flat.includes("max-width:560px"), "双按钮桌面居中横排");
assert(/@media \(max-width:640px\)\{[^}]*\.duo-acts\{flex-direction:column/.test(flat), "双按钮手机竖排");
assert(flat.includes(".foot-note{margin-top:26px") && flat.includes("font-size:12px"), "页脚小字规则");
assert(flat.includes('.nav.open .nav-links{display:flex') && flat.includes(".nav-toggle{display:none"), "汉堡菜单");
assert(flat.includes("grid-template-columns:minmax(0,1fr) auto auto"), "作品库行弹性列");

// —— 作品库行数(与 groups.json other 对齐, 投稿合入自动跟随) + 筛选 ——
const rows = [...lib.matchAll(/class="idx-row rv" data-author="([^"]*)" data-genre="([^"]*)" data-imagery="([^"]*)" data-source="([^"]*)"/g)];
const othersN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/groups.json"), "utf8")).find((g) => g.key === "other").slugs.length;
assert.strictEqual(rows.length, othersN, `库分组行应 ${othersN}(其余社员作品), 实得 ${rows.length}`);
assert(rows.every((r) => r[1] && r[2]), "行缺作者/体裁");

// —— 筛选平铺池(含入期作品, 筛选激活时替代分区视图) ——
const poolM = /id="lib-pool">([\s\S]*?)<\/script>/.exec(lib);
assert(poolM, "库页含 lib-pool 全站作品池");
const libPool = JSON.parse(poolM[1].trim());
assert.strictEqual(libPool.length, nWorksSrc, `lib-pool 应含全部 ${nWorksSrc} 篇(含入期)`);
assert(lib.includes('id="idx-flat"'), "库页含平铺结果容器");
assert(libPool.every((w) => w.t && w.a && w.g && w.h), "池条目字段完整");

// —— 登记一致性: works md = groups∪issues 各一次, order 同集合 (删稿脚本防孤儿) ——
const workSet = new Set(fs.readdirSync(path.join(__dirname, "..", "src/works")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
const counts = new Map();
const bump = (arr) => arr.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1));
const issuesData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/issues.json"), "utf8"));
bump(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/groups.json"), "utf8")).find((g) => g.key === "other").slugs);
issuesData.forEach((i) => bump(i.slugs));
const dupes = [...counts].filter(([, c]) => c > 1).map(([s]) => s);
assert.strictEqual(dupes.length, 0, `slug 重复登记: ${dupes.join(", ")}`);
assert.strictEqual(counts.size, workSet.size, `登记表 ${counts.size} 个 slug vs works ${workSet.size} 个文件`);
for (const s of workSet) assert(counts.has(s), `孤儿(有文件未登记): ${s}`);
const orderArr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/fulltext_order.json"), "utf8"));
assert.strictEqual(orderArr.length, workSet.size, `fulltext_order ${orderArr.length} vs works ${workSet.size}`);
for (const s of orderArr) assert(workSet.has(s), `order 孤儿: ${s}`);
for (const x of ["author", "genre", "imagery", "source"]) assert(lib.includes(`id="f-${x}"`), `筛选 ${x} 缺失`);

// —— 关联轮换结构抽查 ——
const gui = read("w-guixiang.html");
const sec = /<section class="wrap rel rv">([\s\S]*?)<\/section>/.exec(gui);
assert(sec && sec[1].includes('data-rotate="5"') && sec[1].includes('template class="rel-pool"'), "轮换结构缺失");
assert(read("w-zhuyingtai.html").includes('class="foot-note"'), "新投稿页正常渲染");

// —— 站点基建: 404 / sitemap / robots ——
assert(read("404.html").includes("此页无从寻觅"), "404 页存在");
assert(exists("sitemap.xml") && read("sitemap.xml").includes(siteUrl + "/") && (read("sitemap.xml").match(/<url>/g) || []).length >= 50, "sitemap.xml 含全站 URL");
assert(exists("robots.txt") && read("robots.txt").includes("Sitemap: " + siteUrl + "/sitemap.xml"), "robots.txt 指向 sitemap");

// —— 刊期档案(P2.1) ——
assert(lib.includes("刊期档案") && lib.includes("issue-qingming-ji.html") && lib.includes("issue-2026-09.html") && lib.includes("issue-huiyi-shijianliuliu.html"), "作品库顶部刊期档案(三期)");
for (const f of ["issue-qingming-ji.html", "issue-2026-09.html", "issue-huiyi-shijianliuliu.html"]) assert(exists(f), `期页缺失 ${f}`);
assert(read("issue-qingming-ji.html").includes("甲辰清明雅集") && read("issue-qingming-ji.html").includes("清明会序"), "清明期页内容");
assert(read("issue-2026-09.html").includes("九月投稿辑") && read("issue-2026-09.html").includes("w-zhuyingtai"), "投稿辑期页内容");
assert(read("issue-huiyi-shijianliuliu.html").includes("回忆文会《时间溯流》") && read("issue-huiyi-shijianliuliu.html").includes("w-golden"), "回忆文会期页内容");
assert(read("issue-qingming-ji.html").includes("全部刊期"), "期页互链");
assert(!lib.includes("清明首聚 · 立社原创") && !lib.includes("回忆文会《时间溯流》（公众号）"), "旧分组已并入刊期档案");
const pendN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src/_data/pending_issue.json"), "utf8")).length;
assert(pendN ? lib.includes("待辑入新期") : !lib.includes("待辑入新期"), `待辑提示与 pending(${pendN}) 不一致`);

// —— 众注嵌入(P1) ——
assert(read("w-feng.html").includes('id="zhuzhu"') && read("w-feng.html").includes("zhuzhu.js"), "作品页含众注容器(默认隐藏, API 点亮)");
assert(!read("index.html").includes('id="zhuzhu"'), "首页不含众注容器");
// —— 社员大全: 每人最多 3 首作品 + 查看更多跳作品库作者筛选 ——
const mem = read("members.html");
const memCards = [...mem.matchAll(/<div class="member"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
assert(memCards.length >= 10, `社员卡片应 ≥10, 实得 ${memCards.length}`);
assert.strictEqual(memCards.filter((c) => (c.match(/>作品：/g) || []).length > 3).length, 0, "每张卡片最多列 3 首作品");
assert(mem.includes("查看更多作品") && /library\.html\?author=[^"]+/.test(mem), "含「查看更多作品」跳作品库作者筛选页");
const moreLinks = [...mem.matchAll(/href="library\.html\?author=([^"]+)"/g)].map((m) => m[1]);
assert(moreLinks.length === new Set(moreLinks).size, "查看更多链接不重复");
// 作品改为"每次打开随机抽 3 首": 页面带作品池 + 占位容器, JS 填充
const pools = JSON.parse("[" + /id="member-pools">([\s\S]*?)<\/script>/.exec(mem)[1].trim().replace(/,$/, "") + "]");
assert(pools.length >= 10, `作品池成员应 ≥10, 实得 ${pools.length}`);
assert(pools.every((p) => p.id && Array.isArray(p.items) && p.items.length >= 1), "作品池条目形状");
assert.strictEqual((mem.match(/class="m-works"/g) || []).length, memCards.length, "每张卡片都有作品占位容器");
assert(read("site.js").includes("member-pools") && read("site.js").includes(".m-works"), "site.js 负责随机填充名册作品");
// 相似标签(余弦)动态组 + 元数据资产
assert(read("w-guixiang.html").includes('id="rel-sim"'), "作品页含相似标签动态容器(有真实分组时)");
assert(read("w-guixiang.html").includes('id="zz-admin-btn"'), "众注含编委模式入口");
assert(read("site.js").includes("zz_key") === false && read("zhuzhu.js").includes('id="zz-admin-btn"') === false && read("zhuzhu.js").includes("zz_key"), "编委钥匙仅存 sessionStorage");
assert(read("w-guixiang.html").includes("相关联作品"), "关联区仍在");
const relMeta = JSON.parse(read("rel-meta.json"));
assert.strictEqual(Object.keys(relMeta).length, nWorksSrc, `rel-meta.json 应含 ${nWorksSrc} 篇`);
assert(relMeta["w-feng"] && Array.isArray(relMeta["w-feng"].imageries), "rel-meta 含意象字段");
assert(!read("w-guixiang.html").includes(">同意象<"), "旧同意象静态组已移除(相似标签改动态)");

// —— 概念卡(P2.3) ——
assert(exists("proto-note.html") && read("proto-note.html").includes("众注 · 版式演示"), "众注版式原型页(设计稿)");
assert(exists("concepts/qingming.html") && exists("concepts/lishe.html"), "概念页生成");
const cq = read("concepts/qingming.html");
assert(cq.includes("清明") && cq.includes("收录篇目") && cq.includes("清明会序"), "清明概念页含收录作品");
assert(!cq.includes("待补") && !cq.includes("虚位"), "题解留空不显示占位文字");
assert(read("issue-qingming-ji.html").includes('concepts/qingming.html'), "期页概念链接");
assert(read("qingming-xu.html").includes("本期概念") && read("qingming-xu.html").includes('concepts/lishe.html'), "作品页本期概念入口");
assert(!read("w-feng.html").includes("本期概念"), "未入期作品无概念入口");

// —— 投稿页字段 ——
const sub = read("submit.html");
for (const x of ['id="sub-created"', 'id="sub-excerpt"', 'id="sub-note"', 'id="sub-imagery"', 'name="website"', '"/api/submit"']) {
  assert(sub.includes(x), `投稿页缺 ${x}`);
}

console.log(`\n✅ verify-dist.js 全部通过 (${htmls.length} 页 / 拾读池 ${pool.length} / 库 ${rows.length} 行)`);
