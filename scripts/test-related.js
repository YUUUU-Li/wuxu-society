// 众注·相似标签(余弦) 单元测试: scripts/test-related.js
// 复算用户拍板的示例(A 思念6/明月5/重逢3; B 思念9/重逢2; C 明月20; 冷门 D2; 只共享1词者出局)
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

const META = {
  a: { title: "甲作", imageries: [] },
  b: { title: "乙作", imageries: [] },
  c: { title: "丙作", imageries: [] },
  d2: { title: "丁作(冷门同主题)", imageries: [] },
  e1: { title: "戊作(只共享一词)", imageries: [] },
  fallbackF: { title: "己作(纯意象回退)", imageries: ["思念", "重逢"] },
};
// 全站票: work -> word -> n
const VOTES = {
  a: { "思念": 6, "明月": 5, "重逢": 3 },
  b: { "思念": 9, "重逢": 2 },
  c: { "明月": 20, "思念": 1 }, // 共享两词, 但票数几乎全押明月(爆款): 余弦应仍低于 b
  d2: { "思念": 2, "重逢": 1 },
  e1: { "明月": 7 }, // 与 a 仅共享 明月(1词) -> 应被共享下限 2 排除
};
const ROWS = [];
for (const w of Object.keys(VOTES))
  for (const word of Object.keys(VOTES[w]))
    ROWS.push({ w, word, c: VOTES[w][word] });

function FakeDB() {
  const stmt = { all: async () => ({ results: ROWS }) };
  return { prepare: () => ({ bind: () => stmt, all: stmt.all }) };
}
const ctx = (work) => ({
  request: new Request("https://x.test/api/related?work=" + work, { headers: { "cf-connecting-ip": "1.2.3.4" } }),
  env: { DB: FakeDB(), REL_META_JSON: JSON.stringify(META) },
});

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "related.js")).href);

  let r = await mod.onRequest({ request: new Request("https://x.test/api/related"), env: { DB: FakeDB(), REL_META_JSON: JSON.stringify(META) } });
  assert.strictEqual(r.status, 400, "缺 work 应 400");

  r = await mod.onRequest(ctx("a"));
  const j = await r.json();
  assert.strictEqual(r.status, 200, "related 应 200");
  assert(j.ok && Array.isArray(j.related), "响应形状");
  const order = j.related.map((x) => x.slug);
  // 只共享一词的 e1 出局; 词向量与 a 全无交集的也应无
  assert(!order.includes("e1"), "共享 <2 应被排除");
  assert(!order.includes("a"), "不含自身");
  // 余弦序: 冷门同主题 d2 > 双主题 b > 单爆款 c; 纯意象回退 f 介于 b 与 c 之间(9/√2≈.76)
  assert(order.indexOf("d2") < order.indexOf("b"), "冷门同主题应胜过热闹双主题");
  assert(order.indexOf("b") < order.indexOf("c"), "双主题应胜过单爆款(余弦特性)");
  assert(order.includes("fallbackF"), "纯意象回退应参与");
  // sim 数值复算抽查: b 的余弦 ≈ 60/(√70·√85)
  const b = j.related.find((x) => x.slug === "b");
  const expect = 60 / (Math.sqrt(70) * Math.sqrt(85));
  assert(Math.abs(b.sim - Math.round(expect * 1000) / 1000) < 0.001, "b 余弦数值错误");
  assert.deepStrictEqual(b.shared, ["思念", "重逢"], "shared 按贡献降序");

  console.log("✅ test-related.js 全部通过 (余弦排序/共享下限/冷启动意象回退/数值复算)");
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
