// 由 src/_data/members.json + src/_data/site.json 生成 functions/api/zhuzhu-config.js
// 用法: node scripts/sync-zhuzhu-config.js    (npm run sync-zhuzhu)
// 为什么: Workers 里没有文件系统, 保留名单与可见性开关必须编译进函数(与 tag-outline.js 同一套路)。
// 改名册(新增社员/改笔名) 或 改 site.json 的 showVoters 之后, 请重跑本脚本 + npm test。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "functions", "api", "zhuzhu-config.js");

// 归一化规则必须与 functions/api/auth.js 的 normName 完全一致
// (scripts/test-auth.js 会交叉校验两边结果, 防止悄悄漂移)
function normName(s) {
  return String(s == null ? "" : s)
    .normalize("NFKC")
    .replace(/[\s·・.,，。、:：;；!！?？'"“”‘’()（）\[\]{}<>《》\-_/\\|]/g, "")
    .toLowerCase();
}

function build() {
  const members = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/members.json"), "utf8"));
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/site.json"), "utf8"));

  // 保留名单: 缩写 + 笔名 + 括号别名(如「新酒（Hugo）」里的 Hugo), 键为归一化形式
  const reserved = new Map();
  for (const sec of members) {
    for (const m of sec.members || []) {
      const label = m.name || m.id;
      const parts = [m.id, ...String(m.name || "").split("·").map((s) => s.trim())];
      for (const raw of parts) {
        const stripped = raw.replace(/[（(][^）)]*[）)]/g, "").trim();
        if (stripped) reserved.set(normName(stripped), label);
        for (const inner of raw.matchAll(/[（(]([^）)]+)[）)]/g)) {
          const k = normName(inner[1]);
          if (k) reserved.set(k, label);
        }
      }
    }
  }

  const showVoters = (site.zhuzhu && site.zhuzhu.showVoters) || "admin";
  if (!["admin", "aggregate", "public"].includes(showVoters)) {
    throw new Error(`site.json 的 zhuzhu.showVoters 只能是 admin | aggregate | public, 实得 ${showVoters}`);
  }

  const js =
    "// 由 scripts/sync-zhuzhu-config.js 生成, 勿手改\n" +
    "// (改 src/_data/members.json 或 site.json 后重跑: npm run sync-zhuzhu && npm test)\n" +
    `export const RESERVED_NAMES = ${JSON.stringify([...reserved.keys()].sort(), null, 0)};\n` +
    `export const RESERVED_LABEL = ${JSON.stringify(Object.fromEntries(reserved), null, 0)};\n` +
    `export const SHOW_VOTERS = ${JSON.stringify(showVoters)};\n`;
  fs.writeFileSync(OUT, js, "utf8");
  return { count: reserved.size, showVoters };
}

if (require.main === module) {
  try {
    const r = build();
    console.log(`✅ 已生成 functions/api/zhuzhu-config.js（保留昵称 ${r.count} 个 · 投票人可见性 ${r.showVoters}）`);
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
}
module.exports = { build, normName };
