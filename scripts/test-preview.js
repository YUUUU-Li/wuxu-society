// 预览接口单测: node scripts/test-preview.js
// 目标: functions/api/preview.js —— 复用投稿解析器, 输出与 bodyToHtml 一致
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

function ctx(obj) {
  return {
    request: new Request("https://wuxu.org/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(obj),
    }),
    env: {},
  };
}

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "preview.js")).href);
  const sub = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "submit.js")).href);

  const r = await mod.onRequestPost(ctx({
    genre: "词",
    body: "春水碧于天。\n\n&前记：序文。\n\n> 旧句一行\n\n---\n\n评（hde）：尾句有味。",
  }));
  assert.strictEqual(r.status, 200, "预览应成功");
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  assert(j.html.includes('<p class="stanza">春水碧于天。</p>'), "诗句段");
  assert(j.html.includes('<p class="stanza kaiti">前记：序文。</p>'), "& 楷体段");
  assert(j.html.includes('<blockquote class="quote">旧句一行</blockquote>'), "引文块");
  assert(j.html.includes('<hr class="rule" />'), "分割线");
  assert(j.html.includes('<p class="analysis">评（hde）：尾句有味。</p>'), "赏析块");
  assert.strictEqual(j.html, sub.bodyToHtml("春水碧于天。\n\n&前记：序文。\n\n> 旧句一行\n\n---\n\n评（hde）：尾句有味。", "词"), "预览输出与投稿解析器逐字节一致");

  assert.strictEqual((await mod.onRequestPost(ctx({ body: "   " }))).status, 400, "空正文应拒绝");
  assert.strictEqual((await mod.onRequestPost(ctx({ body: "x".repeat(30000) }))).status, 200, "超长截断后仍可预览");
  assert.strictEqual((await mod.onRequest()).status, 405, "GET 应 405");

  console.log("✅ test-preview.js 全部通过 (与投稿解析器一致 / 空正文拒绝 / 405)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
