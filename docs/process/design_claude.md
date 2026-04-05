# T104 设计方案：修复 artificial_star 装燃料后无法稳定供电

## 1. 问题根因分析

### 1.1 Tick 内双重燃料检查导致"装入即吞空"

每个 tick 的执行顺序（`core.go:597-606`）：

```
settlePowerGeneration(ws, env)   ← 第一次燃料检查 + 消耗
finalizePowerSettlement(ws, ...)
settleResources(ws)              ← 第二次燃料检查（此时燃料已被消耗完）
```

**第一次**：`settlePowerGeneration`（`power_generation.go:47-63`）
- 检查 `fuelBasedGeneratorHasReachableFuel` → 有燃料 → 设为 `running`
- 调用 `ResolvePowerGeneration` → `consumeFuel` 从 `InputBuffer` / `Inventory` 中扣除燃料
- 燃料被实际消耗

**第二次**：`settleResources`（`rules.go:984-989`）
- 再次调用 `fuelBasedGeneratorHasReachableFuel` 检查燃料
- 此时燃料已在第一步被消耗完 → 返回 `false`
- 将建筑状态设为 `no_power / no_fuel`
- `continue` 跳过后续资源结算

**结果**：每根 `antimatter_fuel_rod`（`ConsumePerTick: 1`）在同一 tick 内被消耗后立即触发无燃料判定，建筑只能维持极短暂的 `running` 状态。3 根燃料棒在 3 个 tick 内全部消耗完，但每个 tick 末尾都被重置为 `no_power`。

### 1.2 影响范围

此 bug 影响所有 `IsFuelBasedPowerSource` 类型的发电建筑：
- `artificial_star`（PowerSourceArtificialStar）
- `thermal_power_plant`（PowerSourceThermal）
- `mini_fusion_power_plant`（PowerSourceFusion）

但 `thermal_power_plant` 和 `mini_fusion_power_plant` 通常通过物流系统持续补给燃料，所以问题不太明显。`artificial_star` 依赖手动 `transfer` 装入有限燃料棒，问题最为突出。

## 2. 修复方案

### 2.1 核心修复：移除 `settleResources` 中对燃料发电建筑的冗余状态检查

**修改文件**：`server/internal/gamecore/rules.go`

**修改位置**：`settleResources` 函数，第 984-989 行

**当前代码**：
```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) && !fuelBasedGeneratorHasReachableFuel(b) {
    if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel); evt != nil {
        events = append(events, evt)
    }
    continue
}
```

**修改为**：
```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) {
    // 燃料发电建筑的状态已由 settlePowerGeneration 管理，
    // settleResources 不再重复检查燃料，避免同 tick 内双重消耗判定。
    // 但如果当前状态已经是 no_power/no_fuel，则跳过资源结算。
    if b.Runtime.State == model.BuildingWorkNoPower && b.Runtime.StateReason == stateReasonNoFuel {
        continue
    }
}
```

**原理**：
- `settlePowerGeneration` 已经完整处理了燃料发电建筑的状态转换（有燃料 → `running`，无燃料 → `no_power/no_fuel`）和燃料消耗
- `settleResources` 只需要尊重 `settlePowerGeneration` 已经设定的状态，不再重复检查燃料可达性
- 如果建筑已经被 `settlePowerGeneration` 标记为 `no_power/no_fuel`，则跳过资源结算（维持原有语义）
- 如果建筑处于 `running`（说明本 tick 有燃料且已消耗），则正常参与资源结算

### 2.2 验证 `settlePowerGeneration` 的状态管理完整性

`power_generation.go:47-58` 已经包含完整的状态管理：

```go
// 无燃料 → no_power/no_fuel
if !fuelBasedGeneratorHasReachableFuel(building) {
    applyBuildingState(building, BuildingWorkNoPower, stateReasonNoFuel)
    continue
}
// 从 no_fuel 恢复 → running
if building.Runtime.State == BuildingWorkNoPower && building.Runtime.StateReason == stateReasonNoFuel {
    applyBuildingState(building, BuildingWorkRunning, stateReasonStart)
}
```

然后调用 `ResolvePowerGeneration` 消耗燃料并计算发电量。

**关键时序**：
1. 检查燃料可达性（消耗前）
2. 设置状态为 `running`
3. 消耗燃料并计算发电量
4. 记录 `PowerInput`

这个顺序是正确的：先确认有燃料，再消耗。消耗后的下一个 tick 如果没有新燃料补入，步骤 1 会检测到无燃料并设为 `no_power`。

### 2.3 无需修改的部分

- `model/power.go` 中的 `ResolvePowerGeneration` 和 `consumeFuel` — 逻辑正确
- `fuel_generators.go` 中的 `fuelBasedGeneratorHasReachableFuel` — 逻辑正确
- `power_generation.go` 中的 `settlePowerGeneration` — 逻辑正确
- `stats_settlement.go` 中的 `buildPlayerEnergyStats` — 从 `PowerSettlementSnapshot` 读取，只要 snapshot 正确就正确
- `transfer` 命令 — 正确地将物品放入 `Storage.Inventory` / `InputBuffer`

## 3. 修复后的 Tick 时序

