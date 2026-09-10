// 作品排序口径(单一真相): 供 .eleventy.js 与 scripts/work-dates-report.js 共用
// 规则(2026-09 社内定):
//   1) 已填 created(YYYY-MM 或 YYYY-MM-DD) 的按 created 升序(早者在前);
//   2) 未填者**不猜日期**——统一排在已填者之后, 作品库里另立「年份待考」一节;
//   3) 同一时点(或都未填)的, 保持 fulltext_order.json 里的原编排次序。
// 旧口径是"未填者继承前一篇已填作品的时点", 因为 fulltext_order 开头是 2024-04-04 的清明雅集,
// 结果 30 多篇未填作品全被算作 2024-04-04 挤作一堆(含 2026 年的投稿), 故改为此口径。
function sortByCreated(order, created) {
  return (order || [])
    .map((s, i) => ({ s, i, k: (created && created[s]) || "" }))
    .sort((a, b) => {
      if (a.k && b.k) return String(a.k).localeCompare(String(b.k)) || a.i - b.i;
      if (a.k) return -1;   // 已填者在前
      if (b.k) return 1;
      return a.i - b.i;     // 都未填: 原编排次序
    })
    .map((x) => x.s);
}

// 未填创作时间的标识(作品库「年份待考」一节用)
function undatedSlugs(order, created) {
  return (order || []).filter((s) => !(created && created[s]));
}

module.exports = { sortByCreated, undatedSlugs };
