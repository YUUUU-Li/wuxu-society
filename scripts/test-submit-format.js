// 投稿排版解析测试: scripts/test-submit-format.js
// 目标: CF 版(functions/api/submit.js) 与 Netlify 版(netlify/functions/submit.js)
//       的 bodyToHtml 输出必须完全一致(防两处逻辑漂移), 且新标记语法正确。
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

const CASES = [
  { name: "诗句体裁: 行间成行", g: "词", t: "春逝久，溽暑蒸垂杨瘦。\n乱枕低吟烦醉酒。" },
  { name: "散文体裁: 段落", g: "散文", t: "第一段文字。\n第二行同段。\n\n第二段。" },
  { name: "& 楷体文段(后记)", g: "词", t: "春逝久，溽暑蒸垂杨瘦。\n\n&后记：丙午年四月二十，芒种作。" },
  { name: "> 引文块", g: "词", t: "> 当时明月在，曾照彩云归。\n> 二句旧引\n\n正文本句。" },
  { name: "--- 分割线", g: "散文", t: "上篇。\n\n---\n\n下篇。" },
  { name: "自动识别保留(自序)", g: "散文", t: "自序：此为序文。\n\n正文一段。" },
  { name: "自动识别保留(评)", g: "词", t: "评（hde）：此为评语。\n\n正文。" },
  { name: "转义安全", g: "散文", t: "<script>alert(1)</script>\n\n&<b>粗</b>" },
];

(async () => {
  const cf = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "submit.js")).href);
  const nl = require(path.join(__dirname, "..", "netlify", "functions", "submit.js"));
  assert.strictEqual(typeof cf.bodyToHtml, "function", "CF 版需导出 bodyToHtml");
  assert.strictEqual(typeof nl.bodyToHtml, "function", "Netlify 版需导出 bodyToHtml");

  for (const c of CASES) {
    const a = cf.bodyToHtml(c.t, c.g);
    const b = nl.bodyToHtml(c.t, c.g);
    assert.strictEqual(a, b, `两版输出不一致: ${c.name}\nCF: ${a}\nNL: ${b}`);
  }

  // 具体形态断言
  const k = cf.bodyToHtml("春逝久。\n\n&后记：芒种作。", "词");
  assert(k.includes('<p class="stanza kaiti">后记：芒种作。</p>'), "& 段应输出楷体段: " + k);
  const h = cf.bodyToHtml("上。\n\n---\n\n下。", "散文");
  assert(h.includes('<hr class="rule" />'), "--- 应输出分割线: " + h);
  const q = cf.bodyToHtml("> 引一句\n> 又一句\n\n正文。", "词");
  assert(q.includes('<blockquote class="quote">引一句<br />又一句</blockquote>'), "> 应输出引文块: " + q);
  const esc = cf.bodyToHtml("<script>x</script>", "散文");
  assert(!esc.includes("<script>") && esc.includes("&lt;script&gt;"), "正文需转义: " + esc);

  console.log("✅ test-submit-format.js 全部通过 (双版一致 / & 楷体 / > 引文 / --- 分割线 / 转义)");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
