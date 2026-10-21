"""Sketchfab 搜索 / 下载 / 许可记录的公共层（只依赖标准库）。

token 只从环境变量 SKETCHFAB_TOKEN 或仓库根 `.env` 读；任何打印都不输出 token。
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.sketchfab.com/v3"
UA = "siliconworld-3a-models/1.0"
CACHE_DIR = Path(os.environ.get("SKETCHFAB_CACHE", "/tmp/sketchfab-cache"))

# 许可优先级：数值越小越优先；by-nc 只在前 8 名里优质候选不足时补入
LICENSE_RANK = {
    "cc0": 0,
    "by": 1,
    "by-sa": 2,
    "by-nd": 3,
    "by-nc": 4,
    "by-nc-sa": 5,
    "by-nc-nd": 6,
}
LICENSE_ALLOWED = {"cc0", "by", "by-sa"}
LICENSE_NC = {"by-nc", "by-nc-sa", "by-nc-nd"}


def _read_dotenv_token() -> str | None:
    """从仓库根 .env 找 SKETCHFAB_TOKEN（从本文件向上找 .env）。"""
    here = Path(__file__).resolve()
    for parent in here.parents:
        env = parent / ".env"
        if env.is_file():
            for line in env.read_text(errors="ignore").splitlines():
                line = line.strip()
                if line.startswith("SKETCHFAB_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def token() -> str:
    t = os.environ.get("SKETCHFAB_TOKEN") or _read_dotenv_token()
    if not t:
        raise SystemExit(
            "缺少 SKETCHFAB_TOKEN：写入仓库根 .env 的 `SKETCHFAB_TOKEN=...`，或导出环境变量"
        )
    return t


def _cache_path(url: str) -> Path:
    import hashlib

    h = hashlib.sha1(url.encode()).hexdigest()
    return CACHE_DIR / "api" / f"{h}.json"


def _get_json(url: str, headers: dict | None = None, retries: int = 5) -> dict:
    """GET JSON，带磁盘缓存与指数退避重试（Sketchfab 偶发 20s+ 慢响应）。"""
    cp = _cache_path(url)
    if cp.is_file():
        try:
            return json.loads(cp.read_text())
        except json.JSONDecodeError:
            cp.unlink()
    hdrs = {"User-Agent": UA}
    if headers:
        hdrs.update(headers)
    delay = 2.0
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read())
            cp.parent.mkdir(parents=True, exist_ok=True)
            cp.write_text(json.dumps(data))
            return data
        except urllib.error.HTTPError as e:
            # 4xx 不重试（429 除外）
            if e.code != 429 and 400 <= e.code < 500:
                raise
            last = e
        except Exception as e:  # noqa: BLE001 - 网络层各种超时统一重试
            last = e
        time.sleep(delay)
        delay = min(delay * 2, 30)
    raise RuntimeError(f"GET 失败 {url}: {last}")


def search(
    q: str,
    count: int = 24,
    license_slug: str | None = None,
    sort_by: str = "-likeCount",
) -> list[dict]:
    params = {
        "type": "models",
        "downloadable": "true",
        "q": q,
        "count": str(count),
        "sort_by": sort_by,
    }
    if license_slug:
        params["license"] = license_slug
    url = f"{API}/search?" + urllib.parse.urlencode(params)
    return _get_json(url).get("results", [])


def model_detail(uid: str) -> dict:
    """模型详情（含完整 license 对象）。搜索结果里的 license 只有 label。"""
    return _get_json(f"{API}/models/{uid}")


def download_url(uid: str) -> str:
    d = _get_json(
        f"{API}/models/{uid}/download",
        headers={"Authorization": f"Token {token()}"},
    )
    return d["glb"]["url"]


def thumbnail_url(model: dict, target_w: int = 720) -> str:
    imgs = (model.get("thumbnails") or {}).get("images") or []
    if not imgs:
        return ""
    # 取不小于目标宽度里最小的那张，没有就取最大
    wider = [i for i in imgs if i["width"] >= target_w]
    pick = min(wider, key=lambda i: i["width"]) if wider else max(imgs, key=lambda i: i["width"])
    return pick["url"]


def license_slug(model: dict) -> str:
    lic = model.get("license") or {}
    if lic.get("slug"):
        return lic["slug"]
    # 搜索结果只有 label：从 label 反推
    label = (lic.get("label") or "").lower()
    table = {
        "cc0 public domain": "cc0",
        "cc attribution": "by",
        "cc attribution-sharealike": "by-sa",
        "cc attribution-noderivs": "by-nd",
        "cc attribution-noncommercial": "by-nc",
        "cc attribution-noncommercial-sharealike": "by-nc-sa",
        "cc attribution-noncommercial-noderivs": "by-nc-nd",
    }
    return table.get(label, "unknown")


def download_model(uid: str, dest_dir: Path) -> Path:
    """下载 GLB 到 dest_dir/<uid>.glb，并写许可记录 dest_dir/<uid>.license.json。"""
    dest_dir.mkdir(parents=True, exist_ok=True)
    detail = model_detail(uid)
    out = dest_dir / f"{uid}.glb"
    if not out.is_file():
        url = download_url(uid)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=600) as resp, out.open("wb") as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)
    lic = detail.get("license") or {}
    record = {
        "uid": uid,
        "name": detail.get("name"),
        "author": (detail.get("user") or {}).get("username"),
        "author_url": (detail.get("user") or {}).get("profileUrl"),
        "license": lic.get("fullName"),
        "license_url": lic.get("url"),
        "license_requirements": lic.get("requirements"),
        "viewerUrl": detail.get("viewerUrl"),
        "faceCount": detail.get("faceCount"),
        "vertexCount": detail.get("vertexCount"),
        "animated": (detail.get("animationCount") or 0) > 0,
        "file": out.name,
        "file_bytes": out.stat().st_size,
    }
    (dest_dir / f"{uid}.license.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n"
    )
    return out
