#!/usr/bin/env bash
# 切换 tako 内置 provider 的地址：on = 走本地重试代理，off = 直连网关，无参数 = 看当前状态。
# 改的是 ~/.tako/config.json（先备份），下次 `tako --claude` 启动生效；codex 不受影响（tako 给 codex 用的是常量地址）。
set -euo pipefail
CFG=~/.tako/config.json
PROXY=http://127.0.0.1:${PORT:-18990}
DIRECT=https://tako.shiroha.tech

case "${1:-status}" in
  on) target=$PROXY ;;
  off) target=$DIRECT ;;
  status)
    python3 -c 'import json,sys;[print(p["name"],p["type"],p["baseUrl"]) for p in json.load(open(sys.argv[1]))["providers"]]' "$CFG"
    latest=$(ls -t ~/.tako/claude-code/launch-settings/*.json 2>/dev/null | head -1)
    [ -n "$latest" ] && echo "最近一次启动用的 ANTHROPIC_BASE_URL: $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["env"].get("ANTHROPIC_BASE_URL"))' "$latest")"
    exit 0 ;;
  *) echo "用法: $0 [on|off|status]" >&2; exit 2 ;;
esac

if [ "$target" = "$PROXY" ] && ! curl -s -o /dev/null --max-time 3 "$PROXY/"; then
  echo "代理 $PROXY 没在跑，先执行 install.sh" >&2; exit 1
fi
cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
python3 - "$CFG" "$target" <<'EOF'
import json, os, sys
path, target = sys.argv[1], sys.argv[2]
cfg = json.load(open(path))
n = 0
for p in cfg["providers"]:
    if p.get("type") == "tako":
        p["baseUrl"] = target; n += 1
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
os.replace(tmp, path)
print(f"已把 {n} 个 tako provider 的 baseUrl 改为 {target}，重启 tako --claude 后生效")
EOF
