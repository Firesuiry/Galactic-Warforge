# T097 设计方案：修正生产统计将空转建筑计入总产出

## 问题概述

`server/internal/gamecore/stats_settlement.go` 中的 `updateProductionStats` 函数在统计生产数据时，只要建筑拥有 `Runtime.Functions.Production` 模块，就直接将其静态 `Throughput` 值累加到 `total_output`。这导致没有配方、缺少原料、或空转的建筑也被计入"总产出"，使 `/state/stats`、CLI `stats` 命令、以及 client-web 的局势展示全部失真。

## 根因分析

当前逻辑（`stats_settlement.go:49-59`）：

```go
for _, building := range gc.world.Buildings {
    if building.Runtime.Functions.Production == nil {
        continue
    }
    throughput := building.Runtime.Functions.Production.Throughput
    stats.TotalOutput += throughput
    stats.ByBuildingType[string(building.Type)] += throughput
}
```

问题：
1. 没有检查 `building.Production.RecipeID` 是否为空
2. 没有检查建筑是否处于 `input_shortage` 状态
3. 使用的是静态能力值 `Throughput`，而非真实产出量
4. `ByItem` 字段虽然初始化了 map，但从未被填充

## 设计方案

### 核心思路

将统计口径从"静态产能"改为"真实产出"。利用 `production_settlement.go` 中已有的 `EvtResourceChanged` 事件作为真实产出的唯一数据源，在每 tick 结算时基于该事件累计产出。

### 方案一（推荐）：基于 EvtResourceChanged 事件累计

#### 原理

`production_settlement.go:37-45` 在建筑实际完成配方并存入产物时，会发出 `EvtResourceChanged` 事件，payload 包含：
- `building_id` — 产出建筑
- `recipe_id` — 完成的配方
- `outputs` — 实际产出的物品列表 `[]ItemAmount`

这是唯一能证明"真实产出发生"的信号。

#### 改动清单

##### 1. 修改 `stats_settlement.go` — `updateProductionStats`

**改动内容：**

不再遍历所有建筑的静态 `Throughput`，改为遍历当前 tick 的 `EvtResourceChanged` 事件，从中提取真实产出数据。

**伪代码：**

```go
func (gc *GameCore) updateProductionStats(player *model.PlayerState) {
    stats := &player.Stats.ProductionStats
    stats.TotalOutput = 0
    stats.ByBuildingType = make(map[string]int)
    stats.ByItem = make(map[string]int)

    var totalEfficiency float64
    var buildingCount int

    // 从当前 tick 的事件中提取真实产出
    for _, evt := range gc.currentTickEvents {
        if evt.EventType != model.EvtResourceChanged {
            continue
        }
        buildingID, _ := evt.Payload["building_id"].(string)
        building := gc.world.Buildings[buildingID]
        if building == nil || building.OwnerID != player.PlayerID {
            continue
        }

        outputs, _ := evt.Payload["outputs"].([]model.ItemAmount)
        for _, item := range outputs {
            stats.TotalOutput += item.Quantity
            stats.ByBuildingType[string(building.Type)] += item.Quantity
            stats.ByItem[item.ItemID] += item.Quantity
        }
    }

    // 效率统计保持不变：基于 ProductionMonitor 的采样数据
    for _, building := range gc.world.Buildings {
        if building.OwnerID != player.PlayerID {
            continue
        }
        if building.ProductionMonitor != nil && building.ProductionMonitor.LastStats.Efficiency > 0 {
            totalEfficiency += building.ProductionMonitor.LastStats.Efficiency
            buildingCount++
        }
    }
    if buildingCount > 0 {
        stats.Efficiency = totalEfficiency / float64(buildingCount)
    }
}
```

##### 2. 确保 `currentTickEvents` 可被 `settleStats` 访问

**背景：** `settleProduction` 返回 `[]*model.GameEvent`，这些事件在 `core.go` 的 tick 结算流程中被收集。需要确认 `settleStats` 调用时能访问到当前 tick 产生的事件列表。

**改动内容：**

在 `GameCore` 上增加一个字段（或利用已有的事件收集机制），将当前 tick 的事件传递给 `settleStats`：

```go
// core.go tick 结算流程中
productionEvents := settleProduction(ws)
allEvents = append(allEvents, productionEvents...)
// ... 其他结算 ...
gc.currentTickEvents = allEvents  // 在 settleStats 之前设置
gc.settleStats()
gc.currentTickEvents = nil        // 结算后清理
```

如果 `GameCore` 已有类似的事件收集字段，直接复用即可。

##### 3. 处理 `outputs` payload 的类型断言

`EvtResourceChanged` 的 `outputs` 字段在 `production_settlement.go:35` 中是 `[]model.ItemAmount`，但存入 `map[string]any` 后取出时需要类型断言。需要一个辅助函数安全提取：

```go
func extractOutputs(payload map[string]any) []model.ItemAmount {
    raw, ok := payload["outputs"]
    if !ok {
        return nil
    }
    if items, ok := raw.([]model.ItemAmount); ok {
        return items
    }
    return nil
}
```

##### 4. 无需修改 model 层

`ProductionStats` 结构体（`model/stats.go:14-19`）的字段定义不需要变更：
- `TotalOutput` — 改为真实产出物品总数量
- `ByBuildingType` — 改为按建筑类型的真实产出数量
- `ByItem` — 终于会被正确填充
- `Efficiency` — 保持不变

