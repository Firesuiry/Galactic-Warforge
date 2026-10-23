"""search：关键词 → 候选 JSON（带磁盘缓存，可重复跑）。

用法：
    python3 develop_tools/sketchfab/search.py --out tmp/3a-models/raw.json
    python3 develop_tools/sketchfab/search.py --q "sci-fi mech" --count 24

默认跑 slots.py 里全部槽位的关键词 + 套装关键词。结果按关键词去重合并后
写入 `{槽位: [候选...]}`，候选里保留原始字段（thumbnails / license / user / faceCount ...）。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sf  # noqa: E402
import slots as S  # noqa: E402

PER_QUERY_COUNT = 24
WORKERS = 24


def _one(q: str, license_slug: str | None = None, count: int = PER_QUERY_COUNT) -> tuple[str, list[dict]]:
    for attempt in range(3):
        try:
            return q, sf.search(q, count=count, license_slug=license_slug)
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f"  ! 查询失败 {q!r}: {e}", file=sys.stderr)
                return q, []
            time.sleep(3 * (attempt + 1))
    return q, []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="候选 JSON 输出路径")
    ap.add_argument("--q", action="append", help="只搜这些关键词（可多次）；缺省跑全部槽位")
    ap.add_argument("--count", type=int, default=PER_QUERY_COUNT)
    args = ap.parse_args()
    count = args.count

    if args.q:
        queries = list(dict.fromkeys(args.q))
        tasks = [(q, None) for q in queries]
        out_map: dict[str, list[dict]] = {}
        with ThreadPoolExecutor(WORKERS) as ex:
            futs = {ex.submit(_one, q, lic, count): (q, lic) for q, lic in tasks}
            for fut in as_completed(futs):
                q, res = fut.result()
                out_map[q] = res
                print(f"  {q!r}: {len(res)}")
    else:
        # 槽位关键词 + 套装关键词，一次并发跑完（同关键词只跑一次）
        all_q: list[str] = []
        for _, _, _, kws in S.SLOTS:
            all_q.extend(kws)
        for _, _, kws in S.PACK_GROUPS:
            all_q.extend(kws)
        all_q = list(dict.fromkeys(all_q))
        print(f"共 {len(all_q)} 个关键词，并发 {WORKERS}…")
        by_q: dict[str, list[dict]] = {}
        t0 = time.time()
        with ThreadPoolExecutor(WORKERS) as ex:
            futs = {ex.submit(_one, q, None, count): q for q in all_q}
            done = 0
            for fut in as_completed(futs):
                q, res = fut.result()
                by_q[q] = res
                done += 1
                print(f"  [{done}/{len(all_q)}] {q!r}: {len(res)}  ({time.time() - t0:.0f}s)")

        out_map = {}
        for _, slot, _, kws in S.SLOTS:
            merged: dict[str, dict] = {}
            for kw in kws:
                for m in by_q.get(kw, []):
                    m.setdefault("_queries", [])
                    m["_queries"].append(kw)
                    merged.setdefault(m["uid"], m)
            out_map[slot] = list(merged.values())
        for key, _, kws in S.PACK_GROUPS:
            merged = {}
            for kw in kws:
                for m in by_q.get(kw, []):
                    m.setdefault("_queries", [])
                    m["_queries"].append(kw)
                    merged.setdefault(m["uid"], m)
            out_map[f"packs/{key}"] = list(merged.values())

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(out_map, ensure_ascii=False))
    total = sum(len(v) for v in out_map.values())
    print(f"写出 {out}：{len(out_map)} 组 / {total} 条候选（去重前）")


if __name__ == "__main__":
    main()
