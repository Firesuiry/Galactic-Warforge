# `vertical_launching_silo` 曾只有建筑壳体没有火箭闭环

- 状态：已修复 / 已过时
- 首次记录：2026-04-03
- 来源：`docs/player/已知问题与回归.md` -> `2026-04-03 当时问题列表`
- 类别：戴森建筑 / 火箭链路 / 历史问题

## 问题描述

`vertical_launching_silo` 曾只有建筑壳体，没有真实可玩的火箭生产、装填和发射闭环。

## 复现

- 研究 `vertical_launching`
- `build 10 5 vertical_launching_silo`
- `build 11 5 vertical_launching_silo --recipe small_carrier_rocket`
- `inspect planet-1-1 building b-42`

## 当时现象

- `launch_solar_sail b-42` 返回：`only EM Rail Ejector can launch solar sails`
- `build ... --recipe small_carrier_rocket` 返回：`unknown recipe: small_carrier_rocket`
- 发射井长期 `idle/input_shortage`

## 影响

- 玩家只能造出建筑，不能进入真实火箭玩法

## 当前状态

- 后续多轮回归已验证 `transfer + launch_rocket` 可用，视为已修复的历史问题
