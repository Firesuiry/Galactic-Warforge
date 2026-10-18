#!/usr/bin/env bash
# 一键试玩环境：在任意 worktree 里起「服务端 + vite preview + 常驻 Playwright 驱动」。
#
# 端口规则（基数 N，必须显式给出，避免多个 worktree 互相踩端口）：
#   服务端   N*100 + 0     例如 N=205 → 20500
#   Web      N*100 + 1     例如 N=205 → 20501
#   驱动     N*100 + 2     例如 N=205 → 20502
#
# 用法：
#   scripts/playtest-up.sh 205 [--config server/config-skirmish.yaml] [--map-config server/map-skirmish.yaml]
#                              [--tick-rate 4] [--checkpoint cp-base]
#   scripts/playtest-down.sh 205
#
# --checkpoint 给了存档名时，起服务前会按当前 worktree 的 Go 版本常量检查该存档；
# 缺失或版本不符（旧 worktree 留下的 .run/checkpoints）会自动跑 checkpointbuild
# 重建该层（含父链），失败则报错退出，不会静默起空局。
#
# 详见 docs/guide/试玩速查.md。
set -euo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# awk 命中第一行就 exit，会提前关掉管道让 git 收到 SIGPIPE；在 `set -o pipefail`
# 下这一步会返回 141，再被 `set -e` 当成启动失败（整脚本静默退出，什么都没打印）。
# `|| true` 把这个「假失败」吃掉，只保留取到的路径。
MAIN_REPO="$(git -C "$WORKTREE" worktree list --porcelain | awk '/^worktree /{print $2; exit}' || true)"
GO_BIN_DIR="${GO_BIN_DIR:-/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin}"
export PATH="$GO_BIN_DIR:$PATH"

usage() {
  sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

[[ $# -ge 1 ]] || usage
N="$1"; shift
[[ "$N" =~ ^[0-9]+$ ]] || { echo "基数 N 必须是整数（例如 205）" >&2; exit 1; }

CONFIG="server/config-skirmish.yaml"
MAP_CONFIG="server/map-skirmish.yaml"
TICK_RATE=4
CHECKPOINT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --map-config) MAP_CONFIG="$2"; shift 2 ;;
    --tick-rate) TICK_RATE="$2"; shift 2 ;;
    --checkpoint) CHECKPOINT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1" >&2; usage ;;
  esac
done

SERVER_PORT=$((N * 100))
WEB_PORT=$((N * 100 + 1))
DRIVER_PORT=$((N * 100 + 2))
RUN_DIR="/tmp/sw-play-$N"
# 存档点目录：默认取**当前 worktree** 的 .run/checkpoints（`checkpointbuild` 就写在这里），
# 没有才退回主仓库那份。试玩 1016 报告 §0：默认指向主仓库时，worktree 里重建的
# cp-logistics 读不到、cp-base 还是缺 rotation 的旧档，跑出来的现象全是假象。
# 显式 SW_CHECKPOINT_DIR 永远优先。
if [[ -n "${SW_CHECKPOINT_DIR:-}" ]]; then
  CHECKPOINT_DIR="$SW_CHECKPOINT_DIR"
  CHECKPOINT_SOURCE="SW_CHECKPOINT_DIR"
elif [[ -d "$WORKTREE/.run/checkpoints" ]]; then
  CHECKPOINT_DIR="$WORKTREE/.run/checkpoints"
  CHECKPOINT_SOURCE="当前 worktree"
else
  CHECKPOINT_DIR="$MAIN_REPO/.run/checkpoints"
  CHECKPOINT_SOURCE="主仓库（本 worktree 没有 .run/checkpoints）"
fi
SERVER_CONFIG="$RUN_DIR/server-config.yaml"
PIDS_FILE="$RUN_DIR/pids"

log() { printf '[playtest-up] %s\n' "$*"; }

# ---- 前置检查：端口空闲（避免和别的 worktree / 已在跑的环境撞车）----
for port in "$SERVER_PORT" "$WEB_PORT" "$DRIVER_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "端口 $port 已被占用；换一个基数 N 再试（端口规则见脚本头注释）" >&2
    exit 1
  fi
done

mkdir -p "$RUN_DIR/data" "$RUN_DIR/pt" "$CHECKPOINT_DIR"
: >"$PIDS_FILE"

