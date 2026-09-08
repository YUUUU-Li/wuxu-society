// src/works/ 目录级默认数据: 每篇作品无需再写 layout / permalink / file
// 输出文件名 = 源文件名 (w-feng.md -> w-feng.html, 与旧 URL 一致)
module.exports = {
  layout: "work.njk",
  permalink: "{{ page.fileSlug }}.html",
};
