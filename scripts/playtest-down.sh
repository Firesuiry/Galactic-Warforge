#!/usr/bin/env bash
# 停止 scripts/playtest-up.sh 起的环境：按 /tmp/sw-play-$N/pids 里的 PID 精确 kill
# （用进程组 SIGTERM，再 SIGKILL 兜底），不做 pkill -f 宽匹配。
#
# 用法：scripts/playtest-down.sh 205
set -euo pipefail

[[ $# -ge 1 ]] || { echo "用法: $0 <基数 N>" >&2; exit 1; }
N="$1"
RUN_DIR="/tmp/sw-play-$N"
PIDS_FILE="$RUN_DIR/pids"

log() { printf '[playtest-down] %s\n' "$*"; }

if [[ ! -f "$PIDS_FILE" ]]; then
  log "没有 $PIDS_FILE（该环境未启动或已停止）"
  exit 0
fi

kill_pid() {
  local name="$1" pid="$2"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$pid" 2>/dev/null || { log "$name (PID $pid) 已退出"; return 0; }
  log "停止 $name (PID $pid)"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  log "$name 未响应 SIGTERM，改用 SIGKILL"
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

# 先杀驱动（关掉浏览器），再杀 web，最后服务端
for name in driver web server; do
  pid="$(awk -v n="$name" '$1==n{print $2}' "$PIDS_FILE" | tail -1)"
  [[ -n "${pid:-}" ]] && kill_pid "$name" "$pid"
done

rm -f "$PIDS_FILE" "$RUN_DIR"/*.pid
log "环境 N=$N 已停止（日志与产物保留在 $RUN_DIR）"