# ---- node_modules：worktree 里缺就建软链到主仓库 ----
# 根 node_modules 不能整体软链：@gw/shared 必须指向**本 worktree** 的 shared-client，
# 否则改 shared-client 不生效。做法：建真目录，逐个软链主仓库的包，再单独覆盖 @gw/shared。
link_node_modules() {
  local pkg_dir="$1"
  local target="$WORKTREE/$pkg_dir/node_modules"
  local source="$MAIN_REPO/$pkg_dir/node_modules"
  [[ -e "$target" ]] && return 0
  [[ -d "$source" ]] || { log "跳过 $pkg_dir/node_modules（主仓库也没有）"; return 0; }

  if [[ "$pkg_dir" == "." ]]; then
    mkdir -p "$target"
    for entry in "$source"/*; do
      local name; name="$(basename "$entry")"
      [[ "$name" == "@gw" ]] && continue
      ln -sfn "$entry" "$target/$name"
    done
    mkdir -p "$target/@gw"
    ln -sfn "$WORKTREE/shared-client" "$target/@gw/shared"
  else
    ln -sfn "$source" "$target"
  fi
  log "软链 $pkg_dir/node_modules → 主仓库"
}

for pkg in "." client-web client-cli agent-gateway; do
  link_node_modules "$pkg"
done

# ---- 服务端 ----
log "编译服务端二进制"
(
  cd "$WORKTREE/server"
  go build -o "$RUN_DIR/server-bin" ./cmd/server
)

# ---- 存档版本检查 / 自动重建 ----
# 旧存档（如别的 worktree 留下的 .run/checkpoints）会被新二进制以「存档版本不受支持」
# 拒绝读档，以前每个代理各自排查、手动跑 checkpointbuild。这里在起服务前按当前
# worktree 的 Go 常量（gamedir.CurrentFormatVersion / snapshot.CurrentVersion）
# 判断 --checkpoint 能否读；缺失/版本不符就自动重建该层（含父链），失败则报错退出，
# 不静默起一个空局。
checkpoint_status() {
  node "$WORKTREE/scripts/checkpoint-version.mjs" "$CHECKPOINT_DIR" "$1" 2>&1 || true
}

ensure_checkpoint() {
  local name="$1" status
  status="$(checkpoint_status "$name")"
  if [[ "$status" == OK* ]]; then
    log "存档 $name 可读（$status）"
    return 0
  fi
  case "$status" in
    MISSING*) log "存档 $name 缺失，自动重建中…" ;;
    MISMATCH*) log "存档 $name 版本不符（${status#MISMATCH }），自动重建中…" ;;
    *)
      echo "[playtest-up] 错误：存档 $name 无法解析：$status" >&2
      echo "  删除 $CHECKPOINT_DIR/$name 后重跑，或手动：cd server && go run ./cmd/checkpointbuild -root .. -layer $name" >&2
      exit 1
      ;;
  esac
  [[ -f "$WORKTREE/docs/guide/checkpoints/$name.json" ]] || {
    echo "[playtest-up] 错误：没有构建记录 docs/guide/checkpoints/$name.json，无法重建 $name" >&2
    exit 1
  }
  local started=$SECONDS
  log "  重建命令：go run ./cmd/checkpointbuild -root .. -checkpoint-dir $CHECKPOINT_DIR -layer $name"
  if ! (cd "$WORKTREE/server" && go run ./cmd/checkpointbuild \
        -root "$WORKTREE" -checkpoint-dir "$CHECKPOINT_DIR" -layer "$name"); then
    echo "[playtest-up] 错误：存档 $name 自动重建失败（见上方 checkpointbuild 输出），环境未启动" >&2
    exit 1
  fi
  status="$(checkpoint_status "$name")"
  if [[ "$status" != OK* ]]; then
    echo "[playtest-up] 错误：重建后存档 $name 仍不可读：$status" >&2
    exit 1
  fi
  log "  存档 $name 重建完成（$((SECONDS - started)) 秒，$status）"
}

if [[ -n "$CHECKPOINT" ]]; then
  ensure_checkpoint "$CHECKPOINT"
fi

log "生成临时配置 $SERVER_CONFIG"
sed -e "s|^  port: .*|  port: $SERVER_PORT|" \
    -e "s|^  data_dir: .*|  data_dir: \"$RUN_DIR/data\"|" \
    -e "s|^  checkpoint_dir: .*|  checkpoint_dir: \"$CHECKPOINT_DIR\"|" \
    -e "s|^  tick_rate_override: .*|  tick_rate_override: $TICK_RATE|" \
    "$WORKTREE/$CONFIG" >"$SERVER_CONFIG"
# 配置里原本没有 tick_rate_override 时补一行（放在 server 段末尾之前）
if ! grep -q '^  tick_rate_override:' "$SERVER_CONFIG"; then
  printf '\n  tick_rate_override: %s\n' "$TICK_RATE" >>"$SERVER_CONFIG"
fi

# 试玩一律整局保留审计/命令日志：checkpointbuild -export 靠它导出「可执行构建
# 记录」，默认的「跟快照保留窗口一起裁」（遭遇战 6000 tick）会把开局建造段裁掉
# （试玩 1016 报告 B3）。审计条目很小（一条命令一行），整局几万 tick 也就几 MB。
# 插在 `server:` 之后（同缩进即同一 mapping），不依赖 server 段是不是文件末段。
log "审计日志保留窗口：整局全留（audit_retention_ticks: 0）"
if grep -q '^  audit_retention_ticks:' "$SERVER_CONFIG"; then
  sed -i 's|^  audit_retention_ticks:.*|  audit_retention_ticks: 0|' "$SERVER_CONFIG"
else
  sed -i '0,/^server:/{s|^server:|server:\n  audit_retention_ticks: 0|}' "$SERVER_CONFIG"
fi

log "启动服务端 (:$SERVER_PORT)"
setsid --fork nohup bash -c "echo \$\$ > '$RUN_DIR/server.pid'; cd '$WORKTREE/server'; exec '$RUN_DIR/server-bin' -config '$SERVER_CONFIG' -map-config '$WORKTREE/$MAP_CONFIG'" \
  >"$RUN_DIR/server.log" 2>&1 </dev/null

# ---- client-web：生产构建 + vite preview ----
# VITE_E2E=1 是**构建期**开关：生产构建默认把浏览器测试钩子（window.__planetThree /
# __systemThree）连同 `?e2e=1` 判断一起编译掉，正式产物里 grep 不到 `e2e`。
# 试玩驱动要读这两个句柄，所以这里显式打开；不要把它加进 npm run build。
log "构建 client-web（vite build → $RUN_DIR/web-dist，VITE_E2E=1 暴露测试钩子）"
(
  cd "$WORKTREE/client-web"
  VITE_E2E=1 npx vite build --outDir "$RUN_DIR/web-dist" --emptyOutDir >"$RUN_DIR/vite-build.log" 2>&1
)

log "启动 vite preview (:$WEB_PORT)"
setsid --fork nohup bash -c "echo \$\$ > '$RUN_DIR/web.pid'; cd '$WORKTREE/client-web'; exec env VITE_SW_PROXY_TARGET='http://127.0.0.1:$SERVER_PORT' npx vite preview --outDir '$RUN_DIR/web-dist' --port '$WEB_PORT' --strictPort --host 127.0.0.1" \
  >"$RUN_DIR/web.log" 2>&1 </dev/null

# ---- 常驻 Playwright 驱动（真实显卡 ANGLE Vulkan，保持既有设置）----
log "启动试玩驱动 (:$DRIVER_PORT)"
setsid --fork nohup bash -c "echo \$\$ > '$RUN_DIR/driver.pid'; cd '$WORKTREE/develop_tools/playtest-driver'; exec env PT_OUT='$RUN_DIR/pt' P1V_WEB='http://127.0.0.1:$WEB_PORT' P1V_SERVER='http://127.0.0.1:$SERVER_PORT' DRIVER_PORT='$DRIVER_PORT' GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib node driver.mjs" \
  >"$RUN_DIR/driver.log" 2>&1 </dev/null

# ---- 等健康检查 ----
wait_http() {
  local url="$1" name="$2" needle="$3"
  for _ in $(seq 1 90); do
    if curl -fsS "$url" 2>/dev/null | grep -qF "$needle"; then log "$name 就绪"; return 0; fi
    sleep 1
  done
  log "错误：$name 未就绪（$url），日志见 $RUN_DIR"
  return 1
}
wait_http "http://127.0.0.1:$SERVER_PORT/health" "服务端" '"tick"'
wait_http "http://127.0.0.1:$WEB_PORT/lobby" "Web" '<div id="root">'
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$DRIVER_PORT") 2>/dev/null; then log "驱动就绪"; break; fi
  sleep 1
done

# ---- 记录 PID（down 脚本按 PID 精确 kill）----
for name in server web driver; do
  pid="$(cat "$RUN_DIR/$name.pid" 2>/dev/null || true)"
  [[ -n "$pid" ]] && printf '%s %s\n' "$name" "$pid" >>"$PIDS_FILE"
done

# ---- 可选：读档 ----
load_checkpoint() {
  curl -fsS -X POST -H 'Authorization: Bearer key_player_1' \
    "http://127.0.0.1:$SERVER_PORT/checkpoints/$CHECKPOINT/load" >/dev/null
}
if [[ -n "$CHECKPOINT" ]]; then
  log "读档 $CHECKPOINT"
  if ! load_checkpoint; then
    # 预检漏掉的情况（例如起服务期间存档被别的进程改写）：再按版本检查重建一次，仍失败就退出，
    # 不静默留一个空局让后续测试读到假象。
    log "读档失败，重新检查/重建存档 $CHECKPOINT"
    ensure_checkpoint "$CHECKPOINT"
    if ! load_checkpoint; then
      echo "[playtest-up] 错误：读档 $CHECKPOINT 失败，环境停在空局（服务端仍运行，可用 playtest-down.sh $N 停掉）" >&2
      exit 1
    fi
  fi
fi

cat <<EOF
[playtest-up] 环境就绪 N=$N
  web:     http://127.0.0.1:$WEB_PORT/login?e2e=1   （行星页 http://127.0.0.1:$WEB_PORT/planet/planet-1-1?quality=low&e2e=1）
  server:  http://127.0.0.1:$SERVER_PORT            tick_rate_override=$TICK_RATE
  driver:  http://127.0.0.1:$DRIVER_PORT            （curl -s localhost:$DRIVER_PORT --data-binary @snippet.js）
  账号:    p1 / key_player_1（admin）  p2 / key_player_2
  存档点:  $CHECKPOINT_DIR   （来源：$CHECKPOINT_SOURCE）
  日志:    $RUN_DIR/{server,web,driver}.log  驱动输出: $RUN_DIR/pt/
  停止:    scripts/playtest-down.sh $N
EOF
