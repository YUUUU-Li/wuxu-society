// 众注前端: 作品页正文下. 容器默认 hidden——仅当 tags/comments 两个 API 都可用时才点亮填充;
// API 不可用(未上线/本地静态预览)时整块保持隐藏, 不出现空壳占位。
(function () {
  "use strict";
  var root = document.getElementById("zhuzhu");
  if (!root) return;
  var work = root.getAttribute("data-work");
  var api = root.getAttribute("data-api") || "/api";
  var adminBtn = gid("zz-admin-btn");
  var adminState = gid("zz-admin-state");
  var adminKey = "";
  try { adminKey = sessionStorage.getItem("zz_key") || ""; } catch (e) {}
  var msg = document.getElementById("zz-msg");
  var tmsg = document.getElementById("zz-tagmsg");
  var floorsData = []; // [{id,name,body,reply_to,likes,liked}]

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function linkify(s) {
    return s.replace(/(https?:\/\/[^\s<]+)/g, '<a class="z-url" href="$1" rel="nofollow noopener" target="_blank">$1</a>');
  }
  function renderText(src) {
    var lines = String(src || "").replace(/\r/g, "").split("\n");
    var html = "", para = [], quote = [];
    function fp() { if (para.length) { html += '<p class="z-text">' + linkify(para.map(esc).join("<br />")) + "</p>"; para = []; } }
    function fq() { if (quote.length) { html += '<div class="z-quote">' + linkify(quote.map(esc).join("<br />")) + "</div>"; quote = []; } }
    lines.forEach(function (ln) {
      if (ln.trim().indexOf(">") === 0) { fp(); quote.push(ln.replace(/^\s*>\s?/, "")); }
      else { fq(); para.push(ln); }
    });
    fp(); fq();
    return html;
  }
  function flash(el) {
    el.classList.remove("z-flash"); void el.offsetWidth; el.classList.add("z-flash");
  }
  function speak(where, t) { if (where) { where.textContent = t; } }
  function gid(id) { return document.getElementById(id); }

  /* ---------- 标签 ---------- */
  var tagLine = gid("zz-tags");
  var tagInput = gid("zz-taginput");
  var tagForm = gid("zz-tagform");
  var sug = gid("zz-sug");
  var pool = [];          // [{word,hint,cat}] 大纲/已采纳词 + 释义
  var near = [];          // 易混近义词组 [[词...]]
  var maxPerDevice = 3;   // 每设备每篇最多赞同标签数(服务端同时兜底)
  var tagState = {};      // word -> {id,count,voted,kind,hint}
  // 设备号(限流用; 无 localStorage 时回退 IP)
  var device = "";
  try {
    device = localStorage.getItem("zz_dev") || "";
    if (!device) {
      device = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("zz_dev", device);
    }
  } catch (e) { device = ""; }

  function hintOf(word) {
    var st = tagState[word];
    if (st && st.hint) return st.hint;
    for (var i = 0; i < pool.length; i++) if (pool[i].word === word) return pool[i].hint || "";
    return "";
  }
  function pillFor(word, c, voted, cand) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tagpill" + (voted ? " on" : "") + (cand ? " cand" : "");
    b.innerHTML = '<span class="tp-word">' + esc(word) + '</span><span class="tp-n">' + c + "</span>";
    var h = hintOf(word);
    if (h) { b.title = word + " · " + h; b.setAttribute("aria-label", word + "：" + h); }
    b.addEventListener("click", function () { vote(word); });
    // 手机端无 hover: 长按 500ms 显示释义
    var timer = null;
    b.addEventListener("touchstart", function () { timer = setTimeout(function () { speak(tmsg, word + "：" + (hintOf(word) || "（无释义）")); }, 500); });
    b.addEventListener("touchend", function () { clearTimeout(timer); });
    return b;
  }
  function renderTags(tags) {
    tagState = {};
    tagLine.innerHTML = "";
    tags.forEach(function (t) {
      tagState[t.word] = t;
      var cand = t.kind === "候选";
      var pill = pillFor(t.word, t.count, t.voted, cand);
      if (adminKey) tagLine.appendChild(adminWrap(pill, t.word));
      else tagLine.appendChild(pill);
    });
  }
  function visibleWords() {
    var s = {};
    Array.prototype.forEach.call(tagLine.querySelectorAll(".tp-word"), function (w) { s[w.textContent] = 1; });
    return s;
  }
  function showSug(list) {
    sug.innerHTML = "";
    list.forEach(function (w) {
      var b = document.createElement("button");
      b.type = "button";
      var st = tagState[w] || {};
      var h = hintOf(w);
      b.innerHTML = '<span class="sug-w">' + esc(w) + (h ? '<i class="sug-h">' + esc(h) + "</i>" : "") + "</span>" +
        (st.count ? '<span class="sug-c">' + st.count + "</span>" : "");
      b.addEventListener("mousedown", function (ev) { ev.preventDefault(); vote(w); });
      sug.appendChild(b);
    });
    sug.hidden = list.length === 0;
  }
  // 已选标签里是否有与该词易混的近义词
  function nearClash(word) {
    var chosen = Object.keys(tagState).filter(function (w) { return tagState[w].voted; });
    for (var i = 0; i < near.length; i++) {
      var g = near[i];
      if (g.indexOf(word) === -1) continue;
      var hit = g.filter(function (x) { return x !== word && chosen.indexOf(x) !== -1; });
      if (hit.length) return hit[0];
    }
    return "";
  }
  function hideSug() { sug.hidden = true; tagInput.setAttribute("aria-expanded", "false"); }
  function refreshSug() {
    var q = tagInput.value.trim();
    var vis = visibleWords();
    var base = q
      ? pool.filter(function (p) { return p.word.indexOf(q) !== -1 || (p.hint || "").indexOf(q) !== -1; })
      : pool.slice();
    // 已选过的排前(便于取消), 其余按词表顺序
    base = base.filter(function (p) { return !vis[p.word]; }).map(function (p) { return p.word; });
    var m = base;
    if (m.length) { showSug(m.slice(0, 5)); tagInput.setAttribute("aria-expanded", "true"); }
    else hideSug();
  }
  async function vote(word) {
    // 近义提醒: 与已选标签易混时先提示(不阻止, 用户确认即可)
    if (tagState[word] && !tagState[word].voted) {
      var clash = nearClash(word);
      if (clash && !window.confirm("「" + word + "」与已选的「" + clash + "」容易混用，仍要赞同吗？")) return;
    }
    try {
      var r = await fetch(api + "/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work: work, word: word, device: device }),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "失败");
      hideSug();
      if (tagState[word]) {
        // 已有标签: 更新计数与选中态(不存在则说明该标签候选已转正由服务端返回?)
        var target = null;
        Array.prototype.forEach.call(tagLine.querySelectorAll(".tagpill"), function (b) {
          if (!target && b.querySelector(".tp-word").textContent === word) target = b;
        });
        if (target) {
          target.classList.toggle("on", !!j.voted);
          target.querySelector(".tp-n").textContent = j.count;
          tagState[word].voted = j.voted; tagState[word].count = j.count;
          // 取消后没人赞了 -> 这个标签不再显示(仍可从输入框里重新赞同); 编委模式下连同小按钮一起收
          if (!j.voted && !j.count) {
            var wrap = target.closest ? target.closest(".tag-admin") : null;
            (wrap || target).remove();
            delete tagState[word];
          }
        }
        speak(tmsg, j.voted ? "已赞同：" + word : "已取消赞同：" + word);
      } else {
        // 新词: 大纲内为预设(直接转正), 表外为候选(待编委采纳)。
        // 颜色一律听服务端的 voted(不再本地写死"点了就红"), 否则换页面/刷新会与库里不一致。
        tagState[word] = { id: j.id, word: word, count: j.count, voted: !!j.voted, hint: j.hint || "", cand: !!j.candidate };
        tagLine.appendChild(pillFor(word, j.count, !!j.voted, !!j.candidate));
        speak(tmsg, j.candidate ? "已新建候选标签：" + word + "（待编委采纳转正）" : "已赞同：" + word);
      }
      tagInput.value = "";
    } catch (e) {
      speak(tmsg, "操作失败：" + e.message);
    }
  }
  tagForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = tagInput.value.trim();
    if (v) vote(v);
  });
  tagInput.addEventListener("input", refreshSug);
  tagInput.addEventListener("focus", refreshSug);
  tagInput.addEventListener("blur", function () { setTimeout(hideSug, 160); });
  tagInput.addEventListener("keydown", function (ev) { if (ev.key === "Escape") hideSug(); });

  /* ---------- 评论(平铺楼式) ---------- */
  var floorsEl = gid("zz-floors");
  var zfName = gid("zz-name");
  var zfText = gid("zz-text");
  var floorsDirty = false;

  function fmtTime(iso) {
    if (!iso) return "";
    return String(iso).replace("T", " ").slice(0, 16);
  }
  function floorBtn(idDb, likes, liked) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "z-like" + (liked ? " on" : "");
    b.innerHTML = "<span>同感 " + likes + "</span><i></i>";
    b.addEventListener("click", function () { like(idDb, b); });
    return b;
  }
  function renderFloors(floors) {
    floorsData = floors;
    floorsEl.innerHTML = "";
    var alive = floors.filter(function (f) { return !f.deleted; });
    var noOf = {};
    alive.forEach(function (f, i) { noOf[f.id] = i + 1; });
    alive.forEach(function (f, i) {
      var li = document.createElement("li");
      li.className = "z-item";
      var no = i + 1;
      li.id = "z-" + no;
      var ref = "";
      if (f.reply_to) {
        var target = null;
        for (var k = 0; k < floors.length; k++) { if (floors[k].id === f.reply_to) { target = floors[k]; break; } }
        if (target && target.deleted) {
          // 被回复的楼已被编委删除 -> 占位, 不可跳转
          ref = '<span class="z-right"><span class="z-ref dead">回复 ' + esc(target.name) + "（该楼已删）</span></span>";
        } else if (target) {
          var tn = noOf[target.id];
          ref = '<span class="z-right"><a class="z-ref" href="#z-' + tn + '" data-target="' + tn + '" data-origin="' + no + '">回复 ' + esc(target.name) + "（#" + tn + "）</a></span>";
        } else {
          ref = '<span class="z-right"><span class="z-ref dead">回复（该楼已删）</span></span>';
        }
      }
      li.innerHTML = '<span class="z-no">' + no + '</span><div class="z-body"><div class="z-mrow"><span class="z-meta">' +
        esc(f.name) + " · " + fmtTime(f.created_at) + "</span>" + ref + "</div>" +
        renderText(f.body) +
        '<div class="z-acts"><button class="z-like" type="button"><span>同感 ' + f.likes + "</span><i></i></button>" +
        '<button class="z-reply" type="button" data-id="' + f.id + '">回复</button>' +
        (adminKey ? '<button class="z-del" type="button" data-id="' + f.id + '" data-no="' + no + '">删</button>' : "") +
        "</div></div>";
      li.querySelector(".z-like").addEventListener("click", function () { like(f.id, li.querySelector(".z-like")); });
      floorsEl.appendChild(li);
    });
  }
  /* ---------- 编委模式(删评): 钥匙只存内存/sessionStorage ---------- */
  function syncAdmin() {
    if (!adminBtn) return;
    adminBtn.textContent = adminKey ? "退出编委" : "编委";
    if (adminState) {
      adminState.textContent = adminKey ? "编委模式已开" : "";
      adminState.innerHTML = "";
      if (adminKey) {
        adminState.appendChild(document.createTextNode("编委模式已开 · "));
        var a = document.createElement("a");
        a.href = "#";
        a.className = "zz-seed";
        a.textContent = "初始化/更新标签词表";
        a.title = "把 src/_data/tag_outline.json 的 94 个词写入数据库（幂等，只增不改）";
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          adminTag("seed", {}).then(function (j) {
            speak(msg, "标签词表已落库：新增 " + j.added + " 词，共 " + j.total + " 词。");
          }).catch(function (e) { speak(msg, "落库失败：" + e.message); });
        });
        adminState.appendChild(a);
        var a2 = document.createElement("a");
        a2.href = "#";
        a2.className = "zz-seed";
        a2.textContent = "整理历史标签";
        a2.title = "把库里旧写法（思念/明月/夜…）按归并表并入大纲词，只做一次";
        a2.addEventListener("click", function (ev) {
          ev.preventDefault();
          if (!window.confirm("把历史标签按归并表并入大纲词？（此操作会合并票数，幂等，可反复执行）")) return;
          adminTag("cleanup", {}).then(function (j) {
            speak(msg, "已整理 " + (j.merged || []).length + " 项：" + (j.merged || []).join("、"));
          }).catch(function (e) { speak(msg, "整理失败：" + e.message); });
        });
        adminState.appendChild(a2);
      }
    }
  }
  // 编委标签动作(采纳/合并/删除)
  function adminTag(action, payload) {
    return fetch(api + "/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ key: adminKey, action: action }, payload || {})),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || "操作失败");
        if (/无权/.test(j.error || "")) { adminKey = ""; try { sessionStorage.removeItem("zz_key"); } catch (e) {} syncAdmin(); }
        return j;
      });
    });
  }
  // 标签 pill 旁的编委小按钮(采纳 / 合并 / 删除)
  function adminWrap(pill, word) {
    var wrap = document.createElement("span");
    wrap.className = "tag-admin";
    wrap.appendChild(pill);
    var cog = document.createElement("button");
    cog.type = "button";
    cog.className = "tag-cog";
    cog.textContent = "⋯";
    cog.title = "编委：采纳 / 合并 / 删除";
    cog.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var act = window.prompt("「" + word + "」编委操作：\n1 = 采纳转正\n2 = 合并到别的词\n3 = 删除\n（输入序号，取消即退出）", "1");
      if (!act) return;
      act = act.trim();
      if (act === "1") {
        adminTag("adopt", { word: word })
          .then(function () { speak(tmsg, "已采纳：" + word + " → 进大纲"); return loadAll(); })
          .catch(function (e) { speak(tmsg, "失败：" + e.message); });
      } else if (act === "2") {
        var to = window.prompt("合并「" + word + "」到哪个词？（票数并入目标词）", "");
        if (!to || !to.trim()) return;
        adminTag("merge", { from: word, to: to.trim() })
          .then(function (j) { speak(tmsg, "已合并：「" + word + "」→「" + j.to + "」（迁 " + (j.moved || 0) + " 票）"); return loadAll(); })
          .catch(function (e) { speak(tmsg, "失败：" + e.message); });
      } else if (act === "3") {
        if (!window.confirm("删除「" + word + "」及其全部票？")) return;
        adminTag("delete", { word: word })
          .then(function () { speak(tmsg, "已删除：" + word); return loadAll(); })
          .catch(function (e) { speak(tmsg, "失败：" + e.message); });
      }
    });
    wrap.appendChild(cog);
    return wrap;
  }
  async function deleteFloor(id, no) {
    if (!window.confirm("确认删除 #" + no + " 楼？")) return;
    try {
      var r = await fetch(api + "/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_id: id, key: adminKey }),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "删除失败");
      speak(msg, "已删除 #" + no + " 楼。");
      await loadAll();
    } catch (e) {
      speak(msg, "删除失败：" + e.message);
      if (/无权/.test(e.message)) { adminKey = ""; try { sessionStorage.removeItem("zz_key"); } catch (e2) {} syncAdmin(); await loadAll(); }
    }
  }
  if (adminBtn) {
    adminBtn.addEventListener("click", async function () {
      if (adminKey) {
        adminKey = "";
        try { sessionStorage.removeItem("zz_key"); } catch (e) {}
        syncAdmin();
        speak(msg, "已退出编委模式。");
        await loadAll();
        return;
      }
      var k = window.prompt("编委钥匙（仅本浏览器会话有效，不会存到网址里）");
      if (!k) return;
      adminKey = k.trim();
      try { sessionStorage.setItem("zz_key", adminKey); } catch (e) {}
      syncAdmin();
      await loadAll();
    });
  }
  function openReplyBar(li, idDb) {
    var old = li.querySelector(".z-replyform");
    if (old) { old.remove(); return; }
    Array.prototype.forEach.call(document.querySelectorAll(".z-replyform"), function (f) { f.remove(); });
    var body = li.querySelector(".z-body");
    var f = document.createElement("div");
    f.className = "z-replyform";
    f.innerHTML = '<input class="z-r-name" type="text" maxlength="20" placeholder="笔名/昵称" aria-label="笔名或昵称" />' +
      '<textarea class="z-r-text" rows="2" maxlength="300" placeholder="回帖内容… 行首加 > 可引原帖" aria-label="回帖内容"></textarea>' +
      '<button class="btn ghost z-r-send" type="button">发送</button>' +
      '<button class="z-r-cancel" type="button">取消</button>';
    body.appendChild(f);
    f.querySelector(".z-r-name").focus();
    f.querySelector(".z-r-send").addEventListener("click", function () {
      var nm = f.querySelector(".z-r-name").value.trim();
      var tx = f.querySelector(".z-r-text").value.trim();
      if (!nm) { speak(msg, "回帖需填笔名/昵称。"); return; }
      if (!tx) { speak(msg, "写点回帖内容吧。"); return; }
      postComment(nm, tx, idDb);
    });
    f.querySelector(".z-r-cancel").addEventListener("click", function () { f.remove(); });
  }
  async function postComment(name, text, replyTo) {
    try {
      var r = await fetch(api + "/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work: work, name: name, body: text, reply_to: replyTo || null }),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "失败");
      speak(msg, "已发表。");
      zfText.value = "";
      await loadAll();
    } catch (e) { speak(msg, "发表失败：" + e.message); }
  }
  async function like(idDb, btn) {
    try {
      var r = await fetch(api + "/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ like_comment_id: idDb }),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "失败");
      btn.classList.toggle("on", !!j.liked);
      btn.querySelector("span").textContent = "同感 " + j.likes;
    } catch (e) { speak(msg, "同感失败：" + e.message); }
  }
  floorsEl.addEventListener("click", function (ev) {
    var ref = ev.target.closest(".z-ref");
    if (ref) {
      ev.preventDefault();
      var t = document.getElementById("z-" + ref.getAttribute("data-target"));
      if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); flash(t); }
      return;
    }
    var rep = ev.target.closest(".z-reply");
    if (rep) openReplyBar(rep.closest(".z-item"), Number(rep.getAttribute("data-id")));
    var del = ev.target.closest(".z-del");
    if (del) deleteFloor(Number(del.getAttribute("data-id")), del.getAttribute("data-no"));
  });
  gid("zz-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var nm = zfName.value.trim();
    var tx = zfText.value.trim();
    if (!nm) { speak(msg, "请填笔名/昵称。"); return; }
    if (!tx) { speak(msg, "写点什么吧。"); return; }
    postComment(nm, tx, null);
  });

  /* ---------- 相似标签(余弦) 动态组 ---------- */
  var relSim = null; // #rel-sim 在脚本之后的 DOM 里, 须等 DOMContentLoaded 再取
  var relPoolData = [];
  function relItem(r) {
    var lis = [];
    var seen = {};
    r.forEach(function (x) {
      if (seen[x.slug]) return;
      seen[x.slug] = 1;
      lis.push('<li><span class="t"><a class="plink" href="' + esc(x.slug) + '.html">' + esc(x.title) + "</a></span>" +
        '<span class="reason">同标签 · ' + esc((x.shared || []).join("、")) + "</span></li>");
    });
    return lis;
  }
  function drawRel() {
    if (!relPoolData.length) return;
    var picked = relPoolData.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 4);
    var ul = relSim.querySelector(".rel-ul");
    ul.innerHTML = relItem(picked).join("");
  }
  async function loadRel() {
    relSim = document.getElementById("rel-sim"); // DOM 就绪后容器必在
    if (!relSim) return;
    try {
      var r = await fetch(api + "/related?work=" + encodeURIComponent(work), { cache: "no-store" });
      if (!r.ok) throw 0;
      var j = await r.json();
      if (!j.ok) throw 0;
      relPoolData = j.related || [];
      if (!relPoolData.length) return; // 无候选保持隐藏
      var showShuffle = relPoolData.length > 4;
      relSim.innerHTML =
        '<h4 class="rel-h4">相似标签<span class="cnt">共 ' + relPoolData.length + ' 篇 · 每次打开随机呈现</span>' +
        (showShuffle ? '<button class="shuffle" type="button">换一批 ↻</button>' : "") + "</h4>" +
        '<ul class="rel-ul" data-rotate="4"></ul>';
      var btn = relSim.querySelector(".shuffle");
      if (btn) btn.addEventListener("click", function () { drawRel(); });
      relSim.hidden = false;
      drawRel();
    } catch (e) { /* 保持隐藏 */ }
  }

  /* ---------- 拉取并点亮 ---------- */
  async function loadAll() {
    try {
      var [tr, cr] = await Promise.all([
        // 带上设备号: 服务端据此标出「我赞过的」标签(与投票写入时同一身份, 才能再点一下取消);
        // no-store: 每次打开都按库里的真实票况着色, 不拿缓存里的旧状态
        fetch(api + "/tags?work=" + encodeURIComponent(work) + "&dev=" + encodeURIComponent(device), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }),
        fetch(api + "/comments?work=" + encodeURIComponent(work), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }),
      ]);
      if (!tr.ok || !cr.ok) throw 0;
      renderTags(tr.tags || []);
      pool = (tr.pool || []).map(function (p) { return typeof p === "string" ? { word: p, hint: "" } : p; });
      near = tr.near || [];
      if (tr.maxPerDevice) maxPerDevice = tr.maxPerDevice;
      renderFloors(cr.floors || []);
      if (root.hidden) {
        root.hidden = false; // 后端可用, 亮出众注
        if (tr.tags.length === 0 && cr.floors.length === 0) {
          // 无内容时不额外提示, 保持界面精简
        }
      }
    } catch (e) {
      // 后端未就绪: 保持隐藏, 页面不留空壳
      root.hidden = true;
    }
  }
  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  loadAll();
  syncAdmin();
  whenReady(loadRel);
})();
