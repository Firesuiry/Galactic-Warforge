#!/usr/bin/env python3
"""生成 服务端API.md / 客户端CLI.md 中的命令一览。

数据源：
  - 服务端公开命令目录：`go run ./cmd/catalogdump -commands`（与 GET /catalog/commands 同源）
  - shared-client/src/command-catalog.ts    PUBLIC_COMMAND_DEFINITIONS（API 名 → CLI 动词、分类、层级）
  - shared-client/src/commands/game-commands.ts  GAME_COMMANDS（CLI 与网关共用的游戏动词）
  - client-cli/src/commands/index.ts         COMMANDS（CLI 终端专属动词，展开 GAME_COMMANDS）
  - shared-client/src/commands/help.ts       HELP_ENTRIES（用法与说明）
  - shared-client/src/command-catalog.ts     EXTRA_AGENT_COMMAND_CATALOG（agent 可用的查询动词）

生成内容写在两份文档的标记之间：
  <!-- BEGIN GENERATED COMMANDS -->
  <!-- END GENERATED COMMANDS -->

用法：
  python3 scripts/gen_command_docs.py          # 重写文档
  python3 scripts/gen_command_docs.py --check  # 文档过期则非零退出
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_DOC = ROOT / "docs/dev/服务端API.md"
CLI_DOC = ROOT / "docs/dev/客户端CLI.md"
BEGIN = "<!-- BEGIN GENERATED COMMANDS -->"
END = "<!-- END GENERATED COMMANDS -->"
GO_FALLBACKS = [
    "/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin/go",
    "/home/firesuiry/sdk/go1.25.0/bin/go",
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find_go() -> str:
    go = shutil.which("go")
    if go:
        return go
    for cand in GO_FALLBACKS:
        if os.path.exists(cand):
            return cand
    raise SystemExit("gen_command_docs: 找不到 go，可执行文件需在 PATH 中")


def load_server_catalog() -> list[dict]:
    env = dict(os.environ)
    env.setdefault("GOCACHE", "/tmp/gw-go-cache")
    env.setdefault("GOTOOLCHAIN", "local")
    out = subprocess.run(
        [find_go(), "run", "./cmd/catalogdump", "-commands"],
        cwd=ROOT / "server",
        env=env,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return sorted(json.loads(out), key=lambda e: e["type"])


def load_shared_catalog() -> dict[str, dict]:
    """apiCommandName -> 定义（兼容单行与多行写法）。"""
    text = read(ROOT / "shared-client/src/command-catalog.ts")
    body = text.split("PUBLIC_COMMAND_DEFINITIONS", 1)[1]
    out: dict[str, dict] = {}
    for obj in re.findall(r"\{[^{}]*\bid\s*:[^{}]*\}", body):
        fields = dict(re.findall(r'(\w+)\s*:\s*"([^"]*)"', obj))
        fields.update(re.findall(r"(\w+)\s*:\s*(true|false)\b", obj))
        if "apiCommandName" in fields:
            out[fields["apiCommandName"]] = fields
    return out


def load_cli_commands() -> list[str]:
    names: list[str] = []
    for path, marker in (
        ("shared-client/src/commands/game-commands.ts", "export const GAME_COMMANDS"),
        ("client-cli/src/commands/index.ts", "export const COMMANDS"),
    ):
        table = read(ROOT / path).split(marker, 1)[1].split("\n};", 1)[0]
        names += re.findall(r"^\s*([a-z_]+)\s*:\s*\{\s*handler\s*:", table, re.M)
    return names


def load_cli_help() -> dict[str, dict]:
    text = read(ROOT / "shared-client/src/commands/help.ts")
    block = text.split("HELP_ENTRIES", 1)[1].split("\n};", 1)[0]
    out: dict[str, dict] = {}
    for line in block.splitlines():
        m = re.match(r"\s*([a-z_]+)\s*:\s*\{(.*)\}\s*,?\s*$", line)
        if not m:
            continue
        fields = dict(re.findall(r"(usage|desc)\s*:\s*'((?:[^'\\]|\\.)*)'", m.group(2)))
        out[m.group(1)] = fields
    return out


def load_agent_extra() -> set[str]:
    text = read(ROOT / "shared-client/src/command-catalog.ts")
    m = re.search(r"EXTRA_AGENT_COMMAND_CATALOG[^=]*=\s*\{(.*?)\n\}", text, re.S)
    return set(re.findall(r"^\s*([a-z_]+)\s*:\s*\{", m.group(1), re.M)) if m else set()


def cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ") if value else "—"


def code_list(items: list[str] | None) -> str:
    return ", ".join(f"`{x}`" for x in items) if items else "—"


def render_api(server: list[dict], shared: dict[str, dict], help_: dict[str, dict]) -> str:
    lines = [
        BEGIN,
        "<!-- 由 scripts/gen_command_docs.py 生成，勿手改；数据源 GET /catalog/commands 与 shared-client 命令目录 -->",
        "",
        f"共 {len(server)} 条公开命令。target 列为 `target` 必填字段；载荷列为 `payload` 字段（可选字段带 `?`）。",
        "",
        "| 命令 | 层级 | target 必填 | payload | CLI 动词 | 说明 |",
        "|---|---|---|---|---|---|",
    ]
    constrained = []
    for e in server:
        api = e["type"]
        d = shared.get(api, {})
        verb = d.get("cliCommandName")
        layer = e.get("required_layer") or d.get("layer") or "—"
        payload = [f"`{x}`" for x in e.get("required_payload_fields") or []]
        payload += [f"`{x}?`" for x in e.get("optional_payload_fields") or []]
        desc = help_.get(verb or "", {}).get("desc", "")
        lines.append(
            f"| `{api}` | {layer} | {code_list(e.get('required_target_fields'))} | "
            f"{', '.join(payload) or '—'} | {f'`{verb}`' if verb else '—'} | {cell(desc)} |"
        )
        if e.get("constraints"):
            constrained.append(e)
    if constrained:
        lines += ["", "**附加约束**（来自目录 `constraints`）：", ""]
        for e in constrained:
            lines.append(f"- `{e['type']}`：" + " ".join(e["constraints"]))
    lines.append(END)
    return "\n".join(lines)


def render_cli(
    cli: list[str], shared: dict[str, dict], help_: dict[str, dict], extra: set[str]
) -> str:
    verb_to_api = {d["cliCommandName"]: api for api, d in shared.items() if d.get("cliCommandName")}
    groups: dict[str, list[str]] = {"game": [], "query": [], "other": []}
    for name in cli:
        if name in verb_to_api:
            groups["game"].append(name)
        elif name in extra:
            groups["query"].append(name)
        else:
            groups["other"].append(name)

    def row(name: str, with_api: bool) -> str:
        h = help_.get(name, {})
        usage = f"`{name} {h['usage']}`".replace("|", "\\|") if h.get("usage") else "—"
        parts = [f"`{name}`", usage]
        if with_api:
            api = verb_to_api[name]
            d = shared[api]
            parts += [f"`{api}`", d.get("permissionCategory", "—")]
        parts.append(cell(h.get("desc", "")))
        return "| " + " | ".join(parts) + " |"

    lines = [
        BEGIN,
        "<!-- 由 scripts/gen_command_docs.py 生成，勿手改；数据源 GAME_COMMANDS/COMMANDS/HELP_ENTRIES 与 shared-client 命令目录 -->",
        "",
        f"### 游戏命令（{len(groups['game'])} 条，对应 `POST /commands`）",
        "",
        "| 动词 | 用法 | API 命令 | 权限类别 | 说明 |",
        "|---|---|---|---|---|",
    ]
    lines += [row(n, True) for n in sorted(groups["game"])]
    lines += [
        "",
        f"### 查询命令（{len(groups['query'])} 条，agent 可用）",
        "",
        "| 动词 | 用法 | 说明 |",
        "|---|---|---|",
    ]
    lines += [row(n, False) for n in groups["query"]]
    lines += [
        "",
        f"### 管理、调试与工具（{len(groups['other'])} 条）",
        "",
        "| 动词 | 用法 | 说明 |",
        "|---|---|---|",
    ]
    lines += [row(n, False) for n in groups["other"]]
    lines.append(END)
    return "\n".join(lines)


def render_all() -> dict[Path, str]:
    shared = load_shared_catalog()
    help_ = load_cli_help()
    return {
        API_DOC: render_api(load_server_catalog(), shared, help_),
        CLI_DOC: render_cli(load_cli_commands(), shared, help_, load_agent_extra()),
    }


def splice(doc: Path, block: str) -> str:
    text = read(doc)
    if text.count(BEGIN) != 1 or text.count(END) != 1:
        raise SystemExit(f"gen_command_docs: {doc.relative_to(ROOT)} 缺少或重复生成标记")
    head, rest = text.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    return head + block + tail


def stale_docs() -> list[str]:
    """返回过期文档的相对路径（供 command_coverage.py --check 调用）。"""
    return [
        str(doc.relative_to(ROOT))
        for doc, block in render_all().items()
        if splice(doc, block) != read(doc)
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成命令一览文档")
    parser.add_argument("--check", action="store_true", help="文档过期则非零退出")
    args = parser.parse_args(argv)
    if args.check:
        stale = stale_docs()
        if stale:
            print(f"命令文档过期，请运行 python3 scripts/gen_command_docs.py：{stale}", file=sys.stderr)
            return 1
        print("command docs OK")
        return 0
    for doc, block in render_all().items():
        new = splice(doc, block)
        if new != read(doc):
            doc.write_text(new, encoding="utf-8")
            print(f"wrote {doc.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
