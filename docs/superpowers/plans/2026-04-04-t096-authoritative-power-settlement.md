# T096 Authoritative Power Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `ray_receiver power` 的发电收益收敛到同一份 authoritative tick 结算结果，并让 `summary`、`stats`、`networks`、`inspect` 同步读取同源事实。

**Architecture:** 在 `WorldState` 上增加运行时 `PowerSettlementSnapshot`，发电阶段仅收集 `PowerInput` 与接收站观测结果，随后由统一的 `finalizePowerSettlement()` 完成储能参与、网络聚合、供电分配、玩家能量提交与事件发布。查询层和统计层优先读取 snapshot，不再各自重算出不同口径。

**Tech Stack:** Go 1.25、现有 `model.ResolvePowerCoverage/Networks/Allocations` 聚合算法、`go test`

---

### Task 1: 锁定失败行为与回归口径

**Files:**
- Modify: `server/internal/gamecore/ray_receiver_settlement_test.go`
- Modify: `server/internal/gamecore/power_shortage_test.go`
- Create: `server/internal/gamecore/t096_power_snapshot_test.go`
- Create: `server/internal/gamecore/t096_ray_receiver_midgame_test.go`
- Modify: `server/internal/query/query_test.go`

- [ ] **Step 1: 为 direct energy writes 增加失败测试**

目标：
- `settlePowerGeneration()` 只写 `ws.PowerInputs`
- `settleRayReceivers()` 只写 `ws.PowerInputs` 与 photon 库存，不直接改 `player.Resources.Energy`
- `settleResources()` 不再因为建筑遍历顺序直接扣减/回写能量

- [ ] **Step 2: 为 inspect / networks / stats 增加 snapshot 口径测试**

目标：
- `query.PlanetNetworks()` 在 snapshot 存在时读 snapshot
- `query.PlanetInspect()` 暴露 `power.network_id / settled_tick / power_output / photon_output`
- `buildPlayerEnergyStats()` 在 snapshot 存在时读 snapshot 玩家视图

- [ ] **Step 3: 增加官方 midgame 风格失败回归**

目标：
- 按 `docs/process/design_final.md` 中的 midgame 链路构造接收站、电网、太阳帆、火箭、模式切换
- 断言 `inspect.power_output > 0`
- 断言 `photon_output == 0`
- 断言 `summary.energy`、`stats.generation`、`networks.supply` 同步抬高
- 断言同一 tick 内 energy-changing `resource_changed` 对玩家最多 1 条

- [ ] **Step 4: 运行这些测试，确认先失败**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gamecore ./internal/query -run 'T096|SettleRayReceivers|PowerShortage|PlanetInspect|PlanetNetworks'`
Expected: 失败，且失败原因与 T096 缺失的 snapshot / direct writes 行为一致。

### Task 2: 建立 authoritative snapshot builder

**Files:**
- Create: `server/internal/model/power_settlement.go`
- Modify: `server/internal/model/world.go`
- Modify: `server/internal/model/power_grid_coverage.go`

- [ ] **Step 1: 增加 snapshot 运行时结构**

目标：
- `PowerSettlementSnapshot`
- `PlayerPowerSnapshot`
- `RayReceiverSettlementView`
- builder 输出结构应包含 `Coverage`、`Networks`、`Allocations`、`Players`、`Receivers`

- [ ] **Step 2: 在 `WorldState` 上挂接 transient `PowerSnapshot`**

目标：
- `json:"-"`，不进入持久化
- 每 tick 在统一提交阶段覆盖

- [ ] **Step 3: 让 coverage 结果具备 network 语义**

目标：
- `PowerCoverageResult` 增加 `NetworkID`
- builder 与 query 可直接复用，不在 query 层再拼第二套事实

### Task 3: 接入统一电力提交流程

**Files:**
- Modify: `server/internal/gamecore/power_generation.go`
- Modify: `server/internal/gamecore/ray_receiver_settlement.go`
- Modify: `server/internal/gamecore/energy_storage_settlement.go`
- Modify: `server/internal/gamecore/core.go`
- Modify: `server/internal/gamecore/rules.go`

- [ ] **Step 1: 移除阶段内直接提交能量/事件**

目标：
- `settlePowerGeneration()` 删除 `generatedByPlayer`、直接改玩家能量、直接发 `EvtResourceChanged`
- `settleRayReceivers()` 改为返回 `RayReceiverSettlementView` 列表，保留 photon 入库，不再直接改玩家能量或发事件

- [ ] **Step 2: 实现 `finalizePowerSettlement()`**

目标：
- 执行 `settleEnergyStorage(ws)`
- 通过现有聚合算法生成 authoritative snapshot
- 一次性提交玩家能量
- 同一玩家同一 tick 最多发 1 条 energy-changing `EvtResourceChanged`
- 回填接收站 `network_id`

- [ ] **Step 3: 改写 `settleResources()` 为只消费 allocation**

目标：
- 通电判定改读 snapshot 或同源 builder 结果
- 删除对 `player.Resources.Energy` 的逐建筑扣写与回加
- 保留建筑状态、生产降额、维护费、资源采集

- [ ] **Step 4: 把 `core.processTick()` 接到统一流程**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gamecore -run 'T096|SettleRayReceivers|PowerShortage'`
Expected: 相关测试转绿，若仍失败则说明 snapshot builder 或统一提交尚不完整。

### Task 4: 对齐 stats / query / replay 读取口径

**Files:**
- Modify: `server/internal/gamecore/stats_settlement.go`
- Modify: `server/internal/query/networks.go`
- Modify: `server/internal/query/planet_inspector.go`
- Modify: `server/internal/query/query.go`
- Modify: `server/internal/gamecore/replay.go`
- Modify: `server/internal/gamecore/rollback.go`

- [ ] **Step 1: stats 优先读 snapshot**

目标：
- `buildPlayerEnergyStats()` 优先读 `ws.PowerSnapshot.Players[playerID]`
- snapshot 缺失时只允许调用同源 builder fallback

- [ ] **Step 2: networks / inspect 优先读 snapshot**

目标：
- `PlanetNetworks()` 优先用 snapshot 的 `Coverage / Networks / Allocations`
- `PlanetInspect()` 新增 `Power` 视图，数据源为 `ws.PowerSnapshot.Receivers`

- [ ] **Step 3: 让 replay / rollback 保持 tick 结算顺序一致**

目标：
- 与主循环一致地执行 `settlePowerGeneration -> settleSolarSails -> settleDysonSpheres -> settleRayReceivers -> settlePlanetaryShields -> finalizePowerSettlement -> settleResources`

### Task 5: 验证、文档与任务清理

**Files:**
- Modify: `docs/dev/服务端API.md`（若 API 观测字段有变化）
- Modify: `docs/player/玩法指南.md`（若玩家观察口径有变化）
- Move/Delete: `docs/process/task/T096_官方midgame下戴森接收站power模式实战不回灌最终电网.md`

- [ ] **Step 1: 跑完整相关测试**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model ./internal/query ./internal/gamecore`
Expected: 所有相关测试通过。

- [ ] **Step 2: 更新文档**

目标：
- 若 `inspect` 新增 `power` 观测字段，则同步服务端 API 文档
- 若玩家验证步骤或口径变化，则同步玩法文档

- [ ] **Step 3: 清理已完成任务文件**

目标：
- 将 `docs/process/task` 下已完成的 T096 文件移出，保持任务目录只保留未完成项
