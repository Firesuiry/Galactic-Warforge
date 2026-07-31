#!/usr/bin/env python3
"""T-D1: server command surface vs GUI / CLI / shared catalog / agent.

Sources (no network):
  - server/internal/model/command.go          authoritative CommandType set
  - shared-client/src/command-catalog.ts     PUBLIC_COMMAND_DEFINITIONS
  - client-cli/src/commands/index.ts         COMMANDS table (action cmds)
  - client-cli/src/command-catalog.ts        AGENT_COMMAND_CATALOG (via shared)
  - client-web/src/**/*.{ts,tsx}             client.cmdX(...) call sites
                                            (tests excluded)

Exit 0 always when --write is used for doc generation; use --check to fail
when required surfaces regress (missing shared catalog entry, or missing CLI
registration for any server command that has a shared cliCommandName).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SERVER_CMD_RE = re.compile(
    r'Cmd\w+\s+CommandType\s*=\s*"([a-z_]+)"'
)
SHARED_ENTRY_RE = re.compile(
    r'\{\s*id:\s*"([a-z_]+)"\s*,\s*'
    r'apiCommandName:\s*"([a-z_]+)"\s*,\s*'
    r'(?:cliCommandName:\s*"([a-z_]+)"\s*,\s*)?'
    r'[\s\S]*?webSurface:\s*"(required|optional|hidden)"',
)
CLI_TABLE_RE = re.compile(r"^\s*([a-z_]+):\s*\{\s*handler:", re.M)
GUI_CMD_CALL_RE = re.compile(r"\bclient\.cmd([A-Z]\w*)\s*\(")
CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def camel_cmd_to_snake(name: str) -> str:
    """cmdFleetMove -> fleet_move (caller strips 'cmd' prefix first)."""
    return CAMEL_BOUNDARY.sub("_", name).lower()


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_server_commands() -> list[str]:
    text = read(ROOT / "server/internal/model/command.go")
    return sorted(set(SERVER_CMD_RE.findall(text)))


def load_shared_catalog() -> dict[str, dict]:
    text = read(ROOT / "shared-client/src/command-catalog.ts")
    out: dict[str, dict] = {}
    for m in SHARED_ENTRY_RE.finditer(text):
        api = m.group(2)
        out[api] = {
            "id": m.group(1),
            "api": api,
            "cli": m.group(3) or None,
            "webSurface": m.group(4),
        }
    return out


def load_cli_commands() -> set[str]:
    text = read(ROOT / "client-cli/src/commands/index.ts")
    return set(CLI_TABLE_RE.findall(text))


def load_agent_commands() -> set[str]:
    """Agent whitelist = EXTRA observe cmds + shared public CLI aliases."""
    shared = load_shared_catalog()
    agent: set[str] = set()
    for entry in shared.values():
        if entry["cli"]:
            agent.add(entry["cli"])
    # EXTRA_AGENT_COMMAND_CATALOG (observe / management query surface)
    cat = read(ROOT / "client-cli/src/command-catalog.ts")
    m = re.search(
        r"EXTRA_AGENT_COMMAND_CATALOG[^=]*=\s*\{(.*?)\n\}",
        cat,
        re.S,
    )
    if m:
        agent |= set(re.findall(r"^\s*([a-z_]+):\s*\{", m.group(1), re.M))
    return agent


def load_gui_commands() -> set[str]:
    """Scan non-test client-web sources for client.cmdX(...) call sites."""
    gui: set[str] = set()
    src = ROOT / "client-web/src"
    for path in src.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if ".test." in path.name or ".spec." in path.name:
            continue
        text = read(path)
        for m in GUI_CMD_CALL_RE.finditer(text):
            gui.add(camel_cmd_to_snake(m.group(1)))
    return gui


def build_matrix() -> dict:
    server = load_server_commands()
    shared = load_shared_catalog()
    cli = load_cli_commands()
    agent = load_agent_commands()
    gui = load_gui_commands()

    rows = []
    for cmd in server:
        entry = shared.get(cmd)
        cli_name = entry["cli"] if entry else None
        # CLI may register under alias (transfer) or api name
        cli_ok = (cli_name in cli) if cli_name else (cmd in cli)
        # Agent whitelist keys are CLI names when present
        agent_key = cli_name or cmd
        agent_ok = agent_key in agent
        gui_ok = cmd in gui
        rows.append(
            {
                "command": cmd,
                "shared": entry is not None,
                "cli_name": cli_name,
                "cli": cli_ok,
                "agent": agent_ok,
                "gui": gui_ok,
                "webSurface": entry["webSurface"] if entry else None,
            }
        )

    counts = {
        "server": len(server),
        "shared": sum(1 for r in rows if r["shared"]),
        "cli": sum(1 for r in rows if r["cli"]),
        "agent": sum(1 for r in rows if r["agent"]),
        "gui": sum(1 for r in rows if r["gui"]),
    }
    gaps = {
        "missing_shared": [r["command"] for r in rows if not r["shared"]],
        "missing_cli": [r["command"] for r in rows if not r["cli"]],
        "missing_gui": [r["command"] for r in rows if not r["gui"]],
        "missing_agent": [r["command"] for r in rows if not r["agent"]],
        "required_web_missing_gui": [
            r["command"]
            for r in rows
            if r["webSurface"] == "required" and not r["gui"]
        ],
    }
    return {
        "generated_on": date.today().isoformat(),
        "counts": counts,
        "gaps": gaps,
        "rows": rows,
        "webSurface_histogram": dict(
            Counter(r["webSurface"] for r in rows if r["webSurface"])
        ),
    }


def render_markdown(matrix: dict) -> str:
    c = matrix["counts"]
    g = matrix["gaps"]
    lines = [
        "# 命令覆盖率矩阵（T-D1）",
        "",
        f"> 自动生成：`scripts/command_coverage.py` · {matrix['generated_on']}",
        ">",
        "> 对照 server 权威指令全集 vs shared catalog / CLI 注册表 / agent 白名单 / Web GUI 调用点。",
        "> 重新生成：`python3 scripts/command_coverage.py --write`",
        "> 回归门禁：`python3 scripts/command_coverage.py --check`",
        "",
        "## 汇总",
        "",
        f"| 面 | 覆盖 | / server |",
        f"|---|---:|---:|",
        f"| server CommandType | {c['server']} | {c['server']} |",
        f"| shared-client catalog | {c['shared']} | {c['server']} |",
        f"| client-cli COMMANDS | {c['cli']} | {c['server']} |",
        f"| agent 白名单（CLI 名） | {c['agent']} | {c['server']} |",
        f"| client-web GUI（cmd 调用） | {c['gui']} | {c['server']} |",
        "",
        f"webSurface 分布：`{matrix['webSurface_histogram']}`",
        "",
        "## 缺口",
        "",
        f"- **missing shared catalog**：{g['missing_shared'] or '（无）'}",
        f"- **missing CLI**：{g['missing_cli'] or '（无）'}",
        f"- **missing GUI**：{g['missing_gui'] or '（无）'}",
        f"- **missing agent**：{g['missing_agent'] or '（无）'}",
        f"- **webSurface=required 但 GUI 无调用**：{g['required_web_missing_gui'] or '（无）'}",
        "",
        "## 全表",
        "",
        "| command | shared | CLI | agent | GUI | webSurface |",
        "|---|:---:|:---:|:---:|:---:|---|",
    ]
    for r in matrix["rows"]:
        def mark(ok: bool) -> str:
            return "✓" if ok else "·"

        cli_cell = mark(r["cli"])
        if r["cli_name"] and r["cli_name"] != r["command"]:
            cli_cell = f"{cli_cell} (`{r['cli_name']}`)"
        lines.append(
            f"| `{r['command']}` | {mark(r['shared'])} | {cli_cell} | "
            f"{mark(r['agent'])} | {mark(r['gui'])} | {r['webSurface'] or '—'} |"
        )
    lines += [
        "",
        "## 说明",
        "",
        "- **shared**：`shared-client/src/command-catalog.ts` 的 `PUBLIC_COMMAND_DEFINITIONS`",
        "- **CLI**：`client-cli/src/commands/index.ts` 的 `COMMANDS` 键；"
        "若 catalog 声明 `cliCommandName` 别名（如 `transfer_item`→`transfer`），按别名匹配",
        "- **agent**：`client-cli/src/command-catalog.ts` 的 "
        "`AGENT_COMMAND_CATALOG`（shared 公开 CLI 别名 + EXTRA 查询命令）",
        "- **GUI**：`client-web/src` 非测试文件中的 `client.cmdX(...)` 静态调用点；"
        "动态/间接派发不会被计入",
        "- **webSurface**：catalog 意图（`required`/`optional`/`hidden`），"
        "与真实 GUI 调用可能短暂漂移——以本表 GUI 列为实测",
        "",
        "## 门禁规则（`--check`）",
        "",
        "1. server 每条 CommandType 必须出现在 shared catalog",
        "2. shared 声明了 `cliCommandName` 的命令必须在 CLI `COMMANDS` 注册",
        "3. `webSurface=required` 的命令必须有 GUI `client.cmd*` 调用点",
        "",
    ]
    return "\n".join(lines)


def check(matrix: dict) -> list[str]:
    errors: list[str] = []
    g = matrix["gaps"]
    if g["missing_shared"]:
        errors.append(f"missing shared catalog: {g['missing_shared']}")
    if g["missing_cli"]:
        errors.append(f"missing CLI registration: {g['missing_cli']}")
    if g["required_web_missing_gui"]:
        errors.append(
            f"webSurface=required without GUI: {g['required_web_missing_gui']}"
        )
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="write docs/dev/命令覆盖率矩阵.md and /tmp/cmd-coverage.json",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero on coverage regressions",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print JSON matrix to stdout",
    )
    args = parser.parse_args(argv)

    matrix = build_matrix()

    if args.json:
        print(json.dumps(matrix, indent=2, ensure_ascii=False))

    if args.write:
        md_path = ROOT / "docs/dev/命令覆盖率矩阵.md"
        md_path.write_text(render_markdown(matrix), encoding="utf-8")
        json_path = Path("/tmp/cmd-coverage.json")
        json_path.write_text(
            json.dumps(matrix, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {md_path.relative_to(ROOT)}")
        print(f"wrote {json_path}")
        c = matrix["counts"]
        print(
            f"coverage: shared {c['shared']}/{c['server']}  "
            f"cli {c['cli']}/{c['server']}  "
            f"agent {c['agent']}/{c['server']}  "
            f"gui {c['gui']}/{c['server']}"
        )

    if not args.write and not args.json:
        # default: human summary
        print(render_markdown(matrix))

    if args.check:
        errors = check(matrix)
        if errors:
            print("CHECK FAILED:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            return 1
        print("CHECK OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
