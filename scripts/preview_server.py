# -*- coding: utf-8 -*-
# 本地预览服务器(含众注假 API): python scripts/preview_server.py -> http://127.0.0.1:8125
# 静态服务 dist/; /api/tags 与 /api/comments 用内存假数据应答(与线上 CF 契约一致),
# 便于无后端时预览"作品页众注区"; 生产请用真实 CF Functions + D1。
import http.server, json, os, pathlib, time
from urllib.parse import urlparse, parse_qs

ROOT = pathlib.Path(__file__).resolve().parent.parent / "dist"
PORT = int(os.environ.get("PORT", "8125"))

POOL = ["思念", "明月", "重逢", "春景", "怅惘", "用典", "夜", "秋", "雨", "白描", "叠字", "旷达", "怀古", "离别", "归乡"]
SEED_TAGS = [
    {"id": 1, "word": "思念", "kind": "预设", "count": 6, "voted": True},
    {"id": 2, "word": "明月", "kind": "预设", "count": 5, "voted": False},
    {"id": 3, "word": "重逢", "kind": "预设", "count": 3, "voted": False},
    {"id": 4, "word": "春景", "kind": "预设", "count": 2, "voted": False},
    {"id": 5, "word": "怅惘", "kind": "预设", "count": 2, "voted": False},
    {"id": 6, "word": "用典", "kind": "预设", "count": 1, "voted": False},
]
SEED_FLOORS = [
    {"id": 1, "name": "泊珩", "body": "“明月”与“彩云”并置，一出一归，情致都在没说出的那句里。", "reply_to": None, "created_at": "2026-09-09 10:21", "likes": 3, "liked": True},
    {"id": 2, "name": "jwl", "body": "> 好句。\n读此句想起“犹恐相逢是梦中”，淡淡怅惘便有了着落。", "reply_to": None, "created_at": "2026-09-09 10:47", "likes": 1, "liked": False},
]

mem_tags = {}
mem_floors = {}
next_tag = [100]
next_floor = [10]

def tags_of(work):
    return mem_tags.setdefault(work, [dict(t) for t in SEED_TAGS])

def floors_of(work):
    return mem_floors.setdefault(work, [dict(f) for f in SEED_FLOORS])

MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".xml": "application/xml",
    ".txt": "text/plain; charset=utf-8", ".json": "application/json",
    ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2",
}

def now_str():
    return time.strftime("%Y-%m-%d %H:%M")

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/tags":
            work = (q.get("work") or [""])[0]
            return self.send_json(400, {"ok": False, "error": "缺少作品标识。"}) if not work \
                else self.send_json(200, {"ok": True, "tags": tags_of(work), "pool": POOL})
        if u.path == "/api/comments":
            work = (q.get("work") or [""])[0]
            return self.send_json(400, {"ok": False, "error": "缺少作品标识。"}) if not work \
                else self.send_json(200, {"ok": True, "floors": floors_of(work)})
        self.serve_static(u.path)

    def do_POST(self):
        try:
            self._post()
        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                self.send_json(500, {"ok": False, "error": "预览服务异常: %s" % e})
            except Exception:
                pass

    def _post(self):
        u = urlparse(self.path)
        b = self.body_json()
        if u.path == "/api/tags":
            work, word = b.get("work", ""), str(b.get("word", "")).strip()[:12]
            if not work or not word:
                return self.send_json(400, {"ok": False, "error": "缺少作品标识或标签词。"})
            tags = tags_of(work)
            hit = next((t for t in tags if t["word"] == word), None)
            if hit:
                hit["voted"] = not hit["voted"]
                hit["count"] += 1 if hit["voted"] else -1
                return self.send_json(200, {"ok": True, "word": word, "id": hit["id"], "candidate": False, "voted": hit["voted"], "count": hit["count"]})
            nid = next_tag[0]; next_tag[0] += 1
            tags.append({"id": nid, "word": word, "kind": "候选", "count": 1, "voted": True})
            return self.send_json(200, {"ok": True, "word": word, "id": nid, "candidate": True, "voted": True, "count": 1})
        if u.path == "/api/comments":
            if b.get("like_comment_id") is not None:
                cid = int(b["like_comment_id"])
                for floors in mem_floors.values():
                    for f in floors:
                        if f["id"] == cid:
                            f["liked"] = not f["liked"]
                            f["likes"] += 1 if f["liked"] else -1
                            return self.send_json(200, {"ok": True, "comment_id": cid, "liked": f["liked"], "likes": f["likes"]})
                return self.send_json(200, {"ok": True, "comment_id": cid, "liked": False, "likes": 0})
            work, name = b.get("work", ""), str(b.get("name", "")).strip()[:20]
            text = str(b.get("body", "")).strip()[:500]
            if not work or not name or not text:
                return self.send_json(400, {"ok": False, "error": "参数不完整。"})
            nid = next_floor[0]; next_floor[0] += 1
            floors_of(work).append({"id": nid, "name": name, "body": text,
                                    "reply_to": int(b["reply_to"]) if b.get("reply_to") else None,
                                    "created_at": now_str(), "likes": 0, "liked": False})
            return self.send_json(200, {"ok": True, "id": nid})
        self.send_json(404, {"ok": False, "error": "未找到。"})

    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        p = (ROOT / path.lstrip("/")).resolve()
        if not str(p).startswith(str(ROOT.resolve())) or not p.is_file():
            fallback = ROOT / "404.html"
            body = fallback.read_bytes() if fallback.is_file() else b"404"
            self.send_response(404)
            self.send_header("Content-Type", MIME.get(fallback.suffix.lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        body = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(p.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    print("本地预览(含众注假API): http://127.0.0.1:%d" % PORT)
    print("  先 npm run build 保证 dist 最新; 众注区在作品页底部, 由假 API 点亮")
    http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
