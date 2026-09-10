// 入社申请接口(Cloudflare Pages Functions 原生 ESM, 自包含)
// 网页表单 -> 自动开 PR: 申请书(applications/) + 名册草稿(src/_data/members.json) 同分支
// 需 Pages 环境变量(secret): GITHUB_TOKEN_SUBMIT (Contents + Pull requests 读写)
// 流程: 校验 -> 建分支 apply/<id> -> 写申请书 -> 名册草稿入 members.json -> 开 PR
// 名册草稿约定: 缩写建议取邮箱前缀(常为拼音), 分部取"地区"字段, 未填则「待考」;
//               编委在 PR 里确认缩写/角色/分部后 Merge, 即同时完成归档与入册。
const OWNER = "YUUUU-Li";
const REPO = "wuxu-society";
const BASE = "main";
const MEMBERS_PATH = "src/_data/members.json";
const GH = "https://api.github.com";

const KINDS = { poem: "古诗词", modern: "现代诗", essay: "随笔", all: "都写", reader: "只读不写" };
const UNKNOWN_BRANCH = "待考";
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
function b64decode(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u);
}
// 缩写草稿: 邮箱前缀若合法小写字母开头则直接采用, 否则 pending-xx
function idHint(mail) {
  const local = String(mail).split("@")[0].toLowerCase();
  const m = /^[a-z][a-z0-9-]{0,15}$/.exec(local);
  return m ? m[0] : "pending-" + rand2();
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
  const region = String(input.region || "").trim().slice(0, 30);
  const kindKey = String(input.kind || "all").trim();
  const kind = KINDS[kindKey] || kindKey.slice(0, 20);
  const note = String(input.note || "").trim().replace(/\r/g, "").slice(0, 1000);

  if (!name) return json(400, { ok: false, error: "请填写笔名或称呼。" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return json(400, { ok: false, error: "邮箱格式不正确。" });
  if (note.length < 5) return json(400, { ok: false, error: "自我介绍太短，写三五句即可。" });
  if (/[<>]/.test(name + mail + region)) return json(400, { ok: false, error: "笔名/邮箱/地区里不能包含 < > 字符。" });

  const ip = context.request.headers.get("cf-connecting-ip") || "unknown";
  const nowT = Date.now();
  const prev = lastHit.get(ip) || 0;
  if (nowT - prev < 60000) return json(429, { ok: false, error: "提交太频繁，请一分钟后再试。" });
  lastHit.set(ip, nowT);

  const id = ts() + "-" + rand2();
  const branch = "apply/" + id;
  const filePath = "applications/" + id + ".md";
  const branchName = region || UNKNOWN_BRANCH;
  const slugHint = idHint(mail);
  const md = [
    "# 入社申请 · " + name,
    "",
    "- 笔名/称呼：" + name,
    "- 邮箱：" + mail,
    "- 地区：" + (region || "未填"),
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

    // 名册草稿: 同分支插入一条, 编委在 PR 里确认后一键 Merge 即入册
    const memRes = await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + MEMBERS_PATH + "?ref=" + BASE);
    const members = JSON.parse(b64decode(memRes.content));
    let sec = members.find((s) => s.branch === branchName);
    if (!sec) {
      sec = { branch: branchName, members: [] };
      members.push(sec);
    }
    const taken = members.some((s) => s.members.some((m) => m.id === slugHint));
    sec.members.push({
      id: taken ? slugHint + "-" + rand2() : slugHint,
      name: name,
      role: "社员",
      branch: branchName,
      note: "",
      links: [],
    });
    await gh(token, "/repos/" + OWNER + "/" + REPO + "/contents/" + MEMBERS_PATH, {
      method: "PUT",
      body: JSON.stringify({
        message: "入社: 名册草稿 " + name,
        content: b64encode(JSON.stringify(members, null, 2) + "\n"),
        sha: memRes.sha,
        branch,
      }),
    });

    const pr = await gh(token, "/repos/" + OWNER + "/" + REPO + "/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: "入社申请：" + name,
        head: branch,
        base: BASE,
        body:
          "## 入社申请\n- 笔名/称呼：" + name + "\n- 邮箱：" + mail + "\n- 地区：" + (region || "未填") +
          "\n- 常写方向：" + kind +
          "\n\n申请书全文见 `" + filePath + "`。\n\n" +
          "### 合入前请确认名册草稿（`" + MEMBERS_PATH + "`）\n" +
          "- [ ] **缩写**：草稿暂用 `" + slugHint + "`（取自邮箱前缀，可能非其常用缩写，请按社内习惯改）\n" +
          "- [ ] **分部**：草稿为 `" + branchName + "`" + (region ? "（申请人所填地区，请归并为正式分部）" : "（申请人未填地区，请补分部）") + "\n" +
          "- [ ] **角色**：草稿默认 `社员`，编委/社长等请改\n" +
          "- [ ] 姓名格式建议 `缩写 · 笔名`（现为 `" + name + "`）\n\n" +
          "确认无误后点 **Merge**，即同时完成申请归档与入册；漏改可事后直接改 `" + MEMBERS_PATH + "` 或跑 `npm run add-member`。",
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
export async function onRequest() {
  return json(405, { ok: false, error: "只接受 POST" });
}
