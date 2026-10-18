#!/usr/bin/env python3
"""从服务端战况录制 JSONL 提取解说视频所需的时间轴数据。

输出 public/battle.json：
- meta：玩家、地图、视口、采样间隔
- frames：每次状态采样的单位/建筑快照（位置 + HP）
- events：解说/字幕用的事件流（击杀、基地受击、胜负等，已过滤 PvE 噪音）
- victory：胜负结果
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 解说视频关心的单位/建筑类型映射（中文名）
UNIT_NAMES = {
    "soldier": "士兵",
    "mecha": "机甲",
    "executor": "执行体",
    "worker": "工程机",
}
BASE_TYPE = "battlefield_analysis_base"

# 事件过滤器：这些事件类型才进字幕/高光流
KEEP_EVENTS = {"entity_destroyed", "victory_declared", "damage_applied"}


def load_rows(path: Path):
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def is_pvp_damage(payload: dict) -> bool:
    """damage_applied 里排除黑雾/环境伤害，只留玩家攻击造成的。"""
    if payload.get("source") == "enemy_force":
        return False
    # 玩家攻击事件带 attacker_id；护盾/环境伤害没有
    return "attacker_id" in payload or "target_id" in payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("record", type=Path, help="battle.jsonl 路径")
    ap.add_argument("-o", "--out", type=Path, required=True, help="输出 battle.json 路径")
    ap.add_argument("--planet", default=None, help="只取该行星（默认取 meta.active_planet_id）")
    args = ap.parse_args()

    meta = None
    frames = []
    events = []
    victory = None

    for row in load_rows(args.record):
        kind = row.get("kind")
        if kind == "meta":
            meta = row
        elif kind == "state":
            frames.append(row)
        elif kind == "event":
            et = row.get("event_type")
            if et not in KEEP_EVENTS:
                continue
            payload = row.get("payload") or {}
            if et == "damage_applied" and not is_pvp_damage(payload):
                continue
            events.append(
                {
                    "tick": row["tick"],
                    "type": et,
                    "payload": payload,
                }
            )
        elif kind == "victory":
            victory = {"tick": row["tick"], **(row.get("payload") or {})}

    if meta is None:
        print("error: 录制文件缺少 meta 行", file=sys.stderr)
        return 1
    if not frames:
        print("error: 录制文件没有 state 采样", file=sys.stderr)
        return 1

    planet_id = args.planet or meta.get("active_planet_id")
    players = meta.get("players") or []
    player_ids = [p["player_id"] for p in players]

    # ── 提取该行星帧序列，并计算视口 ─────────────────────────
    out_frames = []
    min_x, min_y = 10**9, 10**9
    max_x, max_y = -10**9, -10**9
    for fr in frames:
        planets = fr.get("planets") or {}
        ps = planets.get(planet_id)
        if ps is None:
            continue
        units = ps.get("units") or []
        buildings = ps.get("buildings") or []
        for e in units + buildings:
            min_x = min(min_x, e["x"])
            min_y = min(min_y, e["y"])
            max_x = max(max_x, e["x"])
            max_y = max(max_y, e["y"])
        out_frames.append(
            {
                "tick": fr["tick"],
                "units": units,
                "buildings": buildings,
            }
        )

    if not out_frames:
        print(f"error: 行星 {planet_id} 没有任何状态采样", file=sys.stderr)
        return 1

    # 视口：实体包围盒 + 边距，方幅画布
    pad = 4
    vx0 = max(0, min_x - pad)
    vy0 = max(0, min_y - pad)
    vx1 = max_x + pad
    vy1 = max_y + pad
    side = max(vx1 - vx0, vy1 - vy0)
    viewport = {"x": vx0, "y": vy0, "w": side, "h": side}

    # ── 聚合兵力/基地血量曲线 ────────────────────────────────
    series = []
    for fr in out_frames:
        tick = fr["tick"]
        row = {"tick": tick}
        for pid in player_ids:
            units = [u for u in fr["units"] if u["o"] == pid]
            combat = [u for u in units if u["t"] in ("soldier", "mecha")]
            row[f"{pid}_army"] = len(combat)
            row[f"{pid}_army_hp"] = sum(u["hp"] for u in combat)
            bases = [b for b in fr["buildings"] if b["o"] == pid and b["t"] == BASE_TYPE]
            row[f"{pid}_base_hp"] = bases[0]["hp"] if bases else 0
            row[f"{pid}_buildings"] = len([b for b in fr["buildings"] if b["o"] == pid])
        series.append(row)

    # ── 事件→中文字幕文本 ────────────────────────────────────
    unit_name_by_id: dict[str, str] = {}
    building_name_by_id: dict[str, str] = {}
    # 建立实体→名字映射（用最后一帧 + 事件里的 owner 信息尽力还原）
    for fr in out_frames:
        for u in fr["units"]:
            unit_name_by_id[u["id"]] = UNIT_NAMES.get(u["t"], u["t"])
        for b in fr["buildings"]:
            zh = "基地" if b["t"] == BASE_TYPE else b["t"]
            building_name_by_id[b["id"]] = f"{zh}"

    def entity_name(eid: str) -> str:
        if eid in unit_name_by_id:
            return unit_name_by_id[eid]
        if eid in building_name_by_id:
            return building_name_by_id[eid]
        return eid

    ticker_events = []
    for ev in events:
        tick = ev["tick"]
        p = ev["payload"]
        et = ev["type"]
        text = None
        if et == "entity_destroyed":
            etype = p.get("entity_type", "unit")
            owner = p.get("owner_id", "?")
            name = entity_name(str(p.get("entity_id", "")))
            text = f"[{owner}] {name} 被摧毁"
        elif et == "damage_applied":
            tgt = str(p.get("target_id", ""))
            # 只给基地受击上字幕，普通战斗太密
            if tgt in building_name_by_id and building_name_by_id[tgt] == "基地":
                hp = p.get("target_hp")
                text = f"基地遭袭！剩余 HP {hp}"
        elif et == "victory_declared":
            text = f"比赛结束！胜者 {p.get('winner_id')}"
        if text:
            ticker_events.append({"tick": tick, "type": et, "text": text})

    out = {
        "meta": {
            "players": players,
            "planet_id": planet_id,
            "map": (meta.get("planets") or [{}])[0],
            "viewport": viewport,
            "sample_interval": meta.get("sample_interval", 10),
        },
        "frames": out_frames,
        "series": series,
        "events": ticker_events,
        "victory": victory,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False))
    print(
        f"frames={len(out_frames)} series={len(series)} ticker_events={len(ticker_events)} "
        f"victory={victory} viewport={viewport}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
