#!/usr/bin/env python
# -*- coding: utf-8 -*-
# 编委账号工具(账号系统 P1): 开号 / 待确认社员 / 确认社员 / 改角色 / 看名单
# 为什么用 Python: 本机没有 Node, 而 D1 控制台只能跑 SQL(开号要算 PBKDF2 口令哈希, 那是服务端的事)。
# 用法(在仓库根目录跑):
#   python scripts/zhuzhu-admin.py open jwl --key 你的旧钥匙          # 按名册自动取昵称, 开编委号
#   python scripts/zhuzhu-admin.py open zhang3 --nick 张三 --role 读者 --key ...
#   python scripts/zhuzhu-admin.py pending --key ...
#   python scripts/zhuzhu-admin.py confirm 3 --key ...
#   python scripts/zhuzhu-admin.py role 3 编委 --key ...
# 说明: --key 是旧的共享钥匙(ZHUI_ADMIN_KEY); 账号化后它只用于"开第一个编委号"这类过渡操作。
#       中文一律用 Unicode 码位传入不保险(控制台编码), 故社员昵称直接从 src/_data/members.json 取。
import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request

BASE = "https://wuxu-society.pages.dev"
ROOT = pathlib.Path(__file__).resolve().parent.parent
ROLES = ["读者", "社员", "编委"]
ROLE_CP = {"读者": "\u8bfb\u8005", "社员": "\u793e\u5458", "编委": "\u7f16\u59d4"}

try:  # 让中文在 GBK 控制台也能正确输出
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def member_nick(handle):
    """从名册里按缩写取笔名: 'jwl' -> '蓦流'(名册写作 'jwl · 蓦流', 取 · 之后的部分)"""
    try:
        members = json.loads((ROOT / "src/_data/members.json").read_text(encoding="utf8"))
    except Exception:
        return None
    for sec in members:
        for m in sec.get("members", []):
            if m.get("id") == handle:
                name = (m.get("name") or handle).strip()
                return name.split("·")[-1].strip() if "·" in name else name
    return None


def call(path, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf8")
    req = urllib.request.Request(
        BASE + path, data=body, method="POST",
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                 "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"ok": False, "error": raw[:200]}


def main():
    ap = argparse.ArgumentParser(description="婺需文学社 · 编委账号工具")
    ap.add_argument("action", choices=["open", "pending", "confirm", "role", "wipe"])
    ap.add_argument("args", nargs="*", help="open: <缩写>; confirm: <user_id>; role: <user_id> <角色>")
    ap.add_argument("--key", default="", help="旧钥匙 ZHUI_ADMIN_KEY(过渡期用)")
    ap.add_argument("--nick", default="", help="非社员开号时指定昵称(ASCII 更稳)")
    ap.add_argument("--role", default="社员", help="open 时的角色: 读者|社员|编委")
    ap.add_argument("--dry-run", action="store_true", help="只打印将发送的内容, 不真的请求")
    a = ap.parse_args()

    payload = {"action": a.action, "key": a.key}
    if a.action == "wipe":
        # 危险操作: 确认字样写死在脚本里(避免命令行中文编码问题), 仍需 --key 且服务端会校验
        payload["confirm"] = "\u6e05\u7a7a\u6807\u7b7e\u7968\u4e0e\u8bc4\u8bba"   # 清空标签票与评论
        if not a.dry_run and not a.key:
            sys.exit("wipe 需要 --key（旧钥匙）；跑之前请确认已备份（sql/backup 里有快照）。")
    elif a.action == "open":
        if not a.args:
            sys.exit("open 需要给一个登录名(缩写), 例如: open jwl --key ...")
        handle = a.args[0]
        role = a.role if a.role in ROLES else "社员"
        payload.update({"handle": handle, "nick": a.nick or member_nick(handle) or handle, "role": role})
    elif a.action == "confirm":
        if not a.args:
            sys.exit("confirm 需要 user_id, 例如: confirm 3 --key ...")
        payload["user_id"] = int(a.args[0])
    elif a.action == "role":
        if len(a.args) < 2:
            sys.exit("role 需要 user_id 与角色, 例如: role 3 编委 --key ...")
        payload.update({"user_id": int(a.args[0]), "role": a.args[1] if a.args[1] in ROLES else "读者"})

    if a.dry_run:
        print("将发送:", json.dumps(payload, ensure_ascii=False))
        return

    status, out = call("/api/auth", payload)
    if status in (404, 405) or (not out.get("ok") and not out.get("error")):
        print(f"❌ 调用失败（HTTP {status}）。若错误信息为空，多半是账号代码尚未部署 —— "
              f"先 push 让 Cloudflare 部署 /api/auth，再跑本命令。")
        return
    print(json.dumps(out, ensure_ascii=False, indent=2))
    if out.get("ok") and a.action == "open":
        print("\n请把下面两串转告本人（口令用于首次登录，恢复码让其自己保存）：")
        print("  一次性口令：", out.get("tempPass"))
        print("  恢复码：", out.get("recoverCode"))


if __name__ == "__main__":
    main()
