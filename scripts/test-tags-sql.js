// 标签 SQL 落库脚本单测: node scripts/test-tags-sql.js
// 校验 sql/zhuzhu-tags-v1.sql 与 src/_data/tag_outline.json 一致(防两份真相漂移):
//   1) 四段 seed 的 94 词 == 大纲词; 2) 转正表 == 大纲词; 3) 归并表 == tag_outline.json 的 legacy(自映射不收);
//   4) 归并目标都是大纲词, 归并表自建自删(脚本可重复执行), seed 分段(控制台一段一段粘);
//   5) 若运行时的 Node 带 node:sqlite(Node 22.5+), 就在内存库实跑一遍:
//      建表 -> 起步标签 + 历史候选/旧写法 + 真实票 -> 跑脚本 -> 再跑一遍验幂等,
//      断言: 落库 94 词全为预设、大纲词里的「候选」被转正、表外候选保留、旧写法票已并入、重复票已去重。
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
const sortWords = (a) => a.slice().sort();

// 1) 四段 seed 合计 == 大纲词
const seedBlocks = sql.split("INSERT OR IGNORE INTO tags(word, kind) VALUES").slice(1);
const seed = seedBlocks.flatMap((b) => [...b.split(";")[0].matchAll(/\('([^']+)','预设'\)/g)].map((m) => m[1]));
assert.strictEqual(seedBlocks.length, 4, `seed 应分成 4 段(意象/情感/手法/题材)便于控制台分段粘, 实得 ${seedBlocks.length}`);
assert.strictEqual(seed.length, new Set(seed).size, "SQL 词表有重复");
assert.strictEqual(seed.length, 94, `SQL 词表应 94 词, 实得 ${seed.length}`);
assert.deepStrictEqual(sortWords(seed), sortWords(words),
  "SQL 词表应与 tag_outline.json 完全一致(改词表请改 JSON -> npm run sync-tags -> 同步本 SQL)");

// 2) 转正表(候选 -> 预设) == 大纲词
const promo = [...blockAfter("UPDATE tags SET kind = '预设' WHERE kind = '候选' AND word IN (").matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.deepStrictEqual(sortWords(promo), sortWords(words), "转正表应与大纲词一致(历史「候选」需转正才进联想池)");

// 3) 归并表 == JSON legacy(去掉自映射)
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

// 4) 结构: seed 幂等, 归并表自建自删(不留业务 schema)
assert(seedBlocks.every((b) => b.length > 0), "seed 段不得为空");
assert(/DROP TABLE IF EXISTS _tag_legacy_map;/.test(sql) && /DROP TABLE _tag_legacy_map;/.test(sql), "归并表应自建自删");

// 5) 实跑(有 node:sqlite 才跑)
let runtime = "文本比对";
let DatabaseSync = null;
try { ({ DatabaseSync } = require("node:sqlite")); } catch { /* 老版本 Node 没有此模块 */ }
try {
  if (!DatabaseSync) throw new Error("Cannot find module node:sqlite");
  const db = new DatabaseSync(":memory:");
  const snapshot = () => ({
    tags: db.prepare("SELECT COUNT(*) AS n FROM tags").get().n,
    votes: db.prepare("SELECT COUNT(*) AS n FROM tag_votes").get().n,
    candidate: db.prepare("SELECT group_concat(word) AS w FROM tags WHERE kind='候选'").get().w || "",
  });
  db.exec(fs.readFileSync(path.join(ROOT, "sql", "zhuzhu.sql"), "utf8"));
  db.exec(`
    -- 历史库真实样子: 读者投票会即时建词(大纲词也可能先以「候选」落库), 编委可能建过表外候选
    INSERT OR IGNORE INTO tags(word, kind) VALUES
      ('离愁','候选'), ('思乡','候选'), ('风物','预设'), ('JOJO','候选');
    INSERT INTO tag_votes(work_id, tag_id, voter_key) VALUES
      ('w-a', (SELECT id FROM tags WHERE word='思念'), 'ip1'),   -- 目标词同作品同人已有票 -> 重复票应被丢
      ('w-a', (SELECT id FROM tags WHERE word='离愁'), 'ip1'),
      ('w-b', (SELECT id FROM tags WHERE word='明月'), 'ip2'),   -- 普通并入
      ('w-c', (SELECT id FROM tags WHERE word='风物'), 'ip3'),   -- 弃用词 -> 票随词删
      ('w-d', (SELECT id FROM tags WHERE word='秋'),   'ip4'),   -- 并入 秋景
      ('w-e', (SELECT id FROM tags WHERE word='重逢'), 'ip5'),   -- 本就在大纲内 -> 原样留
      ('w-f', (SELECT id FROM tags WHERE word='夜'),   'ip1'),   -- 并入 夜景
      ('w-g', (SELECT id FROM tags WHERE word='思乡'), 'ip6'),   -- 候选的大纲词 -> 转正且票留住
      ('w-h', (SELECT id FROM tags WHERE word='JOJO'), 'ip7');   -- 表外候选 -> 仍是候选
  `);
  db.exec(sql);
  const after = snapshot();
  assert.strictEqual(after.tags, 95, `落库应 94 大纲词 + 1 表外候选 = 95, 实得 ${after.tags}`);
  assert.strictEqual(after.candidate, "JOJO", `表外候选应原样保留, 实得 ${after.candidate}`);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM tags WHERE kind='预设'").get().n, 94, "应 94 条预设");
  assert.strictEqual(after.votes, 7, `归并后应余 7 票, 实得 ${after.votes}`);
  const migrated = db.prepare(`SELECT t.word AS w, tv.work_id AS k, t.kind AS kind FROM tag_votes tv
                               JOIN tags t ON t.id = tv.tag_id ORDER BY tv.work_id`).all()
    .map((r) => `${r.w}@${r.k}${r.kind === "候选" ? "(候选)" : ""}`);
  assert.deepStrictEqual(migrated,
    ["离愁@w-a", "月@w-b", "秋景@w-d", "重逢@w-e", "夜景@w-f", "思乡@w-g", "JOJO@w-h(候选)"],
    "票数并入结果: " + migrated.join(" "));
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM tags WHERE word='夜景'").get().n, 1, "「夜景」必须存活");
  db.exec(sql); // 幂等: 第二遍
  assert.deepStrictEqual(snapshot(), after, "第二遍执行应无任何变化");
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='_tag_legacy_map'").get().n, 0, "归并表应已删除");
  runtime = "文本比对 + 内存库实跑";
} catch (e) {
  if (!/node:sqlite|Cannot find module/.test(e.message)) throw e;
}

// 6) sql/tags-v1/ 拆分包(控制台一次只认一条语句, 故一条一个文件)
//    两道检查: ① 词表/转正表与大纲一致; ② 每个文件都能真执行 —— 专抓"漏了 -- 的说明文字"这类
//    会让整条语句报 syntax error 的致命笔误(线上真踩过一次)。
const stepDir = path.join(ROOT, "sql", "tags-v1");
const stepFiles = fs.readdirSync(stepDir).filter((f) => f.endsWith(".sql")).sort();
assert(stepFiles.length >= 15, `拆分包文件数不足: ${stepFiles.length}`);
const stepRead = (f) => fs.readFileSync(path.join(stepDir, f), "utf8");
const stepWords = stepFiles.flatMap((f) => [...stepRead(f).matchAll(/\('([^']+)','预设'\)/g)].map((m) => m[1]));
assert.deepStrictEqual(sortWords(stepWords), sortWords(words), "拆分包的落库词表应与大纲一致");
const promoFile = stepFiles.find((f) => f.startsWith("05-"));
assert(promoFile, "拆分包应有 05-候选转正");
// 只取 "word IN ( ... )" 之间的词, 免得把 `kind = '预设'` 这类字面量也算进来
const promoStep = [...(stepRead(promoFile).split("word IN (")[1] || "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.deepStrictEqual(sortWords(promoStep), sortWords(words), "拆分包的转正表应与大纲一致");

if (DatabaseSync) {
  const sdb = new DatabaseSync(":memory:");
  sdb.exec(fs.readFileSync(path.join(ROOT, "sql", "zhuzhu.sql"), "utf8"));
  sdb.exec("INSERT OR IGNORE INTO tags(word,kind) VALUES ('离愁','候选'),('怀人','预设'),('JOJO','候选')");
  const before = sdb.prepare("SELECT COUNT(*) AS n FROM tags").get().n;
  for (const f of stepFiles) {
    const body = stepRead(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const stmt of body.split(";").map((s) => s.trim()).filter(Boolean)) {
      try {
        sdb.exec(stmt + ";");
      } catch (e) {
        throw new Error(`sql/tags-v1/${f} 里的语句执行失败(检查是否漏了 -- 注释符): ${e.message}`);
      }
    }
  }
  const after = sdb.prepare("SELECT kind, COUNT(*) AS n FROM tags GROUP BY kind").all();
  assert.strictEqual(after.find((r) => r.kind === "预设").n, 94, "拆分包跑完应有 94 条预设");
  assert.strictEqual(after.find((r) => r.kind === "候选").n, 1, "表外候选应保留(JOJO)");
  assert.strictEqual(sdb.prepare("SELECT COUNT(*) AS n FROM tags WHERE word IN ('思念','明月','夜','秋','离别','归乡')").get().n, 0,
    "拆分包跑完不应残留旧写法");
  runtime += ` + 拆分包 ${stepFiles.length} 文件(${before}→${sdb.prepare("SELECT COUNT(*) AS n FROM tags").get().n} 条)`;
}

console.log(`✅ test-tags-sql.js 全部通过 (${runtime}: seed ${seed.length} 词分 4 段 · 转正 ${promo.length} 词 · 归并 ${pairs.length} 条 · 与 tag_outline.json 一致)`);
