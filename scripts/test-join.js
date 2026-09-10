// 入社申请函数单测: node scripts/test-join.js
// 目标: functions/api/join.js -> 申请书落 applications/, 开 PR
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

let appMd = "";
let prBody = "";
function mockFetch(url, opts) {
  const p = /\/repos\/YUUUU-Li\/wuxu-society\/(.*)/.exec(url)[1];
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  if (method === "GET" && /heads\/main/.test(p))
    return Promise.resolve(new Response(JSON.stringify({ object: { sha: "1" } }), { status: 200 }));
  if (method === "POST" && /refs$/.test(p)) return Promise.resolve(new Response("{}", { status: 201 }));
  if (method === "PUT" && /applications\//.test(p)) {
    appMd = Buffer.from(body.content, "base64").toString("utf8");
    return Promise.resolve(new Response("{}", { status: 201 }));
  }
  if (method === "POST" && /pulls$/.test(p)) {
    prBody = JSON.parse(opts.body).body;
    return Promise.resolve(new Response(JSON.stringify({ number: 12, html_url: "https://x/pr/12" }), { status: 201 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ message: "unexpected " + method + " " + p }), { status: 500 }));
}
global.fetch = mockFetch;

let seed = 0;
function post(mod, obj) {
  seed += 1;
  const req = new Request("https://wuxu.org/api/join", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "10.0.2." + (seed % 250 + 1) },
    body: JSON.stringify(obj),
  });
  return mod.onRequestPost({ request: req, env: { GITHUB_TOKEN_SUBMIT: "t" } });
}

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "join.js")).href);

  assert.strictEqual((await post(mod, { mail: "a@b.com", note: "你好你好" })).status, 400, "缺笔名");
  assert.strictEqual((await post(mod, { penname: "枕月", note: "你好你好" })).status, 400, "缺邮箱");
  assert.strictEqual((await post(mod, { penname: "枕月", mail: "bad-mail", note: "你好你好" })).status, 400, "邮箱格式");
  assert.strictEqual((await post(mod, { penname: "枕月", mail: "a@b.com", note: "短" })).status, 400, "自我介绍过短");

  const hp = await post(mod, { penname: "bot", mail: "a@b.com", note: "你好你好", botField: "x" });
  assert.strictEqual(hp.status, 200, "蜜罐假装成功");
  assert.strictEqual((await hp.json()).honeypot, true, "蜜罐标记");

  const r = await post(mod, { penname: "枕月", mail: "zhenyue@example.com", kind: "poem", note: "写旧体诗五年，想找人一起改稿。" });
  assert.strictEqual(r.status, 200, "申请应成功");
  const j = await r.json();
  assert.strictEqual(j.ok, true, "成功返回 ok");
  assert(/^applications\/.+\.md$/.test(prBody.match(/`([^`]+)`/)[1]), "PR body 指向申请书文件");
  assert(appMd.includes("# 入社申请 · 枕月"), "申请书标题");
  assert(appMd.includes("- 常写方向：古诗词"), "方向映射为中文");
  assert(appMd.includes("写旧体诗五年"), "自我介绍落盘");

  // 频率限制: 同 IP 连续提交
  const ip = "10.9.9.9";
  const hit = () => mod.onRequestPost({
    request: new Request("https://wuxu.org/api/join", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ penname: "枕月", mail: "a@b.com", note: "你好你好呀" }),
    }),
    env: { GITHUB_TOKEN_SUBMIT: "t" },
  });
  assert.strictEqual((await hit()).status, 200, "首次通过");
  assert.strictEqual((await hit()).status, 429, "一分钟内再次提交应限流");

  console.log("✅ test-join.js 全部通过 (校验/蜜罐/方向映射/落盘/限流)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
