// 投稿排版解析测试: scripts/test-submit-format.js
// 目标: functions/api/submit.js 的 bodyToHtml —— 行首标记语法(& 楷体 / > 引文 / --- 分割线)
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

const CASES = [
  ["诗句体裁: 行间成行", "词", "春逝久，溽暑蒸垂杨瘦。\n乱枕低吟烦醉酒。", '<p class="stanza">春逝久，溽暑蒸垂杨瘦。<br />乱枕低吟烦醉酒。</p>'],
  ["散文体裁: 段落连排", "散文", "第一段文字。\n第二行同段。\n\n第二段。", '<p class="prose">第一段文字。 第二行同段。</p>\n<p class="prose">第二段。</p>'],
  ["& 楷体文段(后记)", "词", "春逝久。\n\n&后记：丙午年四月二十，芒种作。", '<p class="stanza">春逝久。</p>\n<p class="stanza kaiti">后记：丙午年四月二十，芒种作。</p>'],
  ["> 引文块", "词", "> 当时明月在，曾照彩云归。\n> 二句旧引\n\n正文本句。", '<blockquote class="quote">当时明月在，曾照彩云归。<br />二句旧引</blockquote>\n<p class="stanza">正文本句。</p>'],
  ["--- 分割线", "散文", "上篇。\n\n---\n\n下篇。", '<p class="prose">上篇。</p>\n<hr class="rule" />\n<p class="prose">下篇。</p>'],
  ["注/评仍自动赏析块", "词", "评（hde）：此为评语。\n\n正文。", '<p class="analysis">评（hde）：此为评语。</p>\n<p class="stanza">正文。</p>'],
  ["自序不再自动楷体(改用 &)", "散文", "自序：此为序文。\n\n正文一段。", '<p class="prose">自序：此为序文。</p>\n<p class="prose">正文一段。</p>'],
  ["转义安全", "散文", "<script>alert(1)</script>\n\n&<b>粗</b>", '<p class="prose">&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p class="stanza kaiti">&lt;b&gt;粗&lt;/b&gt;</p>'],
];

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "submit.js")).href);
  assert.strictEqual(typeof mod.bodyToHtml, "function", "需导出 bodyToHtml");
  for (const [name, genre, text, want] of CASES) {
    const got = mod.bodyToHtml(text, genre);
    assert.strictEqual(got, want, `[${name}] 输出不符\n实得: ${got}\n期望: ${want}`);
  }
  console.log("✅ test-submit-format.js 全部通过 (& 楷体 / > 引文 / --- 分割线 / 注评 / 转义, 共 " + CASES.length + " 例)");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
