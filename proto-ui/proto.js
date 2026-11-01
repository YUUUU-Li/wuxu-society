/* 婺需文学社 · UI 样张脚本
   纯前端模拟：登录、投稿、评论都不发请求。
   数据取自仓库真实作品；点击作品库任意篇目都会进入同一篇样张。 */
(function () {
  "use strict";

  /* ---------- 真实作品数据 ---------- */
  var LIST = [
    { title: "梅", author: "lfk（谰予）", genre: "七言古风", date: "2024-11-29", sort: 20241129, tags: ["花", "离愁"] },
    { title: "芙蓉王诗（并自序）", author: "lfk（谰予）", genre: "古风长诗", date: "2025-04-23", sort: 20250423, tags: ["花", "梦"] },
    { title: "留夏", author: "lfk（谰予）", genre: "七言古风", date: "2025-07-12", sort: 20250712, tags: ["夏景", "雨", "离愁"] },
    { title: "忆秦娥·和答蓦流《小重山》", author: "lfk（谰予）", genre: "词", date: "2025-10-26", sort: 20251026, tags: ["秋景", "离愁"] },
    { title: "忆秦娥·怕秋语", author: "lfk（谰予）", genre: "词", date: "2025-11-06", sort: 20251106, tags: ["雨", "离愁"] },
    { title: "我想去二次元", author: "txy（飞鸟）", genre: "科幻短篇", date: "2025-12-14", sort: 20251214, tags: ["星", "恋慕"] },
    { title: "文艺b与地雷女", author: "txy（飞鸟）", genre: "短篇", date: "2026-06-02", sort: 20260602, tags: ["网络世代", "恋慕"] },
    { title: "A Rotten Peom", author: "cyly", genre: "其他", date: "2026-10-21", sort: 20261021, tags: [] },
    { title: "十二月的夕阳堕入山林（其一）", author: "zk（道格）", genre: "七律", date: "年份待考", sort: 0, tags: ["月", "星", "离愁"] },
    { title: "风", author: "ylj（济枫）", genre: "七言古风", date: "年份待考", sort: 0, tags: ["山", "水"] },
    { title: "沉默", author: "cty（泊珩）", genre: "现代诗", date: "年份待考", sort: 0, tags: [] },
    { title: "长相思·思乡", author: "cty（泊珩）", genre: "词", date: "年份待考", sort: 0, tags: ["秋景", "思乡"] }
  ];
  var PICKS = [
    { title: "梅", author: "lfk（谰予）", genre: "七言古风", q: "梅已欠尽满冬色，又欠离人泪沾衣。" },
    { title: "十二月的夕阳堕入山林（其一）", author: "zk（道格）", genre: "七律", q: "月逐烟云梅倚时，长歌一曲雁来迟。" },
    { title: "祝英台近·观徐克梁祝有感", author: "cty（泊珩）", genre: "词", q: "抚鸣丝，相视笑，春去不成赏。" }
  ];
  var WORK = {
    title: "十二月的夕阳堕入山林",
    subtitle: "（其一）",
    author: "zk（道格）",
    genre: "七律",
    date: "年份待考",
    lines: [
      "月逐烟云梅倚时，长歌一曲雁来迟。",
      "惊鸿影照羞花貌，骚客空怜绰约姿。",
      "巾帼已为豪杰气，笔行且作易安词。",
      "世间但有惆怅客，我念君时人笑痴。"
    ]
  };
  var TAGS_BASE = [
    { word: "月", count: 3 },
    { word: "星", count: 2 },
    { word: "离愁", count: 5 },
    { word: "秋景", count: 1 }
  ];
  var WORK_COMMENTS = [
    { name: "jwl", time: "09-10 14:22", body: "「世间但有惆怅客」一句，收得极稳。", likes: 3 },
    { name: "cty", time: "09-10 15:06", body: "> 月逐烟云梅倚时\n读到这句，想起旧作里的雪夜。", likes: 1 }
  ];
  var DEMO_COMMENTS = [
    { name: "泊珩", time: "刚刚", body: "标签像落在纸边的朱点，不吵。", likes: 2 }
  ];
  var RELATED = [
    { title: "十二月的夕阳堕入山林（其二）", why: "组诗 · 同题其二" },
    { title: "梅", why: "相似标签 · 月 / 离愁" },
    { title: "忆秦娥·和答蓦流《小重山》", why: "相似标签 · 秋景 / 离愁" }
  ];

  /* ---------- 状态 ---------- */
  var state = {
    style: "a",
    screen: "home",
    theme: "light",
    filters: { author: "", genre: "", tag: "" },
    workTags: clone(TAGS_BASE),
    demoTags: clone(TAGS_BASE),
    voted: new Set(),
    demoVoted: new Set(),
    workComments: clone(WORK_COMMENTS),
    demoComments: clone(DEMO_COMMENTS)
  };
  var embed = false;
  var toastTimer = 0;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function unique(arr) {
    return arr.filter(function (v, i) { return arr.indexOf(v) === i; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function formatComment(s) {
    return String(s == null ? "" : s).split(/\n/).map(function (line) {
      return /^>\s?/.test(line) ? "<q>" + esc(line.replace(/^>\s?/, "")) + "</q>" : esc(line);
    }).join("<br>");
  }
  function loading(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = label || "正在…";
      btn.classList.add("is-loading");
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.classList.remove("is-loading");
      btn.disabled = false;
    }
  }
  function showMsg(el, text, kind) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    el.textContent = text || "";
    el.className = "msgline" + (kind ? " " + kind : "");
  }
  function toast(text) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("on"); }, 1900);
  }
  function copyText(text, ok) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(ok || "已复制"); }
      catch (e) { toast("复制失败，请手动选择"); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(ok || "已复制"); }, fallback);
    } else fallback();
  }

  /* ---------- 通用片段 ---------- */
  function tagMarkup(tags, voted) {
    return tags.map(function (t) {
      var on = voted.has(t.word);
      return '<button type="button" class="tag' + (on ? " on" : "") + '" data-word="' + esc(t.word) +
        '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(t.word) + "<b>" + t.count + "</b></button>";
    }).join("");
  }
  function commentMarkup(c, i) {
    return '<div class="comment"><div class="who">' + esc(c.name) + "<br>" + esc(c.time) +
      '</div><div class="body">' + formatComment(c.body) +
      '<div class="acts"><button type="button" class="like" data-like="' + i + '">同感 <span>' + (c.likes || 0) +
      "</span></button><button type=\"button\">回复</button></div></div></div>";
  }
  function commentsMarkup(list) {
    return list.map(commentMarkup).join("");
  }
  function tagsForWork() { return tagMarkup(state.workTags, state.voted); }
  function tagsForDemo() { return tagMarkup(state.demoTags, state.demoVoted); }

  /* ---------- 画面 ---------- */
  function renderHome() {
    var picks = PICKS.map(function (p) {
      return '<a class="pick" href="#" data-go="work"><div class="t">' + esc(p.title) +
        '</div><div class="m">' + esc(p.author) + " · " + esc(p.genre) +
        '</div><p class="q">' + esc(p.q) + "</p></a>";
    }).join("");
    return '<section class="screen home">' +
      '<div class="home-grid"><div class="home-copy">' +
        '<p class="kicker">甲辰 · 婺州 · 文学社</p>' +
        '<h1 class="display">婺需<br>文学社</h1>' +
        '<p class="tagline">以诗会友，以文养心</p>' +
        '<p class="lede">聚四地同人，写一社诗文。愿旧诗与新声，都有人听。</p>' +
        '<div class="actions"><button type="button" class="btn" data-go="work">读一篇</button>' +
        '<button type="button" class="btn ghost" data-go="library">翻作品库</button></div>' +
        '<p class="issue-line"><span><b>甲辰清明雅集</b> · 七篇</span><span>九月投稿辑 · 两篇</span><span>待辑 · 五篇</span></p>' +
      '</div><figure class="home-media"><img src="../src/static/hero-qingming.jpg" alt="清明首聚的水墨意象" />' +
      "<figcaption>清明首聚 · 婺州风雨</figcaption></figure></div>" +
      '<div class="ink-circle" aria-hidden="true"><svg viewBox="0 0 220 220">' +
      '<defs><filter id="inkBlur"><feGaussianBlur stdDeviation="7" /></filter></defs>' +
      '<path d="M112 24c36 1 66 22 79 52 13 31 4 70-22 92-26 22-66 26-96 10-30-16-45-51-37-83 8-32 36-62 76-71Z" fill="currentColor" opacity=".16" filter="url(#inkBlur)" />' +
      '<path d="M96 52c22-5 43 4 54 22 11 18 8 43-8 58-16 15-42 17-59 5-17-12-23-35-13-53 6-12 15-24 26-32Z" fill="currentColor" opacity=".07" />' +
      "</svg></div>" +
      '<div class="picks"><div class="sec-head"><span class="kicker">拾读</span><h2>今夜读什么</h2><span class="rule"></span></div>' +
      '<div class="pick-grid">' + picks + "</div></div>" +
      "</section>";
  }

  function renderWork() {
    var body = WORK.lines.map(function (line) { return "<p>" + esc(line) + "</p>"; }).join("");
    var rel = RELATED.map(function (r) {
      return '<li><a href="#" data-go="work">' + esc(r.title) + '</a><span class="why">' + esc(r.why) + "</span></li>";
    }).join("");
    return '<section class="screen work">' +
      '<div class="work-head"><p class="kicker">作品 · ' + esc(WORK.genre) + "</p>" +
      '<h1 class="work-title">' + esc(WORK.title) + "<span>" + esc(WORK.subtitle) + "</span></h1>" +
      '<p class="work-by"><span>' + esc(WORK.author) + "</span><span>创作时间 " + esc(WORK.date) + "</span><span>月 · 星 · 离愁</span></p></div>" +
      '<div class="work-layout"><aside class="work-aside"><h3>题下</h3>' +
      '<ul class="meta-list"><li><b>作者</b>' + esc(WORK.author) + '</li><li><b>体裁</b>' + esc(WORK.genre) +
      '</li><li><b>创作时间</b>' + esc(WORK.date) + '</li><li><b>出处</b>录自社内原稿</li></ul>' +
      '<h3>标签</h3><div class="tag-row" id="work-tags">' + tagsForWork() + "</div>" +
      '<p class="msgline" id="work-tag-msg">点一下即赞同 · 最多 3 个</p></aside>' +
      '<article class="poem">' + body + '<p class="note">录自社内原稿。正文按七律分行；标点从原稿。</p></article></div>' +
      '<div class="work-foot"><div><h3>众注</h3><div id="work-floors">' + commentsMarkup(state.workComments) + "</div>" +
      '<form class="comment-form" id="work-comment"><textarea placeholder="写一条批注… 行首加 > 可引原句" aria-label="评论"></textarea>' +
      '<div class="row"><button class="btn" type="submit">发表</button></div><p class="msgline" id="work-comment-msg"></p></form></div>' +
      '<div><h3>关联</h3><ul class="rel-list">' + rel + "</ul></div></div></section>";
  }

  function renderLibrary() {
    var authors = unique(LIST.map(function (w) { return w.author; }));
    var genres = unique(LIST.map(function (w) { return w.genre; }));
    var tags = unique(LIST.reduce(function (a, w) { return a.concat(w.tags); }, []));
    function opts(list, cur) {
      return '<option value="">全部</option>' + list.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>";
      }).join("");
    }
    return '<section class="screen library"><header>' +
      '<p class="kicker">总目 · 十二篇</p><h1 class="display">作品库</h1>' +
      '<p class="lede">按创作时间先后排列；尚未考订创作时间的篇目另列于后。可依作者、体裁、意象筛选。</p></header>' +
      '<div class="filterbar"><label>作者<select id="f-author">' + opts(authors, state.filters.author) + "</select></label>" +
      '<label>体裁<select id="f-genre">' + opts(genres, state.filters.genre) + "</select></label>" +
      '<label>意象<select id="f-tag">' + opts(tags, state.filters.tag) + "</select></label>" +
      '<button type="button" class="f-reset" id="f-reset">清除</button>' +
      '<span class="f-count" id="f-count"></span></div>' +
      '<div id="lib-list"></div><div class="empty" id="lib-empty" hidden><p>此页暂无相合篇目。</p>' +
      '<button type="button" class="btn ghost" data-clear="1">清除筛选</button></div></section>';
  }

  function renderFeedback() {
    return '<section class="screen feedback"><header>' +
      '<p class="kicker">反馈 · 样张</p><h1 class="display">交互反馈</h1>' +
      '<p class="lede">同一套反馈语言，在 A / E 两种版式下各看一遍。所有操作都是前端模拟，不发请求。</p></header>' +
      '<div class="feedback-grid">' +
      '<div class="demo-card"><h3>登录 / 注册</h3><p>弹窗可用 Escape、点背景关闭；Tab 在框内循环；注册成功给可复制的恢复码。</p>' +
      '<div class="row"><button type="button" class="btn" data-modal="login">打开登录</button>' +
      '<button type="button" class="btn ghost" data-modal="register">打开注册</button></div></div>' +
      '<div class="demo-card"><h3>标签投票</h3><p>点一下即赞同，再点取消；最多 3 个，超出会给一句提示。</p>' +
      '<div class="tag-row tag-demo" id="demo-tags">' + tagsForDemo() + "</div>" +
      '<p class="msgline" id="demo-tag-msg">点一下即赞同 · 最多 3 个</p></div>' +
      '<div class="demo-card"><h3>投稿</h3><p>校验、加载、成功回执；成功后可复制审稿单链接。</p>' +
      '<form id="demo-submit"><input id="demo-title" type="text" placeholder="题名" aria-label="题名" />' +
      '<textarea id="demo-body" placeholder="正文…（诗每行一句）" aria-label="正文"></textarea>' +
      '<div class="row"><button class="btn" type="submit">送审</button><button type="button" class="btn ghost" id="demo-preview">预览</button>' +
      '<button type="button" class="btn ghost" id="demo-copy">复制链接</button></div>' +
      '<div class="msgline" id="demo-preview-box"></div><p class="msgline" id="demo-submit-msg"></p></form></div>' +
      '<div class="demo-card"><h3>评论</h3><p>提交时按钮进入加载态；成功后新楼出现，旧草稿保留在输入框直到成功。</p>' +
      '<div id="demo-floors">' + commentsMarkup(state.demoComments) + "</div>" +
      '<form id="demo-comment"><textarea placeholder="写一条批注…" aria-label="评论"></textarea>' +
      '<div class="row"><button class="btn" type="submit">发表</button></div><p class="msgline" id="demo-comment-msg"></p></form></div>' +
      '<div class="demo-card"><h3>全局反馈</h3><p>复制成功、网络失败用同一种 Toast；字段错误留在字段旁，不打断输入。</p>' +
      '<div class="row"><button type="button" class="btn" id="demo-error">模拟网络失败</button></div></div>' +
      "</div></section>";
  }

  var screens = { home: renderHome, work: renderWork, library: renderLibrary, feedback: renderFeedback };

  /* ---------- 绑定 ---------- */
  function bindTags(row, tags, voted, msgEl) {
    if (!row) return;
    row.addEventListener("click", function (ev) {
      var b = ev.target.closest(".tag");
      if (!b) return;
      var word = b.dataset.word;
      var item = tags.filter(function (t) { return t.word === word; })[0];
      if (!item) return;
      if (voted.has(word)) {
        voted.delete(word);
        item.count = Math.max(0, item.count - 1);
        b.classList.remove("on");
        b.setAttribute("aria-pressed", "false");
        showMsg(msgEl, "已取消：" + word);
      } else {
        if (voted.size >= 3) { toast("每篇最多赞同 3 个标签"); return; }
        voted.add(word);
        item.count += 1;
        b.classList.add("on");
        b.setAttribute("aria-pressed", "true");
        b.classList.add("stamped");
        setTimeout(function () { b.classList.remove("stamped"); }, 360);
        showMsg(msgEl, "已赞同：" + word);
      }
      b.querySelector("b").textContent = item.count;
    });
  }
  function bindLikes(container) {
    if (!container || container.dataset.likes) return;
    container.dataset.likes = "1";
    container.addEventListener("click", function (ev) {
      var like = ev.target.closest(".like");
      if (!like) {
        var reply = ev.target.closest(".acts button");
        if (reply) toast("样张：正式站的回复会作为新楼插入");
        return;
      }
      var span = like.querySelector("span");
      var n = Number(span.textContent) || 0;
      var on = like.classList.toggle("on");
      span.textContent = on ? n + 1 : Math.max(0, n - 1);
    });
  }
  function bindCommentForm(formId, floorsId, msgId, list) {
    var form = document.getElementById(formId);
    if (!form) return;
    var ta = form.querySelector("textarea");
    var btn = form.querySelector('button[type="submit"]');
    var floors = document.getElementById(floorsId);
    var msg = document.getElementById(msgId);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = ta.value.trim();
      if (!text) { showMsg(msg, "写点什么吧。", "bad"); return; }
      loading(btn, true, "正在…");
      showMsg(msg, "正在发表…");
      setTimeout(function () {
        var c = { name: "你", time: "刚刚", body: text, likes: 0 };
        list.push(c);
        if (floors) floors.insertAdjacentHTML("beforeend", commentMarkup(c, list.length - 1));
        ta.value = "";
        loading(btn, false);
        showMsg(msg, "已发表。", "good");
        toast("已发表");
      }, 700);
    });
  }
  function bindLibrary() {
    var list = document.getElementById("lib-list");
    var empty = document.getElementById("lib-empty");
    var count = document.getElementById("f-count");
    var selA = document.getElementById("f-author");
    var selG = document.getElementById("f-genre");
    var selT = document.getElementById("f-tag");
    if (!list || !selA) return;

    function apply(animate) {
      state.filters.author = selA.value;
      state.filters.genre = selG.value;
      state.filters.tag = selT.value;
      var rows = LIST.filter(function (w) {
        return (!state.filters.author || w.author === state.filters.author) &&
          (!state.filters.genre || w.genre === state.filters.genre) &&
          (!state.filters.tag || w.tags.indexOf(state.filters.tag) !== -1);
      });
      list.innerHTML = rows.map(function (w, i) {
        return '<a class="lib-row' + (w.sort ? "" : " undated") + '" href="#" data-go="work">' +
          '<span class="num">' + String(i + 1).padStart(2, "0") + '</span><span class="title">' + esc(w.title) +
          '</span><span class="author">' + esc(w.author) + '</span><span class="genre">' + esc(w.genre) +
          '</span><span class="date">' + esc(w.date) + "</span></a>";
      }).join("");
      if (count) count.textContent = "显示 " + rows.length + " / " + LIST.length + " 篇";
      if (empty) empty.hidden = rows.length !== 0;
      if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        Array.prototype.forEach.call(list.children, function (row, i) {
          row.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
            { duration: 180, delay: i * 18, easing: "ease-out", fill: "both" });
        });
      }
    }
    [selA, selG, selT].forEach(function (s) {
      s.addEventListener("change", function () { apply(true); });
    });
    document.getElementById("f-reset").addEventListener("click", function () {
      selA.value = ""; selG.value = ""; selT.value = ""; apply(true);
    });
    var clear = document.querySelector("#lib-empty [data-clear]");
    if (clear) clear.addEventListener("click", function () {
      selA.value = ""; selG.value = ""; selT.value = ""; apply(true);
    });
    apply(false);
  }
  function bindFeedback() {
    var tagRow = document.getElementById("demo-tags");
    if (tagRow) bindTags(tagRow, state.demoTags, state.demoVoted, document.getElementById("demo-tag-msg"));
    bindLikes(document.getElementById("demo-floors"));
    bindCommentForm("demo-comment", "demo-floors", "demo-comment-msg", state.demoComments);

    var form = document.getElementById("demo-submit");
    if (form) {
      var title = document.getElementById("demo-title");
      var body = document.getElementById("demo-body");
      var msg = document.getElementById("demo-submit-msg");
      var previewBox = document.getElementById("demo-preview-box");
      var btn = form.querySelector('button[type="submit"]');
      var preview = document.getElementById("demo-preview");
      if (preview) preview.addEventListener("click", function () {
        var text = body.value.trim();
        previewBox.innerHTML = text
          ? text.split(/\n{2,}/).map(function (p) { return "<p>" + formatComment(p) + "</p>"; }).join("")
          : "先写两句，再预览。";
      });
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (!title.value.trim()) { showMsg(msg, "请先填题名。", "bad"); title.focus(); return; }
        if (!body.value.trim()) { showMsg(msg, "正文还空着。", "bad"); body.focus(); return; }
        loading(btn, true, "正在送审…");
        showMsg(msg, "正在送进审稿队列…");
        setTimeout(function () {
          loading(btn, false);
          msg.className = "msgline good";
          msg.innerHTML = '已送审：<a href="#" data-toast="审稿单 #128（样张）">审稿单 #128</a>（样张）。';
          toast("已送审 · 审稿单 #128");
        }, 900);
      });
    }
    var copy = document.getElementById("demo-copy");
    if (copy) copy.addEventListener("click", function () { copyText(location.href, "已复制当前样张链接"); });
    var err = document.getElementById("demo-error");
    if (err) err.addEventListener("click", function () { toast("网络不通，请稍后再试"); });
  }

  function bindScreen() {
    if (state.screen === "work") {
      bindTags(document.getElementById("work-tags"), state.workTags, state.voted, document.getElementById("work-tag-msg"));
      bindLikes(document.getElementById("work-floors"));
      bindCommentForm("work-comment", "work-floors", "work-comment-msg", state.workComments);
    } else if (state.screen === "library") {
      bindLibrary();
    } else if (state.screen === "feedback") {
      bindFeedback();
    }
  }

  /* ---------- 弹窗 ---------- */
  function openModal(mode) {
    var root = document.getElementById("modal-root");
    if (!root) return;
    var prev = document.activeElement;
    var isReg = mode === "register";
    root.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<div class="modal-panel"><div class="modal-head"><h3 id="modal-title">' + (isReg ? "注册" : "登录") +
      '</h3><button type="button" data-close aria-label="关闭">×</button></div>' +
      (isReg ? '<p class="msgline">昵称就是你的署名（样张，不真正注册）。</p>' : "") +
      '<label>昵称<input id="m-nick" type="text" maxlength="20" autocomplete="username" placeholder="社员建议用笔名" /></label>' +
      '<label>口令<input id="m-pass" type="password" maxlength="64" placeholder="' + (isReg ? "至少 8 位" : "") + '" /></label>' +
      '<button class="btn" type="button" id="m-ok">' + (isReg ? "注册并登录" : "登录") + "</button>" +
      '<p class="msgline" id="m-msg"></p></div></div>';
    var modal = root.querySelector(".modal");
    var panel = root.querySelector(".modal-panel");
    var nick = document.getElementById("m-nick");
    var pass = document.getElementById("m-pass");
    var ok = document.getElementById("m-ok");
    var msg = document.getElementById("m-msg");

    function close() {
      document.removeEventListener("keydown", onKey);
      root.innerHTML = "";
      if (prev && prev.focus) prev.focus();
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      if (ev.key !== "Tab") return;
      var f = Array.prototype.slice.call(panel.querySelectorAll("button, input, a[href]"))
        .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    modal.addEventListener("click", function (ev) { if (ev.target === modal) close(); });
    document.addEventListener("keydown", onKey);
    panel.querySelector("[data-close]").addEventListener("click", close);
    ok.addEventListener("click", function () {
      if (!nick.value.trim()) { showMsg(msg, "请填昵称。", "bad"); nick.focus(); return; }
      if (!pass.value) { showMsg(msg, "请填口令。", "bad"); pass.focus(); return; }
      loading(ok, true, "正在…");
      setTimeout(function () {
        if (!isReg) { close(); toast("已登录（样张）"); return; }
        panel.classList.add("is-success");
        panel.innerHTML = '<div class="modal-head"><h3>注册成功</h3><button type="button" data-close aria-label="关闭">×</button></div>' +
          '<p class="msgline">请把恢复码存好（样张，不真正注册）：</p>' +
          '<div class="recover"><code>4F2A-91C3-B7E5</code><button type="button" id="copy-code">复制</button></div>' +
          '<button class="btn" type="button" id="done">完成</button>';
        panel.querySelector("[data-close]").addEventListener("click", close);
        panel.querySelector("#done").addEventListener("click", close);
        panel.querySelector("#copy-code").addEventListener("click", function () { copyText("4F2A-91C3-B7E5", "恢复码已复制"); });
        panel.querySelector("#done").focus();
        toast("注册成功（样张）");
      }, 750);
    });
    nick.focus();
  }

  /* ---------- 顶栏与路由 ---------- */
  function syncUI() {
    Array.prototype.forEach.call(document.querySelectorAll("#style-switch [data-style]"), function (b) {
      b.classList.toggle("on", b.dataset.style === state.style);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#screen-nav [data-screen]"), function (b) {
      b.classList.toggle("on", b.dataset.screen === state.screen);
    });
    var theme = document.getElementById("theme-toggle");
    if (theme) {
      theme.textContent = state.theme === "dark" ? "日" : "夜";
      theme.setAttribute("aria-label", state.theme === "dark" ? "切换到浅色" : "切换到深色");
    }
    var cmp = document.getElementById("compare-link");
    if (cmp) cmp.href = "compare.html?screen=" + encodeURIComponent(state.screen);
  }
  function render() {
    var app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = (screens[state.screen] || screens.home)();
    bindScreen();
  }
  function setScreen(s) {
    state.screen = screens[s] ? s : "home";
    var u = new URL(location.href);
    u.searchParams.set("screen", state.screen);
    if (embed) { u.searchParams.set("embed", "1"); u.searchParams.set("style", state.style); }
    try { history.replaceState(null, "", u); } catch (e) {}
    render();
    syncUI();
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var params = new URLSearchParams(location.search);
    embed = params.get("embed") === "1";
    if (embed) document.body.classList.add("embed");
    var qstyle = params.get("style");
    state.style = qstyle === "e" ? "e" : qstyle === "a" ? "a" : (localStorage.getItem("proto-style") || "a");
    var qtheme = params.get("theme");
    state.theme = qtheme === "dark" ? "dark" : qtheme === "light" ? "light" :
      (localStorage.getItem("proto-theme") ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    state.screen = params.get("screen") || "home";
    document.documentElement.dataset.style = state.style;
    document.documentElement.dataset.theme = state.theme;

    var styleSwitch = document.getElementById("style-switch");
    if (styleSwitch) styleSwitch.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-style]");
      if (!b) return;
      state.style = b.dataset.style;
      document.documentElement.dataset.style = state.style;
      try { localStorage.setItem("proto-style", state.style); } catch (e) {}
      syncUI();
    });
    var screenNav = document.getElementById("screen-nav");
    if (screenNav) screenNav.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-screen]");
      if (b) setScreen(b.dataset.screen);
    });
    var theme = document.getElementById("theme-toggle");
    if (theme) theme.addEventListener("click", function () {
      state.theme = state.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = state.theme;
      try { localStorage.setItem("proto-theme", state.theme); } catch (e) {}
      syncUI();
    });
    var app = document.getElementById("app");
    if (app) app.addEventListener("click", function (ev) {
      var go = ev.target.closest("[data-go]");
      if (go) { ev.preventDefault(); setScreen(go.dataset.go); return; }
      var modal = ev.target.closest("[data-modal]");
      if (modal) { ev.preventDefault(); openModal(modal.dataset.modal); return; }
      var t = ev.target.closest("[data-toast]");
      if (t) { ev.preventDefault(); toast(t.dataset.toast); }
    });
    render();
    syncUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
