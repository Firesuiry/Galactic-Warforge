#!/usr/bin/env python3
"""解说词 TTS 生成器。

输入：解说脚本 JSON（segments: [{tick, text}]）
输出：
- public/audio/war/seg-XX.mp3（edge_tts 合成，体育解说声线）
- src/data/commentary.json（[{tick, text, audio, duration_sec}]，供 WarCommentary 读取）
"""
from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "public" / "audio" / "war"
OUT_JSON = ROOT / "src" / "data" / "commentary.json"

# 体育解说风格男声；rate 稍快制造紧迫感
VOICE = "zh-CN-YunjianNeural"
RATE = "+8%"


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
            "-of", "csv=p=0", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip())


async def synth(text: str, out: Path) -> None:
    comm = edge_tts.Communicate(text, VOICE, rate=RATE)
    await comm.save(str(out))


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("script", type=Path, help="解说脚本 JSON: [{\"tick\": N, \"text\": \"...\"}]")
    args = ap.parse_args()

    segments = json.loads(args.script.read_text())
    if not isinstance(segments, list) or not segments:
        print("error: 脚本为空", file=sys.stderr)
        return 1

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for i, seg in enumerate(segments):
        slug = f"seg-{i + 1:02d}"
        mp3 = AUDIO_DIR / f"{slug}.mp3"
        await synth(seg["text"], mp3)
        dur = probe_duration(mp3)
        manifest.append(
            {
                "tick": seg["tick"],
                "text": seg["text"],
                "audio": f"audio/war/{slug}.mp3",
                "duration_sec": round(dur, 2),
            }
        )
        print(f"  {slug}: {dur:.1f}s  {seg['text'][:40]}")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"commentary.json: {len(manifest)} segments -> {OUT_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
