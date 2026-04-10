# 无舰队时 `fleet_status` 在 CLI 中崩溃

- 状态：已修复（见 T105）
- 首次记录：2026-04-05
- 来源：`docs/player/已知问题与回归.md` -> `2026-04-05 戴森深度试玩终测`
- 类别：CLI / 舰队查询 / 空状态处理

## 问题描述

当玩家还没有任何舰队时，CLI 执行 `fleet_status` 会直接抛异常，而不是返回空状态。

## 复现步骤

1. 登录 `p1`
2. 保持“尚未创建任何舰队”的状态
3. 执行 `fleet_status`

## 实际现象

- CLI 报错：`TypeError: Cannot read properties of null (reading 'length')`
- 服务端 `GET /world/fleets` 返回 `null`，而不是更稳定的 `[]`

## 影响

- 玩家无法在终局舰队线初始态安全查询舰队状态
- 容易误判为 CLI 或舰队系统未实现

## 临时绕过

- 无稳定绕过

## 证据

- 完成记录：`docs/process/finished_task/T105_无舰队时fleet_status崩溃与world_fleets空值口径.md`
