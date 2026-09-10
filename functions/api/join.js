// 入社申请接口(Cloudflare Pages Functions 原生 ESM, 自包含)
// 网页表单 -> 自动开 PR(申请书存 applications/, 不进构建)
// 需 Pages 环境变量(secret): GITHUB_TOKEN_SUBMIT (Contents + Pull requests 读写)
// 流程: 校验 -> 建分支 apply/<ts>-<rand> -> 提交 applications/<file>.md -> 开 PR
const OWNER = "YUUUU-Li";
const REPO = "wuxu-society";
const BASE = "main";
const GH = "https://api.github.com";

const KINDS = { poem: "古诗词", modern: "现代诗", essay: "随笔", all: "都写", reader: "只读不写" };
const lastHit = new Map();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
const pad = (n) => String(n).padStart(2, "0");
function ts() {
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function rand2() {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  return c[Math.floor(Math.random() * c.length)] + c[Math.floor(Math.random() * c.length)];
}
function b64encode(s) {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function gh(token, path, opts = {}) {
  const res = await fetch(GH + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wuxu-join",
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

async function doJoin(context) {
  const token = context.env.GITHUB_TOKEN_SUBMIT;
  if (!token) {
    return json(503, { ok: false, error: "入社通道尚未配置完成，请稍后再试，或直接联系社长。" });
  }
  let input;
  try { input = await context.request.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }

  if (input.botField && String(input.botField).length > 0) {
    return json(200, { ok: true, honeypot: true, number: null, html_url: null });
  }

  const name = String(input.penname || "").trim().slice(0, 40);
  const mail = String(input.mail || "").trim().slice(0, 80);
  const kindKey = String(input.kind || "all").trim();
  const kind = KINDS[kindKey] || kindKey.slice(0, 20);
  const note = String(input.note || "").trim().replace(/\r/g, "").slice(0, 1000);

  if (!name) return json(400, { ok: false, error: "请填写笔名或称呼。" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return json(400, { ok: false, error: "邮箱格式不正确。" });
  if (note.length < 5) return json(400, { ok: false, error: "自我介绍太短，写三五句即可。" });
  if (/[<>]/.test(name + mail)) return json(400, { ok: false, error: "笔名/邮箱里不能包含 < > 字符。" });

  const ip = context.request.headers.get("cf-connecting-ip") || "unknown";
  const nowT = Date.now();
  const prev = lastHit.get(ip) || 0;
  if (nowT - prev < 60000) return json(429, { ok: false, error: "提交太频繁，请一分钟后再试。" });
  lastHit.set(ip, nowT);

  const id = ts() + "-" + rand2();
  const branch = "apply/" + id;
  const filePath = "applications/" + id + ".md";
  const md = [
    "# 入社申请 · " + name,
    "",
    "- 笔名/称呼：" + name,
    "- 邮箱：" + mail,
    "- 常写方向：" + kind,
    "- 提交时间：" + ts(),
    "",
    "## 自我介绍",
    "",
    note,
    "",
  ].join("\n");

  try {
    const head = await gh(token, "/repos/" + OWNER + "/" + REPO + "/git/ref/heads/" + BASE);
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/" + branch, sha: head.object.sha }),
    });
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + filePath, {
      method: "PUT",
      body: JSON.stringify({ message: "入社申请: " + name, content: b64encode(md), branch }),
    });
    const pr = await gh(token, "/repos/" + OWNER + "/" + REPO + "/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: "入社申请：" + name,
        head: branch,
        base: BASE,
        body:
          "## 入社申请\n- 笔名/称呼：" + name + "\n- 邮箱：" + mail + "\n- 常写方向：" + kind +
          "\n\n申请书全文见 `" + filePath + "`。审核通过请 **Merge**；联系后可删除本 PR。",
      }),
    });
    return json(200, { ok: true, number: pr.number, html_url: pr.html_url });
  } catch (err) {
    return json(500, {
      ok: false,
      error: "提交失败（" + (err && err.message ? err.message : "未知错误") + "）。请稍后再试，或直接联系社长。",
    });
  }
}

export async function onRequestPost(context) {
  return doJoin(context);
}
export async function onRequest(context) {
  return json(405, { ok: false, error: "只接受 POST" });
}
