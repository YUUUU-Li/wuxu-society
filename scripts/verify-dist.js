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

// —— 产物数量与泄漏 ——
const htmls = files.filter((f) => f.endsWith(".html"));
assert.strictEqual(htmls.length, 55, `应 55 html(51 正式+3 刊期页+1 众注原型), 实得 ${htmls.length}`);
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
assert(exists("logo.png"), "logo.png 随站发布");
assert(home.includes("微信扫一扫关注"), "公众号引导语");
assert.strictEqual((home.match(/愿旧诗与新声都有人听/g) || []).length, 1, "社训句全页只保留一处(公众号简介)");
assert(home.includes('data-netlify="true"') && home.includes('name="form-name" value="join"'), "入社表单已接 Netlify Forms");
const pool = JSON.parse(/<script type="application\/json" id="home-pool">(.*?)<\/script>/.exec(home)[1]);
assert.strictEqual(pool.length, 38, `拾读池应 38, 实得 ${pool.length}`);
const wy = pool.find((c) => c.href.includes("wenyib"));
assert(wy && wy.line.startsWith("这是我第几次为你扫墓"), `行号跳过失效: ${wy && wy.line}`);

// —— CSS 关键规则 ——
const flat = css.replace(/\n/g, "");
assert(flat.includes('.duo-acts{display:flex;justify-content:center') && flat.includes("max-width:560px"), "双按钮桌面居中横排");
assert(/@media \(max-width:640px\)\{[^}]*\.duo-acts\{flex-direction:column/.test(flat), "双按钮手机竖排");
assert(flat.includes(".foot-note{margin-top:26px") && flat.includes("font-size:12px"), "页脚小字规则");
assert(flat.includes('.nav.open .nav-links{display:flex') && flat.includes(".nav-toggle{display:none"), "汉堡菜单");
assert(flat.includes("grid-template-columns:minmax(0,1fr) auto auto"), "作品库行弹性列");

// —— 作品库 45 行 + 筛选 ——
const rows = [...lib.matchAll(/class="idx-row rv" data-author="([^"]*)" data-genre="([^"]*)" data-imagery="([^"]*)" data-source="([^"]*)"/g)];
assert.strictEqual(rows.length, 29, `库分组行应 29(其余社员作品), 实得 ${rows.length}`);
assert(rows.every((r) => r[1] && r[2]), "行缺作者/体裁");
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
assert(!lib.includes("待辑入新期"), "待辑为空时不显示提示");

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
for (const x of ['id="sub-slug"', 'id="sub-excerpt"', 'id="sub-note"', 'id="sub-imagery"', 'name="website"', "/.netlify/functions/submit"]) {
  assert(sub.includes(x), `投稿页缺 ${x}`);
}

console.log(`\n✅ verify-dist.js 全部通过 (${htmls.length} 页 / 拾读池 ${pool.length} / 库 ${rows.length} 行)`);
