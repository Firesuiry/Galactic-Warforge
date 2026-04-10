# 太阳帆批量发射曾出现 `entity_id` 冲突

- 状态：已收口 / 2026-04-04 深夜未再复现
- 首次记录：2026-04-04
- 来源：`docs/player/已知问题与回归.md` -> `2026-04-04 深夜追加复测`
- 类别：戴森运行态 / 实体生成 / 历史问题

## 问题描述

太阳帆批量发射曾出现同批次 `entity_created` 事件中的 `entity_id` 冲突问题。

## 当前复核口径

在 `2026-04-04` 深夜追加复测中：

- `transfer b-39 solar_sail 4`
- `launch_solar_sail b-39 --count 4 --orbit-radius 1.2`

已确认：

- 同一批次的 4 条 `entity_created` 会携带 4 个不同的 `entity_id`
- 太阳帆已迁入 snapshot-backed 的 `space` runtime
- replay / rollback digest 已覆盖太阳帆计数、system 数和总能量

## 影响

- 该问题如果存在，会破坏太阳帆实体追踪、回放和运行态一致性

## 当前状态

- 本轮未再复现，视为已收口的历史问题
