#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_AUDIO = ROOT / "public" / "audio"
VOICEOVER_DIR = PUBLIC_AUDIO / "voiceover"
BGM_DIR = PUBLIC_AUDIO / "bgm"
INTRO_BGM_DURATION = 51.6
DESIGN_AUDIO_ROOT = PUBLIC_AUDIO / "design"
DESIGN_VOICEOVER_DIR = DESIGN_AUDIO_ROOT / "voiceover"
DESIGN_BGM_DIR = DESIGN_AUDIO_ROOT / "bgm"
DESIGN_BGM_DURATION = 52.0


@dataclass(frozen=True)
class VoiceScene:
    slug: str
    text: str
    max_seconds: float


INTRO_SCENES = [
    VoiceScene(
        slug="scene-01-hero",
        text="这就是硅基世界。一个由服务端权威驱动的，戴森球式工业宇宙。",
        max_seconds=6.0,
    ),
    VoiceScene(
        slug="scene-02-architecture",
        text="在这里，玩家、命令行和 AI 只提交意图。真正的状态变化，由服务器在 Tick 边界统一执行。",
        max_seconds=8.5,
    ),
    VoiceScene(
        slug="scene-03-systems",
        text="工业、物流、能源、科技、戴森系统和战斗，不再各自孤立，而是被压进同一条结算链。",
        max_seconds=7.8,
    ),
    VoiceScene(
        slug="scene-04-loop",
        text="研究解锁建筑，建筑消耗电力与物流，产线再反过来推动下一轮扩张。这条主循环，已经打通。",
        max_seconds=8.4,
    ),
    VoiceScene(
        slug="scene-05-metrics",
        text="截至二零二六年三月二十二日，项目已完成八十七项任务，可建造建筑五十三座，科技条目一百零五项。",
        max_seconds=8.6,
    ),
    VoiceScene(
        slug="scene-06-closing",
        text="它不是一个前端壳，而是一台正在成型的宇宙模拟器。下一步，将继续补强物流配置、战斗科技和轨道编队。",
        max_seconds=9.4,
    ),
]

DESIGN_SCENES = [
    VoiceScene(
        slug="scene-01-hero",
        text="银河战争工厂，是一款围绕星系扩张、人工智能执行与多人战争展开的游戏。",
        max_seconds=6.4,
    ),
    VoiceScene(
        slug="scene-02-ai",
        text="它最重要的设计，不是让玩家一格一格摆建筑，而是让玩家提出目标，由人工智能完成规划、施工、布线和运营细节。",
        max_seconds=10.2,
    ),
    VoiceScene(
        slug="scene-03-war",
        text="在庞大的星系里，多名玩家将从零发展基地，争夺资源、扩张战线，最终打成一场星际红警式的多人混战。",
        max_seconds=9.6,
    ),
    VoiceScene(
        slug="scene-04-roadmap",
        text="项目将完全开源，并且会优先把游戏逻辑服务器做扎实，再继续推进渲染服务器与引擎层。",
        max_seconds=8.4,
    ),
    VoiceScene(
        slug="scene-05-community",
        text="如果你也想一起交流、共建设计与实现，欢迎加入QQ群，一零九四一八六四三七。银河战争工厂，欢迎你一起把这场战争做出来。",
        max_seconds=11.0,
    ),
]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def capture(cmd: list[str]) -> str:
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def probe_duration(path: Path) -> float:
    output = capture(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
    )
    return float(output)


def generate_voiceover(
    *,
    scenes: list[VoiceScene],
    output_dir: Path,
    label: str,
    rate: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating voiceover: {label}")
    for scene in scenes:
        output = output_dir / f"{scene.slug}.mp3"
        run(
            [
                sys.executable,
                "-m",
                "edge_tts",
                "--voice",
                "zh-CN-XiaoxiaoNeural",
                "--rate",
                rate,
                "--volume",
                "+0%",
                "--text",
                scene.text,
                "--write-media",
                str(output),
            ]
        )
        duration = probe_duration(output)
        status = "OK" if duration <= scene.max_seconds else "TOO LONG"
        print(
            f"  {scene.slug}: {duration:.2f}s / budget {scene.max_seconds:.2f}s [{status}]"
        )


def generate_bgm(
    *,
    output: Path,
    duration: float,
    label: str,
    expr_left: str,
    expr_right: str,
    filter_graph: str,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    aeval_expr = f"{expr_left}|{expr_right}"

    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"aevalsrc={aeval_expr}:s=48000:d={duration}",
            "-af",
            filter_graph,
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(output),
        ]
    )

    actual_duration = probe_duration(output)
    print(f"Generated background music: {label} ({actual_duration:.2f}s)")


def main() -> None:
    generate_voiceover(
        scenes=INTRO_SCENES,
        output_dir=VOICEOVER_DIR,
        label="intro",
        rate="+18%",
    )
    generate_bgm(
        output=BGM_DIR / "ambient-bed.mp3",
        duration=INTRO_BGM_DURATION,
        label="ambient-bed.mp3",
        expr_left=(
            "0.040*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.11*t))"
            "+0.028*sin(2*PI*329.63*t+0.6)*(0.50+0.50*sin(2*PI*0.07*t+1.2))"
            "+0.020*sin(2*PI*440*t+1.1)*(0.45+0.55*sin(2*PI*0.05*t+2.2))"
        ),
        expr_right=(
            "0.040*sin(2*PI*220*t+0.3)*(0.55+0.45*sin(2*PI*0.10*t+0.2))"
            "+0.028*sin(2*PI*329.63*t+0.9)*(0.50+0.50*sin(2*PI*0.07*t+1.4))"
            "+0.020*sin(2*PI*440*t+1.4)*(0.45+0.55*sin(2*PI*0.05*t+2.5))"
        ),
        filter_graph=(
            f"aecho=0.8:0.88:60:0.22,lowpass=f=1600,highpass=f=90,"
            f"afade=t=in:st=0:d=1.6,afade=t=out:st={INTRO_BGM_DURATION - 2.3:.1f}:d=2.3"
        ),
    )

    generate_voiceover(
        scenes=DESIGN_SCENES,
        output_dir=DESIGN_VOICEOVER_DIR,
        label="design",
        rate="+20%",
    )
    generate_bgm(
        output=DESIGN_BGM_DIR / "war-room-bed.mp3",
        duration=DESIGN_BGM_DURATION,
        label="war-room-bed.mp3",
        expr_left=(
            "0.038*sin(2*PI*110*t)*(0.60+0.40*sin(2*PI*0.18*t))"
            "+0.025*sin(2*PI*164.81*t+0.9)*(0.50+0.50*sin(2*PI*0.09*t+0.8))"
            "+0.018*sin(2*PI*220*t+1.7)*(0.45+0.55*sin(2*PI*0.24*t+0.4))"
        ),
        expr_right=(
            "0.038*sin(2*PI*110*t+0.2)*(0.60+0.40*sin(2*PI*0.17*t+0.3))"
            "+0.025*sin(2*PI*164.81*t+1.1)*(0.50+0.50*sin(2*PI*0.09*t+1.1))"
            "+0.018*sin(2*PI*220*t+1.9)*(0.45+0.55*sin(2*PI*0.24*t+0.7))"
        ),
        filter_graph=(
            f"aecho=0.78:0.86:52:0.18,lowpass=f=1750,highpass=f=75,"
            f"afade=t=in:st=0:d=1.4,afade=t=out:st={DESIGN_BGM_DURATION - 2.4:.1f}:d=2.4"
        ),
    )


if __name__ == "__main__":
    main()
