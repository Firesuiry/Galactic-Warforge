from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path


def get_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def list_task_files(task_dir: Path) -> list[Path]:
    if not task_dir.exists() or not task_dir.is_dir():
        return []
    return sorted([item for item in task_dir.iterdir() if item.is_file()])


def read_requirement(requirement_path: Path) -> str:
    return requirement_path.read_text(encoding="utf-8").strip()


def run_codex_exec(repo_root: Path, requirement_text: str) -> int:
    result = subprocess.run(
        ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", requirement_text],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode

def run_minimax_exec(repo_root: Path, requirement_text: str) -> int:
    result = subprocess.run(
        ["claude", "--settings","/home/firesuiry/develop/minimax_settings.json", "--dangerously-skip-permissions","-p", requirement_text],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode

def run_claude_exec(repo_root: Path, requirement_text: str) -> int:
    result = subprocess.run(
        ["claude", "--dangerously-skip-permissions","-p", requirement_text],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode


def main() -> int:
    repo_root = get_repo_root()
    task_dir = repo_root / "docs" / "task"
    running_task_dir = repo_root / "docs" / "running_task"
    requirement_path = repo_root / "docs" / "prompt" / "总体说明.txt"

    if not requirement_path.exists() or not requirement_path.is_file():
        print(f"未找到任务要求文件: {requirement_path}", file=sys.stderr)
        return 1

    requirement_text = read_requirement(requirement_path)
    if not requirement_text:
        print(f"任务要求文件为空: {requirement_path}", file=sys.stderr)
        return 1

    while True:
        beijing_time = datetime.now(UTC).astimezone(timezone(timedelta(hours=8)))
        current_hour = beijing_time.hour
        formatted_time = beijing_time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"当前北京时间 {formatted_time}")
        if current_hour > 8:
            print(f"当前北京时间 {formatted_time} 不在 0-8 点之间，等待 10 分钟后重试")
            time.sleep(600)
            continue

        return_code = run_codex_exec(repo_root, requirement_text)
        if return_code != 0:
            print(f"codex exec 执行失败，退出码: {return_code}", file=sys.stderr)
            time.sleep(300)


if __name__ == "__main__":
    raise SystemExit(main())
