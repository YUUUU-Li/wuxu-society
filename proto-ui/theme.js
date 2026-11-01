/* 婺需文学社 · 主题板脚本
   五套主题只改 CSS 变量；不涉及页面布局。 */
(function () {
  "use strict";

  var VAR = {
    paper: "--paper", paper2: "--paper-2", surface: "--surface",
    ink: "--ink", inkSoft: "--ink-soft", muted: "--muted",
    line: "--line", lineSoft: "--line-soft",
    seal: "--seal", sealInk: "--seal-ink",
    action: "--action", actionInk: "--action-ink",
    accent: "--accent", accentDeep: "--accent-deep", accentSoft: "--accent-soft",
    highlight: "--highlight", ok: "--ok", warn: "--warn", danger: "--danger", info: "--info"
  };

  var ROLES = [
    ["paper", "纸", "页面底色"],
    ["paper2", "纸·深", "次级底"],
    ["surface", "纸·浮", "卡片/面板"],
    ["ink", "墨", "正文"],
    ["inkSoft", "墨·次", "正文次"],
    ["muted", "墨·淡", "元信息"],
    ["line", "线", "分隔"],
    ["lineSoft", "线·轻", "细分隔"],
    ["seal", "朱砂", "印/确认"],
    ["sealInk", "朱砂字", "印上字"],
    ["action", "行动", "主按钮/链接"],
    ["actionInk", "行动字", "按钮上字"],
    ["accent", "副色", "主题色"],
    ["accentDeep", "副色·深", "悬停/正文"],
    ["accentSoft", "副色·浅", "底纹"],
    ["highlight", "提亮", "特刊/数字"],
    ["ok", "成功", "状态"],
    ["warn", "提醒", "状态"],
    ["danger", "危险", "状态"],
    ["info", "信息", "状态"]
  ];

  var THEMES = {
    celadon: {
      name: "青瓷·雨过", kicker: "主主题 · v2",
      desc: "宋瓷雨后，纸色微青；墨青做行动色，朱砂只做印。字体与组件状态见下。",
      refs: "参考：StyleKit Cultural / Editorial；Design Prompts Academia / Newsprint；龙泉青瓷与宋画留白。",
      defaultMode: "light",
      light: {
        paper: "#F1F0E8", paper2: "#E3E9E2", surface: "#F7F6EF",
        ink: "#1E2927", inkSoft: "#40504B", muted: "#5A665F",
        line: "rgba(30,41,39,.17)", lineSoft: "rgba(30,41,39,.09)",
        seal: "#9C4A3A", sealInk: "#F7F2E8",
        action: "#2E4641", actionInk: "#F4F5EC",
        accent: "#6F8F86", accentDeep: "#385750", accentSoft: "#D8E3DD",
        highlight: "#B9A06A", ok: "#4F6B52", warn: "#8A6A2F", danger: "#8E3A2C", info: "#385750"
      },
      dark: {
        paper: "#141A18", paper2: "#1B2320", surface: "#1E2723",
        ink: "#E7E5D9", inkSoft: "#C0C9C0", muted: "#A2ADA4",
        line: "rgba(231,229,217,.18)", lineSoft: "rgba(231,229,217,.09)",
        seal: "#C56A55", sealInk: "#121917",
        action: "#A5B8B1", actionInk: "#121917",
        accent: "#8FB0A5", accentDeep: "#7A9D92", accentSoft: "#22302B",
        highlight: "#C0A876", ok: "#8FA38F", warn: "#C0A876", danger: "#D0715B", info: "#8FB0A5"
      }
    },
    vermilion: {
      name: "朱墨·双色", kicker: "期页 / 专题",
      desc: "民国书刊的双色印刷：newsprint 纸、墨黑、靛蓝与朱砂；有力度，也有纸感。",
      refs: "参考：StyleKit Retro / Art Deco；Design Prompts Newsprint / Art Deco；民国书刊封面与双色套印。",
      defaultMode: "light",
      light: {
        paper: "#F4EEDF", paper2: "#E9E1CF", surface: "#FAF6EC",
        ink: "#1C1A17", inkSoft: "#4A443A", muted: "#71685A",
        line: "rgba(28,26,23,.18)", lineSoft: "rgba(28,26,23,.09)",
        seal: "#B23A2A", sealInk: "#FBF4E8",
        action: "#7E3229", actionInk: "#FBF4E8",
        accent: "#2E4A5E", accentDeep: "#1F3443", accentSoft: "#D7E0E4",
        highlight: "#C9A86A", ok: "#4F6B52", warn: "#8A6A2F", danger: "#B23A2A", info: "#2E4A5E"
      },
      dark: {
        paper: "#171411", paper2: "#211C17", surface: "#251F19",
        ink: "#F0E8D8", inkSoft: "#CFC3AE", muted: "#B5A995",
        line: "rgba(240,232,216,.18)", lineSoft: "rgba(240,232,216,.09)",
        seal: "#D46A52", sealInk: "#171411",
        action: "#B87A6D", actionInk: "#171411",
        accent: "#8FA9B8", accentDeep: "#7193A4", accentSoft: "#26333A",
        highlight: "#C9A86A", ok: "#8FA38F", warn: "#C9A86A", danger: "#D46A52", info: "#8FA9B8"
      }
    },
    pine: {
      name: "松烟·夜读", kicker: "深色模式",
      desc: "松烟与灯下：暖黑纸、浅墨、松绿；作为夜间阅读主题，不建议做作品库主色。",
      refs: "参考：StyleKit Nature / Cozy；Design Prompts Monochrome / Academia；松烟墨与夜读灯下。",
      defaultMode: "dark",
      light: {
        paper: "#EFEADF", paper2: "#E4DDD0", surface: "#F7F2E8",
        ink: "#22201C", inkSoft: "#4A453C", muted: "#6E675B",
        line: "rgba(34,32,28,.16)", lineSoft: "rgba(34,32,28,.09)",
        seal: "#A84938", sealInk: "#F7F0E4",
        action: "#A84938", actionInk: "#F7F0E4",
        accent: "#5B6B5E", accentDeep: "#3F4F43", accentSoft: "#D9E0D8",
        highlight: "#C9A86A", ok: "#4F6B52", warn: "#8A6A2F", danger: "#A84938", info: "#5B6B5E"
      },
      dark: {
        paper: "#121110", paper2: "#1A1815", surface: "#1E1B17",
        ink: "#E7E1D3", inkSoft: "#C4BCAB", muted: "#8E8678",
        line: "rgba(231,225,211,.18)", lineSoft: "rgba(231,225,211,.09)",
        seal: "#C96B55", sealInk: "#121110",
        action: "#C96B55", actionInk: "#121110",
        accent: "#8FA38F", accentDeep: "#7C9379", accentSoft: "#243029",
        highlight: "#C9A86A", ok: "#8FA38F", warn: "#C9A86A", danger: "#C96B55", info: "#8FA38F"
      }
    },
    lotus: {
      name: "藕荷·词笺", kicker: "春季 / 柔性",
      desc: "藕粉纸、紫墨、鼠尾草；用于春季专题、评论与投稿，作品库仍建议用主主题。",
      refs: "参考：StyleKit Artistic / Watercolor；Design Prompts Botanical / Academia；十竹斋笺谱。",
      defaultMode: "light",
      light: {
        paper: "#F3EDE6", paper2: "#E9DDD5", surface: "#FAF5EF",
        ink: "#2A2324", inkSoft: "#574A4A", muted: "#6E5F5D",
        line: "rgba(42,35,36,.15)", lineSoft: "rgba(42,35,36,.08)",
        seal: "#A64B45", sealInk: "#FBF3EC",
        action: "#A64B45", actionInk: "#FBF3EC",
        accent: "#6E7C66", accentDeep: "#4D5B48", accentSoft: "#DDE3D8",
        highlight: "#C9A86A", ok: "#4F6B52", warn: "#8A6A2F", danger: "#A64B45", info: "#6E7C66"
      },
      dark: {
        paper: "#171314", paper2: "#211A1B", surface: "#262021",
        ink: "#EDE3DC", inkSoft: "#CDBFBA", muted: "#B3A29E",
        line: "rgba(237,227,220,.18)", lineSoft: "rgba(237,227,220,.09)",
        seal: "#D07A6C", sealInk: "#171314",
        action: "#D07A6C", actionInk: "#171314",
        accent: "#93A58E", accentDeep: "#7F9479", accentSoft: "#2A3228",
        highlight: "#C9A86A", ok: "#93A58E", warn: "#C9A86A", danger: "#D07A6C", info: "#93A58E"
      }
    },
    deco: {
      name: "海派·墨金", kicker: "特刊 / 周年",
      desc: "Art Deco 的几何与哑金；只做封面与分隔，不做正文。",
      refs: "参考：StyleKit Retro / Art Deco；Design Prompts Art Deco；1930 年代上海书刊与建筑装饰。",
      defaultMode: "light",
      light: {
        paper: "#F3EBDD", paper2: "#E8DCC8", surface: "#FAF4E8",
        ink: "#1A1714", inkSoft: "#4A4036", muted: "#73675A",
        line: "rgba(26,23,20,.18)", lineSoft: "rgba(26,23,20,.09)",
        seal: "#A83A2A", sealInk: "#FBF3E4",
        action: "#A83A2A", actionInk: "#FBF3E4",
        accent: "#B08D57", accentDeep: "#7F6136", accentSoft: "#E6D7C0",
        highlight: "#C9A86A", ok: "#4F6B52", warn: "#8A6A2F", danger: "#A83A2A", info: "#2E4A5E"
      },
      dark: {
        paper: "#141210", paper2: "#1F1A15", surface: "#241E18",
        ink: "#F0E7D6", inkSoft: "#D0C0A8", muted: "#B8A78F",
        line: "rgba(240,231,214,.18)", lineSoft: "rgba(240,231,214,.09)",
        seal: "#C16A4E", sealInk: "#141210",
        action: "#C16A4E", actionInk: "#141210",
        accent: "#C8A76A", accentDeep: "#A98551", accentSoft: "#33281A",
        highlight: "#C8A76A", ok: "#8FA38F", warn: "#C8A76A", danger: "#C16A4E", info: "#8FA9B8"
      }
    }
  };

  var current = "celadon";
  var mode = "light";
  var root = document.documentElement;

  function hexLum(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return null;
    var h = hex.slice(1);
    var rgb = [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16) / 255; });
    var lin = rgb.map(function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  function ratio(a, b) {
    var l1 = hexLum(a), l2 = hexLum(b);
    if (l1 === null || l2 === null) return null;
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function fmtRatio(n) { return n === null ? "—" : (Math.round(n * 10) / 10) + ":1"; }

  function apply() {
    var t = THEMES[current], p = t[mode];
    Object.keys(VAR).forEach(function (k) { root.style.setProperty(VAR[k], p[k]); });
    root.dataset.theme = current;
    root.dataset.mode = mode;
    document.title = "婺需文学社 · " + t.name + " · 主题板";

    var nameEl = document.getElementById("theme-name");
    if (nameEl) nameEl.textContent = t.name;
    var kicker = document.getElementById("theme-kicker");
    if (kicker) kicker.textContent = t.kicker + " · " + (mode === "dark" ? "深色" : "浅色");
    var desc = document.getElementById("theme-desc");
    if (desc) desc.textContent = t.desc;
    var refs = document.getElementById("theme-refs");
    if (refs) refs.textContent = t.refs;

    Array.prototype.forEach.call(document.querySelectorAll("#theme-nav [data-theme]"), function (b) {
      var on = b.dataset.theme === current;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var modeBtn = document.getElementById("mode-toggle");
    if (modeBtn) {
      modeBtn.textContent = mode === "dark" ? "日" : "夜";
      modeBtn.setAttribute("aria-label", mode === "dark" ? "切换到浅色" : "切换到深色");
      modeBtn.title = mode === "dark" ? "当前深色，点击切浅色" : "当前浅色，点击切深色";
    }

    renderSwatches(p);
    renderContrast(p);
  }

  function renderSwatches(p) {
    var box = document.getElementById("swatches");
    if (!box) return;
    box.innerHTML = ROLES.map(function (r) {
      var key = r[0], label = r[1], role = r[2], val = p[key];
      return '<div class="tb-swatch"><div class="tb-chip" style="background:' + val + '"></div>' +
        '<div class="label">' + label + '</div><div class="hex">' + val + '</div><div class="role">' + role + "</div></div>";
    }).join("");
  }
  function renderContrast(p) {
    var box = document.getElementById("contrast");
    if (!box) return;
    var pairs = [
      ["正文", p.ink, p.paper],
      ["次文", p.muted, p.paper],
      ["朱砂", p.seal, p.paper],
      ["行动", p.action, p.paper],
      ["副色", p.accentDeep, p.paper]
    ];
    box.innerHTML = pairs.map(function (x) {
      return "<span><b>" + x[0] + "</b> " + fmtRatio(ratio(x[1], x[2])) + "</span>";
    }).join("");
  }

  function setTheme(id) {
    if (!THEMES[id]) return;
    current = id;
    mode = THEMES[id].defaultMode;
    apply();
  }
  function toggleMode() {
    mode = mode === "dark" ? "light" : "dark";
    apply();
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    var qTheme = params.get("theme");
    if (THEMES[qTheme]) current = qTheme;
    var qMode = params.get("mode");
    mode = (qMode === "dark" || qMode === "light") ? qMode : THEMES[current].defaultMode;
    var nav = document.getElementById("theme-nav");
    if (nav) nav.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-theme]");
      if (b) setTheme(b.dataset.theme);
    });
    var modeBtn = document.getElementById("mode-toggle");
    if (modeBtn) modeBtn.addEventListener("click", toggleMode);

    document.addEventListener("click", function (ev) {
      var shake = ev.target.closest("[data-shake-target]");
      if (shake) {
        var target = document.querySelector(shake.getAttribute("data-shake-target"));
        if (target) {
          target.classList.remove("shake");
          void target.offsetWidth;
          target.classList.add("shake");
          setTimeout(function () { target.classList.remove("shake"); }, 540);
        }
      }
      if (ev.target.closest("[data-toast-demo]")) demoToast();
    });
    apply();
  }

  var demoTimer = 0, demoOut = 0;
  function demoToast() {
    var t = document.getElementById("demo-toast");
    if (!t) return;
    clearTimeout(demoTimer);
    clearTimeout(demoOut);
    t.classList.remove("out");
    t.classList.add("on");
    demoTimer = setTimeout(function () {
      t.classList.remove("on");
      t.classList.add("out");
      demoOut = setTimeout(function () { t.classList.remove("out"); }, 420);
    }, 1600);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
