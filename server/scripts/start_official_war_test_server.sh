#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
SERVER_ROOT="${REPO_ROOT}/server"
GO_BIN_DIR="/home/firesuiry/sdk/go1.25.0/bin"
PORT="${1:-19481}"

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/sw-war-test-server.XXXXXX")
CONFIG_SRC="${SERVER_ROOT}/config-war.yaml"
MAP_SRC="${SERVER_ROOT}/map-war.yaml"
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
env PATH="${GO_BIN_DIR}:$PATH" go run ./cmd/server -config "${CONFIG_TMP}" -map-config "${MAP_SRC}" &
SERVER_PID=$!
wait "${SERVER_PID}"
