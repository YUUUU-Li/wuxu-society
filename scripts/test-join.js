// 入社申请函数单测: node scripts/test-join.js
// 目标: functions/api/join.js -> 申请书落 applications/ + 名册草稿写入 members.json + 开 PR
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

let appMd = "";
let membersPut = "";
let prBody = "";
const MEMBERS = [
  { branch: "金华总部", members: [{ id: "jwl", name: "jwl · 蓦流", role: "社长", branch: "金华总部", note: "", links: [] }] },
];
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

function mockFetch(url, opts) {
  const p = /\/repos\/YUUUU-Li\/wuxu-society\/(.*)/.exec(url)[1];
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  if (method === "GET" && /heads\/main/.test(p))
    return Promise.resolve(new Response(JSON.stringify({ object: { sha: "1" } }), { status: 200 }));
  if (method === "POST" && /refs$/.test(p)) return Promise.resolve(new Response("{}", { status: 201 }));
  if (method === "GET" && /members\.json/.test(p))
    return Promise.resolve(new Response(JSON.stringify({ sha: "ms", content: b64(JSON.stringify(MEMBERS, null, 2)) }), { status: 200 }));
  if (method === "PUT" && /members\.json/.test(p)) {
    membersPut = Buffer.from(body.content, "base64").toString("utf8");
    // 模拟"已写入主分支": 后续 GET 能读到, 用于验证缩写去重
    const next = JSON.parse(membersPut);
    MEMBERS.length = 0;
    next.forEach((s) => MEMBERS.push(s));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }
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

  // 校验
  assert.strictEqual((await post(mod, { mail: "a@b.com", note: "你好你好" })).status, 400, "缺笔名");
  assert.strictEqual((await post(mod, { penname: "枕月", note: "你好你好" })).status, 400, "缺邮箱");
  assert.strictEqual((await post(mod, { penname: "枕月", mail: "bad-mail", note: "你好你好" })).status, 400, "邮箱格式");
  assert.strictEqual((await post(mod, { penname: "枕月", mail: "a@b.com", note: "短" })).status, 400, "自我介绍过短");

  const hp = await post(mod, { penname: "bot", mail: "a@b.com", note: "你好你好", botField: "x" });
  assert.strictEqual(hp.status, 200, "蜜罐假装成功");
  assert.strictEqual((await hp.json()).honeypot, true, "蜜罐标记");
  assert.strictEqual(membersPut, "", "蜜罐不得匿名册");

  // 正常申请(填了地区) -> 名册草稿落在该地区分部
  let r = await post(mod, { penname: "枕月", mail: "zhenyue@example.com", region: "浙江金华", kind: "poem", note: "写旧体诗五年，想找人一起改稿。" });
  assert.strictEqual(r.status, 200, "申请应成功");
  assert.strictEqual((await r.json()).ok, true);
  assert(appMd.includes("- 地区：浙江金华"), "申请书含地区");
  assert(appMd.includes("- 常写方向：古诗词"), "方向映射为中文");
  let mem = JSON.parse(membersPut);
  let draft = mem.find((s) => s.branch === "浙江金华").members[0];
  assert.strictEqual(draft.id, "zhenyue", "缩写草稿取自邮箱前缀");
  assert.strictEqual(draft.role, "社员", "默认角色");
  assert.deepStrictEqual(draft.links, [], "链接待编委补");
  assert(prBody.includes("合入前请确认名册草稿"), "PR body 含确认清单");
  assert(prBody.includes("`zhenyue`"), "PR body 提示缩写草稿");

  // 地区留空 -> 分部记「待考」; 邮箱前缀非法 -> pending-xx
  r = await post(mod, { penname: "无名", mail: "9x@example.com", note: "只读也想来。" });
  assert.strictEqual(r.status, 200, "地区选填也可提交");
  assert(appMd.includes("- 地区：未填"), "申请书地区记未填");
  mem = JSON.parse(membersPut);
  draft = mem.find((s) => s.branch === "待考").members[0];
  assert(/^pending-[a-z0-9]{2}$/.test(draft.id), "非法邮箱前缀回退 pending-xx: " + draft.id);

  // 缩写重复 -> 自动加后缀
  r = await post(mod, { penname: "另一个枕月", mail: "zhenyue@other.com", region: "金华总部", note: "同名不同人。" });
  assert.strictEqual(r.status, 200);
  mem = JSON.parse(membersPut);
  const ids = mem.find((s) => s.branch === "金华总部").members.map((m) => m.id);
  assert(ids.includes("jwl") && ids.includes("zhenyue") === false, "既有缩写不被覆盖: " + JSON.stringify(ids));
  assert(ids.some((x) => /^zhenyue-[a-z0-9]{2}$/.test(x)), "重复缩写自动加后缀: " + ids.join(","));

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

  console.log("✅ test-join.js 全部通过 (校验/蜜罐/地区→分部/缩写草稿/待考回退/去重/限流)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
