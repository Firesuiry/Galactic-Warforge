#!/usr/bin/env python3
"""Headless Chrome 截图工具（Windows）。

依赖 client-web 的 ?as=&key= URL 快捷登录。

用法：
    python shot.py --player p1 --route /galaxy --out frame.png [--wait 15000]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
WEB_ORIGIN = "http://127.0.0.1:5173"

PLAYER_KEYS = {
    "p1": "key_player_1",
    "p2": "key_player_2",
}


def take_shot(player_id: str, route: str, out_path: Path, width: int, height: int, wait_ms: int) -> None:
    key = PLAYER_KEYS[player_id]
    sep = "&" if "?" in route else "?"
    target_url = f"{WEB_ORIGIN}{route}{sep}as={player_id}&key={key}"
    workdir = Path(tempfile.mkdtemp(prefix="sw-shot-"))
    profile = workdir / "profile"

    args_list = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--disable-sync",
        "--disable-background-networking",
        f"--user-data-dir={profile}",
        f"--window-size={width},{height}",
        f"--screenshot={out_path.resolve()}",
        f"--virtual-time-budget={wait_ms}",
        target_url,
    ]
    result = subprocess.run(args_list, capture_output=True, text=True, timeout=90)
    shutil.rmtree(workdir, ignore_errors=True)
    if result.returncode != 0:
        print("RC:", result.returncode, file=sys.stderr)
        print("STDERR:", result.stderr[-2000:], file=sys.stderr)
    if not out_path.exists():
        raise RuntimeError(f"screenshot not produced: {out_path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--player", required=True, choices=["p1", "p2"])
    parser.add_argument("--route", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--wait", type=int, default=15000)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    take_shot(args.player, args.route, args.out, args.width, args.height, args.wait)
    print(f"saved: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
