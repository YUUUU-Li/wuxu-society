// 婺需文学社 · Eleventy 配置
// 构建: npm run build  (输出到 dist/, 即 Netlify 发布目录)
const fs = require("fs");
const path = require("path");

const MEMBERS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "src/_data/members.json"), "utf8")
);
const FULLTEXT_ORDER = JSON.parse(
  fs.readFileSync(path.join(__dirname, "src/_data/fulltext_order.json"), "utf8")
);
const memberById = {};
for (const sec of MEMBERS) for (const m of sec.members) memberById[m.id] = m;
const orderIdx = {};
FULLTEXT_ORDER.forEach((s, i) => (orderIdx[s] = i));

// "jwl（蓦流）" -> "jwl"; "cty" -> "cty"
function akOf(author) {
  const i = String(author || "").indexOf("（");
  return i > 0 ? author.slice(0, i) : author;
}
function branchOf(author) {
  const m = memberById[akOf(author)];
  return m ? m.branch : "";
}

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

  // 署名 -> 姓名缩写 (作者锚点用)
  eleventyConfig.addFilter("akOf", akOf);
  // 署名 -> 所属分部
  eleventyConfig.addFilter("branchOf", branchOf);

  // 关联作品自动推导: 强关联(手动related) -> 同作者 -> 同意象 -> 同时同源
  // 每篇作品只出现在最先命中的一类里; 组内按全文库顺序排列
  eleventyConfig.addFilter("relOf", (self, works) => {
    const HEAD = {
      strong: "本作关联（唱和 · 组诗）",
      author: "同作者",
      imagery: "同意象",
      source: "同时同源",
    };
    // 轮换上限: 这两组全量入池, 由页面 JS 每次加载随机抽选
    const ROTATE_MAX = { author: 5, imagery: 4 };
    const selfIm = self.imageries || [];
    const selfAk = akOf(self.author);
    const bySlug = {};
    for (const w of works) bySlug[w.fileSlug] = w;
    const sortWork = (a, b) =>
      (orderIdx[a.fileSlug] ?? 999) - (orderIdx[b.fileSlug] ?? 999);

    // 手动"强关联"(唱和/组诗): 作品 front matter 的 related 列表
    const manual = (self.related || []).map((r) => ({
      to: r.to,
      title: bySlug[r.to] ? bySlug[r.to].data.title : r.to,
      label: r.label,
    }));
    const taken = new Set(manual.map((r) => r.to));
    taken.add(self.slug);

    // 同作者: 同缩写作者的其他作品 (全部入池, 页面端轮换显示)
    const authorItems = works
      .filter((w) => w.fileSlug !== self.slug && !taken.has(w.fileSlug) &&
        akOf(w.data.author) === selfAk)
      .sort(sortWork)
      .map((w) => ({
        to: w.fileSlug,
        title: w.data.title,
        label: "同作者 · 社员同名篇目",
      }));
    authorItems.forEach((r) => taken.add(r.to));

    // 同意象: 与本作共意象者全部入池 (按共享数降序, 页面端轮换)
    const imageryItems = [];
    const imageryCands = works
      .filter((x) => x.fileSlug !== self.slug && !taken.has(x.fileSlug))
      .sort(sortWork)
      .map((w) => ({ w, shared: (w.data.imageries || []).filter((i) => selfIm.includes(i)) }))
      .filter((c) => c.shared.length)
      .sort((a, b) => b.shared.length - a.shared.length || sortWork(a.w, b.w));
    for (const { w, shared } of imageryCands) {
      imageryItems.push({
        to: w.fileSlug,
        title: w.data.title,
        label: "意象：" + shared.join("、"),
      });
      taken.add(w.fileSlug);
    }

    // 同时同源: 出处相同的其他作品 (全部列出, 无需轮换)
    const sourceItems = [];
    if (self.source) {
      for (const w of works
        .filter((x) => x.fileSlug !== self.slug && !taken.has(x.fileSlug) &&
          x.data.source === self.source)
        .sort(sortWork)) {
        sourceItems.push({
          to: w.fileSlug,
          title: w.data.title,
          label: self.source,
        });
      }
    }

    const groups = [];
    if (manual.length) groups.push({ heading: HEAD.strong, kind: "strong", rotateMax: 0, items: manual });
    if (authorItems.length) groups.push({ heading: HEAD.author, kind: "author", rotateMax: ROTATE_MAX.author, items: authorItems });
    if (imageryItems.length) groups.push({ heading: HEAD.imagery, kind: "imagery", rotateMax: ROTATE_MAX.imagery, items: imageryItems });
    if (sourceItems.length) groups.push({ heading: HEAD.source, kind: "source", rotateMax: 0, items: sourceItems });
    return groups;
  });

  // —— 首页"随机拾读"卡片池 ——
  // 立社同题 7 篇已固定在"同题作品"区, 随机池剔除它们避免同页重复
  const FOUNDING = [
    "qingming-xu", "qingming-cty", "qingming-jwl", "qingming-hde",
    "qingming-lfk", "qingming-cyk", "qingming-cyly",
  ];
  // 从 md 正文取"摘句": 跳过行号("0、")与过短片段; 诗句取该段首行, 散文取有意义的首句
  function firstLine(slug) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, "src/works", slug + ".md"), "utf8");
      const body = raw.split("---").slice(2).join("---");
      const paras = [...body.matchAll(/<p class="(stanza(?:\s+\w+)?|prose)">([\s\S]*?)<\/p>/g)];
      for (const m of paras) {
        // 先按 <br/> 切成"行", 再剥标签, 保留行结构
        const segs = m[2]
          .split(/<br\s*\/?>/)
          .map((s) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim())
          .filter(Boolean);
        // 去掉行号行(0、/1、/一、/01. 等)
        const real = segs.filter((l) => !/^\d+[、.．]\s*$/.test(l) && !/^[一二三四五六七八九十]+、/.test(l));
        if (!real.length) continue;
        let t = real[0];
        if (t.length < 6) {
          const next = real.slice(1).find((l) => l.length >= 6);
          if (!next) continue;
          t = next;
        }
        return t.length > 34 ? t.slice(0, 34) + "…" : t;
      }
      return "";
    } catch { return ""; }
  }
  eleventyConfig.addFilter("homeCards", (works) =>
    works
      .filter((w) => !FOUNDING.includes(w.fileSlug))
      .map((w) => {
        const ex = String(w.data.excerpt || "").trim();
        const line = ex ? (ex.length > 46 ? ex.slice(0, 46) + "…" : ex) : firstLine(w.fileSlug);
        return {
          href: w.fileSlug + ".html",
          title: w.data.title,
          name: String(w.data.author || "").replace("（", " · ").replace("）", ""),
          genre: w.data.genre || "",
          line,
        };
      })
      .sort((a, b) => (orderIdx[a.href.slice(0, -5)] ?? 999) - (orderIdx[b.href.slice(0, -5)] ?? 999))
  );
  eleventyConfig.addFilter("toJSON", (v) => JSON.stringify(v));

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
