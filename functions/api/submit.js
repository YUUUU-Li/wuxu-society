// Cloudflare Pages Functions 适配器（切换用）：
// 复用 netlify/functions/submit.js 同一份投稿逻辑，仅做"平台翻译层"。
// 部署形态：仓库根 /functions/api/submit.js -> Pages Functions 路由 /api/submit
// （勿放 /functions/submit.js：会与静态页 submit.html 的规范化路径 /submit 撞车，函数不触发）
// 需在 Cloudflare Pages 环境变量(secret)里配置 GITHUB_TOKEN_SUBMIT。
if (typeof Buffer === "undefined") {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  class ShimBuf {
    constructor(u8) {
      this.u8 = u8;
    }
    toString(fmt) {
      if (fmt === "base64") {
        let bin = "";
        for (let i = 0; i < this.u8.length; i++) bin += String.fromCharCode(this.u8[i]);
        return btoa(bin);
      }
      return dec.decode(this.u8);
    }
  }
  globalThis.Buffer = {
    from(input, fmt) {
      if (fmt === "base64") {
        const s = atob(String(input));
        const u = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        return new ShimBuf(u);
      }
      return new ShimBuf(enc.encode(String(input)));
    },
  };
}

const { handler } = require("../../netlify/functions/submit.js");

function headersToObj(h) {
  const o = {};
  h.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

exports.onRequest = async (context) => {
  const req = context.request;
  const headers = headersToObj(req.headers);
  // 限流依赖 x-forwarded-for；CF 侧的真实 IP 在 cf-connecting-ip
  if (!headers["x-forwarded-for"]) {
    const cfIp = req.headers.get("cf-connecting-ip");
    if (cfIp) headers["x-forwarded-for"] = cfIp;
  }
  // CF env -> process.env（投稿逻辑只读这一个变量）
  if (context.env && context.env.GITHUB_TOKEN_SUBMIT) {
    process.env.GITHUB_TOKEN_SUBMIT = context.env.GITHUB_TOKEN_SUBMIT;
  }
  const u = new URL(req.url);
  const event = {
    httpMethod: req.method,
    headers,
    body: await req.text(),
    queryStringParameters: Object.fromEntries(u.searchParams),
    path: u.pathname,
  };
  const r = await handler(event, {});
  return new Response(r.body, { status: r.statusCode, headers: r.headers });
};
