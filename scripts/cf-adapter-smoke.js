// 快速接线自检: node scripts/cf-adapter-smoke.js
// 在 Node 里模拟 CF Pages 调用 onRequest, 验证"平台翻译层"工作:
// 空请求应返回 400(缺少题名), 而不是 500/类型错误。
const path = require("path");

(async () => {
  const mod = require(path.join(__dirname, "..", "functions", "api", "submit.js"));
  const req = new Request("https://example.test/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const res = await mod.onRequest({ request: req, env: { GITHUB_TOKEN_SUBMIT: "test" } });
  const text = await res.text();
  const j = JSON.parse(text);
  const ok = res.status === 400 && j.ok === false;
  console.log("CF 适配器状态码:", res.status, "| 响应:", text);
  if (!ok) process.exit(1);
  console.log("✅ CF 适配器接线正常(400 校验路径可达, 未发任何外网请求)");
})().catch((e) => {
  console.error("CF 适配器异常:", e.message);
  process.exit(1);
});
