#!/usr/bin/env bash
# 固定机位截图统一入口：读档该场景 → 等 ~50 tick → 按场景脚本逐张拍。
#
# 用法：
#   scripts/playtest-shots.sh <N> <场景名> <输出目录> [--compare <修前目录>] [--procedural]
#
#   --procedural  页面带 ?procedural-models=1，强制用程序化模型（模型素材的「修前」图）。
#
#   N          playtest-up.sh 用的端口基数（服务端 N*100 / Web +1 / 驱动 +2）
#   场景名      scripts/playtest-shots/<场景名>.mjs（新增场景只需加这个文件）
#   输出目录    截图写到 <输出目录>/<机位>.png，同名覆盖；--compare 时另写 compare.md
#
# 前置：环境已用 scripts/playtest-up.sh <N> 起好（驱动要能接受片段）。
# 机位定义与新增场景约定见 docs/guide/试玩速查.md「固定机位截图」。
set -euo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  # 自动截取文件头的连续注释块（跳过 shebang），加行号也不用手改范围。
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
  exit 1
}

[[ $# -ge 3 ]] || usage
N="$1"; SCENE="$2"; OUT="$3"; shift 3
[[ "$N" =~ ^[0-9]+$ ]] || { echo "基数 N 必须是整数（例如 249）" >&2; exit 1; }

COMPARE=""
PROCEDURAL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --procedural)
      # 模型素材对照：页面带 `?procedural-models=1`，强制回退程序化模型（修前图）。
      PROCEDURAL="--procedural"; shift ;;
    --compare)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "--compare 需要一个修前截图目录参数" >&2
        usage
      fi
      COMPARE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1" >&2; usage ;;
  esac
done

SERVER_PORT=$((N * 100))
DRIVER_PORT=$((N * 100 + 2))

[[ -f "$WORKTREE/scripts/playtest-shots/$SCENE.mjs" ]] || {
  echo "没有场景脚本 scripts/playtest-shots/$SCENE.mjs" >&2
  echo "新增场景按约定建这个文件（见 docs/guide/试玩速查.md「固定机位截图」）。" >&2
  exit 1
}

if ! curl -fsS -m 3 "http://127.0.0.1:$SERVER_PORT/health" >/dev/null 2>&1; then
  echo "服务端 http://127.0.0.1:$SERVER_PORT 未就绪；先跑 scripts/playtest-up.sh $N" >&2
  exit 1
fi
if ! (exec 3<>"/dev/tcp/127.0.0.1/$DRIVER_PORT") 2>/dev/null; then
  echo "驱动 :$DRIVER_PORT 未就绪；先跑 scripts/playtest-up.sh $N" >&2
  exit 1
fi

mkdir -p "$OUT"
ARGS=("$N" "$SCENE" "$OUT")
[[ -n "$COMPARE" ]] && ARGS+=(--compare "$COMPARE")
[[ -n "$PROCEDURAL" ]] && ARGS+=("$PROCEDURAL")
exec node "$WORKTREE/scripts/playtest-shots/run.mjs" "${ARGS[@]}"
