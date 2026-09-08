#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性迁移提取脚本 (2026-09):
从旧静态站 (w-*.html / qingming-*.html / members.html / library.html / index.html)
提取全部内容到 Eleventy 源结构:
  src/works/<slug>.md       每篇一个文件: YAML front matter + 正文 HTML 片段
  src/_data/groups.json     作品库三分组及组内顺序 (来自 library.html 呈现顺序)
  src/_data/members.json    社员档案 (来自 members.html 呈现顺序)
用法: python scripts/migrate_extract.py <site-root>
"""
import re, os, sys, json, html as H

ROOT = sys.argv[1] if len(sys.argv) > 1 else r"D:/wuxu-society/wuxu-society"
SRC_WORKS = os.path.join(ROOT, "src", "works")
SRC_DATA = os.path.join(ROOT, "src", "_data")
os.makedirs(SRC_WORKS, exist_ok=True)
os.makedirs(SRC_DATA, exist_ok=True)

def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()

def jstr(s):
    return json.dumps(s, ensure_ascii=False)

def yaml_list(items):
    return "[" + ", ".join(jstr(x) for x in items) + "]"

def parse_page(path):
    s = read(path)
    slug = os.path.basename(path)[:-5]
    h1 = re.search(r'<h1 class="p-title rv">(.*?)</h1>', s, re.S).group(1).strip()
    mm = re.search(r'<div class="p-meta rv">(.*?)</div>', s, re.S).group(1)
    meta = {}
    for sp in re.findall(r'<span>(.*?)</span>', mm, re.S):
        b = re.search(r'<b>(.*?)</b>', sp, re.S)
        key = H.unescape(b.group(1)).strip() if b else ""
        rest = re.sub(r'<b>.*?</b>', '', sp, flags=re.S)
        a = re.search(r'<a href="members.html#([^"]+)">(.*?)</a>', rest, re.S)
        if key == "作者" and a:
            meta["author"] = H.unescape(a.group(2)).strip()
            meta["ak"] = a.group(1).strip()
        else:
            txt = H.unescape(re.sub(r'<[^>]+>', '', rest)).strip()
            if key == "分部": meta["branch"] = txt
            elif key == "体裁": meta["genre"] = txt
            elif key == "出处": meta["source"] = txt
    body = re.search(r'<div class="lib-body">(.*?)</div>\s*</section>', s, re.S)
    body_html = body.group(1).strip() if body else ""
    rel = re.search(r'<section class="wrap rel rv">(.*?)</section>', s, re.S)
    rels = []
    if rel:
        cur = None
        for token in re.findall(r'<h4>(.*?)</h4>|<li>(.*?)</li>', rel.group(1), re.S):
            if token[0]:
                h = H.unescape(token[0]).strip()
                cur = {"本作关联（唱和 · 组诗）": "strong", "同作者": "author",
                       "同意象": "imagery", "同时同源": "source"}.get(h, "strong")
            else:
                a = re.search(r'href="([^"]+)"[^>]*>(.*?)</a>', token[1], re.S)
                r = re.search(r'<span class="reason">(.*?)</span>', token[1], re.S)
                if a and cur:
                    rels.append({"to": os.path.basename(a.group(1))[:-5],
                                 "cat": cur,
                                 "title": H.unescape(a.group(2)).strip(),
                                 "label": H.unescape(r.group(1)).strip() if r else ""})
    return {"slug": slug, "title": h1, "body": body_html, "meta": meta, "rel": rels}

# ---------- 1) 读取旧 JSON 元数据作参照 (tm / im / strong) ----------
dw = json.loads(read("data-works.json"))
by_file = {w["file"]: w for w in dw["works"]}

# ---------- 2) library.html 分组顺序 ----------
lib = read("library.html")
groups_def = [
    ("qingming", "清明首聚 · 立社原创"),
    ("huiyi", "回忆文会《时间溯流》（公众号）"),
    ("other", "其余社员作品"),
]
group_slugs = {}
for key, h2 in groups_def:
    m = re.search(re.escape(h2) + r'</h2><hr class="hair" /></div><div class="idx-list">(.*?)</div></div></section>', lib, re.S)
    slugs = re.findall(r'class="plink" href="([^"]+)"', m.group(1))
    group_slugs[key] = [os.path.basename(x)[:-5] for x in slugs]

# ---------- 3) members.html 社员档案 ----------
# 按 <div class="branch-sec rv"> 标记切分 (避免非贪婪正则吞掉分部最后一张卡片)
mem = read("members.html")
chunks = re.split(r'<div class="branch-sec rv">', mem)[1:]
members = []
for chunk in chunks:
    chunk = chunk.split("</section>")[0]
    h3 = re.search(r'<h3>(.*?)<small>', chunk, re.S)
    branch = H.unescape(h3.group(1)).strip() if h3 else ""
    branch_members = []
    for card in re.findall(r'<div class="member"[^>]*id="([^"]+)"[^>]*>(.*?)</div>', chunk, re.S):
        mid, inner = card
        name = re.search(r'<span class="m-name">(.*?)</span>', inner, re.S)
        role = re.search(r'<span class="m-role">(.*?)</span>', inner, re.S)
        note = re.search(r'<p class="m-note">(.*?)</p>', inner, re.S)
        links = []
        for a in re.findall(r'<a class="plink" href="([^"]+)">(.*?)</a>', inner, re.S):
            links.append({"href": a[0], "label": H.unescape(a[1]).strip()})
        branch_members.append({
            "id": mid,
            "name": H.unescape(name.group(1)).strip(),
            "role": H.unescape(role.group(1)).strip(),
            "branch": branch,
            "note": H.unescape(note.group(1)).strip() if note else "",
            "links": links,
        })
    members.append({"branch": branch, "members": branch_members})

# ---------- 5) _fulltext.html 的题名/署名/体裁标签与展示顺序 ----------
# (qingming 7 篇原不在 fulltext 中, 重建后置于卷首; 其余按原 details 顺序)
ft = read("_fulltext.html")
ft_details = re.findall(r'<details class="lib-item" id="([^"]+)">(.*?)</details>', ft, re.S)
ft_order = []          # 已有 36 篇的显示顺序 (slug)
ft_label = {}          # slug -> {t,a,f} 原样标签
for did, inner in ft_details:
    spans = re.findall(r'<span class="(t|a|f)">(.*?)</span>', inner, re.S)
    lab = {k: H.unescape(v).strip() for k, v in spans}
    # id -> file (经 JSON 映射)
    entry = next((w for w in dw["works"] if w["id"] == did), None)
    if not entry:
        continue
    slug = os.path.basename(entry["file"])[:-5]
    ft_order.append(slug)
    ft_label[slug] = lab

# ---------- 6) index.html 卡片摘句 ----------
idx = read("index.html")
excerpts = {}
for item in re.findall(r'<article class="poem-item rv">(.*?)</article>', idx, re.S):
    a = re.search(r'href="([^"]+)"[^>]*>(.*?)</a>', item, re.S)
    q = re.search(r'<p class="pi-line">(.*?)</p>', item, re.S)
    if a and q:
        excerpts[os.path.basename(a.group(1))[:-5]] = H.unescape(q.group(1)).strip()

# ---------- 5) 逐篇抽取 -> works/<slug>.md ----------
pages = sorted(os.listdir(os.path.join(ROOT)))
count = 0
for fn in pages:
    if not (fn.startswith("w-") or fn.startswith("qingming-")) or not fn.endswith(".html"):
        continue
    p = parse_page(fn)
    ref = by_file.get(fn, {})
    group = "qingming" if p["slug"] in group_slugs["qingming"] else \
            ("huiyi" if p["slug"] in group_slugs["huiyi"] else "other")
    fm = {
        "title": p["title"],
        "file": fn,
        "author": p["meta"].get("author", ""),
        "ak": p["meta"].get("ak", ""),
        "branch": p["meta"].get("branch", ""),
        "genre": p["meta"].get("genre", ""),
        "group": group,
    }
    if p["meta"].get("source"): fm["source"] = p["meta"]["source"]
    if ref.get("tm"): fm["themes"] = ref["tm"]
    if ref.get("im"): fm["imageries"] = ref["im"]
    if p["slug"] in excerpts: fm["excerpt"] = excerpts[p["slug"]]
    if p["slug"] in ft_label:
        lab = ft_label[p["slug"]]
        if lab.get("t") and lab["t"] != p["title"]: fm["ft_title"] = lab["t"]
        if lab.get("a") and lab["a"] != p["meta"].get("author", ""): fm["ft_author"] = lab["a"]
        if lab.get("f") and lab["f"] != p["meta"].get("genre", ""): fm["ft_genre"] = lab["f"]
    if p["rel"]:
        # 去重: 原页面同篇目只出现一次; 此处原样保留顺序与类别
        fm["related"] = [{"to": r["to"], "cat": r["cat"],
                          "title": r["title"], "label": r["label"]} for r in p["rel"]]
    lines = ["---"]
    lines.append("layout: \"work.njk\"")
    lines.append(f'permalink: "{{{{ file }}}}"')
    lines.append("seoTitle: " + jstr(p["title"] + " | 婺需文学社"))
    lines.append("desc: " + jstr((p["meta"].get("author", "") or "") + "《" + p["title"] + "》全文与相关联作品。"))
    for k in ("title", "file", "author", "ak", "branch", "genre", "group", "source"):
        if fm.get(k) is not None: lines.append(f"{k}: {jstr(fm[k])}")
    if fm.get("themes"): lines.append("themes: " + yaml_list(fm["themes"]))
    if fm.get("imageries"): lines.append("imageries: " + yaml_list(fm["imageries"]))
    if fm.get("excerpt"): lines.append("excerpt: " + jstr(fm["excerpt"]))
    for k in ("ft_title", "ft_author", "ft_genre"):
        if fm.get(k) is not None: lines.append(f"{k}: " + jstr(fm[k]))
    if fm.get("related"):
        lines.append("related:")
        for r in fm["related"]:
            lines.append("  - to: " + jstr(r["to"]))
            lines.append("    cat: " + jstr(r["cat"]))
            lines.append("    title: " + jstr(r["title"]))
            lines.append("    label: " + jstr(r["label"]))
    lines.append("---")
    lines.append("")
    lines.append('<!-- 正文片段: 每段一个 <p>；改字请只动这里 -->')
    body = p["body"]
    # 每段一行, 便于 diff/编辑
    body = re.sub(r'</p>\s*<p ', '</p>\n<p ', body)
    lines.append(body)
    lines.append("")
    with open(os.path.join(SRC_WORKS, p["slug"] + ".md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    count += 1

groups_out = [{"key": k, "h2": h2, "slugs": group_slugs[k]} for k, h2 in groups_def]
with open(os.path.join(SRC_DATA, "groups.json"), "w", encoding="utf-8") as f:
    json.dump(groups_out, f, ensure_ascii=False, indent=2)
with open(os.path.join(SRC_DATA, "members.json"), "w", encoding="utf-8") as f:
    json.dump(members, f, ensure_ascii=False, indent=2)
qming_slugs = group_slugs["qingming"]
fulltext_order = qming_slugs + [s for s in ft_order if s not in qming_slugs]
with open(os.path.join(SRC_DATA, "fulltext_order.json"), "w", encoding="utf-8") as f:
    json.dump(fulltext_order, f, ensure_ascii=False, indent=2)

print(f"works 提取: {count} 篇")
print("groups:", {g['key']: len(g['slugs']) for g in groups_out}, "合计",
      sum(len(g['slugs']) for g in groups_out))
print("members:", [(m['branch'], len(m['members'])) for m in members])
print("fulltext 顺序: qingming", len(qming_slugs), "+ 原有", len(fulltext_order) - len(qming_slugs), "=", len(fulltext_order))
no_ft_label = [os.path.basename(fn)[:-5] for fn in sorted(os.listdir(SRC_WORKS))
               if os.path.basename(fn).startswith(("w-", "qingming-")) and
               os.path.basename(fn)[:-5] not in ft_label]
print("无原 fulltext 标签(将回退到页面元数据):", no_ft_label or "无")
missing = [s for g in groups_out for s in g["slugs"] if not os.path.exists(os.path.join(SRC_WORKS, s + ".md"))]
print("分组引用但不存在的文件:", missing or "无")
# 校验 rel 引用完整性
bad = []
for fn in sorted(os.listdir(SRC_WORKS)):
    txt = open(os.path.join(SRC_WORKS, fn), encoding="utf-8").read()
    for r in re.finditer(r'to: "([^"]+)"', txt):
        if not os.path.exists(os.path.join(SRC_WORKS, r.group(1) + ".md")):
            bad.append((fn, r.group(1)))
print("related 引用失效:", bad or "无")
