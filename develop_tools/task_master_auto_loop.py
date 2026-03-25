from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


def get_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def read_requirement(requirement_path: Path) -> str:
    if not requirement_path.exists() or not requirement_path.is_file():
        return ""
    return requirement_path.read_text(encoding="utf-8").strip()


def build_prompt(repo_root: Path, requirement_text: str) -> str:
    finish_file = repo_root / "task_finished.txt"
    base_requirement = requirement_text if requirement_text else "无额外任务要求，按仓库现状推进。"
    return f"""你是本仓库的自动化执行代理。必须使用 Task Master MCP 工具推进任务，工具能力与用法参考 https://docs.task-master.dev/capabilities/mcp 。

项目根目录: {repo_root}
任务补充要求: {base_requirement}

每次仅处理一个任务，严格按以下顺序执行：
1. 先用 get_tasks 检查未完成任务；必要时用 next_task 和 get_task 获取任务详情。
2. 若所有任务都完成，立即在项目根目录创建文件 {finish_file}，文件内容写入“all tasks finished”，然后结束本次执行。
3. 若存在任务，判断复杂度(可用mcp中的analyze_project_complexity)：
   - 复杂任务或实现路径不清晰：调用 expand_task 进行任务扩展，再补充实现建议。
   - 简单任务：直接实现代码、运行必要验证，并把任务标记为完成。
4. 实现成功后，必须调用 set_task_status 标记完成，并用 update_subtask 记录实现与验证结果。
5. 若实现失败或暂时无法完成，不允许直接跳过，必须调用 expand_task 拆分任务，再更新子任务说明。

执行约束：
- 必须真实修改代码并验证，不要只给计划。
- 一次只推进一个任务，避免大范围并行改动。
- 任何状态变更都要回写到 Task Master。
- 完成后直接退出，不要进入交互提问。"""


def run_claude_exec(repo_root: Path, prompt: str) -> int:
    env = os.environ.copy()
    env["TASK_MASTER_TOOLS"] = env.get("TASK_MASTER_TOOLS", "standard")
    result = subprocess.run(
        [
            "claude",
            "--dangerously-skip-permissions",
            "-p",
            prompt,
        ],
        cwd=str(repo_root),
        env=env,
        check=False,
    )
    return result.returncode


def main() -> int:
    repo_root = get_repo_root()
    requirement_path = repo_root / "docs" / "任务要求.txt"
    finish_file = repo_root / "task_finished.txt"

    requirement_text = read_requirement(requirement_path)

    while True:
        if finish_file.exists():
            print(f"检测到完成标记文件，停止循环: {finish_file}")
            return 0

        prompt = build_prompt(repo_root, requirement_text)
        return_code = run_claude_exec(repo_root, prompt)
        if return_code != 0:
            print(f"执行失败，退出码: {return_code}，300 秒后重试。", file=sys.stderr)
            time.sleep(300)
            continue

        if finish_file.exists():
            print(f"检测到完成标记文件，停止循环: {finish_file}")
            return 0

        print("本轮执行完成，60 秒后进入下一轮检查。")
        time.sleep(60)


if __name__ == "__main__":
    raise SystemExit(main())
