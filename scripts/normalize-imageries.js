// 把作品的 imageries 收敛到标签大纲词: node scripts/normalize-imageries.js [--dry-run]
// 依据: src/_data/tag_outline.json 的词表 + 下方 MAP(历史写法 -> 大纲词)。
// 语义: 迁移遗留的同义/近义写法; 未在大纲中的词会被丢弃(dry-run 会列出来)。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORKS = path.join(ROOT, "src", "works");
const OUTLINE = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_data", "tag_outline.json"), "utf8"));
const OUT_WORDS = new Set(OUTLINE.categories.flatMap((c) => c.words));

// 历史写法 -> 大纲词(可一对多)
const MAP = {
  离别相思: ["离愁"], 离别: ["离愁"], 思念: ["离愁"],
  思乡归途: ["思乡"], 归乡: ["思乡"],
  月星: ["月", "星"], 月亮: ["月"], 明月: ["月"], 星际: ["星"],
  山水: ["山", "水"], 江: ["水"], 花木: ["花"], 梅: ["花"], 草木: ["草木"],
  凄冷: ["孤寂"], 累: ["忧郁"], 征人: ["怀人"], 修身: ["自省"],
  高中: ["校园"], 棋局: ["棋"], 恋: ["恋慕"], 爱: ["恋慕"],
  春: ["春景"], 夏: ["夏景"], 秋: ["秋景"], 冬: ["冬景"], 夜: ["夜景"],
  风物: [],  // 大纲无此词, 丢弃(由编委后续人工补)
};

function normalize(list) {
  const out = [];
  for (const w of list) {
    const mapped = Object.prototype.hasOwnProperty.call(MAP, w) ? MAP[w] : [w];
    for (const m of mapped) if (OUT_WORDS.has(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

function run({ dryRun } = {}) {
  const report = [];
  for (const f of fs.readdirSync(WORKS)) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(WORKS, f);
    const s = fs.readFileSync(p, "utf8");
    const m = /^imageries:\s*\[(.*?)\]\s*$/m.exec(s);
    if (!m) continue;
    const before = m[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
    const after = normalize(before);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      report.push({ slug: f.slice(0, -3), before, after });
      if (!dryRun) {
        const line = "imageries: [" + after.map((w) => `"${w}"`).join(", ") + "]";
        fs.writeFileSync(p, s.replace(/^imageries:.*$/m, line), "utf8");
      }
    }
  }
  const dropped = new Set();
  report.forEach((r) => r.before.forEach((b) => { if (!r.after.includes(b) && !MAP[b]) dropped.add(b); }));
  return { report, dropped: [...dropped] };
}

if (require.main === module) {
  const dry = process.argv.includes("--dry-run");
  const r = run({ dryRun: dry });
  if (!r.report.length) console.log("✅ 无需改动, 全部作品已符合大纲词");
  r.report.forEach((x) => console.log(`${dry ? "[干跑] " : "✅ "}${x.slug}: [${x.before.join(" ")}] -> [${x.after.join(" ")}]`));
  if (r.dropped.length) console.log("⚠️ 被丢弃(大纲无此词):", r.dropped.join(" "));
  console.log(`共 ${r.report.length} 篇${dry ? "(未写入)" : "已更新"}`);
}
module.exports = { run, normalize, MAP };
