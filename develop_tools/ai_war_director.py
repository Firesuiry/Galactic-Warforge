"""
AI War Director - orchestrates a full battle between p1 and p2 on planet-1-1.

Strategy:
  - p1 (aggressive): mass-produce soldiers, then push straight to p2's main base.
  - p2 (defensive counter-puncher): build a defensive clump, then once >=8 soldiers
    are accumulated, counter-attack p1's main base.

The script polls /state/summary until winner is non-empty. All commands go through
the real server API.
"""

import json
import time
import uuid
import urllib.request
import urllib.error
from pathlib import Path

SERVER = "http://127.0.0.1:19481"
PLANET = "planet-1-1"
P1_KEY = "key_player_1"
P2_KEY = "key_player_2"

LOG_PATH = Path("C:/develop/Galactic-Warforge/.run/ai-war/battle_log.jsonl")
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

# --- Configuration ---------------------------------------------------------
P1_PRODUCER = "b-109"   # assembling_machine_mk1 at (5,4)
P2_PRODUCER = "b-112"   # assembling_machine_mk1 at (42,43)
P1_MAIN_BASE = "b-1"    # battlefield_analysis_base @ (3,2)
P2_MAIN_BASE = "b-3"    # battlefield_analysis_base @ (44,44)
P1_MAIN_POS = (3, 2)
P2_MAIN_POS = (44, 44)

# Rally points just outside enemy base so soldiers can siege
P1_ATTACK_STAGING = (40, 40)   # p1 stages here before hitting b-3 at (44,44)
P2_ATTACK_STAGING = (7, 6)     # p2 stages here before hitting b-1 at (3,2)

P2_COUNTER_THRESHOLD = 8  # p2 launches counter-attack once it has this many soldiers

TICKS_PER_ROUND = 25        # wait this many ticks between rounds
MAX_WALL_SECONDS = 60 * 60  # 60-minute timeout
# ---------------------------------------------------------------------------


def http(method: str, path: str, key: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        SERVER + path,
        method=method,
        data=(json.dumps(body).encode("utf-8") if body is not None else None),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode("utf-8", "replace")}


def get_tick() -> int:
    return int(http("GET", "/health", P1_KEY)["tick"])


def get_summary(key: str) -> dict:
    return http("GET", "/state/summary", key)


def get_scene(key: str) -> dict:
    return http("GET", f"/world/planets/{PLANET}/scene", key)


def submit_commands(player: str, key: str, commands: list[dict]) -> dict:
    body = {
        "request_id": str(uuid.uuid4()),
        "issuer_type": "player",
        "issuer_id": player,
        "commands": commands,
    }
    return http("POST", "/commands", key, body)


