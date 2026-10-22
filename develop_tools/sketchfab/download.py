"""download：按 selection.json 批量下载 GLB 到 raw/，并写许可记录。

用法：
    python3 develop_tools/sketchfab/download.py                # 下载全部首选 + 备选
    python3 develop_tools/sketchfab/download.py --primary-only # 只下首选
    python3 develop_tools/sketchfab/download.py --slot executor --slot mecha

token：环境变量 SKETCHFAB_TOKEN 或仓库根 `.env`（不入库、不打印）。
输出：`develop_tools/sketchfab/raw/<槽位>[-备选]/<uid>.glb` + `<uid>.license.json`（目录 gitignore）。
许可不在 CC0 / CC-BY / CC-BY-SA 的模型直接拒绝（本阶段没有 NC 候选）。
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sf  # noqa: E402

HERE = Path(__file__).resolve().parent
SELECTION = HERE / "selection.json"
RAW = HERE / "raw"
ALLOWED = {"cc0", "by", "by-sa"}


def one(slot: str, role: str, entry: dict) -> tuple[str, str]:
    tag = slot if role == "primary" else f"{slot}-{role}"
    dest = RAW / tag
    detail = sf.model_detail(entry["uid"])
    slug = sf.license_slug(detail)
    if slug not in ALLOWED:
        return tag, f"跳过：许可 {slug} 不可用"
    glb = dest / f"{entry['uid']}.glb"
    license_file = dest / f"{entry['uid']}.license.json"
    # 上次中断留下的半截文件：没有 license 记录就删掉重下。
    if glb.is_file() and not license_file.is_file():
        glb.unlink()
    out = sf.download_model(entry["uid"], dest)
    rec = json.loads(license_file.read_text())
    return tag, f"✓ {rec['name']} {rec['file_bytes'] / 1e6:.2f} MB {rec['license']}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slot", action="append", default=[])
    ap.add_argument("--primary-only", action="store_true")
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()

    selection = json.loads(SELECTION.read_text())
    jobs = []
    for slot, roles in selection.items():
        if args.slot and slot not in args.slot:
            continue
        for role, entry in roles.items():
            if args.primary_only and role != "primary":
                continue
            jobs.append((slot, role, entry))

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(one, slot, role, entry): (slot, role) for slot, role, entry in jobs}
        for future in as_completed(futures):
            slot, role = futures[future]
            try:
                tag, message = future.result()
            except Exception as exc:  # noqa: BLE001 - 单个失败不拖垮整批
                print(f"  ✗ {slot}/{role}: {exc}", file=sys.stderr)
                continue
            print(f"  {tag}: {message}")


if __name__ == "__main__":
    main()
