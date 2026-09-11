// 投稿函数回归单测: node scripts/test-submit.js
// 目标实现: functions/api/submit.js (Cloudflare Pages 原生 ESM)
// 覆盖: 参数校验 / 正文排版(诗句·散文·& 楷体稿·评注) / 摘句 front matter / slug / 待辑登记
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

let md = "";
let prBody = "";
let pendingPut = "";
function mockFetch(url, opts) {
  const path_ = /\/repos\/YUUUU-Li\/wuxu-society\/(.*)/.exec(url)[1];
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  if (method === "GET" && /heads\/main/.test(path_))
    return Promise.resolve(new Response(JSON.stringify({ object: { sha: "1" } }), { status: 200 }));
  if (method === "POST" && /refs$/.test(path_)) return Promise.resolve(new Response("{}", { status: 201 }));
  if (method === "GET" && /contents\/src\/works\/.+\.md/.test(path_))
    return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
  if (method === "GET" && /groups\.json/.test(path_))
    return Promise.resolve(new Response(JSON.stringify({ sha: "gs", content: b64([{ key: "other", slugs: [] }]) }), { status: 200 }));
  if (method === "GET" && /fulltext_order\.json/.test(path_))
    return Promise.resolve(new Response(JSON.stringify({ sha: "os", content: b64(["w-feng"]) }), { status: 200 }));
  if (method === "GET" && /pending_issue\.json/.test(path_))
    return Promise.resolve(new Response(JSON.stringify({ sha: "ps", content: b64([]) }), { status: 200 }));
  if (method === "PUT" && /pending_issue\.json/.test(path_)) {
    pendingPut = Buffer.from(body.content, "base64").toString("utf8");
    return Promise.resolve(new Response("{}", { status: 200 }));
  }
  if (method === "PUT" && /works\//.test(path_)) {
    md = Buffer.from(body.content, "base64").toString("utf8");
    return Promise.resolve(new Response("{}", { status: 201 }));
  }
  if (method === "PUT") return Promise.resolve(new Response("{}", { status: 200 }));
  if (method === "POST" && /pulls$/.test(path_)) {
    prBody = JSON.parse(opts.body).body;
    return Promise.resolve(new Response(JSON.stringify({ number: 7, html_url: "https://x/pr/7" }), { status: 201 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ message: "unexpected " + method + " " + path_ }), { status: 500 }));
}
global.fetch = mockFetch;

