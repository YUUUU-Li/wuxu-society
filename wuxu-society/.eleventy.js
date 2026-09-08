// 婺需文学社 · Eleventy 配置
// 构建: npm run build  (输出到 dist/, 即 Netlify 发布目录)
module.exports = function (eleventyConfig) {
  // 静态资源 (css/js/图片) 原样复制到输出根目录
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });

  // Markdown: 正文为 HTML 片段, 需允许原生 HTML 原样通过
  eleventyConfig.amendLibrary("md", (md) =>
    md.set({ html: true, breaks: false, linkify: false })
  );

  // 作品集合: src/works/*.md
  eleventyConfig.addCollection("works", (collectionApi) =>
    collectionApi.getFilteredByGlob("src/works/*.md")
  );

  // slug -> work 快速查找 (slug = 文件名, 如 w-feng)
  eleventyConfig.addFilter("worksMap", (works) => {
    const map = {};
    for (const w of works) map[w.fileSlug] = w;
    return map;
  });

  // 关联作品按规范顺序分组: 本作关联 -> 同作者 -> 同意象 -> 同时同源
  // (注: 不用 nunjucks 内置 groupby, 该版本对数组返回空结果)
  eleventyConfig.addFilter("relGroups", (related) => {
    const order = ["strong", "author", "imagery", "source"];
    const head = {
      strong: "本作关联（唱和 · 组诗）",
      author: "同作者",
      imagery: "同意象",
      source: "同时同源",
    };
    const out = [];
    for (const cat of order) {
      const items = (related || []).filter((r) => r.cat === cat);
      if (items.length) out.push({ cat, heading: head[cat], items });
    }
    return out;
  });

  return {
    dir: {
      input: "src",
      output: "dist",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data",
    },
    templateFormats: ["md", "njk"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
