// 众注·账号前端（全站）: 导航右上角的「登录 / 注册」与账号态 + 登录/注册弹窗。
// 为什么独立成一个脚本: 打标签/评论/同感都要求登录, 而登录入口要在**每个页面**的右上角都能看到,
// 所以它不能塞在只存在于作品页的 zhuzhu.js 里。对外提供 window.zzAuth:
//   zzAuth.me                  当前登录者({id,handle,nick,role,member_state}) 或 null
//   zzAuth.ready               Promise: 登录态已就绪(解析为该登录者或 null)
//   zzAuth.open("login"|"register")   打开弹窗
//   zzAuth.onChange(fn)        登录态变化时回调(返回取消订阅函数); 注册后不会立刻回调一次
//   zzAuth.refresh()           重新拉一次登录态
(function () {
  "use strict";
  var api = "/api";
  var slot = document.getElementById("nav-auth");
  var state = { me: null };
  var listeners = [];

  function gid(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function emit() {
    listeners.slice().forEach(function (fn) { try { fn(state.me); } catch (e) { /* 单个订阅出错不影响别人 */ } });
  }

  async function load() {
    try {
      var r = await fetch(api + "/auth", { cache: "no-store" });
      var j = await r.json();
      state.me = (j && j.user) || null;
    } catch (e) { state.me = null; }   // 未部署/离线时当作未登录, 页面照常可用
    render();
    syncNoStats();
    loadStats();
    return state.me;
  }

  /* ---------- 浏览量(只给编委看; 读者与其它账号一律看不到) ----------
     两个点位, 都默认 hidden, 判定「是否编委」通过后才去拉 /api/stats 填入：
       · 作品页题下 #work-stats(带 data-work) → 只报**本篇**: /api/stats?work=<slug>
       · 首页 Hero  #site-stats             → 只报**全站**: /api/stats?derived=1
     全站数字**不公开**(2026-10-15 收回): 一度做过公开接口 /api/site-stats 放在首页给所有人看,
     但"访客"这个词在公开场合站不住 —— 指纹按天更换、且改版前的历史行没有机器标记, 只能当上界。
     编委 = 账号 role='编委'(state.me) 或过渡期的旧共享钥匙(sessionStorage 里的 zz_key)。
     注意: 本脚本在导航里执行, 此时 <main> 还没解析 —— 元素必须**每次现查**(不能脚本一开头就抓,
     否则永远是 null), 并且要在 DOMContentLoaded 后再试一次。 */
  var statsLoaded = false;
  function workStatsNode() { return document.getElementById("work-stats"); }
  function siteStatsNode() { return document.getElementById("site-stats"); }
  function legacyKey() { try { return sessionStorage.getItem("zz_key") || ""; } catch (e) { return ""; } }
  function statsOn() { return !!(state.me && state.me.role === "编委") || !!legacyKey(); }
  // 编委自己不计入统计: 编委态时种 zz_nostats=1（中间件见到直接跳过），退出编委/登出即清掉。
  // 说明: cookie 是 JS 种下的, 所以"登录后的第一个页面请求"仍会被算一次, 之后就不会了。
  function syncNoStats() {
    try {
      var has = /(?:^|;\s*)zz_nostats=1(?:;|$)/.test(document.cookie || "");
      if (statsOn() && !has) document.cookie = "zz_nostats=1; path=/; max-age=43200; SameSite=Lax";
      else if (!statsOn() && has) document.cookie = "zz_nostats=; path=/; max-age=0; SameSite=Lax";
    } catch (e) { /* 隐私模式等禁 cookie 的场景: 忽略 */ }
  }
  function fmtNum(n) {
    try { return Number(n || 0).toLocaleString("zh-CN"); } catch (e) { return String(n || 0); }
  }
  // 疑似机器那一小段(为 0 就不显示)
  function botBit(n) {
    return n > 0 ? '<span class="ws-bot">疑机 ' + fmtNum(n) + "</span>" : "";
  }
  // 作品页题下: **只报本篇**。有 beacon 数据就报「有效阅读 · 读者」，否则退回「到达 · 人次」。
  // 口径说明**不占版面** —— 放进 title, 鼠标悬停才显示(和首页那行同一套做法)。
  function renderWorkStats(el, j) {
    var w = j.work || { views: 0, uniq: 0, sviews: 0 };
    var eng = Number(w.reads || 0), ppl = Number(w.readers || 0);
    var useEng = typeof w.reads === "number";              // 接口给了有效阅读字段 ⇒ 就按新口径报（哪怕是 0）
    el.innerHTML = useEng
      ? "本篇有效阅读 <b>" + fmtNum(eng) + "</b> · 读者 <b>" + fmtNum(ppl) + "</b>" +
        botBit(w.sviews) + '<span class="ws-only">仅编委可见</span>'
      : "本篇到达 <b>" + fmtNum(w.views) + "</b> · 人次 <b>" + fmtNum(w.uniq) + "</b>" +
        botBit(w.sviews) + '<span class="ws-only">仅编委可见</span>';
    el.title = useEng
      ? "有效阅读 = 页面里报了停留/滚动/交互、并经**服务端复算**够门槛才记一次（≥8 秒；或 ≥4 秒且滚过半/有交互）。" +
        "读者 = 跨天去重的访客标识（≠账号、不等于人数上限）。" +
        "本篇到达 " + fmtNum(w.views) + " 次（服务端看到打开就算，含点开就退）。" +
        "【疑机】= 爬虫/脚本/AI 爬虫，单独记，不混进上面两个数。"
      : "本篇还没有有效阅读数据（接口还是旧版，或 beacon 没部署上）。" +
        "到达 = 服务端看到的页面打开次数（含点开就退）；人次 = 按天去重（≠人数）。" +
        "【疑机】= 疑似机器人的访问，单独记。";
    el.hidden = false;
  }
  // 首页 Hero: **只报全站**（内容页口径）。数字小、放不进括号说明, 所以口径与"上界"也写进 title。
  function renderSiteStats(el, j) {
    var d = j.derived;
    if (!d) return;
    var r = j.reads || null;
    var upper = Number(d.legacyDayCount || 0) > 0;         // 还有改版前的历史行 ⇒ 只能当上界
    var useEng = !!(r && typeof r.total === "number");     // 接口给了有效阅读层 ⇒ 就按新口径报（哪怕是 0）
    el.innerHTML = useEng
      ? "网站累计有效阅读 <b>" + fmtNum(r.total) + "</b> · 读者 <b>" + fmtNum(r.readers) + "</b>" +
        '<span class="ws-only">仅编委可见</span>'
      : "网站累计到达 <b>" + fmtNum(d.contentViews) + "</b> · 人次 <b>" + fmtNum(d.contentUniq) + "</b>" +
        '<span class="ws-only">仅编委可见</span>';
    el.title = useEng
      ? "全站内容页（作品 / 期页 / 概念页 / 全文库）的**有效阅读**与**读者**。" +
        "有效阅读经服务端复算（≥8 秒；或 ≥4 秒且滚过半/有交互）；读者 = 跨天去重的访客标识（≠账号）。" +
        "同口径下另有「到达」" + fmtNum(d.contentViews) + " 次（服务端看到打开就算，含点开就退）；" +
        "有效/到达 = " + (r.rate || 0) + "%，健康区间约 25%–45%。" +
        (upper ? "改版前的历史行没有机器标记、无法分离，到达那一层只能当上界。" : "")
      : "全站内容页（作品 / 期页 / 概念页 / 全文库）的打开次数与按天去重人次（≠人数）。" +
        "有效阅读还没有数据（接口还是旧版，或 beacon 没部署上）。" +
        (upper ? "改版前的历史行没有机器标记、无法分离，所以这两个数都是上界（不超过这么多）。" : "");
    el.hidden = false;
  }
  function hideStats(el) { if (el) { el.hidden = true; el.innerHTML = ""; el.textContent = ""; } }
  function loadStats(force) {
    var workEl = workStatsNode();
    var siteEl = siteStatsNode();
    if (!workEl && !siteEl) return;                        // 这页没有统计点位: 什么都不做
    if (!statsOn()) { hideStats(workEl); hideStats(siteEl); statsLoaded = false; return; }
    if (statsLoaded && !force) return;
    statsLoaded = true;
    var key = legacyKey();
    var tail = key ? "&key=" + encodeURIComponent(key) : "";
    // 作品页只要本篇(不跑回溯, 省掉最贵的全表去重); 首页只要全站聚合(要回溯, 所以带 derived=1)
    var q = workEl
      ? api + "/stats?work=" + encodeURIComponent(workEl.getAttribute("data-work") || "") + tail
      : api + "/stats?derived=1" + tail;
    fetch(q, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) {
          // 作品页那块小字是编委排错用的, 出错就**如实说明**, 不要静默消失;
          // 首页那行在 Hero 里, 出错只藏起来(不能在那里留一行报错)
          if (workEl) {
            workEl.textContent = "统计暂不可用" + (j && j.error ? "（" + j.error + "）" : "");
            workEl.hidden = false;
          }
          statsLoaded = false;
          return;
        }
        if (workEl) renderWorkStats(workEl, j);
        if (siteEl) renderSiteStats(siteEl, j);
      })
      .catch(function () { hideStats(workEl); hideStats(siteEl); statsLoaded = false; });
  }
  // DOM 解析完再试一次(脚本在导航里, 首跑时两个点位通常都还不存在)
  function statsWhenReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { loadStats(true); });
    } else {
      loadStats(true);
    }
  }

  function render() {
    if (!slot) return;
    if (state.me) {
      slot.innerHTML = '<span class="nav-who">' + esc(state.me.nick) +
        (state.me.role === "编委" ? " · 编委" : state.me.role === "社员" ? " · 社员" : "") + "</span>" +
        '<a class="txt" href="#" id="nav-logout">退出</a>';
      var lo = gid("nav-logout");
      if (lo) lo.addEventListener("click", function (ev) { ev.preventDefault(); logout(); });
    } else {
      // 未登录: 用页头按钮(原「申请入社」那款)的样式, 一眼能看见
      slot.innerHTML = '<a class="btn nav-login" href="#" id="nav-login">登录 / 注册</a>';
      var li = gid("nav-login");
      if (li) li.addEventListener("click", function (ev) { ev.preventDefault(); openAuth("login"); });
    }
  }

  async function logout() {
    try {
      await fetch(api + "/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    } catch (e) { /* 忽略: 本地照样切回未登录 */ }
    state.me = null;
    render();
    syncNoStats();
    loadStats(true);
    emit();
  }

  // 登录/注册弹窗
  function openAuth(mode) {
    var old = gid("zz-authbox");
    if (old) old.remove();
    var isReg = mode === "register";
    var box = document.createElement("div");
    box.id = "zz-authbox";
    box.className = "zz-authbox";
    box.innerHTML =
      '<div class="zz-authpanel" role="dialog" aria-label="登录或注册">' +
      '<div class="zz-authhd"><b id="zz-authtitle">' + (isReg ? "注册" : "登录") + "</b>" +
      '<button class="zz-x" type="button" id="zz-a-cancel" aria-label="关闭">×</button></div>' +
      '<label class="zz-f"><span>昵称</span><input id="zz-a-nick" type="text" maxlength="20" autocomplete="username" placeholder="社员建议用笔名" /></label>' +
      '<label class="zz-f"><span>口令</span><span class="zz-passwrap">' +
        '<input id="zz-a-pass" type="password" maxlength="64" autocomplete="' +
        (isReg ? "new-password" : "current-password") + '" placeholder="' + (isReg ? "至少 8 位" : "") + '" />' +
        '<button class="zz-eye" type="button" id="zz-a-eye" aria-label="显示口令" aria-pressed="false" title="显示 / 隐藏口令">' +
          '<svg class="eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>' +
          '<svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.7 6.2A10.6 10.6 0 0 1 12 6.1c6 0 9.5 5.9 9.5 5.9a17.6 17.6 0 0 1-3.4 4M6.4 8A17.3 17.3 0 0 0 2.5 12S6 17.9 12 17.9c1.1 0 2.1-.2 3-.5"/></svg>' +
        "</button></span></label>" +
      (isReg ? '<p class="zz-hint" id="zz-a-hint">昵称就是你的署名（会显示在标签与评论旁）。</p>' : "") +
      '<div class="zz-authacts"><button class="btn" type="button" id="zz-a-ok">' + (isReg ? "注册并登录" : "登录") + "</button>" +
      '<button class="btn" type="button" id="zz-a-switch">' + (isReg ? "已有账号，去登录" : "没有账号，去注册") + "</button></div>" +
      '<p class="zz-msgline" id="zz-a-msg"></p></div>';
    document.body.appendChild(box);

    var A = function (id) { return box.querySelector("#" + id); };
    var msgEl = A("zz-a-msg");
    function say(t, cls) { msgEl.textContent = t || ""; msgEl.className = "zz-msgline" + (cls ? " " + cls : ""); }
    A("zz-a-cancel").addEventListener("click", function () { box.remove(); });
    // 口令显示/隐藏(点一下在 ●●●● 与明文间切换)
    var passEl = A("zz-a-pass"), eyeEl = A("zz-a-eye");
    if (eyeEl) eyeEl.addEventListener("click", function () {
      var show = passEl.type === "password";
      passEl.type = show ? "text" : "password";
      eyeEl.classList.toggle("on", show);
      eyeEl.setAttribute("aria-pressed", show ? "true" : "false");
      eyeEl.setAttribute("aria-label", show ? "隐藏口令" : "显示口令");
      passEl.focus();
    });
    A("zz-a-switch").addEventListener("click", function () { box.remove(); openAuth(isReg ? "login" : "register"); });
    A("zz-a-ok").addEventListener("click", async function () {
      var nick = A("zz-a-nick").value.trim();
      var pass = A("zz-a-pass").value;
      if (!nick) { say("请填昵称。"); return; }
      if (!pass) { say("请填口令。"); return; }
      try {
        var payload = isReg ? { action: "register", nick: nick, pass: pass }
                           : { action: "login", nick: nick, pass: pass };
        var r = await fetch(api + "/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        var j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "失败");
        state.me = j.user;
        if (j.recoverCode) {
          window.alert("注册成功！请把下面这串「恢复码」自己存好（换设备或忘记口令时用它重设）：\n\n" + j.recoverCode +
            (j.note ? "\n\n" + j.note : ""));
        }
        box.remove();
        render();
        syncNoStats();
        loadStats(true);
        emit();
      } catch (e) { say(e.message, "bad"); }
    });
    A("zz-a-nick").focus();
  }

  window.zzAuth = {
    get me() { return state.me; },
    ready: null,
    open: openAuth,
    refresh: load,
    logout: logout,
    // 编委开关旧钥匙后, 由 zhuzhu.js 叫一次: 同步"不计入统计"的 cookie + 刷新数字
    statsRefresh: function () { syncNoStats(); loadStats(true); },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
  };
  window.zzAuth.ready = load();
  statsWhenReady();
})();
