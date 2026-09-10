// 婺需文学社 · Eleventy 配置
// 构建: npm run build  (输出到 dist/, 即 Cloudflare Pages 发布目录)
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

// 创作时间排序: 作品 front matter 的 created(YYYY-MM 或 YYYY-MM-DD) 升序;
// 未填者"继承"前一篇已填作品的时点(即保持现有编排位置, 补填后自动归位)。
const createdOf = {};
for (const f of fs.readdirSync(path.join(__dirname, "src", "works"))) {
  if (!f.endsWith(".md")) continue;
  const s = fs.readFileSync(path.join(__dirname, "src", "works", f), "utf8");
  const m = /^created:\s*"([^"]*)"/m.exec(s);
  if (m) createdOf[f.slice(0, -3)] = m[1];
}
const effKey = {};
{
  let carry = "";
  for (const s of FULLTEXT_ORDER) {
    if (createdOf[s]) carry = createdOf[s];
    effKey[s] = carry;
  }
}
const FULLTEXT_SORTED = FULLTEXT_ORDER
  .map((s, i) => ({ s, i }))
  .sort((a, b) => String(effKey[a.s] || "").localeCompare(String(effKey[b.s] || "")) || a.i - b.i)
  .map((x) => x.s);
const orderIdx = {};
FULLTEXT_SORTED.forEach((s, i) => (orderIdx[s] = i));

// "jwl（蓦流）" -> "jwl"; "cty" -> "cty"
function akOf(author) {
  const i = String(author || "").indexOf("（");
  return i > 0 ? author.slice(0, i) : author;
}
function branchOf(author) {
  const m = memberById[akOf(author)];
  return m ? m.branch : "";
}

