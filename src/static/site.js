/* 婺需文学社 共享脚本: 入场揭示 + 表单校验 */
(function(){
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce && "IntersectionObserver" in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, {threshold:.1, rootMargin:"0px 0px -5% 0px"});
    document.querySelectorAll(".rv").forEach(function(el){ io.observe(el); });
  } else {
    document.querySelectorAll(".rv").forEach(function(el){ el.classList.add("in"); });
  }

  var form = document.getElementById("join-form");
  var msg  = document.getElementById("form-msg");
  if (form){
    form.addEventListener("submit", function(ev){
      ev.preventDefault();
      msg.className = "form-msg";
      var name = form.penname.value.trim();
      var mail = form.mail.value.trim();
      var mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
      if (!name){ msg.textContent = "请先留下笔名或称呼。"; msg.className = "form-msg err"; form.penname.focus(); }
      else if (!mail){ msg.textContent = "请填写邮箱，方便社长回信。"; msg.className = "form-msg err"; form.mail.focus(); }
      else if (!mailOk){ msg.textContent = "邮箱格式不正确，请检查后重试。"; msg.className = "form-msg err"; form.mail.focus(); }
      else {
        msg.textContent = "已收到申请。入社说明将发送至你的邮箱，请静候。";
        form.reset();
      }
    });
  }

  /* 移动端导航菜单: 点按钮向下展开/收起 */
  var navWrap = document.querySelector(".nav");
  var navBtn = document.getElementById("nav-toggle");
  function setNav(open) {
    if (navWrap) navWrap.classList.toggle("open", open);
    if (navBtn) navBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (navBtn && navWrap) {
    navBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      setNav(!navWrap.classList.contains("open"));
    });
    document.addEventListener("click", function (e) {
      if (navWrap.classList.contains("open") && !e.target.closest(".nav")) setNav(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setNav(false);
    });
    // 点击菜单内链接后自动收起
    navWrap.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { setNav(false); });
    });
  }

  /* 关联作品轮换: 每次打开页面随机抽选一批, 点"换一批"再抽 */
  function relShuffle() {
    document.querySelectorAll("ul.rel-ul[data-rotate]").forEach(function (ul) {
      var max = parseInt(ul.getAttribute("data-rotate"), 10) || 5;
      var tpl = ul.parentNode.querySelector("template.rel-pool");
      // 池 = template 全量节点(唯一)；初始列表只是无 JS 兜底, 不参与抽选, 否则会与池重复
      var pool = tpl
        ? Array.prototype.slice.call(tpl.content.querySelectorAll("li"))
        : Array.prototype.slice.call(ul.children);
      if (!pool.length) return;
      var h4 = ul.previousElementSibling;
      var btn = h4 && h4.querySelector("button.shuffle");
      function pick() {
        var arr = pool.slice();
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        var n = Math.min(max, arr.length);
        var frag = document.createDocumentFragment();
        for (var k = 0; k < n; k++) frag.appendChild(arr[k]);
        ul.innerHTML = "";
        ul.appendChild(frag);
        if (btn && pool.length > max) btn.hidden = false;
      }
      pick();
      if (btn) btn.addEventListener("click", pick);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", relShuffle);
  else relShuffle();
})();
