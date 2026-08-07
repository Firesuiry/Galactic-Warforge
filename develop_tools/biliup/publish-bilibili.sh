#!/usr/bin/env bash
# 一键发布试玩介绍视频到 B 站
# 用法: bash develop_tools/biliup/publish-bilibili.sh
# 第一步会打开扫码登录（手机 B 站 App 扫一扫确认），登录信息保存到 cookies.json，之后投稿全自动。
set -euo pipefail
cd "$(dirname "$0")"
BILIUP=./biliupR-v0.2.4-x86_64-linux/biliup
VIDEO=../../siliconworld-试玩介绍.mp4
COOKIE=cookies.json

if [ ! -f "$COOKIE" ]; then
  echo "== 首次使用，请扫码登录 B 站 =="
  $BILIUP -u "$COOKIE" login
fi

$BILIUP -u "$COOKIE" upload "$VIDEO" \
  --title "【硅基世界 SiliconWorld】真实试玩：从荒星基站到工业前哨" \
  --desc "真实游玩录制，非 CG。开局只有一座分析基站：勘察矿带、拍下风机、矿机上矿、熔炉点火、传送带贯通全厂；铁矿炼磁铁、铜矿出电路板，自产电磁矩阵点亮科技树——电磁学、物流、冶金、武器逐一突破，高斯炮塔守卫基地，工程与作战单位量产下线。命令下达，世界运转。" \
  --tag "硅基世界,工厂建造,自动化,戴森球计划,独立游戏,策略游戏,游戏试玩" \
  --tid 171 \
  --copyright 1 \
  --no-reprint 1

echo "投稿完成"
