// 生成《作品时间收集表》: node scripts/work-dates-report.js [--stdout]
// 用途: 补填创作时间时, 一眼看清"哪些篇还缺 created、属于哪一批、有什么线索"。
//   写得 docs/作品时间收集表.md; 加 --stdout 只打印不写文件。
// 说明: 本表只汇总**仓库里已有的证据**(期/出处/干支落款/节令题名), 不替作者猜日期;
//       created 的确切值仍由作者或编委确认后, 用 npm run set-created 写入。
// 排序口径与 .eleventy.js 一致(共用 scripts/work-order.js): created 升序, 模糊的排当月具体日子之前, 未填者列于其后。
const fs = require("fs");
const path = require("path");
const { sortByCreated, createdKey, normalizeCreated } = require("./work-order.js");

const ROOT = path.join(__dirname, "..");
const WORKS = path.join(ROOT, "src", "works");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

// 名单来自作品目录(共享登记表已取消)
const ORDER = fs.readdirSync(WORKS).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
const ISSUES = read("src/_data/issues.json");
const PENDING = ORDER.filter((slug) =>
  /^pending:\s*true\s*$/m.test(fs.readFileSync(path.join(WORKS, slug + ".md"), "utf8"))
);

// 干支 -> 公元(近一轮): 只给"待核"的线索, 不当作已定日期
const GANZHI = { 癸卯: 2023, 甲辰: 2024, 乙巳: 2025, 丙午: 2026, 丁未: 2027 };
const FESTIVAL = { 元宵: "元宵节前后", 上元: "元宵节前后", 清明: "清明前后", 寒食: "清明前后", 端午: "端午前后", 七夕: "七夕前后", 中秋: "中秋前后", 重阳: "重阳前后", 立秋: "立秋前后", 冬至: "冬至前后", 除夕: "岁末年初" };

function fm(s, key) {
  const m = new RegExp("^" + key + ':\\s*"([^"]*)"', "m").exec(s);
  return m ? m[1] : "";
}
function collect() {
  const out = [];
  for (const f of fs.readdirSync(WORKS)) {
    if (!f.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(WORKS, f), "utf8");
    const slug = f.slice(0, -3);
    const body = raw.split("---").slice(2).join("---");
    const issue = ISSUES.find((i) => (i.slugs || []).includes(slug));
    // 线索: 题名里的节令 / 正文落款的干支
    const hints = [];
    const title = fm(raw, "title");
    for (const [k, v] of Object.entries(FESTIVAL)) if (title.includes(k)) hints.push(`题名「${k}」→ ${v}`);
    const gz = /([癸甲乙丙丁戊己庚辛壬])([卯辰巳午未申酉戌亥子丑])年/.exec(body);
    if (gz) {
      const g = gz[1] + gz[2];
      hints.push(`落款干支「${g}年」${GANZHI[g] ? `≈ ${GANZHI[g]} 年（待核）` : "（年份待考）"}`);
    }
    out.push({
      slug,
      title,
      author: fm(raw, "author"),
      genre: fm(raw, "genre"),
      created: fm(raw, "created"),
      source: fm(raw, "source"),
      issue: issue ? `${issue.title}（${issue.period}）` : (PENDING.includes(slug) ? "待辑（已投稿，未封期）" : ""),
      hints,
    });
  }
  return out;
}

// 待填篇目的分批: 先按刊期, 再按出处(雅集/组诗), 余下归拢
function batchesOf(missing) {
  const used = new Set();
  const groups = [];
  const take = (name, pred) => {
    const rows = missing.filter((w) => !used.has(w.slug) && pred(w));
    if (!rows.length) return;
    rows.forEach((w) => used.add(w.slug));
    groups.push({ name: `${name}（${rows.length} 篇）`, rows });
  };
  for (const iss of ISSUES) take(`${iss.title} · ${iss.period}`, (w) => (iss.slugs || []).includes(w.slug));
  take("待辑散作 · 投稿已登记未封期", (w) => PENDING.includes(w.slug));
  const bySource = new Map();
  for (const w of missing) {
    if (used.has(w.slug) || !w.source) continue;
    used.add(w.slug);
    if (!bySource.has(w.source)) bySource.set(w.source, []);
    bySource.get(w.source).push(w);
  }
  for (const [src, rows] of bySource) groups.push({ name: `${src} · 同批同源（${rows.length} 篇）`, rows });
  take("其余散作 · 未标出处", () => true);
  return groups;
}

