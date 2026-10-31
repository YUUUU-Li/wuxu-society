// 有效阅读上报（配合 functions/api/hit.js）
//
// 干什么：盯住这一页"到底有没有被人读"，够了门槛就用 navigator.sendBeacon 报一次。
//   · 停留时长只在**页面可见**时累计 —— 切到别的标签页挂着不算读；
//   · 滚动深度取扫过的最大值；
//   · 点一下/摸一下/敲一下算一次交互。
//
// 门槛（**与 functions/api/hit.js 的 ENGAGED_MS / SHORT_MS 必须一致**，那边才是判定处，
// 这边只是"不够就不发"，省一次请求）：
//   · 可见停留 ≥ 8 秒 → 算读完（站着读完的短诗也算，不必滚动）
//   · 否则 ≥ 4 秒 **且**（滚过半 或 有过交互）→ 也算
// 为什么要 4 秒那条补充通道：本站多是短诗，一页往往根本不可滚动 ⇒ 滚动比例恒等于 100%，
// 照"三条满足任一"的字面执行，点开 0.5 秒就跑的人也会被判成有效。
//
// 不做的三件事（都是有意的）：
//   1. 不查 requestIdleCallback —— Safari 至今不支持它，拿它当"人"的证据会**排除所有 iPhone/Mac 读者**；
//   2. 不读页面正文、不取 canvas/字体指纹、不跨站、不连账号 —— 只发一个随机 UUID + 三个数字；
//   3. 任何异常都静默吞掉 —— 统计不许影响页面。上报失败就失败，不重试（重试只会放大噪声）。
(function () {
  "use strict";
  try {
    if (navigator.webdriver === true) return;                       // 自动化控制的一律不报
    if (!/^https?:$/.test(location.protocol)) return;                // file:// 预览不报

    // 与服务端 CONTENT_PATH_RE 同一口径（scripts/test-stats.js 守着这条不许走样）：
    // 只有内容页参与"有效阅读"；首页/作品库/社员那些入口页由"到达"层负责。
    var CONTENT_RE = /^\/(w-|qingming-|issue-|concepts\/|_fulltext)/;
    if (!CONTENT_RE.test(location.pathname)) return;

    var KEY = "wuxu_vid";
    var TTL = 365 * 24 * 3600 * 1000;      // 本地标识最长留 365 天
    var REFRESH = 30 * 24 * 3600 * 1000;   // 每 30 天才续期一次，避免每次开页都写 localStorage
    var ENGAGED_MS = 8000, SHORT_MS = 4000, SCROLL_MIN = 50;
    var ENDPOINT = "/api/hit";

    function now() {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    }
    function uuid() {
      try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
      try {
        var b = new Uint8Array(16); crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        var h = [], i;
        for (i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
        return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") +
               "-" + h.slice(8, 10).join("") + "-" + h.slice(10, 16).join("");
      } catch (e) { return ""; }
    }
    // 取/建本地标识。取不到（隐私模式、被禁用）就干脆不报 —— 服务端也不接受没有标识的上报。
    function vid() {
      try {
        var raw = localStorage.getItem(KEY), t = Date.now(), v = "", ts = 0, o;
        if (raw) { try { o = JSON.parse(raw); if (o && o.v) { v = String(o.v); ts = Number(o.t) || 0; } } catch (e) {} }
        if (!v || t - ts > TTL) { v = uuid(); ts = 0; }
        if (v && t - ts > REFRESH) localStorage.setItem(KEY, JSON.stringify({ v: v, t: t }));
        return v;
      } catch (e) { return ""; }
    }

    // —— 可见停留：只有 visibilityState === "visible" 的时段才累计 ——
    var acc = 0, mark = 0, counting = false;
    function beginWin() { if (!counting) { mark = now(); counting = true; } }
    function endWin() { if (counting) { acc += now() - mark; counting = false; } }
    function dwell() { return acc + (counting ? now() - mark : 0); }

    // —— 滚动深度（取最大值）——
    var scrolled = 0;
    function readScroll() {
      try {
        var doc = document.documentElement;
        var max = (doc.scrollHeight || 0) - (window.innerHeight || 0);
        var pct = max <= 0 ? 100 : Math.round(((window.pageYOffset || doc.scrollTop || 0) / max) * 100);
        if (pct > scrolled) scrolled = pct > 100 ? 100 : pct;
      } catch (e) {}
    }

    var interacted = false;
    function touch() { interacted = true; }

    var sent = false;
    function enough() {
      var d = dwell();
      if (d >= ENGAGED_MS) return true;
      return d >= SHORT_MS && (scrolled >= SCROLL_MIN || interacted);
    }
    function send() {
      if (sent) return;
      if (!enough()) return;
      var v = vid();
      if (!v) return;
      sent = true;
      try {
        readScroll();
        var payload = JSON.stringify({
          vid: v, path: location.pathname,
          dwell_ms: Math.round(dwell()), scrolled: scrolled, interacted: interacted
        });
        // 先用 sendBeacon（页面关掉也能发出去）；不支持时退到 fetch keepalive
        var ok = false;
        try {
          if (navigator.sendBeacon) {
            ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "text/plain;charset=UTF-8" }));
          }
        } catch (e) { ok = false; }
        if (!ok) {
          try {
            fetch(ENDPOINT, { method: "POST", body: payload, headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true, credentials: "same-origin" });
          } catch (e) {}
        }
      } catch (e) {}
    }

    if (document.visibilityState === "visible") beginWin();
    window.addEventListener("scroll", readScroll, { passive: true });
    window.addEventListener("resize", readScroll, { passive: true });
    document.addEventListener("click", touch, true);
    window.addEventListener("touchstart", touch, { passive: true, capture: true });
    window.addEventListener("keydown", touch, true);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { endWin(); send(); }
      else beginWin();
    });
    // 关页面/进 bfcache 的最后一次机会
    window.addEventListener("pagehide", function () { endWin(); send(); });
    readScroll();
    // 每秒自检一次（开销可忽略：只是读三个变量）
    var timer = setInterval(function () {
      if (sent) { clearInterval(timer); return; }
      try { if (enough()) { clearInterval(timer); send(); } } catch (e) {}
    }, 1000);

    // 给"清除我的本地标识"留一个口子（页脚暂时没放开，见 docs/编委操作手册.md §5.6）
    window.wuxuBeacon = { forget: function () { try { localStorage.removeItem(KEY); } catch (e) {} } };
  } catch (e) { /* 统计绝不能影响页面 */ }
})();