##### 5. 无需修改 API / CLI / client-web

- `GET /state/stats` handler（`gateway/server.go:173-178`）只是透传 `PlayerStats`，无需改动
- CLI `stats` 命令（`client-cli/src/commands/query.ts` + `format.ts:121-142`）已经展示 `total_output`、`by_building_type`、`by_item`，无需改动
- client-web 当前未直接展示 `production_stats`（只展示 energy/logistics/combat），但修复后数据正确，未来接入时不会失真

### 方案二（备选）：在原有遍历中增加过滤条件

如果事件传递机制改动成本过高，可在原有遍历逻辑中增加过滤：

```go
for _, building := range gc.world.Buildings {
    if building.OwnerID != player.PlayerID {
        continue
    }
    if building.Runtime.Functions.Production == nil {
        continue
    }
    // 新增过滤条件
    if building.Production == nil || building.Production.RecipeID == "" {
        continue  // 没有配方，不计入
    }
    if building.ProductionMonitor != nil && building.ProductionMonitor.LastStats.InputShortage {
        continue  // 原料短缺且无实际产出，不计入
    }
    if building.ProductionMonitor != nil && building.ProductionMonitor.LastStats.Efficiency <= 0 {
        continue  // 效率为 0，不计入
    }
    // ... 原有统计逻辑
}
```

**缺点：**
- 仍然使用静态 `Throughput` 而非真实产出量
- `ByItem` 仍然无法被正确填充（因为不知道具体产出了什么物品）
- 只是"排除明显空转"，不是"统计真实产出"

**结论：推荐方案一。**

## 回归测试设计

在 `server/internal/gamecore/` 下新增 `stats_settlement_test.go`：

### 测试用例

#### TestProductionStats_NoRecipe_ZeroOutput

构造一个 `recomposing_assembler` 建筑，有 `Production` 模块但不设置 `RecipeID`。
- 断言：`total_output = 0`，`by_building_type` 为空，`by_item` 为空

#### TestProductionStats_InputShortage_ZeroOutput

构造一个 `self_evolution_lab` 建筑，设置 `RecipeID` 但不提供任何输入原料。
- 断言：`total_output = 0`

#### TestProductionStats_SiloNoRocket_ZeroOutput

构造一个 `vertical_launching_silo`，默认挂 `small_carrier_rocket` 配方但 `input_shortage = true`，无实际火箭产出。
- 断言：`total_output = 0`

#### TestProductionStats_RealProduction_Counted

构造一个 `assembler` 建筑，提供足够原料使其在 tick 中完成一次配方。
- 断言：`total_output > 0`
- 断言：`by_building_type["assembler"] > 0`
- 断言：`by_item` 中包含配方产物且数量正确
- 断言：三个字段（`total_output`、`by_building_type` 总和、`by_item` 总和）一致

#### TestProductionStats_MultipleBuildings_Aggregated

构造多个不同类型的生产建筑，部分有真实产出、部分空转。
- 断言：只有真实产出的建筑被计入
- 断言：空转建筑不影响统计

### 测试辅助

复用项目中已有的测试 helper（参考 `production_io_policy_test.go`、`e2e_test.go` 中的建筑构造方式），构造最小化的 `WorldState` + `GameCore` 实例。

## 影响范围

| 组件 | 是否需要改动 | 说明 |
|------|-------------|------|
| `server/internal/gamecore/stats_settlement.go` | **是** | 核心改动：重写 `updateProductionStats` |
| `server/internal/gamecore/core.go` | **是** | 传递当前 tick 事件给 `settleStats` |
| `server/internal/model/stats.go` | 否 | 结构体不变 |
| `server/internal/gateway/server.go` | 否 | API handler 透传，无需改动 |
| `server/internal/query/stats.go` | 否 | 查询层透传，无需改动 |
| `client-cli/src/format.ts` | 否 | 已正确展示所有字段 |
| `client-web` | 否 | 当前未展示 production_stats |
| `server/internal/gamecore/stats_settlement_test.go` | **新增** | 回归测试 |

## 实施步骤

1. 确认 `core.go` 中 tick 结算流程的事件收集机制，确定 `settleStats` 能访问当前 tick 事件的最佳方式
2. 修改 `stats_settlement.go` 中的 `updateProductionStats`，改为基于 `EvtResourceChanged` 事件统计
3. 新增 `stats_settlement_test.go`，覆盖 5 个测试用例
4. 运行 `go test ./...` 确保所有测试通过
5. 在 midgame 场景下手动验证：空转建筑 `total_output = 0`，真实产出建筑数据正确

## 风险与注意事项

1. **`outputs` 类型断言**：`map[string]any` 中存储的 `[]model.ItemAmount` 在取出时需要正确的类型断言，不能用 JSON 反序列化的方式处理
2. **事件时序**：`settleStats` 必须在 `settleProduction` 之后调用（当前已满足，见 `core.go` 结算顺序）
3. **性能**：遍历事件列表的开销远小于遍历所有建筑，不会引入性能问题
4. **向后兼容**：`total_output` 的语义从"静态产能"变为"真实产出"，数值会显著降低。这是正确行为，但需要在发布说明中提及
