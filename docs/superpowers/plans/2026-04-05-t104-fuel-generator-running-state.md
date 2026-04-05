# T104 Fuel Generator Running State Implementation Plan

> **执行方式：** 用户已明确要求本轮直接实现，因此按当前工作区内联执行，不额外切分执行会话；但仍按 TDD 和逐步验证推进。

**Goal:** 按 `docs/process/design_final.md` 修复燃料型发电建筑在同一 tick 内被二次改写为 `no_power/no_fuel` 的问题，让 `artificial_star`、`thermal_power_plant`、`mini_fusion_power_plant` 的运行态、事件和查询面保持同一事实源。

**Architecture:** `settlePowerGeneration` 负责燃料型发电建筑的 authoritative 运行态；`settleResources` 不再二次用库存空值覆盖本 tick 已完成的发电结果。查询层和统计层保持读现有 runtime/snapshot，不新增持久字段或适配层。

**Tech Stack:** Go server, Go tests, Markdown docs

---

### Task 1: 先用失败测试锁住 T104 新语义

**Files:**
- Modify: `server/internal/gamecore/t099_fuel_generator_state_test.go`
- Create: `server/internal/gamecore/t104_artificial_star_stable_power_test.go`

- [ ] **Step 1: 改写旧 T099 的“最后一根燃料”预期**

```go
core.processTick()
if star.Runtime.State != model.BuildingWorkRunning { ... }
if remaining := star.Storage.OutputQuantity(model.ItemAntimatterFuelRod); remaining != 0 { ... }
if output := powerInputOutputForBuildingT099(ws, star.ID); output != 80 { ... }

core.processTick()
if star.Runtime.State != model.BuildingWorkNoPower { ... }
```

- [ ] **Step 2: 新增 T104 回归**

```go
func TestT104ArtificialStarRuntimeEventsAndQueryViewsStayConsistentAcrossFuelTicks(t *testing.T) { ... }
func TestT104FuelGeneratorsConsumeOneTickPerFuelAcrossSharedBranch(t *testing.T) { ... }
```

- [ ] **Step 3: 运行单测确认旧实现失败**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestT099ArtificialStarFallsBackToNoFuelAfterLastRodIsConsumed|TestT104' -count=1`
Expected: FAIL，表现为第 1 个发电 tick 结束后建筑已被错误打回 `no_power/no_fuel`

### Task 2: 最小实现 authoritative 运行态收口

**Files:**
- Modify: `server/internal/gamecore/rules.go`
- Modify: `server/internal/gamecore/power_generation.go`

- [ ] **Step 1: 删除 `settleResources` 对燃料发电建筑的后置库存判定**

```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) {
    if b.Runtime.State == model.BuildingWorkNoPower && b.Runtime.StateReason == stateReasonNoFuel {
        continue
    }
}
```

- [ ] **Step 2: 在 `settlePowerGeneration` 补注释**

```go
// Fuel-based generators publish their authoritative tick result here.
// Later phases must not overwrite a successful generation tick with a
// post-consumption inventory check.
```

- [ ] **Step 3: 重跑 T099/T104 直到转绿**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestT099ArtificialStarFallsBackToNoFuelAfterLastRodIsConsumed|TestT104' -count=1`
Expected: PASS

### Task 3: 同步公开文档语义

**Files:**
- Modify: `docs/player/已知问题与回归.md`
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/dev/服务端API.md`

- [ ] **Step 1: 把 T104 从当前缺口改为已修复**
- [ ] **Step 2: 明确 `artificial_star` 的燃料、逐 tick 消耗和“最后一根燃料仍支撑本 tick 发电”语义**
- [ ] **Step 3: 明确 `inspect/scene` 读 runtime，`networks/stats` 读 snapshot，但在发电 tick 内必须保持一致**

### Task 4: 自动化验证、实验与任务清理

**Files:**
- Delete: `docs/process/task/T104_戴森终局人造恒星装燃料后无法稳定供电.md`

- [ ] **Step 1: 跑 gamecore 全量自动化**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore`
Expected: PASS

- [ ] **Step 2: 做一次真实终局链路实验**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestT104' -count=1 -v`
Expected: PASS，并能从断言覆盖 `inspect`、`scene`、`building_state_changed`、`networks`、`stats`

- [ ] **Step 3: 删除已完成任务文件并复查 diff**

Run: `cd /home/firesuiry/develop/siliconWorld && git diff -- server/internal/gamecore/rules.go server/internal/gamecore/power_generation.go server/internal/gamecore/t099_fuel_generator_state_test.go server/internal/gamecore/t104_artificial_star_stable_power_test.go docs/player/已知问题与回归.md docs/player/玩法指南.md docs/dev/服务端API.md docs/process/task`
Expected: diff 仅包含 T104 范围修改与任务文件删除
