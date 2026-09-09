// 投稿函数回归单测: node scripts/test-submit.js
// 覆盖: 参数校验 / 正文自动排版(诗句·散文·自序·评注) / 摘句 front matter / slug 流程
const { handler } = require("../netlify/functions/submit.js");
const assert = require("assert");

let md = "";
let prBody = "";
function mockFetch(url, opts) {
  const path = /\/repos\/YUUUU-Li\/wuxu-society\/(.*)/.exec(url)[1];
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  if (method === "GET" && /heads\/main/.test(path))
    return Promise.resolve(new Response(JSON.stringify({ object: { sha: "1" } }), { status: 200 }));
  if (method === "POST" && /refs$/.test(path))
    return Promise.resolve(new Response("{}", { status: 201 }));
  if (method === "GET" && /contents\/src\/works\/.+\.md/.test(path))
    return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
  if (method === "GET" && /groups\.json/.test(path))
    return Promise.resolve(new Response(JSON.stringify({ sha: "gs", content: b64([{ key: "other", slugs: [] }]) }), { status: 200 }));
  if (method === "GET" && /fulltext_order\.json/.test(path))
    return Promise.resolve(new Response(JSON.stringify({ sha: "os", content: b64(["w-feng"]) }), { status: 200 }));
  if (method === "PUT" && /works\//.test(path)) {
    md = Buffer.from(body.content, "base64").toString("utf8");
    return Promise.resolve(new Response("{}", { status: 201 }));
  }
  if (method === "PUT") return Promise.resolve(new Response("{}", { status: 200 }));
  if (method === "POST" && /pulls$/.test(path)) {
    prBody = JSON.parse(opts.body).body;
    return Promise.resolve(new Response(JSON.stringify({ number: 7 }), { status: 201 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ message: "unexpected " + method + " " + path }), { status: 500 }));
}
global.fetch = mockFetch;

let ipSeed = 0;
const post = (obj) => {
  ipSeed += 1;
  return handler({ httpMethod: "POST", body: JSON.stringify(obj), headers: { "x-forwarded-for": "10.0.0." + (ipSeed % 250 + 1) } });
};
const LONG_BODY = "一二三四五六七八九十。\n二二三四五六七八九十。\n\n第三段落内容也足够长了。";

async function main() {
  process.env.GITHUB_TOKEN_SUBMIT = "t";

  // 1) 校验
  assert.strictEqual((await post({ author: "zk", genre: "词", body: LONG_BODY })).statusCode, 400, "缺题名");
  assert.strictEqual((await post({ title: "x", genre: "词", body: LONG_BODY })).statusCode, 400, "缺署名");
  assert.strictEqual((await post({ title: "x", author: "a", genre: "词", body: "短" })).statusCode, 400, "正文过短");
  assert.strictEqual((await post({ title: "a<b", author: "a", genre: "词", body: LONG_BODY })).statusCode, 400, "非法字符 < >");

  // 2) 诗句排版(行间 <br />) + 空行分段
  let r = await post({ title: "联句", author: "jwl（蓦流）", genre: "联句", body: "共怀帘中清明雨。\n相与檐下语清明。" });
  assert.strictEqual(r.statusCode, 200, r.body);
  const html = md.split("---")[2];
  assert(html.includes('<p class="stanza">共怀帘中清明雨。<br />相与檐下语清明。</p>'), "诗句段 stanza+br");

  // 3) 散文体裁 -> prose
  r = await post({ title: "短篇", author: "txy（飞鸟）", genre: "短篇", body: "第一句很长的话。\n第二句。" });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert((md.split("---")[2]).includes('<p class="prose">'), "散文段 prose");

  // 4) 自序: 标记 + 独立标题行
  r = await post({ title: "芙蓉王", author: "lfk（谰予）", genre: "古风", body: "自序：予于默写中得句，聊推于翌日。\n\n王家有子男。\n性本爱奇葩。\n\n自序\n独立标题行应被丢弃。\n\n评（hde）：开篇写尽意气。" });
  assert.strictEqual(r.statusCode, 200, r.body);
  const m = md.split("---")[2];
  assert(m.includes('<p class="stanza kaiti">予于默写中得句，聊推于翌日。</p>'), "自序：-> kaiti");
  assert(m.includes('<p class="stanza">王家有子男。<br />性本爱奇葩。</p>'), "诗句不受影响");
  assert(m.includes('<p class="stanza kaiti">独立标题行应被丢弃。</p>'), "独立自序标题行丢弃, 正文保留");
  assert(m.includes('<p class="analysis">评（hde）：开篇写尽意气。</p>'), "评（署名）原样进 analysis");

  // 5) 摘句: 归一化写入; 非法拒绝
  r = await post({ title: "春望", author: "zk（道格）", genre: "七律", slug: "qiuwang", excerpt: " 万里悲秋常作客，\n百年多病独登台。 ", body: "万里悲秋常作客。\n百年多病独登台。\n\n后文亦足够长了。" });
  assert.strictEqual(r.statusCode, 200, r.body);
  const ex = /excerpt: "([^"]*)"/.exec(md);
  assert(ex && ex[1] === "万里悲秋常作客， 百年多病独登台。", "excerpt 归一化(去首尾空/换行合并)");
  assert.strictEqual((await post({ title: "x", author: "a", genre: "词", excerpt: "a<b", body: LONG_BODY })).statusCode, 400, "摘句非法字符");

  // 6) 蜜罐(填了隐藏字段 -> 假装成功, 不真正提交)
  const hp = await post({ title: "x", author: "a", genre: "词", body: LONG_BODY, website: "http://spam" });
  assert.strictEqual(hp.statusCode, 200, "蜜罐应假装成功");
  assert.strictEqual(JSON.parse(hp.body).honeypot, true, "蜜罐标记");

  // 7) 给编委的附言 -> 进 PR body(blockquote), 不进 md
  r = await post({
    title: "秋兴", author: "zk（道格）", genre: "七律", body: "玉露凋伤枫树林。\n巫山巫峡气萧森。\n\n次联亦成。",
    editorNote: "此为第三稿。\n如合适请以笔名发布。",
  });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert(prBody.includes("## 给编委的附言"), "附言标题进 PR body");
  assert(prBody.includes("> 此为第三稿。\n> 如合适请以笔名发布。"), "附言按行转引用");
  assert(!md.includes("此为第三稿"), "附言不进作品 md");

  console.log("\n✅ test-submit.js 全部通过 (校验/诗句/散文/自序/评注/摘句/蜜罐/附言)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
