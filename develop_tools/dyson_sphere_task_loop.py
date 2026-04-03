from __future__ import annotations

import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


def get_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent

def run_codex_exec(repo_root: Path, requirement_text: str) -> int:
    print(f"\n[Codex] 执行任务: {requirement_text}", flush=True)
    result = subprocess.run(
        ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", requirement_text],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode

def run_minimax_exec(repo_root: Path, requirement_text: str) -> int:
    print(f"\n[Minimax] 执行任务: {requirement_text}", flush=True)
    result = subprocess.run(
        ["claude", "--settings", "/home/firesuiry/develop/minimax_settings.json", "--dangerously-skip-permissions", "-p", requirement_text],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode

def run_claude_exec(repo_root: Path, requirement_text: str) -> int:
    print(f"\n[Claude] 执行任务: {requirement_text}", flush=True)
    result = subprocess.run(
        ["claude", "--dangerously-skip-permissions", "-p", requirement_text],
        cwd=str(repo_root),
        check=False,
    )
    return result.returncode


def list_task_files(task_dir: Path) -> list[Path]:
    if not task_dir.exists() or not task_dir.is_dir():
        return []
    return sorted([item for item in task_dir.iterdir() if item.is_file()])

def archive_files(repo_root: Path) -> None:
    archive_base = repo_root / "docs" / "process" / "archive"
    beijing_tz = timezone(timedelta(hours=8))
    timestamp = datetime.now(beijing_tz).strftime("%Y%m%d_%H%M%S")
    archive_dir = archive_base / timestamp
    archive_dir.mkdir(parents=True, exist_ok=True)

    # 归档 task 目录下的文件
    task_dir = repo_root / "docs" / "process" / "task"
    if task_dir.exists():
        for item in task_dir.iterdir():
            if item.is_file():
                shutil.move(str(item), str(archive_dir / item.name))

    # 归档 design 文件
    process_dir = repo_root / "docs" / "process"
    for file_name in ["design_claude.md", "design_codex.md", "design_final.md"]:
        file_path = process_dir / file_name
        if file_path.exists():
            shutil.move(str(file_path), str(archive_dir / file_name))

    print(f"已将本轮中间文件归档至: {archive_dir}", flush=True)


def main() -> int:
    repo_root = get_repo_root()
    task_dir = repo_root / "docs" / "process" / "task"
    task_dir.mkdir(parents=True, exist_ok=True)

    print("开始戴森球计划相关开发循环...", flush=True)

    while True:
        beijing_tz = timezone(timedelta(hours=8))
        now_bj = datetime.now(beijing_tz)
        if not (now_bj.hour >= 22 or now_bj.hour < 6):
            print(f"[{now_bj.strftime('%Y-%m-%d %H:%M:%S')}] 当前北京时间不在执行时间段(22:00-06:00)内，休眠300秒后重试...", flush=True)
            time.sleep(300)
            continue

        print("\n=============================================", flush=True)
        print("步骤 1: 探索游戏状态并生成任务", flush=True)
        print("=============================================", flush=True)
        step1_prompt = "探索游戏源码，并深度试玩游戏，查看戴森球计划相关的建筑、科技树、玩法是否都已经实现。如果没有实现，请在 docs/process/task 目录下增加一个具体的文件，写清楚缺少的东西和改动需求。"
        run_codex_exec(repo_root, step1_prompt)

        # 检查是否生成了新任务
        task_files = list_task_files(task_dir)
        if not task_files:
            print("docs/process/task 目录下没有新任务文件，可能戴森球计划相关功能已经实现。休眠后重试...", flush=True)
            time.sleep(300)
            continue

        print("\n=============================================", flush=True)
        print("步骤 2: 生成设计方案", flush=True)
        print("=============================================", flush=True)
        step2_claude_prompt = "针对 docs/process/task 目录下未实现的功能，生成一份详细的设计方案，保存在 docs/process/design_claude.md 中。"
        run_claude_exec(repo_root, step2_claude_prompt)

        step2_codex_prompt = "针对 docs/process/task 目录下未实现的功能，生成一份详细的设计方案，保存在 docs/process/design_codex.md 中。"
        run_codex_exec(repo_root, step2_codex_prompt)

        print("\n=============================================", flush=True)
        print("步骤 3: 综合最终方案", flush=True)
        print("=============================================", flush=True)
        step3_prompt = "参考 docs/process/design_claude.md 和 docs/process/design_codex.md 两个设计方案，综合生成最终的实现方案，保存在 docs/process/design_final.md 中。"
        run_codex_exec(repo_root, step3_prompt)

        print("\n=============================================", flush=True)
        print("步骤 4: 实验和测试", flush=True)
        print("=============================================", flush=True)
        step4_prompt = "根据 docs/process/design_final.md 中的最终设计方案，进行代码实现、实验和测试。请务必确保功能正确并能够运行，并且清理掉 docs/process/task 下已完成的任务文件。"
        run_codex_exec(repo_root, step4_prompt)

        print("\n=============================================", flush=True)
        print("步骤 5: 更新服务端API和游戏设计文件", flush=True)
        print("=============================================", flush=True)
        step5_prompt = "根据刚才完成的戴森球计划相关功能实现，更新服务端的 API 文档和游戏设计文件。"
        run_codex_exec(repo_root, step5_prompt)

        print("\n=============================================", flush=True)
        print("步骤 6: 归档中间文件", flush=True)
        print("=============================================", flush=True)
        archive_files(repo_root)

        print("\n当前循环开发完成，休息一会儿后继续下一轮检查...", flush=True)
        time.sleep(60)

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n收到退出信号，结束循环。")
        sys.exit(0)
