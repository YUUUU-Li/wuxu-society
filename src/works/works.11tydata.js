// src/works/ 目录级默认数据: 每篇作品无需再写 layout / permalink / file
// 输出文件名 = 源文件名 (w-feng.md -> w-feng.html, 与旧 URL 一致)
const { normalizeCreated } = require("../../scripts/work-order.js");

module.exports = {
  layout: "work.njk",
  permalink: "{{ page.fileSlug }}.html",
  eleventyComputed: {
    // 创作时间写法很宽松(20240911 / 2024.9.11 / 2024年9月11日 / 202409 / 2024-09 / 2024),
    // 页面上统一显示归一化后的 YYYY[-MM[-DD]](经 cnDate 再转"2024年9月11日");
    // 排序口径见 scripts/work-order.js —— 模糊的(只到月/只到年)排在当月具体日子之前。
    created: (data) => normalizeCreated(data.created),
  },
};
