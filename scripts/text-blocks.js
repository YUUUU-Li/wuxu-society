// 短文本块(题记 / 自注)的统一转义口径 —— 供作品页模板的 escLines 过滤器使用。
// 与 functions/api/preview.js 里的同名函数**逐字节一致**(scripts/test-blocks.js 会比对),
// 这样投稿页「预览」看到的排版与发布后的作品页完全相同。
//   先按 HTML 转义(& < > " '), 再把换行变成 <br />; 结果由模板用 | safe 输出, 不再二次转义。
function escLines(s) {
  return String(s == null ? "" : s)
    .replace(/\r/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br />");
}

module.exports = { escLines };
