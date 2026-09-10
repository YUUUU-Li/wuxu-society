// 正文排版预览接口(Cloudflare Pages Functions 原生 ESM)
// POST /api/preview { body, genre } -> { ok, html }
// 直接复用投稿函数的 bodyToHtml, 保证"预览 = 实际发布排版"。
import { bodyToHtml } from "./submit.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  let input;
  try { input = await context.request.json(); } catch { return json(400, { ok: false, error: "请求格式不正确。" }); }
  const body = String(input.body || "").slice(0, 20000);
  const genre = String(input.genre || "").slice(0, 40);
  if (!body.trim()) return json(400, { ok: false, error: "请先写正文。" });
  return json(200, { ok: true, html: bodyToHtml(body, genre) });
}

export async function onRequest() {
  return json(405, { ok: false, error: "只接受 POST" });
}