let ipSeed = 0;
function post(mod, obj) {
  ipSeed += 1;
  const req = new Request("https://wuxu.org/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "10.0.1." + (ipSeed % 250 + 1) },
    body: JSON.stringify(obj),
  });
  return mod.onRequestPost({ request: req, env: { GITHUB_TOKEN_SUBMIT: "t" } });
}
const LONG_BODY = "一二三四五六七八九十。\n二二三四五六七八九十。\n\n第三段落内容也足够长了。";

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "submit.js")).href);

  // 1) 校验
  assert.strictEqual((await post(mod, { author: "zk", genre: "词", created: "2024-04", body: LONG_BODY })).status, 400, "缺题名");
  assert.strictEqual((await post(mod, { title: "x", genre: "词", created: "2024-04", body: LONG_BODY })).status, 400, "缺署名");
  assert.strictEqual((await post(mod, { title: "x", author: "a", genre: "词", created: "2024-04", body: "短" })).status, 400, "正文过短");
  assert.strictEqual((await post(mod, { title: "a<b", author: "a", genre: "词", created: "2024-04", body: LONG_BODY })).status, 400, "非法字符 < >");
  assert.strictEqual((await post(mod, { title: "无时间", author: "a", genre: "词", body: LONG_BODY })).status, 400, "缺创作时间");
  assert.strictEqual((await post(mod, { title: "坏时间", author: "a", genre: "词", created: "2024-13", body: LONG_BODY })).status, 400, "月份非法");
  assert.strictEqual((await post(mod, { title: "坏时间2", author: "a", genre: "词", created: "去年春天", body: LONG_BODY })).status, 400, "认不出的日期");

  // 1.5) 创作时间的宽松写法: 8 位数字 / 点号 / 汉字 / 只到月, 入库前统一归一化
  for (const [raw, want, slugWant] of [
    ["20240911", "2024-09-11", "w-20240911-01"],
    ["2024.9.11", "2024-09-11", "w-20240911-01"],
    ["2024年9月11日", "2024-09-11", "w-20240911-01"],
    ["2024-09", "2024-09", "w-202409-01"],
    ["202409", "2024-09", "w-202409-01"],
  ]) {
    const rr = await post(mod, { title: "日期写法", author: "zk（道格）", genre: "七律", created: raw, body: LONG_BODY });
    assert.strictEqual(rr.status, 200, `「${raw}」应被接受: ` + (await rr.text()));
    assert(new RegExp('^created: "' + want + '"$', "m").test(md), `「${raw}」应归一化为 ${want}`);
    assert(prBody.includes("`" + slugWant + "`"), `「${raw}」标识名应为 ${slugWant}`);
  }

  // 2) 诗句排版(行间 <br />) + 空行分段
  let r = await post(mod, { title: "联句", author: "jwl（蓦流）", genre: "联句", created: "2024-04", body: "共怀帘中清明雨。\n相与檐下语清明。" });
  assert.strictEqual(r.status, 200, await r.text());
  const html = md.split("---")[2];
  assert(html.includes('<p class="stanza">共怀帘中清明雨。<br />相与檐下语清明。</p>'), "诗句段 stanza+br");

  // 3) 散文体裁 -> prose
  r = await post(mod, { title: "短篇", author: "txy（飞鸟）", genre: "短篇", created: "2025-06", body: "第一句很长的话。\n第二句。" });
  assert.strictEqual(r.status, 200);
  assert(md.split("---")[2].includes('<p class="prose">'), "散文段 prose");

  // 4) & 楷体稿 + 评注 + 分割线
  r = await post(mod, {
    title: "芙蓉王", author: "lfk（谰予）", genre: "古风", created: "2025-06",
    body: "&前记：予于默写中得句，聊推于翌日。\n\n王家有子男。\n性本爱奇葩。\n\n---\n\n评（hde）：开篇写尽意气。",
  });
  assert.strictEqual(r.status, 200, await r.text());
  const m = md.split("---")[2];
  assert(m.includes('<p class="stanza kaiti">前记：予于默写中得句，聊推于翌日。</p>'), "& -> 楷体段");
  assert(m.includes('<p class="stanza">王家有子男。<br />性本爱奇葩。</p>'), "诗句不受影响");
  assert(m.includes('<hr class="rule" />'), "--- -> 分割线");
  assert(m.includes('<p class="analysis">评（hde）：开篇写尽意气。</p>'), "评（署名）原样进 analysis");

  // 5) 摘句: 归一化写入; 非法拒绝
  r = await post(mod, { title: "春望", author: "zk（道格）", genre: "七律", created: "2024-10-05", excerpt: " 万里悲秋常作客，\n百年多病独登台。 ", body: "万里悲秋常作客。\n百年多病独登台。\n\n后文亦足够长了。" });
  assert.strictEqual(r.status, 200);
  // 创作时间写入 front matter; 标识名按创作日期自动生成
  assert(/created: "2024-10-05"/.test(md), "front matter 写入 created");
  assert(prBody.includes("创作时间：2024-10-05"), "PR body 含创作时间");
  assert(/文件标识（自动生成）：`w-20241005-01`/.test(prBody), "标识名 = w-<创作日期>-序号");
  const ex = /excerpt: "([^"]*)"/.exec(md);
  assert(ex && ex[1] === "万里悲秋常作客， 百年多病独登台。", "excerpt 归一化(去首尾空/换行合并)");
  assert.strictEqual((await post(mod, { title: "x", author: "a", genre: "词", created: "2024-04", excerpt: "a<b", body: LONG_BODY })).status, 400, "摘句非法字符");

  // 6) 蜜罐(填了隐藏字段 -> 假装成功, 不真正提交)
  const hp = await post(mod, { title: "x", author: "a", genre: "词", created: "2024-04", body: LONG_BODY, website: "http://spam" });
  assert.strictEqual(hp.status, 200, "蜜罐应假装成功");
  assert.strictEqual((await hp.json()).honeypot, true, "蜜罐标记");

  // 7) 给编委的附言 -> 进 PR body(blockquote), 不进 md
  r = await post(mod, {
    title: "秋兴", author: "zk（道格）", genre: "七律", created: "2024-11", body: "玉露凋伤枫树林。\n巫山巫峡气萧森。\n\n次联亦成。",
    editorNote: "此为第三稿。\n如合适请以笔名发布。",
  });
  assert.strictEqual(r.status, 200, await r.text());
  assert(prBody.includes("## 给编委的附言"), "附言标题进 PR body");
  assert(prBody.includes("> 此为第三稿。\n> 如合适请以笔名发布。"), "附言按行转引用");
  assert(!md.includes("此为第三稿"), "附言不进作品 md");

  // 8) 题记 / 自注: 选填, 写进 front matter(换行转义 \n) 也进 PR body; 留空不写; 非法字符拒绝
  r = await post(mod, {
    title: "夜航", author: "zk（道格）", genre: "七律", created: "2024-12",
    epigraph: "是夜宿江馆，\n闻雨声不绝。",
    selfNote: "颔联用王子猷雪夜访戴事。\n「红砖」指老校区的红砖楼。",
    body: "寒江夜雨入孤篷。\n一盏灯明万里风。\n\n后文亦足够长了。",
  });
  assert.strictEqual(r.status, 200, await r.text());
  const ep = /epigraph: "([^"]*)"/.exec(md);
  const sn = /selfNote: "([^"]*)"/.exec(md);
  assert(ep && ep[1] === "是夜宿江馆，\\n闻雨声不绝。", "题记进 front matter, 换行写成 \\n 转义");
  assert(sn && sn[1] === "颔联用王子猷雪夜访戴事。\\n「红砖」指老校区的红砖楼。", "自注进 front matter, 换行写成 \\n 转义");
  assert(prBody.includes("题记：是夜宿江馆， ⏎ 闻雨声不绝。"), "PR body 含题记(换行显示为 ⏎)");
  assert(prBody.includes("自注：颔联用王子猷雪夜访戴事。 ⏎ 「红砖」指老校区的红砖楼。"), "PR body 含自注");
  // 留空 -> 两栏都不写进 front matter(老稿零影响)
  r = await post(mod, { title: "无题记", author: "zk（道格）", genre: "七律", created: "2025-01", body: LONG_BODY });
  assert.strictEqual(r.status, 200, await r.text());
  assert(!/\nepigraph: /.test(md) && !/\nselfNote: /.test(md), "留空则不写题记/自注");
  assert.strictEqual((await post(mod, { title: "x", author: "a", genre: "词", created: "2024-04", body: LONG_BODY, epigraph: "a<b" })).status, 400, "题记非法字符");
  assert.strictEqual((await post(mod, { title: "x", author: "a", genre: "词", created: "2024-04", body: LONG_BODY, selfNote: "a>b" })).status, 400, "自注非法字符");

  // 9) 待辑登记: 每篇投稿 slug 写入 pending_issue.json
  const pend = JSON.parse(pendingPut);
  assert(Array.isArray(pend) && pend.length === 1 && /^w-/.test(pend[0]), "pending_issue.json 登记待辑 slug");

  console.log("✅ test-submit.js 全部通过 (校验/创作时间/自动标识名/诗句/散文/&楷体稿/评注/分割线/摘句/题记/自注/蜜罐/附言/待辑登记)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
