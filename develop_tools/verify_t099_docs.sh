#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLAYER_GUIDE="docs/player/玩法指南.md"
KNOWN_ISSUES="docs/player/已知问题与回归.md"
CLI_DOC="docs/dev/客户端CLI.md"
API_DOC="docs/dev/服务端API.md"
ARCHIVE_REF="docs/archive/reference/戴森球计划-服务端逻辑功能清单.md"

FILES=(
  "$PLAYER_GUIDE"
  "$KNOWN_ISSUES"
  "$CLI_DOC"
  "$API_DOC"
  "$ARCHIVE_REF"
)

require_fixed() {
  local file="$1"
  local needle="$2"
  if ! rg -Fq "$needle" "$ROOT_DIR/$file"; then
    echo "missing expected text in $file: $needle" >&2
    exit 1
  fi
}

reject_fixed() {
  local file="$1"
  local needle="$2"
  if rg -Fq "$needle" "$ROOT_DIR/$file"; then
    echo "found forbidden text in $file: $needle" >&2
    exit 1
  fi
}

require_fixed "$PLAYER_GUIDE" "当前版本的 DSP 科技树覆盖不包含这条线"
require_fixed "$PLAYER_GUIDE" "当前直接支持的单位类型只有："
require_fixed "$KNOWN_ISSUES" "终局高阶舰队线的当前版本边界已经明确"
require_fixed "$KNOWN_ISSUES" "no_power"
require_fixed "$KNOWN_ISSUES" "no_fuel"
require_fixed "$CLI_DOC" "help produce"
require_fixed "$CLI_DOC" "worker / soldier"
require_fixed "$API_DOC" "payload.unit_type"
require_fixed "$API_DOC" "worker|soldier"
require_fixed "$API_DOC" "no_power/no_fuel"
require_fixed "$ARCHIVE_REF" "终局高阶舰队线仍处于隐藏状态"

for file in "${FILES[@]}"; do
  reject_fixed "$file" "已全部实现"
  reject_fixed "$file" "全部实现"
  reject_fixed "$file" "科技树完整覆盖"
  reject_fixed "$file" "终局玩法已全部覆盖"
done

echo "T099 docs verification passed."
