// 题记/自注(短文本块)转义口径单测: node scripts/test-blocks.js
// 关键点: 作品页模板用的 escLines 过滤器(scripts/text-blocks.js)
//         必须与投稿预览接口(functions/api/preview.js)的口径**逐字节一致**,
//         否则会出现"预览好看、发布变形"。这里两边都真跑一遍来比对。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const { escLines } = require("./text-blocks.js");

const CASES = [
  "",                                     // 空
  "是夜宿江馆，闻雨声不绝。",                 // 单行
  "是夜宿江馆，\n闻雨声不绝。",               // 多行 -> <br />
  "颔联用王子猷雪夜访戴事。\r\n「红砖」指老校区的红砖楼。",  // CRLF 归一
  '<img src=x onerror=alert(1)>',         // 标签转义
  "甲 & 乙 <script>alert('x')</script>",  // 与号/引号转义
  '他说："好"。',                          // 双引号
];

async function main() {
  // 1) escLines 自身口径
  assert.strictEqual(escLines("甲\n乙"), "甲<br />乙", "换行 -> <br />");
  assert.strictEqual(escLines("甲\r\n乙"), "甲<br />乙", "CRLF 也归一");
  assert.strictEqual(escLines("<b>粗</b>"), "&lt;b&gt;粗&lt;/b&gt;", "标签转义");
  assert.strictEqual(escLines("a&b"), "a&amp;b", "& 转义");
  assert.strictEqual(escLines(null), "" , "null -> 空串");
  assert.strictEqual(escLines(undefined), "", "undefined -> 空串");

  // 2) 与预览接口口径一致(同输入 -> 同一段 HTML)
  const pv = await import(pathToFileURL(path.join(ROOT, "functions", "api", "preview.js")).href);
  for (const s of CASES) {
    const r = await pv.onRequestPost({
      request: new Request("https://wuxu.org/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "正文足够长了。", epigraph: s, selfNote: s }),
      }),
      env: {},
    });
    assert.strictEqual(r.status, 200, "预览应成功");
    const html = (await r.json()).html;
    const want = escLines(s.trim());   // 接口先 trim 再转义(与投稿一致)
    if (!want) {
      assert(!html.includes("work-epigraph") && !html.includes("work-selfnote"), "留空则不渲染题记/自注");
      continue;
    }
    assert(html.includes('<p class="work-epigraph kaiti">' + want + "</p>"),
      "题记渲染应与 escLines 一致: " + JSON.stringify(s));
    assert(html.includes('<div class="work-selfnote kaiti">' + want + "</div>"),
      "自注渲染应与 escLines 一致: " + JSON.stringify(s));
  }

  // 3) 接线: 模板/配置/样式三处都在
  const workNjk = fs.readFileSync(path.join(ROOT, "src/_includes/layouts/work.njk"), "utf8");
  assert(workNjk.includes("{{ epigraph | escLines | safe }}"), "作品页题记应走 escLines 过滤器");
  assert(workNjk.includes("{{ selfNote | escLines | safe }}"), "作品页自注应走 escLines 过滤器");
  assert(!workNjk.includes('replace("\\n"'), "不要再用 replace(\"\\n\") 写法(转义在 JS 里统一做)");
  const el = fs.readFileSync(path.join(ROOT, ".eleventy.js"), "utf8");
  assert(el.includes('require("./scripts/text-blocks.js")') && el.includes('addFilter("escLines"'),
    ".eleventy.js 应注册 escLines 过滤器");

  console.log("✅ test-blocks.js 全部通过 (题记·自注转义口径 / 与预览接口一致 / 模板接线, 共 " + CASES.length + " 例)");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
