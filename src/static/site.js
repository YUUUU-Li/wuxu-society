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
})();
