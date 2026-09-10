// 众注·相似标签(余弦) 单元测试: scripts/test-related.js
// 复算示例(A 思念6/明月5/重逢3; B 思念9/重逢2; C 明月20/思念1; 冷门 D 思念2/重逢1; 只共享 1 词者 E 明月7)
// 口径(2026-09 修订): 只用读者票数; 不用 imageries 兜底; 共享下限 1。
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

// meta 里故意给 fallbackF 配上 imageries 却没有票 —— 它必须不出现(反证"意象不当票用")
const META = {
  a: { title: "甲作", imageries: [] },
  b: { title: "乙作", imageries: [] },
  c: { title: "丙作", imageries: [] },
  d2: { title: "丁作(冷门同主题)", imageries: [] },
  e1: { title: "戊作(只共享一词)", imageries: [] },
  fallbackF: { title: "己作(纯意象、无读者票)", imageries: ["思念", "重逢"] },
};
// 全站读者票: work -> word -> n
const VOTES = {
  a: { "思念": 6, "明月": 5, "重逢": 3 },
  b: { "思念": 9, "重逢": 2 },
  c: { "明月": 20, "思念": 1 }, // 共享两词, 但票几乎全押明月(爆款): 余弦应仍低于 b
  d2: { "思念": 2, "重逢": 1 },
  e1: { "明月": 7 }, // 与 a 仅共享 明月(1 词) -> 下限 1, 应当入选
};
const ROWS = [];
for (const w of Object.keys(VOTES))
  for (const word of Object.keys(VOTES[w]))
    ROWS.push({ w, word, c: VOTES[w][word] });

function FakeDB() {
  const stmt = { all: async () => ({ results: ROWS }) };
  return { prepare: () => ({ bind: () => stmt, all: stmt.all }) };
}
const makeCtx = (work) => ({
  request: new Request("https://x.test/api/related?work=" + work, { headers: { "cf-connecting-ip": "1.2.3.4" } }),
  env: { DB: FakeDB(), REL_META_JSON: JSON.stringify(META) },
});

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "related.js")).href);

  let r = await mod.onRequest({ request: new Request("https://x.test/api/related"), env: { DB: FakeDB(), REL_META_JSON: JSON.stringify(META) } });
  assert.strictEqual(r.status, 400, "缺 work 应 400");

  r = await mod.onRequest(makeCtx("a"));
  const j = await r.json();
  assert.strictEqual(r.status, 200, "related 应 200");
  assert(j.ok && Array.isArray(j.related), "响应形状");
  const order = j.related.map((x) => x.slug);

  // 1) 共享下限 1: 只共享一词的 e1 有资格上榜
  assert(order.includes("e1"), "共享 1 个标签就应上榜");
  const e1 = j.related.find((x) => x.slug === "e1");
  assert.deepStrictEqual(e1.shared, ["明月"], "e1 的共享词");
  const e1exp = 35 / (Math.sqrt(70) * 7);
  assert(Math.abs(e1.sim - Math.round(e1exp * 1000) / 1000) < 0.001, `e1 余弦应为 ${e1exp.toFixed(3)}`);

  // 2) 不再拿 imageries 兜底: 无票作品即使意象全同也不出现
  assert(!order.includes("fallbackF"), "无读者票的作品不得靠 imageries 上榜");
  r = await mod.onRequest(makeCtx("fallbackF"));
  assert.deepStrictEqual((await r.json()).related, [], "只有意象没有票的作品, 自己也不参与相似计算");

  // 3) 余弦序: 冷门同主题 d2 > 双主题 b > 单爆款 c > 只共享一词 e1
  assert(order.indexOf("d2") < order.indexOf("b"), "冷门同主题应胜过热闹双主题");
  assert(order.indexOf("b") < order.indexOf("c"), "双主题应胜过单爆款(余弦特性)");
  assert(order.indexOf("c") < order.indexOf("e1"), "共享两词应胜过只共享一词");
  assert(!order.includes("a"), "不含自身");
  assert.deepStrictEqual(j.related.slice(0, 4).map((x) => x.slug), ["d2", "b", "c", "e1"], "整体次序: " + order.join(" > "));

  // 4) 数值复算 + shared 按贡献降序
  const b = j.related.find((x) => x.slug === "b");
  const expect = 60 / (Math.sqrt(70) * Math.sqrt(85));
  assert(Math.abs(b.sim - Math.round(expect * 1000) / 1000) < 0.001, "b 余弦数值错误");
  assert.deepStrictEqual(b.shared, ["思念", "重逢"], "shared 按贡献降序");

  console.log("✅ test-related.js 全部通过 (只用读者票/共享下限1/无票不参与/余弦排序与数值复算)");
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
