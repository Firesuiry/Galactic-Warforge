#!/usr/bin/env bash
# 赛后一键管线：battle.jsonl → battle.json → 高光清单 → （解说词已就位后）渲染成片
set -euo pipefail

RECORD="${1:-/home/firesuiry/develop/siliconWorld/.run/war-match/battle.jsonl}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== 1/3 提取时间轴 =="
python3 "${ROOT}/scripts/extract_battle.py" "${RECORD}" -o "${ROOT}/src/data/battle.json"

echo "== 2/3 高光时刻 =="
python3 "${ROOT}/scripts/find_highlights.py" "${ROOT}/src/data/battle.json"

echo "== 3/3 渲染 =="
cd "${ROOT}"
npm run render:war
