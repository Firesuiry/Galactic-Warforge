import sys
from pathlib import Path
import subprocess

def run_minimax_exec(repo_root: Path, requirement_text: str) -> int:
    result = subprocess.run(
        ["claude", "--settings","/home/firesuiry/develop/minimax_settings.json", "--dangerously-skip-permissions","-p", requirement_text,"--verbose"],
        cwd=str(repo_root),
        check=False,
    )
    # claude --settings /home/firesuiry/develop/minimax_settings.json --dangerously-skip-permissions 
    return result.returncode



def test_run():
    # 获取项目根目录
    repo_root = Path(__file__).resolve().parent.parent
    
    # 使用一个非常安全且简单的测试提示词
    requirement_text = "This is a test run. Please just read docs/running_task/T066_blueprint_batch_ops.md and tell me what it says."
    
    print("==================================================")
    print(f"Testing run_minimax_exec")
    print(f"Repo root: {repo_root}")
    print(f"Requirement: {requirement_text}")
    print("==================================================")
    
    try:
        return_code = run_minimax_exec(repo_root, requirement_text)
        print("==================================================")
        print(f"Execution finished with return code: {return_code}")
        if return_code == 0:
            print("✅ Test passed: The calling method works normally.")
        else:
            print(f"❌ Test failed: The command returned a non-zero exit code ({return_code}).")
    except Exception as e:
        print("==================================================")
        print(f"❌ Test failed with exception: {e}")

if __name__ == "__main__":
    test_run()
