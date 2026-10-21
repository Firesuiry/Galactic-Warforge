#!/usr/bin/env bash
# 把重试代理装成 systemd 用户服务（开机自启、挂了 1 秒内拉起）。可重复执行。
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
NODE=${NODE:-$(readlink -f "$(command -v node)")}
PORT=${PORT:-18990}
UNIT=~/.config/systemd/user/api-retry-proxy.service

mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<EOF
[Unit]
Description=Claude Code API retry proxy (127.0.0.1:$PORT -> tako)

[Service]
ExecStart=$NODE $DIR/proxy.mjs
Environment=PORT=$PORT
Restart=always
RestartSec=1

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now api-retry-proxy
systemctl --user restart api-retry-proxy
sleep 1
systemctl --user --no-pager status api-retry-proxy | head -5
