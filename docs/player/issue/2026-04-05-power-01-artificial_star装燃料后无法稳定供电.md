# `artificial_star` 装燃料后曾无法稳定供电

- 状态：已修复（见 T104）
- 首次记录：2026-04-05
- 来源：`docs/player/已知问题与回归.md` -> `2026-04-05 戴森终局补测`
- 类别：电力 / 终局建筑 / 运行态

## 问题描述

`artificial_star` 曾存在“能建、能装燃料，但无法形成稳定可观察供电闭环”的问题。

## 复现步骤

1. 在终局派生验证局执行：
   - `build 2 1 wind_turbine`
   - `build 3 1 wind_turbine`
   - `build 4 1 artificial_star`
   - `transfer b-12 antimatter_fuel_rod 1`
2. 再对照执行：`transfer b-12 antimatter_fuel_rod 3`

## 实际现象

- 装 1 根燃料棒后，会先进入 `running`，随后立刻回到 `no_power / no_fuel`
- 装 3 根燃料棒后，也会在极短 tick 内再次回到 `no_power / no_fuel`
- 同期 `generation` 没有体现理论上的稳定 `+80` 收益

## 影响

- 终局人造恒星一度难以形成可观察、可验证的真实供电闭环

## 当前状态

- 已由 T104 修复
- 当前口径：只要该 tick 实际完成发电，tick 结束时仍显示 `running`；无新燃料时下一 tick 才回到 `no_power / no_fuel`

## 证据

- 完成记录：`docs/process/finished_task/T104_...`（见原始回归记录的 T104 描述）