def log(entry: dict) -> None:
    entry.setdefault("tick", get_tick())
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def manhattan(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def step_toward(src: tuple[int, int], dst: tuple[int, int], move_range: int) -> tuple[int, int]:
    """One greedy step toward dst, capped at move_range manhattan distance."""
    x, y = src
    tx, ty = dst
    budget = move_range
    # move x first then y
    while budget > 0 and x != tx:
        x += 1 if tx > x else -1
        budget -= 1
    while budget > 0 and y != ty:
        y += 1 if ty > y else -1
        budget -= 1
    return (x, y)


# --- Player strategies -----------------------------------------------------

def p1_strategy(scene: dict, tick: int) -> list[dict]:
    """Aggressive: produce soldiers continuously; move all soldiers toward p2 base; attack if in range."""
    cmds: list[dict] = []
    my_soldiers = [u for u in scene["units"].values() if u["owner_id"] == "p1" and u["type"] == "soldier"]

    # produce up to 2 soldiers per round (executor concurrent_tasks = 2)
    produce_attempts = 2
    for _ in range(produce_attempts):
        cmds.append({
            "type": "produce",
            "target": {"entity_id": P1_PRODUCER},
            "payload": {"unit_type": "soldier"},
        })

    for s in my_soldiers:
        sid = s["id"]
        spos = (s["position"]["x"], s["position"]["y"])
        # find nearest p2 building in visible scene
        targets = [b for b in scene["buildings"].values() if b["owner_id"] == "p2"]
        # prefer main base
        main = next((b for b in targets if b["id"] == P2_MAIN_BASE), None)
        target_pos = P2_MAIN_POS if main is None else (main["position"]["x"], main["position"]["y"])

        # if in attack range of main base, attack
        if manhattan(spos, target_pos) <= s.get("attack_range", 2):
            cmds.append({
                "type": "attack",
                "target": {"entity_id": sid},
                "payload": {"target_entity_id": P2_MAIN_BASE},
            })
        else:
            nxt = step_toward(spos, target_pos, s.get("move_range", 2))
            if nxt != spos:
                cmds.append({
                    "type": "move",
                    "target": {"entity_id": sid, "position": {"x": nxt[0], "y": nxt[1]}},
                    "payload": {},
                })
    return cmds


def p2_strategy(scene: dict, tick: int) -> list[dict]:
    """Defensive counter-puncher: mass soldiers, hold until >=8, then push p1's main base."""
    cmds: list[dict] = []
    my_soldiers = [u for u in scene["units"].values() if u["owner_id"] == "p2" and u["type"] == "soldier"]

    # produce up to 2 soldiers per round
    produce_attempts = 2
    for _ in range(produce_attempts):
        cmds.append({
            "type": "produce",
            "target": {"entity_id": P2_PRODUCER},
            "payload": {"unit_type": "soldier"},
        })

    launch_counter = len(my_soldiers) >= P2_COUNTER_THRESHOLD
    for s in my_soldiers:
        sid = s["id"]
        spos = (s["position"]["x"], s["position"]["y"])
        if launch_counter:
            target_pos = P1_MAIN_POS
            target_id = P1_MAIN_BASE
        else:
            # hold position near base (slight spread so they don't block spawn)
            target_pos = (42, 42)
            target_id = None

        if target_id and manhattan(spos, target_pos) <= s.get("attack_range", 2):
            cmds.append({
                "type": "attack",
                "target": {"entity_id": sid},
                "payload": {"target_entity_id": target_id},
            })
        else:
            nxt = step_toward(spos, target_pos, s.get("move_range", 2))
            if nxt != spos:
                cmds.append({
                    "type": "move",
                    "target": {"entity_id": sid, "position": {"x": nxt[0], "y": nxt[1]}},
                    "payload": {},
                })
    return cmds


# --- Orchestrator -----------------------------------------------------------

def force_timeout_finish() -> None:
    """If we hit the wall-clock timeout, force the lower-HP main base to lose."""
    s1 = get_summary(P1_KEY)
    # we can't see enemy buildings from p1; use last known HP from scenes
    sc1 = get_scene(P1_KEY)
    sc2 = get_scene(P2_KEY)
    p1_base_hp = next((b["hp"] for b in sc2["buildings"].values() if b["id"] == P1_MAIN_BASE), None)
    p2_base_hp = next((b["hp"] for b in sc1["buildings"].values() if b["id"] == P2_MAIN_BASE), None)
    log({"actor": "system", "event": "timeout_forced", "p1_base_hp": p1_base_hp, "p2_base_hp": p2_base_hp})

    # Decide loser: whoever's base HP is lower; if we can't see one side, default to p1 losing
    if p1_base_hp is None and p2_base_hp is None:
        loser = "p1"
    elif p1_base_hp is None:
        loser = "p1"
    elif p2_base_hp is None:
        loser = "p2"
    else:
        loser = "p1" if p1_base_hp < p2_base_hp else "p2"

    log({"actor": "system", "event": "timeout_forced_loser", "loser": loser})
    # All of the winner's soldiers attack the loser's base every round until it dies.
    if loser == "p1":
        winner_key, winner_id = P2_KEY, "p2"
        target_base, target_pos = P1_MAIN_BASE, P1_MAIN_POS
    else:
        winner_key, winner_id = P1_KEY, "p1"
        target_base, target_pos = P2_MAIN_BASE, P2_MAIN_POS

    deadline = time.time() + 600  # extra 10 min for forced finish
    while time.time() < deadline:
        s = get_summary(winner_key)
        if s.get("winner"):
            return
        sc = get_scene(winner_key)
        cmds: list[dict] = []
        for u in sc["units"].values():
            if u["owner_id"] != winner_id or u["type"] != "soldier":
                continue
            spos = (u["position"]["x"], u["position"]["y"])
            if manhattan(spos, target_pos) <= u.get("attack_range", 2):
                cmds.append({"type": "attack", "target": {"entity_id": u["id"]}, "payload": {"target_entity_id": target_base}})
            else:
                nxt = step_toward(spos, target_pos, u.get("move_range", 2))
                cmds.append({"type": "move", "target": {"entity_id": u["id"], "position": {"x": nxt[0], "y": nxt[1]}}, "payload": {}})
        if cmds:
            submit_commands(winner_id, winner_key, cmds)
        time.sleep(2.5)


def main() -> None:
    LOG_PATH.write_text("", encoding="utf-8")  # truncate log
    start_tick = get_tick()
    start_time = time.time()
    log({"actor": "system", "event": "war_start", "start_tick": start_tick})

    last_tick = start_tick
    round_idx = 0

    while True:
        # victory check
        summary = get_summary(P1_KEY)
        if summary.get("winner"):
            log({
                "actor": "system",
                "event": "victory",
                "winner": summary["winner"],
                "reason": summary.get("victory_reason"),
                "end_tick": summary["tick"],
                "total_ticks": summary["tick"] - start_tick,
            })
            print(f"VICTORY: {summary['winner']} ({summary.get('victory_reason')}) at tick {summary['tick']}")
            return

        # timeout check
        if time.time() - start_time > MAX_WALL_SECONDS:
            log({"actor": "system", "event": "timeout", "wall_seconds": MAX_WALL_SECONDS})
            force_timeout_finish()
            summary = get_summary(P1_KEY)
            log({
                "actor": "system",
                "event": "victory",
                "winner": summary.get("winner"),
                "reason": summary.get("victory_reason") or "timeout_forced",
                "end_tick": summary["tick"],
                "total_ticks": summary["tick"] - start_tick,
            })
            print(f"TIMEOUT FORCED: winner={summary.get('winner')}")
            return

        # wait until server advances TICKS_PER_ROUND ticks
        now_tick = get_tick()
        if now_tick - last_tick < TICKS_PER_ROUND:
            time.sleep(0.5)
            continue

        round_idx += 1
        last_tick = now_tick

        # Each player makes decisions independently based on their own scene (fog of war)
        sc1 = get_scene(P1_KEY)
        sc2 = get_scene(P2_KEY)

        p1_cmds = p1_strategy(sc1, now_tick)
        p2_cmds = p2_strategy(sc2, now_tick)

        p1_soldiers = sum(1 for u in sc1["units"].values() if u["owner_id"] == "p1" and u["type"] == "soldier")
        p2_soldiers = sum(1 for u in sc2["units"].values() if u["owner_id"] == "p2" and u["type"] == "soldier")
        p1_base_hp = next((b["hp"] for b in sc1["buildings"].values() if b["id"] == P1_MAIN_BASE), None)
        p2_base_hp = next((b["hp"] for b in sc2["buildings"].values() if b["id"] == P2_MAIN_BASE), None)

        log({
            "actor": "system",
            "event": "round",
            "round": round_idx,
            "tick": now_tick,
            "p1_soldiers": p1_soldiers,
            "p2_soldiers": p2_soldiers,
            "p1_base_hp": p1_base_hp,
            "p2_base_hp": p2_base_hp,
            "p1_cmds": len(p1_cmds),
            "p2_cmds": len(p2_cmds),
        })

        if p1_cmds:
            r1 = submit_commands("p1", P1_KEY, p1_cmds)
            for c, r in zip(p1_cmds, r1.get("results", [])):
                log({
                    "actor": "p1",
                    "action": c["type"],
                    "target": c.get("target", {}).get("entity_id") or c.get("payload", {}).get("target_entity_id"),
                    "result": r.get("code"),
                    "message": r.get("message"),
                })
        if p2_cmds:
            r2 = submit_commands("p2", P2_KEY, p2_cmds)
            for c, r in zip(p2_cmds, r2.get("results", [])):
                log({
                    "actor": "p2",
                    "action": c["type"],
                    "target": c.get("target", {}).get("entity_id") or c.get("payload", {}).get("target_entity_id"),
                    "result": r.get("code"),
                    "message": r.get("message"),
                })

        # Pull damage_applied / entity_destroyed events from both players
        for player, key in (("p1", P1_KEY), ("p2", P2_KEY)):
            ev = http("GET", f"/events/snapshot?since_tick={now_tick - TICKS_PER_ROUND}&event_types=damage_applied,entity_destroyed&limit=100", key)
            for e in ev.get("events", []):
                p = e.get("payload", {})
                log({
                    "actor": player,
                    "event": e["event_type"],
                    "attacker": p.get("attacker_id"),
                    "target": p.get("target_id") or p.get("entity_id"),
                    "damage": p.get("damage"),
                    "target_hp": p.get("target_hp") or p.get("hp"),
                    "owner": p.get("owner_id"),
                })


if __name__ == "__main__":
    main()
