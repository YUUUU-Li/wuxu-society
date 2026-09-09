// 投稿接口: 网页表单 -> 自动开 PR (审稿单)
// 部署于 Netlify Functions。需要环境变量 GITHUB_TOKEN_SUBMIT
// (GitHub fine-grained token, 仅本仓库 Contents/Pull requests 读写)
//
// 流程: 校验 -> 生成 slug -> 建分支 submit/<slug>
//       -> 提交 src/works/<slug>.md + 更新 src/_data/groups.json -> 开 PR
const OWNER = "YUUUU-Li";
const REPO = "wuxu-society";
const BASE = "main";
const GROUPS_PATH = "src/_data/groups.json";
const ORDER_PATH = "src/_data/fulltext_order.json";
const GH = "https://api.github.com";

// 体裁里含这些词的按"诗句"排版(行间 <br />, class=stanza), 否则按散文段落
const POETIC = /诗|词|联句|古风|律|绝|曲|赋/;

// 简单限流: 每个 IP 两次投稿间隔 >= 60s (内存态, 冷启动会重置, 够用即可)
const lastHit = new Map();

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pad(n) { return String(n).padStart(2, "0"); }
function ts() {
  const d = new Date();
  return (
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  );
}

function rand2() {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  return c[Math.floor(Math.random() * c.length)] + c[Math.floor(Math.random() * c.length)];
}

// 正文 -> HTML 片段: 空行分段; 诗句段落内行间 <br />
function bodyToHtml(text, genre) {
  const poetic = POETIC.test(genre || "");
  const paras = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras
    .map((p) => {
      const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
      if (poetic) {
        return '<p class="stanza">' + lines.map(esc).join("<br />") + "</p>";
      }
      return '<p class="prose">' + lines.map(esc).join(" ") + "</p>";
    })
    .join("\n");
}

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN_SUBMIT;
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

