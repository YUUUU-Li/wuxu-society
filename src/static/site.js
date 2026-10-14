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
      if (!name) { msg.textContent = "请留下笔名或称呼。"; msg.classList.add("err"); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { msg.textContent = "邮箱格式似乎不对，请检查。"; msg.classList.add("err"); return; }
      msg.textContent = "正在提交…";
      var fd = new FormData(form);
      fd.set("form-name", "join");
      fetch("/", {
        method: "POST",
        body: fd,
        headers: { Accept: "application/json" }
      })
        .then(function (r) { if (!r.ok) throw new Error("submit-failed"); return r.json(); })
        .then(function () {
          msg.className = "form-msg";
          msg.textContent = "已收到申请。入社说明将发送至你的邮箱，请静候。";
          form.reset();
        })
        .catch(function () {
          msg.className = "form-msg err";
          msg.textContent = "提交失败：本地预览无法提交属正常，请到线上站点申请；或直接邮件 wuxuliterature@163.com 联系。";
        });
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

/* 深色模式切换: 按钮在导航(电脑端在"申请入社"右, 手机端在汉堡左)
   换色不硬切: 几滴墨(浅→深滴深纸色, 深→浅滴浅纸色)先后晕开铺满画面,
   铺满后在墨底下换色, 再把墨淡出露出内容 —— 墨的样子见 site.css 的 .ink-veil */
(function () {
  var b = document.getElementById("theme-toggle");
  if (!b) return;
  var root = document.documentElement;
  var GAP = 60;    // 每滴错开多少毫秒(再小就看着像一起滴; 人眼要分清先后, 差得 >50ms 才看得出)
  var DUR = 400;   // 每滴晕开用时
  var FADE = 200;  // 铺满后墨淡出的用时

  function sync() {
    var dark = root.getAttribute("data-theme") === "dark";
    b.classList.toggle("on", dark);
    b.setAttribute("aria-pressed", dark ? "true" : "false");
    b.title = dark ? "切换到浅色" : "切换到深色";
  }

  /* 系统设了"减少动态效果"就直接换色, 不滴墨 */
  function quiet() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* 滴墨铺满画面, 铺满时回调 swap(); 返回整段用时(ms) */
  function bloom(to, swap) {
    var w = root.clientWidth, h = root.clientHeight;
    var diag = Math.sqrt(w * w + h * h);
    var size = diag * 0.30;   // 每滴的边长
    // 终值缩放: 让每滴的"实心"部分正好涨到 0.30*diag(够盖住离它最远 0.25*diag 的画面边角)。
    // 0.28 = site.css 那三层渐变里 56% 实心 × 半边长(两边是一对, 改一处得改两处)。
    var k = (0.30 * diag) / (0.28 * size);   // ≈3.57
    // 四角各一滴 + 正中一滴。画面任意一点离最近那滴都不超过 0.25*diag(位置随机抖 4% 也还在 0.30 内),
    // 所以每滴涨到 0.30*diag 时画面必被盖满 —— 满之前绝不在墨底下换色, 免得透出旧底色。
    var at = [[.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .5]];
    for (var i = at.length - 1; i > 0; i--) {          // 打乱先后: 每次切换的墨迹都不一样
      var j = Math.floor(Math.random() * (i + 1));
      var t = at[i]; at[i] = at[j]; at[j] = t;
    }
    var veil = document.createElement("div");
    veil.className = "ink-veil";
    veil.setAttribute("data-to", to);                  // 决定滴的是哪一色
    veil.setAttribute("aria-hidden", "true");
    at.forEach(function (p, i) {
      var d = document.createElement("span");
      d.className = "ink-drop";
      d.style.left = (p[0] + (Math.random() - .5) * .04) * w + "px";
      d.style.top = (p[1] + (Math.random() - .5) * .04) * h + "px";
      d.style.width = d.style.height = size + "px";
      // 曲线前端压得住: 前 1/5 时间墨还是一小滴(点下去那一下), 中段才猛地洇开, 末段慢慢收住。
      // 早先用的 .2,.75,.25,1 太陡 —— 头 40ms 就涨成一大片, 看着像"一上来就糊满"。
      d.animate([
        { transform: "translate(-50%,-50%) scale(.02)" },     // 先落成一小滴
        { transform: "translate(-50%,-50%) scale(" + k + ")" } // 再晕开
      ], { duration: DUR, delay: i * GAP, easing: "cubic-bezier(.5,0,.2,1)", fill: "both" });
      veil.appendChild(d);
    });
    document.body.appendChild(veil);
    var total = (at.length - 1) * GAP + DUR;
    setTimeout(function () {
      swap();                       // 画面已被墨盖满, 此刻换色看不见
      veil.classList.add("off");    // 墨色 == 新底色, 淡出只是把内容慢慢显出来
      setTimeout(function () { if (veil.parentNode) veil.parentNode.removeChild(veil); }, FADE + 60);
    }, total + 40);                 // 多留 40ms: 万一主线程忙、动画收尾略晚, 边角也不至于透出旧底色
    return total + 40 + FADE + 60;
  }

  var running = false;
  b.addEventListener("click", function () {
    if (running) return;            // 上一段墨还没落定就再点, 不理(免得墨叠墨)
    var to = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    function swap() {
      root.setAttribute("data-theme", to);
      try { localStorage.setItem("theme", to); } catch (e) {}
      sync();
    }
    if (quiet()) { swap(); return; }
    running = true;
    var ms = bloom(to, swap);
    setTimeout(function () { running = false; }, ms);
  });
  sync();
})();

/* 名册页: 每人随机抽 3 首作品(每次打开不同; 无"换一批") */
(function () {
  var el = document.getElementById("member-pools");
  if (!el) return;
  var pools = {};
  try {
    var raw = el.textContent.trim().replace(/,\s*$/, "");
    JSON.parse("[" + raw + "]").forEach(function (p) { pools[p.id] = p.items; });
  } catch (e) { return; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pick(arr, n) {
    var a = arr.slice(), out = [];
    for (var i = 0; i < n && a.length; i++) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
    return out;
  }
  Array.prototype.forEach.call(document.querySelectorAll(".m-works"), function (box) {
    var items = pools[box.getAttribute("data-id")];
    if (!items || !items.length) return;
    box.innerHTML = pick(items, 3).map(function (w) {
      return '<a class="plink" href="' + esc(w.h) + '">作品：' + esc(w.t) + "</a>";
    }).join("");
  });
})();
