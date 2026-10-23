"""fetch：uid → 下载 GLB 到指定目录，并写许可记录（THIRD_PARTY 片段）。

用法：
    python3 develop_tools/sketchfab/fetch.py --uid <uid> [--uid ...] --dest client-web/public/assets/models/sketchfab
    python3 develop_tools/sketchfab/fetch.py --from-candidates tmp/3a-models/candidates.json --slot executor --idx 1 --dest ...

token：环境变量 SKETCHFAB_TOKEN 或仓库根 `.env`（不入库，不打印）。
下载前会再查一次模型详情，许可不在 CC0 / CC-BY / CC-BY-SA / CC-BY-NC* 内直接拒绝；
--allow-nc 才允许非商用许可（图/报告里必须标注 NC）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sf  # noqa: E402

THIRD_PARTY_HEADER = """# Sketchfab 模型来源与许可

本目录模型均来自 Sketchfab，逐个文件附 `<uid>.license.json`。仓库公开 + 视频投稿，
只接受 CC0 / CC-BY / CC-BY-SA；CC-BY* 必须在此署名。
"""


def _record_line(rec: dict) -> str:
    return (
        f"- `{rec['file']}` — **{rec['name']}** by [{rec['author']}]({rec['author_url']})，"
        f"{rec['license']}（{rec['license_url']}），来源 {rec['viewerUrl']}"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", action="append", default=[])
    ap.add_argument("--from-candidates", help="candidates.json 路径")
    ap.add_argument("--slot", help="配合 --from-candidates：只取该槽位")
    ap.add_argument("--idx", type=int, action="append", help="配合 --from-candidates：只取这些编号")
    ap.add_argument("--dest", required=True, help="GLB 输出目录")
    ap.add_argument("--allow-nc", action="store_true", help="允许 CC-BY-NC*（必须标注）")
    args = ap.parse_args()

    uids = list(args.uid)
    if args.from_candidates:
        cand = json.loads(Path(args.from_candidates).read_text())
        slots = [args.slot] if args.slot else list(cand)
        for slot in slots:
            for e in cand.get(slot, []):
                if args.idx and e["idx"] not in args.idx:
                    continue
                uids.append(e["uid"])
    uids = list(dict.fromkeys(uids))
    if not uids:
        raise SystemExit("没有要下载的 uid")

    dest = Path(args.dest)
    records = []
    for uid in uids:
        detail = sf.model_detail(uid)
        slug = sf.license_slug(detail)
        if slug not in {"cc0", "by", "by-sa"} and not (args.allow_nc and slug.startswith("by-nc")):
            print(f"  跳过 {uid} {detail.get('name')!r}：许可 {slug} 不可用", file=sys.stderr)
            continue
        out = sf.download_model(uid, dest)
        rec = json.loads((dest / f"{uid}.license.json").read_text())
        records.append(rec)
        print(f"  ✓ {rec['name']} → {out} ({rec['file_bytes'] / 1e6:.2f} MB, {rec['license']})")

    if records:
        tp = dest / "THIRD_PARTY.md"
        lines = [THIRD_PARTY_HEADER]
        if tp.is_file():
            lines = [tp.read_text().rstrip() + "\n"]
        lines.append("\n## 本次下载\n")
        lines.extend(_record_line(r) + "\n" for r in records)
        tp.write_text("".join(lines))
        print(f"写出 {tp}")


if __name__ == "__main__":
    main()
