// 正文排版预览接口(Cloudflare Pages Functions 原生 ESM)
// POST /api/preview { body, genre, epigraph?, selfNote? } -> { ok, html }
// 直接复用投稿函数的 bodyToHtml, 并照作品页的包法把「题记」放正文前、「自注」放正文后,
// 保证"预览 = 实际发布排版"(见 src/_includes/layouts/work.njk)。
import { bodyToHtml } from "./submit.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
// 与模板里的转义一致: 先转义, 再把换行变成 <br />
function escLines(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    .replace(/\n/g, "<br />");
}

export async function onRequestPost(context) {
  let input;
  try { input = await context.request.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }
  const body = String(input.body || "").slice(0, 20000);
  const genre = String(input.genre || "").slice(0, 40);
  const epigraph = String(input.epigraph || "").replace(/\r/g, "").trim().slice(0, 200);
  const selfNote = String(input.selfNote || "").replace(/\r/g, "").trim().slice(0, 600);
  if (!body.trim()) return json(400, { ok: false, error: "请先写正文。" });
  const parts = [];
  if (epigraph) parts.push('<p class="work-epigraph kaiti">' + escLines(epigraph) + "</p>");
  parts.push(bodyToHtml(body, genre));
  if (selfNote) parts.push('<div class="work-selfnote kaiti">' + escLines(selfNote) + "</div>");
  return json(200, { ok: true, html: parts.join("\n") });
}

export async function onRequest() {
  return json(405, { ok: false, error: "只接受 POST" });
}
