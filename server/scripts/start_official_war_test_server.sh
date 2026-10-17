#!/usr/bin/env bash
# 起一个隔离的官方战争测试服（config-war.yaml + map-war.yaml），供集成测试 / 手工验收用。
#
#   bash server/scripts/start_official_war_test_server.sh <port>
#
# 端口默认 19481 只是为了手工跑；**自动化测试不要依赖这个默认值**：
# client-cli / agent-gateway 的集成测试会先向内核申请空闲端口再把它传进来
# （shared-client/src/test-server.ts），避免上一轮残留的服务端被误连。
# 进程以进程组形式运行，调用方用 `kill -TERM -- -<pid>` 整组回收（脚本的 trap 会清临时目录）。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
SERVER_ROOT="${REPO_ROOT}/server"
PORT="${1:-19481}"
# 优先用仓库文档里的 Go 路径；不存在时退回 PATH 里的 go（其他机器 / CI）。
for candidate in /home/firesuiry/sdk/go1.25.0/bin /mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin; do
  if [[ -x "$candidate/go" ]]; then
    GO_BIN_DIR="$candidate"
    break
  fi
done
if [[ -z "${GO_BIN_DIR:-}" ]]; then
  GO_BIN_DIR="$(dirname "$(command -v go)")"
fi
export PATH="${GO_BIN_DIR}:$PATH"
export GOCACHE="${GOCACHE:-/tmp/gw-go-cache}"
export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/sw-war-test-server.XXXXXX")
CONFIG_SRC="${SERVER_ROOT}/config-war.yaml"
MAP_SRC="${SW_TEST_MAP:-${SERVER_ROOT}/map-war.yaml}"
CONFIG_TMP="${WORK_DIR}/config-war.yaml"
DATA_DIR="${WORK_DIR}/data-war"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${WORK_DIR}"
}

trap cleanup EXIT INT TERM

sed \
  -e "s/^  port: .*/  port: ${PORT}/" \
  -e "s|data_dir: \"data-war\"|data_dir: \"${DATA_DIR}\"|" \
  "${CONFIG_SRC}" > "${CONFIG_TMP}"

cd "${SERVER_ROOT}"
# 先编译再运行：go run 会多一层进程，且进程组回收时 go run 可能先退而留下编译产物子进程。
go build -o "${WORK_DIR}/server-bin" ./cmd/server
"${WORK_DIR}/server-bin" -config "${CONFIG_TMP}" -map-config "${MAP_SRC}" &
SERVER_PID=$!
wait "${SERVER_PID}"
