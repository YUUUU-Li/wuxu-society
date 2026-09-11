// 作品创作时间(created)的解析与排序口径(单一真相): 供 .eleventy.js / scripts/* 共用
//
// 一、能认哪些写法(社内实测, 越随意越好):
//    20240911 · 2024-09-11 · 2024.9.11 · 2024/9/11 · 2024年9月11日   -> 2024-09-11
//    202409   · 2024-09 · 2024.9 · 2024年9月                        -> 2024-09
//    2024                                                          -> 2024
//    认不出的(如 2024-13、abcd)一律当"没填"—— 宁可进「年份待考」, 也不乱排。
//
// 二、排序规则(2026-09 社内定):
//    1) 已填 created 的按 created **升序**(早者在前);
//    2) **模糊的往前排**: 同年只知月份 -> 排在该月有具体日子的前面
//       (2024-06 在 2024-06-07 之前; 2024 在 2024-06 之前);
//       做法是把年月日补零成 8 位数字当排序键: 2024 -> 20240000, 2024-06 -> 20240600, 2024-06-07 -> 20240607;
//    3) 未填(或认不出)者**不猜日期**——统一排在已填者之后, 作品库里另立「年份待考」一节;
//    4) 同一时点(或都未填)的, 保持 fulltext_order.json 里的原编排次序。
//    旧口径是"未填者继承前一篇已填作品的时点"(fulltext_order 开头是 2024-04-04 的清明雅集),
//    结果 30 多篇未填作品全被算作 2024-04-04 挤作一堆(含 2026 年投稿), 故改为此口径。
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad2 = (n) => ("0" + n).slice(-2);

// "20240911" / "2024.6.7" / "2024年6月7日" / "2024-06" / "2024" -> { y, m, d, key, text } 或 null
function parseCreated(s) {
  const raw = String(s == null ? "" : s).trim();
  if (!raw) return null;
  const parts = raw.split(/[^\d]+/).filter((x) => x !== "");
  let y = "";
  let m = "";
  let d = "";
  if (parts.length >= 3) {
    [y, m, d] = parts;
  } else if (parts.length === 2) {
    [y, m] = parts;
  } else {
    const t = parts[0] || "";
    if (t.length === 4) y = t;
    else if (t.length === 6) { y = t.slice(0, 4); m = t.slice(4); }
    else if (t.length === 8) { y = t.slice(0, 4); m = t.slice(4, 6); d = t.slice(6); }
    else return null;
  }
  if (!/^\d{4}$/.test(y)) return null;
  const yi = Number(y);
  if (yi < 1000 || yi > 2999) return null;
  let mi = null;
  let di = null;
  if (m !== "") {
    if (!/^\d{1,2}$/.test(m)) return null;
    mi = Number(m);
    if (mi < 1 || mi > 12) return null;
  }
  if (d !== "") {
    if (!/^\d{1,2}$/.test(d)) return null;
    di = Number(d);
    if (di < 1 || di > (mi ? MONTH_DAYS[mi - 1] : 31)) return null;
  }
  return {
    y: yi,
    m: mi,
    d: di,
    key: y + (mi ? pad2(mi) : "00") + (di ? pad2(di) : "00"),
    text: y + (mi ? "-" + pad2(mi) : "") + (di ? "-" + pad2(di) : ""),
  };
}

// 排序键: 认不出/没填 -> ""(排在最后)
function createdKey(s) {
  const p = parseCreated(s);
  return p ? p.key : "";
}

// 归一化显示: 认得出就转成 YYYY[-MM[-DD]], 认不出就原样返回(不吞掉原作写法)
function normalizeCreated(s) {
  const p = parseCreated(s);
  return p ? p.text : String(s == null ? "" : s).trim();
}

// 显示用(作品页题下「创作时间」): 2024-03-06 -> 2024年3月6日; 只到月 -> 2024年3月; 只到年 -> 2024年; 认不出原样
function cnCreated(s) {
  const p = parseCreated(s);
  if (!p) return String(s == null ? "" : s).trim();
  return p.y + "年" + (p.m ? p.m + "月" : "") + (p.d ? p.d + "日" : "");
}

function sortByCreated(order, created) {
  return (order || [])
    .map((s, i) => ({ s, i, k: createdKey(created && created[s]) }))
    .sort((a, b) => {
      if (a.k && b.k) return a.k.localeCompare(b.k) || a.i - b.i;
      if (a.k) return -1;   // 已填者在前
      if (b.k) return 1;
      return a.i - b.i;     // 都未填: 原编排次序
    })
    .map((x) => x.s);
}

// 未填(或写错认不出)创作时间的标识(作品库「年份待考」一节用)
function undatedSlugs(order, created) {
  return (order || []).filter((s) => !createdKey(created && created[s]));
}

module.exports = { parseCreated, createdKey, normalizeCreated, cnCreated, sortByCreated, undatedSlugs };
