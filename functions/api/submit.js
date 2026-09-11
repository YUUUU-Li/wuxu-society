// 投稿接口(Cloudflare Pages Functions 原生实现, ESM 自包含): 网页表单 -> 自动开 PR (审稿单)
// 需 Pages 环境变量(secret): GITHUB_TOKEN_SUBMIT
//   (GitHub fine-grained token, 仅本仓库 Contents/Pull requests 读写)
// 流程: 校验 -> 自动生成标识名(w-<创作日期>-序号) -> 建分支 submit/<slug>
//       -> 提交 src/works/<slug>.md(含 created 创作时间) + 更新 src/_data/groups.json + fulltext_order.json
//       -> 待辑登记 pending_issue.json(best-effort) -> 开 PR
// 正文排版: 行首 & = 楷体文段(前记/后记/序), 行首 > = 引文块, 单独一行 --- = 分割线
const OWNER = "YUUUU-Li";
const REPO = "wuxu-society";
const BASE = "main";
const GROUPS_PATH = "src/_data/groups.json";
const ORDER_PATH = "src/_data/fulltext_order.json";
const PENDING_PATH = "src/_data/pending_issue.json";
const GH = "https://api.github.com";

const POETIC = /诗|词|联句|古风|律|绝|曲|赋/;
const lastHit = new Map();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad = (n) => String(n).padStart(2, "0");
function ts() {
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function rand2() {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  return c[Math.floor(Math.random() * c.length)] + c[Math.floor(Math.random() * c.length)];
}
// 无 Buffer: UTF-8 <-> base64 用 TextEncoder + btoa/atob
function b64encode(s) {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u);
}

const P_ANALYSIS = /^(注|注释|评注|评|赏析)\s*[:：]?\s*/;
const RULE_RE = /^-{3,}$/;
// 行首标记语法(投稿方写):
//   & 开头   -> 楷体文段(前记/后记/序/跋 等)
//   > 开头   -> 引文块(楷体 + 朱砂竖线)
//   单独一行 ---> 分割线
// 其余: 段首「注：」「评：」「赏析：」按赏析块; 诗词类每行成行, 散文类连排成段。
function bodyToHtml(text, genre) {
  const poetic = POETIC.test(genre || "");
  const blocks = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 1 && RULE_RE.test(lines[0])) return '<hr class="rule" />';
      if (/^&/.test(lines[0])) {
        const body = [lines[0].replace(/^&\s*/, ""), ...lines.slice(1)].filter(Boolean).map(esc);
        return '<p class="stanza kaiti">' + body.join("") + "</p>";
      }
      if (/^>/.test(lines[0])) {
        const body = lines.map((l) => l.replace(/^>\s?/, "")).filter((l) => l !== "").map(esc);
        return '<blockquote class="quote">' + body.join("<br />") + "</blockquote>";
      }
      let first = lines[0] || "";
      let mode = poetic ? "stanza" : "prose";
      const am = P_ANALYSIS.exec(first);
      if (am) {
        mode = "analysis";
        const rest = first.slice(am[1].length);
        if (/^[:：]/.test(rest)) first = rest.slice(1).trim();
        else if (rest.trim() === "") first = "";
      }
      const body = [first, ...lines.slice(1)].filter(Boolean).map(esc);
      if (mode === "stanza") return '<p class="stanza">' + body.join("<br />") + "</p>";
      if (mode === "kaiti") return '<p class="stanza kaiti">' + body.join("") + "</p>";
      if (mode === "analysis") return '<p class="analysis">' + body.join(" ") + "</p>";
      return '<p class="prose">' + body.join(" ") + "</p>";
    })
    .join("\n");
}

