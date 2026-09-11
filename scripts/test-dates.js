// 创作时间(created)口径单测: node scripts/test-dates.js
// 覆盖三处必须一致的实现:
//   1) scripts/work-order.js  —— 排序/待考判定(构建与报告共用)
//   2) functions/api/submit.js —— 投稿入库前的校验与归一化
//   3) scripts/set-created.js —— 编委回填
// 另外锁死社内定的两条规矩: **升序** 与 **模糊的往前排**(2024.6 在 2024.6.7 之前)。
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

const { parseCreated, createdKey, normalizeCreated, cnCreated, sortByCreated, undatedSlugs } = require("./work-order.js");

// [输入, 归一化显示, 排序键]
const CASES = [
  ["20240911", "2024-09-11", "20240911"],
  ["2024-09-11", "2024-09-11", "20240911"],
  ["2024.9.11", "2024-09-11", "20240911"],
  ["2024.09.11", "2024-09-11", "20240911"],
  ["2024/9/11", "2024-09-11", "20240911"],
  ["2024年9月11日", "2024-09-11", "20240911"],
  [" 2024年9月11日 ", "2024-09-11", "20240911"],
  ["202409", "2024-09", "20240900"],
  ["2024-09", "2024-09", "20240900"],
  ["2024.9", "2024-09", "20240900"],
  ["2024年9月", "2024-09", "20240900"],
  ["2024", "2024", "20240000"],
  ["2024-06", "2024-06", "20240600"],
  ["20240607", "2024-06-07", "20240607"],
];
const BAD = ["", "   ", "abcd", "2024-13", "2024-00", "2024-06-32", "2024-02-30", "13", "202", "20249", "2024091", "202409111", "１２３４"];

