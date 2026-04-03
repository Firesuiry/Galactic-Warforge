from __future__ import annotations

import subprocess
import sys
import time
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
        ["claude", "--settings", "/home/firesuiry/develop/minimax_settings.json", "--dangerously-skip-permissions", "-p", requirement_text, "--verbose"],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode


def main() -> int:
    repo_root = get_repo_root()
    task_dir = repo_root / "docs" / "process" / "task"
    running_task_dir = repo_root / "docs" / "process" / "running_task"
    requirement_path = repo_root / "docs" / "process" / "任务要求.txt"

    if not requirement_path.exists() or not requirement_path.is_file():
        print(f"未找到任务要求文件: {requirement_path}", file=sys.stderr)
        return 1

    requirement_text = read_requirement(requirement_path)
    if not requirement_text:
        print(f"任务要求文件为空: {requirement_path}", file=sys.stderr)
        return 1

    while True:
        task_files = list_task_files(task_dir) + list_task_files(running_task_dir)
        if not task_files:
            print("docs/process/task 和 docs/process/running_task 下没有文件，结束。")
            return 0

        print(f"检测到 {len(task_files)} 个任务文件，执行 codex exec ...")
        return_code = run_minimax_exec(repo_root, requirement_text)
        if return_code != 0:
            print(f"codex exec 执行失败，退出码: {return_code}", file=sys.stderr)
            time.sleep(300)


if __name__ == "__main__":
    raise SystemExit(main())
