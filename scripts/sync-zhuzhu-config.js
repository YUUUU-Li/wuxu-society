// 由 src/_data/site.json 生成 functions/api/zhuzhu-config.js
// 用法: node scripts/sync-zhuzhu-config.js    (npm run sync-zhuzhu)
// 为什么: Workers 里没有文件系统, 众注的可配置项必须编译进函数(与 tag-outline.js 同一套路)。
// 说明: 账号已简化为"昵称 + 口令", 不再查社员名册、不做保留昵称, 所以这里只剩投票人可见性一项。
//       改 site.json 的 showVoters 之后重跑本脚本 + npm test。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "functions", "api", "zhuzhu-config.js");

// 归一化规则与 functions/api/auth.js 的 normName 保持一致(scripts/test-auth.js 会交叉校验)
function normName(s) {
  return String(s == null ? "" : s)
    .normalize("NFKC")
    .replace(/[\s·・.,，。、:：;；!！?？'"“”‘’()（）\[\]{}<>《》\-_/\\|]/g, "")
    .toLowerCase();
}

function build() {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data", "site.json"), "utf8"));
  const showVoters = (site.zhuzhu && site.zhuzhu.showVoters) || "admin";
  if (!["admin", "aggregate", "public"].includes(showVoters)) {
    throw new Error(`site.json 的 zhuzhu.showVoters 只能是 admin | aggregate | public, 实得 ${showVoters}`);
  }
  const js =
    "// 由 scripts/sync-zhuzhu-config.js 生成, 勿手改\n" +
    "// (改 site.json 后重跑: npm run sync-zhuzhu && npm test)\n" +
    `export const SHOW_VOTERS = ${JSON.stringify(showVoters)};\n`;
  fs.writeFileSync(OUT, js, "utf8");
  return { showVoters };
}

if (require.main === module) {
  try {
    const r = build();
    console.log(`✅ 已生成 functions/api/zhuzhu-config.js（投票人可见性 ${r.showVoters}）`);
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
}
module.exports = { build, normName };
