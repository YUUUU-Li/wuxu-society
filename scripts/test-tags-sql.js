// 标签 SQL 落库脚本单测: node scripts/test-tags-sql.js
// 校验 sql/zhuzhu-tags-v1.sql 与 src/_data/tag_outline.json 一致(防两份真相漂移):
//   1) SQL 的 94 条 seed == 大纲词;
//   2) SQL 的归并表 == tag_outline.json 的 legacy(自映射不收 —— 收了会把大纲词本身删掉);
//   3) 归并目标都是大纲词, 归并表自建自删(脚本可重复执行);
//   4) 若运行时的 Node 带 node:sqlite(Node 22.5+), 就在内存库实跑一遍:
//      建表 -> 起步标签 -> 带历史票跑脚本 -> 再跑一遍验幂等, 并断言票数并入与去重。
//      (老版本 Node 没这个模块, 自动跳过实跑, 只做文本比对。)
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const O = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_data", "tag_outline.json"), "utf8"));
const words = O.categories.flatMap((c) => c.words);
const sqlPath = path.join(ROOT, "sql", "zhuzhu-tags-v1.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

// 取 "<marker> ... ;" 之间的第一段(用于按片段解析, 不误伤文件别处)
function blockAfter(marker) {
  const i = sql.indexOf(marker);
  assert(i >= 0, `SQL 里找不到片段: ${marker}`);
  const seg = sql.slice(i + marker.length);
  const j = seg.indexOf(";");
  assert(j >= 0, `SQL 片段缺分号: ${marker}`);
  return seg.slice(0, j);
}

// 1) 词表: SQL 的 seed == 大纲词
const seed = [...blockAfter("INSERT OR IGNORE INTO tags(word, kind) VALUES").matchAll(/\('([^']+)','预设'\)/g)].map((m) => m[1]);
assert.strictEqual(seed.length, new Set(seed).size, "SQL 词表有重复");
assert.strictEqual(seed.length, 94, `SQL 词表应 94 词, 实得 ${seed.length}`);
assert.deepStrictEqual(seed.slice().sort(), words.slice().sort(),
  "SQL 词表应与 tag_outline.json 完全一致(改词表请改 JSON -> npm run sync-tags -> 同步本 SQL)");

// 2) 归并表: SQL 映射 == JSON legacy(去掉自映射)
const pairs = [...blockAfter("INSERT INTO _tag_legacy_map(from_word, to_word) VALUES").matchAll(/\('([^']*)','([^']*)'\)/g)];
const sqlMap = {};
for (const [, from, to] of pairs) sqlMap[from] = to;
assert.strictEqual(pairs.length, Object.keys(sqlMap).length, "SQL 归并表有重复的 from_word");
const jsonMap = {};
for (const [k, v] of Object.entries(O.legacy || {})) if (k !== v) jsonMap[k] = v;
assert.deepStrictEqual(sqlMap, jsonMap, "SQL 归并表应与 tag_outline.json 的 legacy 一致(不含自映射)");
assert(!pairs.some(([, from, to]) => from === to), "归并表不得含自映射");
const inv = new Set(words);
const badTarget = pairs.filter(([, , to]) => to && !inv.has(to)).map(([, from, to]) => `${from}->${to}`);
assert.strictEqual(badTarget.length, 0, "归并目标必须都是大纲词: " + badTarget.join(" "));

// 3) 结构: seed 用 INSERT OR IGNORE(可重复), 归并表用后即删(不留业务 schema)
assert(/INSERT OR IGNORE INTO tags\(word, kind\)\s*SELECT DISTINCT to_word/.test(sql), "目标词落库应幂等(INSERT OR IGNORE)");
assert(/DROP TABLE IF EXISTS _tag_legacy_map;/.test(sql) && /DROP TABLE _tag_legacy_map;/.test(sql), "归并表应自建自删");

// 4) 实跑(有 node:sqlite 才跑)
let runtime = "文本比对";
try {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const snapshot = () => ({
    tags: db.prepare("SELECT COUNT(*) AS n FROM tags").get().n,
    votes: db.prepare("SELECT COUNT(*) AS n FROM tag_votes").get().n,
    kinds: db.prepare("SELECT DISTINCT kind FROM tags").all().map((r) => r.kind).join(","),
  });
  db.exec(fs.readFileSync(path.join(ROOT, "sql", "zhuzhu.sql"), "utf8"));
  db.exec(`
    -- 读者投票会即时建词, 历史库里未必只有 15 条起步标签
    INSERT OR IGNORE INTO tags(word, kind) VALUES ('离愁','预设'), ('风物','预设');
    INSERT INTO tag_votes(work_id, tag_id, voter_key) VALUES
      ('w-a', (SELECT id FROM tags WHERE word='思念'), 'ip1'),  -- 目标词同作品同人已有票 -> 重复票应被丢
      ('w-a', (SELECT id FROM tags WHERE word='离愁'), 'ip1'),
      ('w-b', (SELECT id FROM tags WHERE word='明月'), 'ip2'),  -- 普通并入
      ('w-c', (SELECT id FROM tags WHERE word='风物'), 'ip3'),  -- 弃用词 -> 票随词删
      ('w-d', (SELECT id FROM tags WHERE word='秋'),   'ip4'),  -- 并入 秋景
      ('w-e', (SELECT id FROM tags WHERE word='重逢'), 'ip5');  -- 本就在大纲内 -> 原样留
  `);
  db.exec(sql);
  const after = snapshot();
  assert.strictEqual(after.tags, 94, `落库词数应为 94, 实得 ${after.tags}`);
  assert.strictEqual(after.kinds, "预设", `落库后 kind 应全为预设, 实得 ${after.kinds}`);
  assert.strictEqual(after.votes, 4, `归并后应余 4 票(离愁/月/秋景/重逢), 实得 ${after.votes}`);
  const migrated = db.prepare(`SELECT t.word AS w, tv.work_id AS k FROM tag_votes tv
                               JOIN tags t ON t.id = tv.tag_id ORDER BY tv.work_id`).all()
    .map((r) => `${r.w}@${r.k}`);
  assert.deepStrictEqual(migrated, ["离愁@w-a", "月@w-b", "秋景@w-d", "重逢@w-e"], "票数并入结果: " + migrated.join(" "));
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM tags WHERE word='夜景'").get().n, 1, "「夜景」必须存活");
  db.exec(sql); // 幂等: 第二遍
  assert.deepStrictEqual(snapshot(), after, "第二遍执行应无任何变化");
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='_tag_legacy_map'").get().n, 0, "归并表应已删除");
  runtime = "文本比对 + 内存库实跑";
} catch (e) {
  if (!/node:sqlite|Cannot find module/.test(e.message)) throw e;
}

console.log(`✅ test-tags-sql.js 全部通过 (${runtime}: SQL 词表 ${seed.length} 词 · 归并 ${pairs.length} 条 · 与 tag_outline.json 一致)`);
