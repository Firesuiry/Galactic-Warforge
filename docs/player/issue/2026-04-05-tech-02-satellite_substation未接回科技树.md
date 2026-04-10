# `satellite_substation` 曾未正确接回科技树

- 状态：已修复（见 T103 收口）
- 首次记录：2026-04-05
- 来源：`docs/player/已知问题与回归.md` -> `2026-04-05 戴森深度试玩补测 → 本轮问题收口结果`
- 类别：科技树 / 建筑解锁

## 问题描述

`satellite_substation` 曾没有正确挂回公开科技树，导致玩家无法从科技树理解它的真实解锁路径。

## 收口后口径

- `satellite_power` 现在公开解锁 `satellite_substation`
- `/catalog.buildings[].unlock_tech` authoritative 返回 `['satellite_power']`

## 影响

- 修复前玩家和前端会误判其为孤立建筑或隐藏能力

## 证据

- 该问题在 `2026-04-05 戴森深度试玩补测` 中作为“问题收口结果”记录
