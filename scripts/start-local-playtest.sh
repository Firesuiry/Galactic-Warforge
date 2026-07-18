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

SERVER_PORT="${SERVER_PORT:-18080}"
GATEWAY_PORT="${GATEWAY_PORT:-18180}"
WEB_PORT="${WEB_PORT:-5173}"

mkdir -p "$RUN_DIR"

log() {
  printf '[local-playtest] %s\n' "$*"
}

usage() {
  cat <<EOF
用法: $0 [start|stop]

  start  启动本地试玩环境（默认），启动前自动清理本仓库残留的旧进程
  stop   停止试玩环境，清理 $SERVER_PORT/$GATEWAY_PORT/$WEB_PORT 三个端口上属于本仓库的进程

可用环境变量覆盖端口: SERVER_PORT / GATEWAY_PORT / WEB_PORT
EOF
}

# 等待 HTTP 就绪，并校验响应体包含游戏标识，避免端口被外部服务占用时误判
wait_for_http() {
  local url="$1"
  local name="$2"
  local expect_substring="$3"
  local attempts="${4:-60}"
  local delay_seconds="${5:-1}"
  local body

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    body="$(curl -fsS "$url" 2>/dev/null || true)"
    if [[ -n "$body" ]] && grep -qF "$expect_substring" <<<"$body"; then
      log "$name 已就绪: $url"
      return 0
    fi
    sleep "$delay_seconds"
  done

  log "$name 启动失败，或端口被外部服务占用（响应中未找到 '$expect_substring'），请检查日志: $url"
  return 1
}

ensure_node_modules() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    log "安装依赖: $dir"
    (cd "$dir" && npm install)
  fi
}

port_pids() {
  lsof -ti:"$1" 2>/dev/null || true
}

# 探测端口是否可连接（用于发现 lsof 看不到的 root/容器占用者）
port_connectable() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# 判断进程是否属于本仓库（cmdline 中含仓库路径），外部服务不可擅杀
is_our_process() {
  local pid="$1"
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  tr '\0' ' ' <"/proc/$pid/cmdline" | grep -qF "$ROOT_DIR"
}

# 清理单个端口：只杀本仓库残留进程；被外部进程占用时报错退出并提示换端口
cleanup_port() {
  local port="$1"
  local name="$2"
  local port_env="$3"
  local pids pid attempt

  pids="$(port_pids "$port")"
  if [[ -z "$pids" ]]; then
    if port_connectable "$port"; then
      log "错误: 端口 $port ($name) 被外部进程占用（当前用户无权限查看占用者，可能是 root/容器进程）"
      log "不会擅杀外部进程，请换端口重试: $port_env=<新端口> $0"
      return 1
    fi
    return 0
  fi

  for pid in $pids; do
    if is_our_process "$pid"; then
      log "关闭旧 $name 进程: PID $pid"
      kill "$pid" 2>/dev/null || true
    else
      log "错误: 端口 $port ($name) 被外部进程占用: PID $pid ($(ps -o comm= -p "$pid" 2>/dev/null || echo unknown))"
      log "不会擅杀外部进程，请换端口重试: $port_env=<新端口> $0"
      return 1
    fi
  done

  for ((attempt = 1; attempt <= 20; attempt += 1)); do
    pids="$(port_pids "$port")"
    if [[ -z "$pids" ]]; then
      return 0
    fi
    sleep 0.5
  done

  log "错误: 端口 $port ($name) 仍被占用: PID $pids，进程未响应 SIGTERM"
  return 1
}

cleanup_ports() {
  cleanup_port "$SERVER_PORT" "服务端" "SERVER_PORT"
  cleanup_port "$GATEWAY_PORT" "智能体平台" "GATEWAY_PORT"
  cleanup_port "$WEB_PORT" "Web" "WEB_PORT"
}

prepare_server_config() {
  mkdir -p "$SERVER_DATA_DIR"
  sed -e "s|data_dir: \"data\"|data_dir: \"$SERVER_DATA_DIR\"|" \
      -e "s|^  port: 18080|  port: $SERVER_PORT|" \
      "$SERVER_CONFIG_TEMPLATE" >"$SERVER_CONFIG_RUNTIME"
}

start_server() {
  log "编译并启动服务端"
  prepare_server_config
  (cd "$SERVER_DIR" && env PATH="$GO_BIN_DIR:$PATH" go build -o "$RUN_DIR/server-bin" ./cmd/server)
  (
    cd "$SERVER_DIR"
    # 直接 exec 编译产物，保证 server.pid 指向真实监听进程（go run 会 fork 出孤儿二进制）
    nohup bash -c "echo \$\$ > '$RUN_DIR/server.pid'; exec '$RUN_DIR/server-bin' -config '$SERVER_CONFIG_RUNTIME' -map-config map.yaml" \
      >"$RUN_DIR/server.log" 2>&1 </dev/null &
  )
  wait_for_http "http://127.0.0.1:$SERVER_PORT/health" "服务端" '"tick"'
}

start_gateway() {
  log "启动智能体平台"
  ensure_node_modules "$GATEWAY_DIR"
  (
    cd "$GATEWAY_DIR"
    nohup bash -c "echo \$\$ > '$RUN_DIR/agent-gateway.pid'; exec env SW_AGENT_GATEWAY_PORT='$GATEWAY_PORT' SW_AGENT_GATEWAY_ENV_FILE='$ROOT_DIR/.env' npm run dev" \
      >"$RUN_DIR/agent-gateway.log" 2>&1 </dev/null &
  )
  wait_for_http "http://127.0.0.1:$GATEWAY_PORT/health" "智能体平台" '"status":"ok"'
}

start_web() {
  log "启动 Web"
  ensure_node_modules "$WEB_DIR"
  (
    cd "$WEB_DIR"
    nohup bash -c "echo \$\$ > '$RUN_DIR/client-web.pid'; exec env VITE_SW_PROXY_TARGET='http://127.0.0.1:$SERVER_PORT' VITE_SW_AGENT_PROXY_TARGET='http://127.0.0.1:$GATEWAY_PORT' npm run dev -- --host 0.0.0.0 --port '$WEB_PORT'" \
      >"$RUN_DIR/client-web.log" 2>&1 </dev/null &
  )
  wait_for_http "http://127.0.0.1:$WEB_PORT/agent-api/health" "Web 代理" '"status":"ok"'
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

试玩结束后一键清理:
  $0 stop
EOF
}

cmd_start() {
  cleanup_ports
  start_server
  start_gateway
  start_web
  print_summary
}

cmd_stop() {
  cleanup_ports
  rm -f "$RUN_DIR"/*.pid
  log "试玩环境已停止"
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  -h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
