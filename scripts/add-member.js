// 一键入册: node scripts/add-member.js <缩写> <笔名> [选项]
//   --branch 金华总部   (默认 金华总部; 不存在则新建该分部)
//   --role 社员         (默认 社员)
//   --note "一句话"     (可选, 名册里的简介)
//   --link w-xxx.html:作品：xxx   (可多次, 关联作品链接)
// 作用: 把新社友写进 src/_data/members.json, 社员页(members.html)随之更新。
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "src", "_data", "members.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, data) {
  const text = JSON.stringify(data, null, 2).split("\n").join("\r\n") + "\r\n";
  fs.writeFileSync(p, text, "utf8");
}

function addMember(file, opts) {
  const data = readJson(file);
  const id = String(opts.id || "").trim().toLowerCase();
  const penname = String(opts.penname || "").trim();
  const branch = String(opts.branch || "金华总部").trim();
  const role = String(opts.role || "社员").trim();
  const note = String(opts.note || "").trim();
  const links = (opts.links || []).map((l) => {
    const i = String(l).indexOf(":");
    return i === -1 ? { href: l, label: l } : { href: l.slice(0, i), label: l.slice(i + 1) };
  });

  if (!/^[a-z][a-z0-9-]{0,15}$/.test(id)) throw new Error("缩写需以小写字母开头，只含小写字母/数字/连字符（如 zhenyue）");
  if (!penname) throw new Error("请给出笔名或称呼");
  const exists = data.some((sec) => sec.members.some((m) => m.id === id));
  if (exists) throw new Error(`名册里已有缩写「${id}」，如需修改请直接编辑 src/_data/members.json`);

  let sec = data.find((s) => s.branch === branch);
  if (!sec) {
    sec = { branch, members: [] };
    data.push(sec);
  }
  sec.members.push({
    id,
    name: penname === id ? id : id + " · " + penname,
    role,
    branch,
    note,
    links,
  });
  writeJson(file, data);
  return { id, name: penname, branch, role, links: links.length };
}

function parseArgs(argv) {
  const out = { links: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--branch") out.branch = argv[++i];
    else if (a === "--role") out.role = argv[++i];
    else if (a === "--note") out.note = argv[++i];
    else if (a === "--link") out.links.push(argv[++i]);
    else rest.push(a);
  }
  out.id = rest[0];
  out.penname = rest[1];
  return out;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.id || !opts.penname) {
    console.log("用法: npm run add-member -- <缩写> <笔名> [--branch 金华总部] [--role 社员] [--note \"简介\"] [--link w-xxx.html:作品：xxx]");
    process.exit(1);
  }
  try {
    const r = addMember(DATA, opts);
    console.log(`✅ 已入册: ${r.name}（${r.id}）· ${r.branch} · ${r.role}` + (r.links ? ` · ${r.links} 个作品链接` : ""));
    console.log("下一步: npm run build && npm test 通过后提交推送（或直接在入社 PR 里改 members.json 一并合并）。");
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
}

module.exports = { addMember };