exports.handler = async (event) => {
  const respond = (status, body) => ({
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  });

  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "只接受 POST" });
  if (!process.env.GITHUB_TOKEN_SUBMIT) {
    return respond(503, { ok: false, error: "投稿通道尚未配置完成，请稍后再试，或联系社长代投。" });
  }

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "请求格式不正确。" }); }

  // honeypot: 机器人填了隐藏字段 -> 假装成功
  if (input.website && String(input.website).length > 0) {
    return respond(200, { ok: true, number: null, html_url: null, honeypot: true });
  }

  const title = String(input.title || "").trim().slice(0, 60);
  const author = String(input.author || "").trim().slice(0, 40);
  const genre = String(input.genre || "").trim().slice(0, 40);
  const source = String(input.source || "").trim().slice(0, 100);
  const imageriesRaw = String(input.imageries || "").trim().slice(0, 200);
  const body = String(input.body || "").trim().slice(0, 20000);
  if (!title) return respond(400, { ok: false, error: "缺少题名。" });
  if (!author) return respond(400, { ok: false, error: "缺少署名。" });
  if (!genre) return respond(400, { ok: false, error: "请选择体裁。" });
  if (body.length < 10) return respond(400, { ok: false, error: "正文太短。" });
  if (/[<>]/.test(title + author + genre + source)) {
    return respond(400, { ok: false, error: "题名/署名里不能包含 < > 字符。" });
  }
  const imageries = imageriesRaw
    ? imageriesRaw.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean).slice(0, 12)
    : [];
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim());
  if (paragraphs.length > 200) return respond(400, { ok: false, error: "正文分段过多，请精简。" });

  // 简单限流
  const ip = (event.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const prev = lastHit.get(ip) || 0;
  if (now - prev < 60000) {
    return respond(429, { ok: false, error: "提交太频繁，请一分钟后再试。" });
  }
  lastHit.set(ip, now);

  let slug = "w-sub-" + ts() + "-" + rand2();
  const slugHint = String(input.slug || "").trim().toLowerCase().slice(0, 40);
  if (slugHint) {
    if (!/^[a-z][a-z0-9-]*$/.test(slugHint)) {
      return respond(400, { ok: false, error: "文件标识只能用小写字母开头，含小写字母、数字、连字符。" });
    }
    try {
      slug = "w-" + slugHint;
      for (let i = 2; i <= 20; i++) {
        let taken = true;
        try {
          await gh("/repos/" + OWNER + "/" + REPO + "/contents/src/works/" + slug + ".md");
        } catch (e) {
          if (!e.status || e.status !== 404) throw e;
          taken = false; // 404 = 该名字未被占用
        }
        if (!taken) break;
        slug = "w-" + slugHint + "-" + i;
      }
    } catch (err) {
      console.error("slug check failed:", err && err.message ? err.message : err);
      return respond(500, { ok: false, error: "投稿暂时失败，请稍后再试或联系社长代投。" });
    }
  }
  const branch = "submit/" + slug;

  const bodyHtml = bodyToHtml(body, genre);
  const fm = [
    "---",
    'title: "' + title.replace(/"/g, '\\"') + '"',
    'author: "' + author.replace(/"/g, '\\"') + '"',
    'genre: "' + genre.replace(/"/g, '\\"') + '"',
  ];
  if (source) fm.push('source: "' + source.replace(/"/g, '\\"') + '"');
  if (imageries.length) {
    fm.push("imageries: [" + imageries.map((s) => JSON.stringify(s)).join(", ") + "]");
  }
  fm.push("---", "");
  const md =
    fm.join("\n") +
    "<!-- 正文片段: 每段一个 <p>；改字请只动这里 -->\n" +
    bodyHtml +
    "\n";

  try {
    // 1) main 最新提交
    const head = await gh("/repos/" + OWNER + "/" + REPO + "/git/ref/heads/" + BASE);
    const headSha = head.object.sha;
    // 2) 建分支
    await gh("/repos/" + OWNER + "/" + REPO + "/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/" + branch, sha: headSha }),
    });
    // 3) 读 groups.json 与 fulltext_order.json (main 上, 分支内容相同)
    const groupsRes = await gh(
      "/repos/" + OWNER + "/" + REPO + "/contents/" + GROUPS_PATH + "?ref=" + BASE
    );
    const groups = JSON.parse(Buffer.from(groupsRes.content, "base64").toString("utf8"));
    const bucket = groups.find((g) => g.key === "other");
    if (!bucket) throw new Error("groups.json 缺少 other 分组");
    if (!bucket.slugs.includes(slug)) bucket.slugs.push(slug);
    const groupsB64 = Buffer.from(JSON.stringify(groups, null, 2), "utf8").toString("base64");
    // 3b) 读 fulltext_order.json 并把新 slug 追加到末尾 (全文源库顺序)
    const orderRes = await gh(
      "/repos/" + OWNER + "/" + REPO + "/contents/" + ORDER_PATH + "?ref=" + BASE
    );
    const order = JSON.parse(Buffer.from(orderRes.content, "base64").toString("utf8"));
    if (!order.includes(slug)) order.push(slug);
    const orderB64 = Buffer.from(JSON.stringify(order, null, 2), "utf8").toString("base64");
    // 4) 提交作品 md (新文件, 无需 sha)
    await gh("/repos/" + OWNER + "/" + REPO + "/contents/src/works/" + slug + ".md", {
      method: "PUT",
      body: JSON.stringify({ message: "投稿: " + title + "（" + author + "）", content: Buffer.from(md, "utf8").toString("base64"), branch }),
    });
    // 5) 更新 groups.json 与 fulltext_order.json
    await gh("/repos/" + OWNER + "/" + REPO + "/contents/" + GROUPS_PATH, {
      method: "PUT",
      body: JSON.stringify({ message: "投稿: 登记 " + slug, content: groupsB64, sha: groupsRes.sha, branch }),
    });
    await gh("/repos/" + OWNER + "/" + REPO + "/contents/" + ORDER_PATH, {
      method: "PUT",
      body: JSON.stringify({ message: "投稿: 登记全文库 " + slug, content: orderB64, sha: orderRes.sha, branch }),
    });
    // 6) 开 PR
    const pr = await gh("/repos/" + OWNER + "/" + REPO + "/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: "投稿：" + title + "（" + author + "）",
        head: branch,
        base: BASE,
        body:
          "## 投稿：" + title +
          "\n- 作者：" + author +
          "\n- 体裁：" + genre +
          (source ? "\n- 出处：" + source : "") +
          "\n\nNetlify 预览链接会自动出现在本 PR 中。审核通过请点 **Merge pull request**；需修改可在文件里直接改，或让作者在网页重新提交。",
      }),
    });
    return respond(200, { ok: true, number: pr.number, html_url: pr.html_url, slug });
  } catch (err) {
    console.error("submit failed:", err && err.stack ? err.stack : err);
    return respond(500, {
      ok: false,
      error: "投稿暂时失败（" + (err && err.message ? err.message : "未知错误") + "）。请稍后再试或联系社长代投。",
    });
  }
};