```
Tick N:
  settlePowerGeneration:
    → fuelBasedGeneratorHasReachableFuel(star) = true (有 3 根燃料棒)
    → state = running
    → consumeFuel: 消耗 1 根 antimatter_fuel_rod
    → PowerInput.Output = 80
  finalizePowerSettlement:
    → PowerSnapshot.Players[p1].Generation += 80
    → stats.energy_stats.generation 反映 +80
  settleResources:
    → 检测到 IsFuelBasedPowerSource，但 state = running（非 no_power/no_fuel）
    → 正常参与资源结算（维护费等）

Tick N+1:
  settlePowerGeneration:
    → fuelBasedGeneratorHasReachableFuel(star) = true (还有 2 根)
    → state 保持 running
    → consumeFuel: 消耗 1 根
    → PowerInput.Output = 80

Tick N+2:
  settlePowerGeneration:
    → fuelBasedGeneratorHasReachableFuel(star) = true (还有 1 根)
    → consumeFuel: 消耗最后 1 根
    → PowerInput.Output = 80

Tick N+3:
  settlePowerGeneration:
    → fuelBasedGeneratorHasReachableFuel(star) = false (0 根)
    → state = no_power / no_fuel
    → 不产生 PowerInput
  settleResources:
    → state == no_power && reason == no_fuel → continue（跳过）
```

3 根燃料棒持续 3 个 tick 的 `running` 状态，与 `ConsumePerTick: 1` 一致。

## 4. 测试方案

### 4.1 新增测试文件

**文件**：`server/internal/gamecore/t104_artificial_star_stable_power_test.go`

### 4.2 测试用例

#### 测试 1：多根燃料棒持续供电时间与 ConsumePerTick 一致

```
场景：装入 5 根 antimatter_fuel_rod，ConsumePerTick = 1
预期：
  - 连续 5 个 tick 保持 running
  - 每个 tick 的 PowerInput.Output = 80
  - 每个 tick 的 stats.energy_stats.generation 包含 80
  - 第 6 个 tick 回到 no_power/no_fuel
  - 第 6 个 tick 的 PowerInput 中不再包含该建筑
```

#### 测试 2：单根燃料棒的最小运行期

```
场景：装入 1 根 antimatter_fuel_rod
预期：
  - 第 1 个 tick：running，Output = 80
  - 第 2 个 tick：no_power/no_fuel，Output = 0
```

#### 测试 3：燃料耗尽后重新装入可恢复

```
场景：装入 1 根 → 运行 1 tick → 耗尽 → 再装入 2 根
预期：
  - 耗尽后 state = no_power/no_fuel
  - 重新装入后下一 tick 恢复 running
  - 持续 2 tick 后再次 no_power/no_fuel
```

#### 测试 4：电网统计一致性

```
场景：2 台 wind_turbine（各 10）+ 1 台 artificial_star（80，装 3 根燃料）
预期：
  - 有燃料期间：generation = 100（20 + 80）
  - 燃料耗尽后：generation = 20
  - networks 中 supply 同步变化
```

#### 测试 5：所有燃料发电建筑共享修复

```
场景：thermal_power_plant 装入 coal，mini_fusion_power_plant 装入 hydrogen_fuel_rod
预期：
  - 两者都能稳定保持 running 直到燃料耗尽
  - 不会出现同 tick 内 running → no_power 的闪烁
```

## 5. 需要同步更新的文档

### 5.1 `docs/player/已知问题与回归.md`
- 标记 T104 问题已修复
- 记录修复版本

### 5.2 `docs/player/玩法指南.md`
- 确认终局能源玩法描述与实际行为一致
- 补充 artificial_star 的燃料消耗速率说明（1 根/tick）

### 5.3 `docs/dev/服务端API.md`
- 确认"装回燃料后的下一 tick 会恢复 running"的描述现在与实际行为一致
- 补充 networks/stats 在燃料存在期间持续反映发电收益的说明

## 6. 验收清单

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | `transfer` 装入燃料后，`inspect` 持续显示 `running` 直到燃料耗尽 | 测试 1、2 |
| 2 | `networks` 和 `stats.energy_stats` 在燃料期间反映 `+80` 供电 | 测试 4 |
| 3 | N 根燃料棒持续 N 个 tick（ConsumePerTick=1） | 测试 1 |
| 4 | 燃料真正耗尽后才回到 `no_power/no_fuel` | 测试 1、2 |
| 5 | `building_state_changed` 事件与状态一致 | 测试 1、3 |
| 6 | 所有燃料发电建筑（thermal/fusion/artificial_star）行为一致 | 测试 5 |
| 7 | 现有 T099 测试全部通过 | `go test ./...` |
| 8 | 新增 T104 测试全部通过 | `go test ./...` |

## 7. 风险评估

### 低风险
- 修改范围极小：仅 `rules.go` 中 `settleResources` 的 6 行代码
- 不改变任何数据结构或接口
- 不影响非燃料发电建筑的行为
- `settlePowerGeneration` 的逻辑不变，只是不再被 `settleResources` 覆盖

### 需要确认
- `settleResources` 中的 `continue` 跳过了后续的矿物采集、生产等逻辑。对于纯发电建筑（artificial_star 没有 Collect/Produce 功能），跳过是正确的。但如果未来有既发电又生产的燃料建筑，需要重新评估此处逻辑。当前三种燃料发电建筑（thermal/fusion/artificial_star）都是纯发电建筑，无此问题。
