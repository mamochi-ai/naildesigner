#!/usr/bin/env python3
"""index.html と css/js を1ファイルにまとめ、プレビュー公開用の HTML を作る。

使い方: python3 tools/build_artifact.py  → dist/naildesigner.html
（静的ホスティングでは index.html をそのまま使えるので、このビルドは不要）
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def section(html, name):
    m = re.search(r"<!--BUILD:%s-START-->(.*?)<!--BUILD:%s-END-->" % (name, name), html, re.S)
    if not m:
        raise SystemExit("marker not found: " + name)
    return m.group(1)


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    head = section(html, "HEAD")
    head = re.sub(r'<link rel="stylesheet" href="([^"]+)">',
                  lambda m: "<style>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "\n</style>", head)
    body = section(html, "BODY")
    scripts = section(html, "SCRIPTS")
    scripts = re.sub(r'<script src="([^"]+)"></script>',
                     lambda m: "<script>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8").replace("</script", "<\\/script") + "\n</script>",
                     scripts)
    out = head.strip() + "\n" + body.strip() + "\n" + scripts.strip() + "\n"
    # assets/ の画像はプレビューでは別ファイルを読めないので、データURIとして埋め込む
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    def inline(m):
        f = ROOT / "assets" / m.group(2)
        data = base64.b64encode(f.read_bytes()).decode("ascii")
        return m.group(1) + "data:" + mime[f.suffix.lower()] + ";base64," + data + m.group(1)
    out = re.sub(r'(["\'])assets/([\w.-]+)\1', inline, out)
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "naildesigner.html").write_text(out, encoding="utf-8")
    print("wrote", dist / "naildesigner.html", len(out), "bytes")


if __name__ == "__main__":
    main()