async function gh(token, path, opts = {}) {
  const res = await fetch(GH + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wuxu-submit",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error("GitHub API " + res.status + ": " + (data && data.message ? data.message : text));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function doSubmit(context) {
  const token = context.env.GITHUB_TOKEN_SUBMIT;
  if (!token) {
    return json(503, { ok: false, error: "投稿通道尚未配置完成，请稍后再试，或联系社长代投。" });
  }
  let input;
  try { input = await context.request.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }

  if (input.website && String(input.website).length > 0) {
    return json(200, { ok: true, number: null, html_url: null, honeypot: true });
  }

  const title = String(input.title || "").trim().slice(0, 60);
  const author = String(input.author || "").trim().slice(0, 40);
  const genre = String(input.genre || "").trim().slice(0, 40);
  const source = String(input.source || "").trim().slice(0, 100);
  const imageriesRaw = String(input.imageries || "").trim().slice(0, 200);
  const excerpt = String(input.excerpt || "").trim().replace(/\s+/g, " ").slice(0, 60);
  // 题记(排在正文开篇, 楷体) 与 自注(排在正文下方, 楷体) —— 保留换行, 两个都选填
  const epigraph = String(input.epigraph || "").replace(/\r/g, "").trim().slice(0, 200);
  const selfNote = String(input.selfNote || "").replace(/\r/g, "").trim().slice(0, 600);
  const editorNote = String(input.editorNote || "").trim().replace(/[\r\t]/g, "").slice(0, 500);
  const body = String(input.body || "").trim().slice(0, 20000);
  if (!title) return json(400, { ok: false, error: "缺少题名。" });
  if (!author) return json(400, { ok: false, error: "缺少署名。" });
  if (!genre) return json(400, { ok: false, error: "请选择体裁。" });
  if (body.length < 10) return json(400, { ok: false, error: "正文太短。" });
  if (/[<>]/.test(title + author + genre + source + excerpt + epigraph + selfNote)) {
    return json(400, { ok: false, error: "题名/署名/摘句/题记/自注里不能包含 < > 字符。" });
  }
  const created = String(input.created || "").trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(created)) {
    return json(400, { ok: false, error: "请填写创作时间（年月，如 2024-04）。" });
  }
  const [cy, cm, cd] = created.split("-");
  if (+cy < 1900 || +cy > 2100 || +cm < 1 || +cm > 12 || (cd && (+cd < 1 || +cd > 31))) {
    return json(400, { ok: false, error: "创作时间不合法。" });
  }
  const imageries = imageriesRaw
    ? imageriesRaw.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean).slice(0, 12)
    : [];
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim());
  if (paragraphs.length > 200) return json(400, { ok: false, error: "正文分段过多，请精简。" });

  const ip = context.request.headers.get("cf-connecting-ip") || "unknown";
  const nowT = Date.now();
  const prev = lastHit.get(ip) || 0;
  if (nowT - prev < 60000) {
    return json(429, { ok: false, error: "提交太频繁，请一分钟后再试。" });
  }
  lastHit.set(ip, nowT);

  // 标识名 = w-<创作日期>-<当日序号>（如 w-2024-0404-01）; 同日多篇依次 01,02...
  // 说明: 投稿者不再自填标识名; 编委若想要雅名, 可在合并前跑 npm run rename-work 改名(未发布无外链)
  const stamp = created.replace(/-/g, "");
  let slug = "";
  try {
    for (let n = 1; n <= 99; n++) {
      const cand = "w-" + stamp + "-" + pad(n);
      let taken = true;
      try {
        await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/src/works/" + cand + ".md");
      } catch (e) {
        if (!e.status || e.status !== 404) throw e;
        taken = false;
      }
      if (!taken) { slug = cand; break; }
    }
    if (!slug) return json(500, { ok: false, error: "同日作品过多，请稍后再试或联系社长。" });
  } catch (err) {
    return json(500, { ok: false, error: "投稿暂时失败，请稍后再试或联系社长代投。" });
  }
  const branch = "submit/" + slug;

  const bodyHtml = bodyToHtml(body, genre);
  const q = (s) => s.replace(/"/g, '\\"');
  // 双引号 YAML 标量里的换行要写成 \n 转义(解析回来仍是真换行), 这样题记/自注的多行不会破坏 front matter
  const qm = (s) => q(s).replace(/\n/g, "\\n");
  const fm = [
    "---",
    'title: "' + q(title) + '"',
    'author: "' + q(author) + '"',
    'genre: "' + q(genre) + '"',
    'created: "' + created + '"',
  ];
  if (source) fm.push('source: "' + q(source) + '"');
  if (excerpt) fm.push('excerpt: "' + q(excerpt) + '"');
  if (epigraph) fm.push('epigraph: "' + qm(epigraph) + '"');
  if (selfNote) fm.push('selfNote: "' + qm(selfNote) + '"');
  if (imageries.length) fm.push("imageries: [" + imageries.map((s) => JSON.stringify(s)).join(", ") + "]");
  fm.push("---", "");
  const md = fm.join("\n") + "<!-- 正文片段: 每段一个 <p>；改字请只动这里 -->\n" + bodyHtml + "\n";

  try {
    const head = await gh(token, "/repos/" + OWNER + "/" + REPO + "/git/ref/heads/" + BASE);
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/" + branch, sha: head.object.sha }),
    });
    const groupsRes = await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + GROUPS_PATH + "?ref=" + BASE);
    const groups = JSON.parse(b64decode(groupsRes.content));
    const bucket = groups.find((g) => g.key === "other");
    if (!bucket) throw new Error("groups.json 缺少 other 分组");
    if (!bucket.slugs.includes(slug)) bucket.slugs.push(slug);
    const groupsB64 = b64encode(JSON.stringify(groups, null, 2));
    const orderRes = await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + ORDER_PATH + "?ref=" + BASE);
    const order = JSON.parse(b64decode(orderRes.content));
    if (!order.includes(slug)) order.push(slug);
    const orderB64 = b64encode(JSON.stringify(order, null, 2));
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/src/works/" + slug + ".md", {
      method: "PUT",
      body: JSON.stringify({ message: "投稿: " + title + "（" + author + "）", content: b64encode(md), branch }),
    });
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + GROUPS_PATH, {
      method: "PUT",
      body: JSON.stringify({ message: "投稿: 登记 " + slug, content: groupsB64, sha: groupsRes.sha, branch }),
    });
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + ORDER_PATH, {
      method: "PUT",
      body: JSON.stringify({ message: "投稿: 登记全文库 " + slug, content: orderB64, sha: orderRes.sha, branch }),
    });
    try {
      const pendRes = await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + PENDING_PATH + "?ref=" + BASE);
      const pend = JSON.parse(b64decode(pendRes.content));
      if (Array.isArray(pend) && !pend.includes(slug)) {
        pend.push(slug);
        await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + PENDING_PATH, {
          method: "PUT",
          body: JSON.stringify({
            message: "投稿: 记待辑 " + slug,
            content: b64encode(JSON.stringify(pend, null, 2)),
            sha: pendRes.sha,
            branch,
          }),
        });
      }
    } catch (e) {
      // 待辑登记失败不影响投稿主流程
    }
    const noteBody = editorNote
      ? "## 给编委的附言\n" + editorNote.split("\n").map((l) => "> " + l).join("\n") + "\n\n"
      : "";
    const pr = await gh(token, "/repos/" + OWNER + "/" + REPO + "/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: "投稿：" + title + "（" + author + "）",
        head: branch,
        base: BASE,
        body:
          noteBody + "## 投稿：" + title +
          "\n- 作者：" + author +
          "\n- 体裁：" + genre +
          "\n- 创作时间：" + created +
          (source ? "\n- 出处：" + source : "") +
          (epigraph ? "\n- 题记：" + epigraph.replace(/\n/g, " ⏎ ") : "") +
          (selfNote ? "\n- 自注：" + selfNote.replace(/\n/g, " ⏎ ") : "") +
          "\n- 文件标识（自动生成）：`" + slug + "`——如想要雅名，见《编委操作手册》「改名」一节（本地终端跑 `npm run rename-work`，合并前后皆可；已自动带 301 跳转，旧链接不失效）" +
          "\n\nCloudflare Pages 预览链接会自动出现在本 PR 中。审核通过请点 **Merge pull request**；需修改可在文件里直接改，或让作者在网页重新提交。",
      }),
    });
    return json(200, { ok: true, number: pr.number, html_url: pr.html_url, slug });
  } catch (err) {
    return json(500, {
      ok: false,
      error: "投稿暂时失败（" + (err && err.message ? err.message : "未知错误") + "）。请稍后再试或联系社长代投。",
    });
  }
}

export async function onRequestPost(context) {
  return doSubmit(context);
}
export async function onRequest(context) {
  return json(405, { ok: false, error: "只接受 POST" });
}
export { bodyToHtml };
