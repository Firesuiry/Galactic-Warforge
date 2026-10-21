#!/usr/bin/env python3
"""SubagentStop 钩子：派出去干活的子代理没交付就停下时，自动让它继续。

只管 prompt 里提到「子代理须知」的子代理（即按 CLAUDE.md 派活的那些）。
它们按须知必须以「## 交付」段结束；最后一条回复里没有这段，就视为中途停下
（deepseek 常见：只回一句 "Now let me…" 就结束），用 decision=block 把它推回去继续，
每个子代理最多推 MAX_NUDGE 次，超过就放行，交给主代理处理。
"""
import json
import os
import sys

MAX_NUDGE = 5
MARK = "## 交付"
STATE_DIR = "/tmp/claude-subagent-nudge"


def first_prompt(path):
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            if e.get("type") == "user":
                c = e["message"]["content"]
                return c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
    return ""


def main():
    d = json.load(sys.stdin)
    if MARK in (d.get("last_assistant_message") or ""):
        return
    try:
        if "子代理须知" not in first_prompt(d.get("agent_transcript_path") or ""):
            return
    except (OSError, ValueError, KeyError):
        return

    os.makedirs(STATE_DIR, exist_ok=True)
    counter = os.path.join(STATE_DIR, str(d.get("agent_id") or "unknown"))
    try:
        n = int(open(counter).read())
    except (OSError, ValueError):
        n = 0
    if n >= MAX_NUDGE:
        return
    with open(counter, "w") as f:
        f.write(str(n + 1))

    reason = (
        f"（自动提示 {n + 1}/{MAX_NUDGE}）你的最后一条回复里没有「{MARK}」段，按子代理须知这说明任务还没做完。"
        "先看 git log / git status 和计划清单确认做到哪，从断点继续推进，不要重做已提交的步骤。"
        f"如果确实全部做完、或被阻塞需要主代理决定，就按子代理须知「汇报」格式输出，以「{MARK}」开头。"
    )
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


if __name__ == "__main__":
    main()
