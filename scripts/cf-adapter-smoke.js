// 快速接线自检: node scripts/cf-adapter-smoke.js
// 在 Node 里模拟 CF Pages 调用 ESM 函数, 验证投稿函数工作:
// GET -> 405; POST 空请求(带假 token, 不会外发) -> 400(缺少题名)
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "submit.js")).href);
  const env = { GITHUB_TOKEN_SUBMIT: "test" };

  const getRes = await mod.onRequest({ request: new Request("https://example.test/api/submit"), env });
  if (getRes.status !== 405) {
    console.log("GET 应 405, 实得", getRes.status);
    process.exit(1);
  }
  const postReq = new Request("https://example.test/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": "9.9.9.9" },
    body: "{}",
  });
  const res = await mod.onRequestPost({ request: postReq, env });
  const text = await res.text();
  const j = JSON.parse(text);
  const ok = res.status === 400 && j.ok === false;
  console.log("CF 投稿函数 GET:", getRes.status, "| POST 状态码:", res.status, "| 响应:", text);
  if (!ok) process.exit(1);
  console.log("✅ CF 投稿函数接线正常(ESM, 405/400 校验路径可达, 未发任何外网请求)");
})().catch((e) => {
  console.error("CF 投稿函数异常:", e.message);
  process.exit(1);
});
