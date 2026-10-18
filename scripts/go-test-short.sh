#!/usr/bin/env bash
# 串行化 gamecore -short：多个子代理同时跑会互抢 CPU（每个都开满 GOMAXPROCS），
# 墙钟反而更长。用 flock 把同一台机器上的 -short 排成一队，后来的排队等待。
#
# 用法（任意 worktree、任意目录）：
#   bash scripts/go-test-short.sh                  # go test ./internal/gamecore/ -short -count=1
#   bash scripts/go-test-short.sh -run TestXxx -v  # 额外参数原样透传
#
# 脚本自己 cd 到「所在仓库的 server/」，所以从别的 worktree 调用本脚本时，
# 仍然测的是那个 worktree 的代码。
set -euo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$WORKTREE/server"
LOCK_FILE="${SW_GOTEST_LOCK:-/tmp/sw-gotest-short.lock}"

export PATH="/home/firesuiry/sdk/go1.25.0/bin:/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin:$PATH"
export GOCACHE="${GOCACHE:-/tmp/gw-go-cache}"
export GOTOOLCHAIN=local

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[go-test-short] 另一组 -short 正在跑，排队中（锁：$LOCK_FILE）..." >&2
  flock 9
fi

cd "$SERVER_DIR"
echo "[go-test-short] $(basename "$WORKTREE"): go test ./internal/gamecore/ -short -count=1 $*" >&2
exec go test ./internal/gamecore/ -short -count=1 "$@"
