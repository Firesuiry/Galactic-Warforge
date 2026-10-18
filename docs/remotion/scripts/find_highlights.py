#!/usr/bin/env python3
"""从 battle.json 提取解说高光时刻。

输出按 tick 排序的高光列表：首次交火、击杀集群、基地 HP 阈值跨越、兵力反转、胜负。
供解说词撰写参考（直接打印到 stdout）。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("battle", type=argparse.FileType("r"), help="battle.json")
    args = ap.parse_args()
    d = json.load(args.battle)

    players = [p["player_id"] for p in d["meta"]["players"]]
    series = d["series"]
    events = d["events"]
    victory = d.get("victory")

    highlights: list[tuple[int, str]] = []

    # 1) 首次基地受击 / 首次击杀
    first_destroy = next((e for e in events if e["type"] == "entity_destroyed"), None)
    if first_destroy:
        highlights.append((first_destroy["tick"], f"首杀：{first_destroy['text']}"))

    # 2) 击杀集群（200 tick 窗口内 >=3 击杀）
    kills = [e for e in events if e["type"] == "entity_destroyed"]
    window = 200
    i = 0
    while i < len(kills):
        j = i
        while j < len(kills) and kills[j]["tick"] - kills[i]["tick"] <= window:
            j += 1
        if j - i >= 3:
            highlights.append(
                (kills[i]["tick"], f"激战：{window} tick 内 {j - i} 个单位被摧毁")
            )
            i = j
        else:
            i += 1

    # 3) 基地 HP 阈值跨越（每个玩家 500/300/100/0）
    thresholds = [500, 300, 100, 0]
    for pid in players:
        key = f"{pid}_base_hp"
        prev = 700
        for th in thresholds:
            for row in series:
                hp = row.get(key, 700)
                if prev > th >= hp:
                    highlights.append((row["tick"], f"{pid} 基地 HP 跌破 {th}（={hp}）"))
                    prev = hp
                    break
            else:
                break

    # 4) 兵力反转：领先方易手的时刻
    if players and len(players) == 2:
        a, b = players
        leader = None
        for row in series:
            diff = row.get(f"{a}_army", 0) - row.get(f"{b}_army", 0)
            cur = a if diff > 2 else (b if diff < -2 else None)
            if cur and leader and cur != leader:
                highlights.append(
                    (row["tick"], f"兵力反转：{cur} 反超（{row.get(f'{a}_army')} vs {row.get(f'{b}_army')}）")
                )
            if cur:
                leader = cur

    # 5) 胜负
    if victory:
        highlights.append((victory["tick"], f"胜者：{victory.get('winner_id')}（{victory.get('reason')}）"))

    highlights.sort()
    for tick, text in highlights:
        print(f"t{tick:>7}  ({tick / 10 / 60:5.1f}min)  {text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