function build() {
  const all = collect();
  // 宽松写法统一归一化(20240911 / 2024.9.11 / 2024年9月11日 / 202409 / 2024-09 / 2024)
  all.forEach((w) => { if (w.created) w.created = normalizeCreated(w.created); });
  const created = {};
  all.forEach((w) => { if (createdKey(w.created)) created[w.slug] = w.created; });
  const orderIdx = {};
  sortByCreated(ORDER, created).forEach((s, i) => (orderIdx[s] = i));
  const sorted = all.slice().sort((a, b) => (orderIdx[a.slug] ?? 9999) - (orderIdx[b.slug] ?? 9999));
  const dated = sorted.filter((w) => createdKey(w.created));
  const missing = sorted.filter((w) => !createdKey(w.created));

  const row = (w) =>
    `| \`${w.slug}\` | ${w.title} | ${w.author} | ${w.genre} | ${w.created || "**待填**"} | ${w.source || (w.issue ? w.issue : "—")} | ${w.hints.length ? w.hints.join("；") : "—"} |`;

  const out = [];
  out.push("# 作品时间收集表（自动生成，勿手改）");
  out.push("");
  out.push("> 由 `node scripts/work-dates-report.js` 生成；改完作品 front matter 后重跑即可刷新。");
  out.push("> 目的：为缺 `created` 的篇目收集准确创作时间。**本表不替作者猜日期**，只把仓库里已有的证据（期/出处/干支落款/节令题名）摆出来供核对。");
  out.push("");
  out.push(`**当前进度：已填 ${dated.length} 篇 / 待填 ${missing.length} 篇（共 ${all.length} 篇）。**`);
  out.push("");
  out.push("## 一、怎么补填");
  out.push("");
  out.push("1. 与作者或编委核对到**年、月**即可（知道具体日子更好）。日期写法很随意，脚本会统一归一化：");
  out.push("   `20240911` · `2024.9.11` · `2024/9/11` · `2024年9月11日` · `2024-09-11`（到日）；`202409` · `2024-09`（只到月）；`2024`（只到年）；");
  out.push("2. 写进 front matter：");
  out.push("   ```bash");
  out.push("   npm run set-created -- w-mei 2024-05 w-feng 2024-06 --dry-run   # 先看改动");
  out.push("   npm run set-created -- w-mei 2024-05 w-feng 20240605           # 8 位/点号写法也认");
  out.push("   npm test && git add -A && git commit -m \"补创作时间\" && git push");
  out.push("   ```");
  out.push("3. 排序口径（单一真相在 `scripts/work-order.js`）：`created` **升序**（早者在前）；");
  out.push("   **模糊的往前排**——只知月份的排在该月有具体日子的**前面**（`2024-06` 在 `2024-06-07` 之前，`2024` 在 `2024-06` 之前）；");
  out.push("   **未填者不猜日期**——统一排在已填者之后，作品库里另立「年份待考」一节（组内保持 `fulltext_order.json` 原次序）。");
  out.push("   ⚠️ 旧口径是「未填者继承前一篇已填作品的时点」：因 `fulltext_order.json` 开头就是 2024-04-04 的清明雅集，");
  out.push("   30 多篇未填作品会被一律算作 2024-04-04（含 2026 年的投稿）挤作一堆，故已废弃。");
  out.push("");
  out.push("## 二、已填创作时间");
  out.push("");
  out.push("| 标识 | 题名 | 署名 | 体裁 | 创作时间 | 出处/期 | 线索 |");
  out.push("|---|---|---|---|---|---|---|");
  dated.forEach((w) => out.push(row(w)));
  out.push("");
  out.push("## 三、待填创作时间（按批次）");
  out.push("");
  out.push("> 「线索」一列只是提示（干支纪年每 60 年一轮，务必与作者核实），不是结论。");
  for (const b of batchesOf(missing)) {
    out.push(`### ${b.name}`);
    out.push("");
    out.push("| 标识 | 题名 | 署名 | 体裁 | 创作时间 | 出处/期 | 线索 |");
    out.push("|---|---|---|---|---|---|---|");
    b.rows.forEach((w) => out.push(row(w)));
    out.push("");
  }
  out.push("## 四、当前排序实际落点（按 `created` 推导后的顺序）");
  out.push("");
  out.push("> 表末若干篇即作品库里「年份待考」那一节；补填 `created` 后它们会自动归位到时间轴上。");
  out.push("");
  out.push("| # | 标识 | 题名 | 创作时间 | 状态 |");
  out.push("|---|---|---|---|---|");
  sorted.forEach((w, i) => {
    out.push(`| ${i + 1} | \`${w.slug}\` | ${w.title} | ${w.created || "—"} | ${createdKey(w.created) ? "已填" : "**年份待考**（库里另列一节）"} |`);
  });
  out.push("");
  return { md: out.join("\n"), dated: dated.length, missing: missing.length, total: all.length };
}

if (require.main === module) {
  const r = build();
  if (process.argv.includes("--stdout")) {
    process.stdout.write(r.md);
  } else {
    fs.writeFileSync(path.join(ROOT, "docs", "作品时间收集表.md"), r.md, "utf8");
    console.log(`✅ 已生成 docs/作品时间收集表.md（共 ${r.total} 篇：已填 ${r.dated} / 待填 ${r.missing}）`);
  }
}
module.exports = { build };
