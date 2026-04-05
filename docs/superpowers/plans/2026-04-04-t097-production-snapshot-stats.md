# T097 Production Snapshot Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `production_stats` 的事实来源从静态产能切换为当前 tick 的真实落库产物快照，并完成回归验证、文档同步与任务清理。

**Architecture:** 在 `WorldState` 上挂一份仅对当前 tick 生效的 `ProductionSettlementSnapshot`。`settleProduction` 在真实写库时同步写入快照和事件；`updateProductionStats` 仅消费快照与现有 `ProductionMonitor` 效率采样，不再从建筑静态 `Throughput` 推导产出。

**Tech Stack:** Go 1.25、现有 `server/internal/model` / `server/internal/gamecore` / `docs/dev` 文档体系、`client-cli` 与 `client-web` 现有验证链路。

---

### Task 1: 写出失败的生产统计回归测试

**Files:**
- Create: `server/internal/gamecore/stats_settlement_test.go`
- Create: `server/internal/gamecore/t097_midgame_stats_test.go`

- [ ] 覆盖无配方、缺料、默认挂配方但未出货的建筑不应贡献 `total_output` / `by_building_type` / `by_item`
- [ ] 覆盖真实产出与副产物产出都会同步增长三组统计字段
- [ ] 覆盖官方 midgame 中 `recomposing_assembler`、`self_evolution_lab`、`vertical_launching_silo` 的空转复现场景
- [ ] 先运行新增测试，确认当前实现按预期失败

### Task 2: 引入 authoritative 生产结算快照

**Files:**
- Create: `server/internal/model/production_settlement_snapshot.go`
- Modify: `server/internal/model/world.go`
- Modify: `server/internal/gamecore/production_settlement.go`

- [ ] 定义 `ProductionSettlementSnapshot`、玩家聚合视图、当前 tick helper 与聚合记录方法
- [ ] 在 `WorldState` 上挂 `ProductionSnapshot`
- [ ] 在 `settleProduction` 开始时初始化快照
- [ ] 仅在产物真实落库时，用同一份 `combinedOutputs` 同步写快照与 `EvtResourceChanged`

### Task 3: 切换 stats 读取路径

**Files:**
- Modify: `server/internal/gamecore/stats_settlement.go`

- [ ] 每 tick 显式清空 `TotalOutput` / `ByBuildingType` / `ByItem` / `Efficiency`
- [ ] 从 `CurrentProductionSettlementSnapshot(gc.world)` 读取当前玩家的真实产出聚合
- [ ] 保留 `Efficiency` 使用现有 `ProductionMonitor` 采样均值

### Task 4: 同步文档与任务流转

**Files:**
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/dev/客户端CLI.md`
- Move/Delete: `docs/process/task/T097_戴森深度试玩中生产统计误将空转建筑计入总产出.md`

- [ ] 把 `production_stats` 语义更新为“当前 active world、当前 tick、真实落库产物数量”
- [ ] 如果 `stats` 命令说明仍沿用旧口径，一并修正
- [ ] 将已完成的 T097 任务文件从 `docs/process/task` 清走并归档

### Task 5: 完整验证

**Files:**
- Verify: `server/internal/gamecore/...`
- Verify: `client-cli`
- Verify: `client-web`

- [ ] 运行新增与相关服务端测试，确认绿灯
- [ ] 使用 CLI 查询 `stats` 做最小人工验证
- [ ] 启动 `client-web` 并通过浏览器自动化检查页面可正常展示，不因统计口径修复而报错