// 构建时把许可证复制进静态区, 随站发布(根目录显示为 /LICENSE.txt /LICENSE-CODE.txt)
// 副本加 UTF-8 BOM, 浏览器不看响应头也能正确识别编码, 避免中文乱码
for (const [src, dest] of [
  ["LICENSE", "src/static/LICENSE.txt"],
  ["LICENSE-CODE", "src/static/LICENSE-CODE.txt"],
]) {
  try {
    const text = fs.readFileSync(path.join(__dirname, src), "utf8");
    fs.writeFileSync(path.join(__dirname, dest), "\uFEFF" + text, "utf8");
  } catch (e) {
    console.warn("复制许可文件失败(跳过):", src, e.message);
  }
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
  // rel-meta.json 用: JSON 安全序列化(未定义按空数组)
  eleventyConfig.addFilter("jsonify", (o) => JSON.stringify(o));
  eleventyConfig.addFilter("jsonarr", (o) => JSON.stringify(Array.isArray(o) ? o : []));
  // 名册页: 判断是否"作品"链接(其余如"评注：""作品库"不占 3 篇额度)
  eleventyConfig.addFilter("isWorkLink", (l) => /^作品[:：]/.test((l && l.label) || ""));
  // 名册页: 作者索引(id -> {author, count, items:[{t,h}]}) —— 
  //   items 供"每次打开随机抽 3 首"与"查看更多作品"跳作品库作者筛选页
  eleventyConfig.addGlobalData("authorIndex", () => {
    const dir = path.join(__dirname, "src", "works");
    const map = {};
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const s = fs.readFileSync(path.join(dir, f), "utf8");
      const am = /^author:\s*"([^"]*)"/m.exec(s);
      const tm = /^title:\s*"([^"]*)"/m.exec(s);
      if (!am) continue;
      const author = am[1];
      const id = (author.match(/^[a-z0-9]+/i) || [""])[0].toLowerCase();
      if (!id) continue;
      if (!map[id]) map[id] = { author, count: 0, items: [] };
      map[id].count += 1;
      map[id].items.push({ t: tm ? tm[1] : f.replace(/\.md$/, ""), h: "/" + f.replace(/\.md$/, "") + ".html" });
    }
    return map;
  });
  // 静态资源版本号: 每次构建变化, 让浏览器拿到最新 CSS/JS(避免新 HTML 配旧缓存)
  eleventyConfig.addGlobalData("assetVer", () => String(Date.now()));
  // 创作时间下拉选项(用中文"年/月"下拉, 避开原生 date/month 控件的英文界面与图标配色问题)
  eleventyConfig.addGlobalData("yearsList", () => {
    const now = new Date().getFullYear() + 1;
    const out = [];
    for (let y = now; y >= 1990; y--) out.push({ v: String(y), label: y + " 年" });
    return out;
  });
  eleventyConfig.addGlobalData("monthsList", () =>
    Array.from({ length: 12 }, (_, i) => ({ v: ("0" + (i + 1)).slice(-2), label: i + 1 + " 月" }))
  );
  // 按创作时间排序后的全文库顺序(供作品库平铺池与全文库页使用)
  eleventyConfig.addGlobalData("fulltextSorted", () => FULLTEXT_SORTED);
  // 把任意 slug 列表按创作时间(created 升序, 未填者继承)重排 —— 作品库分组列表用
  eleventyConfig.addFilter("byCreated", (slugs) =>
    (slugs || []).slice().sort((a, b) => (orderIdx[a] ?? 9999) - (orderIdx[b] ?? 9999))
  );
  // 创作时间显示: "2024-03" -> 2024年3月; "2024-03-06" -> 2024年3月6日
  eleventyConfig.addFilter("cnDate", (s) => {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || "").trim());
    if (!m) return s || "";
    return m[1] + "年" + Number(m[2]) + "月" + (m[3] ? Number(m[3]) + "日" : "");
  });

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

    // (原"同意象"静态组已移除: 相似标签改由运行时余弦计算,
    //  见 functions/api/related.js + 作品页 #rel-sim 动态填充; 冷启动=意象词按 1 票回退)

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
    if (sourceItems.length) groups.push({ heading: HEAD.source, kind: "source", rotateMax: 0, items: sourceItems });
    // 相似标签(余弦): 运行时由 /api/related 计算后填充(前端 #rel-sim)。仅当存在真实分组时占位,
    // 且插在"同时同源"之前(层级: 强关联 -> 同作者 -> 相似标签 -> 同源)
    if (groups.length) {
      const simGroup = { heading: "相似标签", kind: "similar", rotateMax: 4, items: [] };
      const srcIdx = groups.findIndex((g) => g.kind === "source");
      if (srcIdx >= 0) groups.splice(srcIdx, 0, simGroup);
      else groups.push(simGroup);
    }
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

  // 概念工具: concepts.json(concepts) 与 issues.json(issues) 由 _data 自动注入
  // conceptsOf(slug): 该作品所属各期带出的概念(去重, 保持期序)
  eleventyConfig.addFilter("conceptsOf", (concepts, slug, issues) => {
    const map = {};
    for (const c of concepts || []) map[c.id] = c;
    const out = [];
    for (const iss of issues || []) {
      if (!Array.isArray(iss.slugs) || !iss.slugs.includes(slug)) continue;
      for (const cid of iss.concepts || []) {
        const c = map[cid] || { id: cid, name: cid, note: "" };
        if (!out.some((x) => x.id === c.id)) out.push(c);
      }
    }
    return out;
  });
  // issueConcepts(issue): 某一期的概念列表
  eleventyConfig.addFilter("issueConcepts", (concepts, iss) => {
    const map = {};
    for (const c of concepts || []) map[c.id] = c;
    return (iss && iss.concepts || []).map((cid) => map[cid] || { id: cid, name: cid, note: "" });
  });
  // conceptSlugs(issues, cid): 含该概念的各期收录 slug(去重, 期序)
  eleventyConfig.addFilter("conceptSlugs", (issues, cid) => {
    const out = [];
    for (const iss of issues || []) {
      if (!Array.isArray(iss.concepts) || !iss.concepts.includes(cid)) continue;
      for (const s of iss.slugs || []) if (!out.includes(s)) out.push(s);
    }
    return out;
  });
  // findConcept(concepts, id): 按 id 找概念(用于"相近概念"链)
  eleventyConfig.addFilter("findConcept", (concepts, id) =>
    (concepts || []).find((c) => c.id === id)
  );

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