async function main() {
  // 1) 解析与归一化
  for (const [input, text, key] of CASES) {
    const p = parseCreated(input);
    assert(p, `应认得「${input}」`);
    assert.strictEqual(p.text, text, `「${input}」应归一化为 ${text}`);
    assert.strictEqual(p.key, key, `「${input}」排序键应为 ${key}`);
    assert.strictEqual(normalizeCreated(input), text, `normalizeCreated(「${input}」)`);
    assert.strictEqual(createdKey(input), key, `createdKey(「${input}」)`);
  }
  for (const bad of BAD) {
    assert.strictEqual(parseCreated(bad), null, `不该认得「${bad}」`);
    assert.strictEqual(createdKey(bad), "", `「${bad}」排序键应为空(按年份待考处理)`);
  }
  assert.strictEqual(normalizeCreated("乱写"), "乱写", "认不出时原样返回, 不吞掉原作写法");
  assert.strictEqual(normalizeCreated(undefined), "", "undefined -> 空");

  // 1.5) 页面上怎么显示(作品页题下「创作时间」, .eleventy.js 的 cnDate 过滤器用的就是它)
  assert.strictEqual(cnCreated("2024-03-06"), "2024年3月6日", "到日");
  assert.strictEqual(cnCreated("20240911"), "2024年9月11日", "8 位数字也照样显示成中文");
  assert.strictEqual(cnCreated("2024.9"), "2024年9月", "只到月");
  assert.strictEqual(cnCreated("2024"), "2024年", "只到年");
  assert.strictEqual(cnCreated(""), "", "空 -> 空");
  assert.strictEqual(cnCreated("去年春天"), "去年春天", "认不出原样显示");

  // 2) 社内口径: 升序 + 模糊的往前排 + 未填最后 + 同时点稳定
  const order = ["a", "b", "c", "d", "e", "f", "g"];
  const created = {
    a: "2024.6.7",     // 2024-06-07
    b: "2024.6",       // 只到月 -> 排在该月具体日子之前
    c: "20240911",     // 2024-09-11
    d: "2024",         // 只到年 -> 排在该年所有月份之前
    e: "",             // 未填
  };
  assert.deepStrictEqual(sortByCreated(order, created), ["d", "b", "a", "c", "e", "f", "g"],
    "应为: 只到年 < 只到月 < 当月具体日子 < 后一月 < 未填");
  assert.deepStrictEqual(undatedSlugs(order, created), ["e", "f", "g"], "未填者列入年份待考");
  // 写错认不出的也按"年份待考", 不许乱插到时间轴里
  assert.deepStrictEqual(sortByCreated(["x", "y"], { x: "2024-13", y: "2024.5" }), ["y", "x"], "认不出的排最后");
  assert.deepStrictEqual(undatedSlugs(["x", "y"], { x: "2024-13", y: "2024.5" }), ["x"], "认不出的算待考");
  // 同时点保持原编排次序
  assert.deepStrictEqual(sortByCreated(["p", "q", "r"], { p: "20240607", q: "2024-06-07", r: "2024.6.7" }), ["p", "q", "r"],
    "同一时点(不同写法)保持原次序");

  // 3) 投稿接口口径必须与脚本一致(逐例比对)
  const sub = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "submit.js")).href);
  assert.strictEqual(typeof sub.parseCreated, "function", "submit.js 应导出 parseCreated(供比对)");
  for (const [input, text, key] of CASES) {
    const p = sub.parseCreated(input);
    assert(p, `投稿接口应认得「${input}」`);
    assert.strictEqual(p.text, text, `投稿接口「${input}」归一化应与脚本一致`);
    assert.strictEqual(p.key, key, `投稿接口「${input}」排序键应与脚本一致`);
  }
  for (const bad of BAD) {
    assert.strictEqual(sub.parseCreated(bad), null, `投稿接口不该认得「${bad}」`);
  }

  // 4) 投稿页里那份"整串日期"解析也要同口径(直接从 submit.njk 抠出来跑, 防止页面与脚本走偏)
  const njk = require("fs").readFileSync(path.join(__dirname, "..", "src", "submit.njk"), "utf8");
  const pageSrc = /var RE_DATE = [\s\S]*?function parseLooseDate\(v\) \{[\s\S]*?\n  \}/.exec(njk);
  assert(pageSrc, "应从 src/submit.njk 里找到整串日期解析代码(RE_DATE/parseLooseDate)");
  const pageParse = new Function(pageSrc[0] + "\nreturn parseLooseDate;")();
  const pad2 = (n) => ("0" + n).slice(-2);
  for (const [input, text] of CASES) {
    const want = parseCreated(input);
    const got = pageParse(input);
    if (!want.m) {
      // 只到年的写法(2024)交给页面上的年份下拉, "日"那一格不认它
      assert.strictEqual(got, null, `只到年的「${input}」应由年份下拉处理`);
      continue;
    }
    assert(got, `投稿页应认得「${input}」`);
    assert.deepStrictEqual(
      { y: String(got.y), mo: got.mo, d: got.d },
      { y: String(want.y), mo: pad2(want.m), d: want.d ? pad2(want.d) : "" },
      `投稿页「${input}」拆出来的年月日应与脚本一致（期望 ${text}）`
    );
  }
  for (const bad of BAD) {
    assert.strictEqual(pageParse(bad), null, `投稿页不该认得「${bad}」`);
  }
  assert.strictEqual(pageParse("7"), null, "只填 1–2 位的「日」不当作整串日期");
  assert.strictEqual(pageParse("2024"), null, "只填 4 位年份不当作整串日期(页面上另有年份下拉)");

  // 5) .eleventy.js 能加载, 且注册的 cnDate 过滤器与脚本同一口径(构建期真会用)
  const cfg = {};
  const stub = new Proxy({}, { get: (_t, k) => (k === "addFilter" ? (n, f) => { cfg[n] = f; } : () => {}) });
  require(path.join(__dirname, "..", ".eleventy.js"))(stub);
  assert(cfg.cnDate, ".eleventy.js 应注册 cnDate 过滤器");
  assert.strictEqual(cfg.cnDate("20240911"), "2024年9月11日", "cnDate 过滤器应认 8 位数字");
  assert.strictEqual(cfg.cnDate("2024-03-06"), "2024年3月6日", "cnDate 过滤器应与脚本同口径");

  console.log(`✅ test-dates.js 全部通过 (宽松写法归一化 ${CASES.length} 例 / 认不出 ${BAD.length} 例 / 升序+模糊在前 / 投稿接口同口径 / 投稿页同口径 / 构建期同口径)`);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
