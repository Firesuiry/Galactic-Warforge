#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run/local-playtest"
SERVER_DIR="$ROOT_DIR/server"
WEB_DIR="$ROOT_DIR/client-web"
GATEWAY_DIR="$ROOT_DIR/agent-gateway"
GO_BIN_DIR="/home/firesuiry/sdk/go1.25.0/bin"
SERVER_CONFIG_TEMPLATE="$SERVER_DIR/config-dev.yaml"
SERVER_CONFIG_RUNTIME="$RUN_DIR/server-config.yaml"
SERVER_DATA_DIR="$RUN_DIR/server-data"

SERVER_PORT=18080
GATEWAY_PORT=18180
WEB_PORT=5173

mkdir -p "$RUN_DIR"

log() {
  printf '[local-playtest] %s\n' "$*"
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts="${3:-60}"
  local delay_seconds="${4:-1}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$name 已就绪: $url"
      return 0
    fi
    sleep "$delay_seconds"
  done

  log "$name 启动失败，请检查日志: $url"
  return 1
}

ensure_node_modules() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    log "安装依赖: $dir"
    (cd "$dir" && npm install)
  fi
}

cleanup_ports() {
  local pids
  pids="$(lsof -ti:"$SERVER_PORT" -ti:"$GATEWAY_PORT" -ti:"$WEB_PORT" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    log "关闭旧进程: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

prepare_server_config() {
  mkdir -p "$SERVER_DATA_DIR"
  sed "s|data_dir: \"data\"|data_dir: \"$SERVER_DATA_DIR\"|" \
    "$SERVER_CONFIG_TEMPLATE" >"$SERVER_CONFIG_RUNTIME"
}

start_server() {
  log "启动服务端"
  prepare_server_config
  (
    cd "$SERVER_DIR"
    nohup bash -lc "echo \$\$ > '$RUN_DIR/server.pid'; exec env PATH='$GO_BIN_DIR:\$PATH' go run ./cmd/server -config '$SERVER_CONFIG_RUNTIME' -map-config map.yaml" \
      >"$RUN_DIR/server.log" 2>&1 </dev/null &
  )
  wait_for_http "http://127.0.0.1:$SERVER_PORT/health" "服务端"
}

start_gateway() {
  log "启动智能体平台"
  ensure_node_modules "$GATEWAY_DIR"
  (
    cd "$GATEWAY_DIR"
    nohup bash -lc "echo \$\$ > '$RUN_DIR/agent-gateway.pid'; exec env SW_AGENT_GATEWAY_PORT='$GATEWAY_PORT' SW_AGENT_GATEWAY_ENV_FILE='$ROOT_DIR/.env' npm run dev" \
      >"$RUN_DIR/agent-gateway.log" 2>&1 </dev/null &
  )
  wait_for_http "http://127.0.0.1:$GATEWAY_PORT/health" "智能体平台"
}

start_web() {
  log "启动 Web"
  ensure_node_modules "$WEB_DIR"
  (
    cd "$WEB_DIR"
    nohup bash -lc "echo \$\$ > '$RUN_DIR/client-web.pid'; exec env VITE_SW_PROXY_TARGET='http://127.0.0.1:$SERVER_PORT' VITE_SW_AGENT_PROXY_TARGET='http://127.0.0.1:$GATEWAY_PORT' npm run dev -- --host 0.0.0.0 --port '$WEB_PORT'" \
      >"$RUN_DIR/client-web.log" 2>&1 </dev/null &
  )
  wait_for_http "http://127.0.0.1:$WEB_PORT/agent-api/health" "Web 代理"
}

print_summary() {
  cat <<EOF

试玩环境已启动:
  server:        http://127.0.0.1:$SERVER_PORT
  agent-gateway: http://127.0.0.1:$GATEWAY_PORT
  web:           http://127.0.0.1:$WEB_PORT/login

试玩账号:
  p1 / key_player_1
  p2 / key_player_2

日志目录:
  $RUN_DIR
EOF
}

cleanup_ports
start_server
start_gateway
start_web
print_summary
