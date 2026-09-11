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
    return state.me;
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
      slot.innerHTML = '<a class="txt nav-login" href="#" id="nav-login">登录 / 注册</a>';
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
      '<label class="zz-f"><span>昵称</span><input id="zz-a-nick" maxlength="20" autocomplete="username" placeholder="' +
        (isReg ? "社员建议用姓名缩写或笔名" : "注册时用的昵称") + '" /></label>' +
      '<label class="zz-f"><span>口令</span><input id="zz-a-pass" type="password" maxlength="64" autocomplete="' +
        (isReg ? "new-password" : "current-password") + '" placeholder="' + (isReg ? "至少 8 位" : "") + '" /></label>' +
      (isReg ? '<p class="zz-hint" id="zz-a-hint">昵称就是你的署名（会显示在标签与评论旁）。社员请尽量用姓名缩写或笔名，方便大家认得。</p>' : "") +
      '<div class="zz-authacts"><button class="btn" type="button" id="zz-a-ok">' + (isReg ? "注册并登录" : "登录") + "</button>" +
      '<button class="btn ghost" type="button" id="zz-a-switch">' + (isReg ? "已有账号，去登录" : "没有账号，去注册") + "</button></div>" +
      '<p class="zz-msgline" id="zz-a-msg"></p></div>';
    document.body.appendChild(box);

    var A = function (id) { return box.querySelector("#" + id); };
    var msgEl = A("zz-a-msg");
    function say(t, cls) { msgEl.textContent = t || ""; msgEl.className = "zz-msgline" + (cls ? " " + cls : ""); }
    A("zz-a-cancel").addEventListener("click", function () { box.remove(); });
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
    onChange: function (fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
  };
  window.zzAuth.ready = load();
})();
