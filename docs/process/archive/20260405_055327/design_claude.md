# T098 设计方案：采集产出纳入生产统计

## 1. 问题分析

当前 `ProductionSettlementSnapshot` 仅在 `settleProduction()` 中被创建和写入，只统计 recipe 生产的产物。以下两类真实产出未被统计：

| 产出来源 | 结算函数 | 产出写入位置 | 统计状态 |
|---|---|---|---|
| `advanced_mining_machine` 等采矿建筑 | `settleResources()` | `building.Storage` 或 `player.Resources.Minerals` | 未统计 |
| `orbital_collector` 轨道采集站 | `settleOrbitalCollectors()` | `building.LogisticsStation.Inventory` | 未统计 |
| recipe 生产建筑 | `settleProduction()` | `building.Storage` | 已统计 |

### 根因

Tick 执行顺序（`core.go:589-605`）：

```
settleResources(ws)           ← 采矿产出在此发生，但此时 snapshot 尚未创建
settleOrbitalCollectors(ws)   ← 轨采产出在此发生，同上
...
settleProduction(ws)          ← snapshot 在此创建，只记录 recipe 产出
```

`settleProduction()` 第一行就创建了新的 `ProductionSettlementSnapshot`，覆盖了之前可能存在的任何数据。采矿和轨采在 snapshot 创建之前执行，无处可写。

## 2. 设计方案

### 核心思路

将 `ProductionSettlementSnapshot` 的创建时机提前，使其在所有产出结算之前就存在，然后在各个结算函数中分别写入各自的真实产出。

### 2.1 提前创建 snapshot

在 `core.go` 的 tick 循环中，在 `settleResources` 之前创建 snapshot：

```go
// core.go tick 循环中，settleResources 之前
snapshot := model.NewProductionSettlementSnapshot(ws.Tick)
ws.ProductionSnapshot = snapshot

allEvents = append(allEvents, settleResources(ws)...)
settleOrbitalCollectors(ws, gc.maps)
...
allEvents = append(allEvents, settleProduction(ws)...)
```

### 2.2 修改 `settleProduction()` —— 不再重新创建 snapshot

`production_settlement.go:10` 当前逻辑：

```go
snapshot := model.NewProductionSettlementSnapshot(ws.Tick)
ws.ProductionSnapshot = snapshot
```

改为复用已存在的 snapshot：

```go
snapshot := ws.ProductionSnapshot
if snapshot == nil || snapshot.Tick != ws.Tick {
    snapshot = model.NewProductionSettlementSnapshot(ws.Tick)
    ws.ProductionSnapshot = snapshot
}
```

这样 `settleProduction` 会在已有 snapshot 上追加 recipe 产出，而不是覆盖掉之前写入的采矿/轨采数据。

### 2.3 修改 `settleResources()` —— 记录采矿产出

在 `rules.go` 的 `settleResources()` 中，当采矿建筑真实产出写入 `Storage` 或 `player.Resources` 后，同步写入 snapshot。

需要记录的两个分支：

**分支 A：产出写入 `building.Storage`（`advanced_mining_machine` 等有 `RequiresResourceNode` 且有 Storage 的建筑）**

位置：`rules.go:988-991`，`mined > 0` 时：

```go
if mined > 0 {
    _, _, _ = b.Storage.Receive(itemID, mined)
    // 新增：记录到 snapshot
    if snap := model.CurrentProductionSettlementSnapshot(ws); snap != nil {
        snap.RecordBuildingOutputs(b, []model.ItemAmount{{ItemID: itemID, Quantity: mined}})
    }
}
```

**分支 B：产出写入 `player.Resources.Minerals`（旧式采矿建筑，无 Storage）**

位置：`rules.go:1002`，`minerals > 0` 时。这条路径产出的是通用 minerals 而非具体物品，需要用 `"minerals"` 作为 ItemID：

```go
player.Resources.Minerals += minerals
// 新增：记录到 snapshot
if minerals > 0 {
    if snap := model.CurrentProductionSettlementSnapshot(ws); snap != nil {
        snap.RecordBuildingOutputs(b, []model.ItemAmount{{ItemID: "minerals", Quantity: minerals}})
    }
}
```

### 2.4 修改 `settleOrbitalCollectors()` —— 记录轨采产出

在 `orbital_collector_settlement.go` 中，当物品实际写入 `LogisticsStation.Inventory` 后，同步写入 snapshot。

位置：`orbital_collector_settlement.go:56`，`add > 0` 之后：

```go
building.LogisticsStation.Inventory[output.ItemID] = current + add
// 新增：记录到 snapshot
if snap := model.CurrentProductionSettlementSnapshot(ws); snap != nil {
    snap.RecordBuildingOutputs(building, []model.ItemAmount{{ItemID: output.ItemID, Quantity: add}})
}
```

注意：`settleOrbitalCollectors` 当前签名为 `func settleOrbitalCollectors(ws *model.WorldState, maps *mapmodel.Universe)`，已有 `ws` 参数，可直接调用 `CurrentProductionSettlementSnapshot(ws)`。

## 3. 涉及文件清单

| 文件 | 改动内容 |
|---|---|
| `server/internal/gamecore/core.go` | tick 循环中提前创建 `ProductionSettlementSnapshot` |
| `server/internal/gamecore/production_settlement.go` | `settleProduction()` 复用已有 snapshot 而非重建 |
| `server/internal/gamecore/rules.go` | `settleResources()` 中采矿产出写入 snapshot |
| `server/internal/gamecore/orbital_collector_settlement.go` | 轨采产出写入 snapshot |

## 4. 不需要改动的部分

- `model/production_settlement_snapshot.go` —— `RecordBuildingOutputs` 方法已支持按 building 和 item 聚合，无需修改
- `stats_settlement.go` —— `updateProductionStats` 已从 snapshot 读取数据，无需修改
- `gateway/server.go` —— `/state/stats` 端点已读取 `player.Stats`，无需修改
- `query/stats.go` —— 查询层已返回 `player.Stats` 副本，无需修改
- `client-web` / `client-cli` —— 展示层读取同一套 API，数据源修正后自动生效

## 5. 回归测试计划

### 5.1 新增测试：采矿建筑产出统计

文件：`server/internal/gamecore/stats_settlement_test.go`

```
TestProductionStats_MiningBuilding_Counted
```

- 构造一个 `advanced_mining_machine`，放在有资源节点的 tile 上
- 设置 `Runtime.State = Running`，`Runtime.Functions.Collect` 有 `YieldPerTick`
- 执行 `settleResources(ws)` + `settleProduction(ws)` + `updateProductionStats(player)`
- 断言 `TotalOutput > 0`
- 断言 `ByBuildingType["advanced_mining_machine"] > 0`
- 断言 `ByItem` 包含对应资源物品

### 5.2 新增测试：轨道采集站产出统计

文件：`server/internal/gamecore/orbital_collection_test.go`（或新建 `stats_settlement_test.go` 中追加）

```
TestProductionStats_OrbitalCollector_Counted
```

- 构造气态行星 WorldState + `orbital_collector` 建筑
- 设置 `Runtime.State = Running`，`Orbital.Outputs` 有产出配置
- 初始化 `LogisticsStation.Inventory`
- 提前创建 snapshot：`ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)`
- 执行 `settleOrbitalCollectors(ws, maps)` + `settleProduction(ws)` + `updateProductionStats(player)`
- 断言 `TotalOutput > 0`
- 断言 `ByBuildingType["orbital_collector"] > 0`
- 断言 `ByItem` 包含 `hydrogen` / `deuterium`

### 5.3 回归测试：空转建筑不误计

确保现有测试全部通过：

- `TestProductionStats_NoRecipe_ZeroOutput` —— 无配方建筑仍为 0
- `TestProductionStats_InputShortage_ZeroOutput` —— 缺料建筑仍为 0
- `TestProductionStats_SiloNoRocket_ZeroOutput` —— 空转发射井仍为 0
- `TestT097OfficialMidgameIdleProductionBuildingsDoNotInflateStats` —— midgame 空转建筑仍为 0

### 5.4 回归测试：无产出时保持 0

```
TestProductionStats_MiningBuilding_NoResource_ZeroOutput
```

- 采矿建筑放在无资源节点的 tile 上
- 断言 `TotalOutput == 0`

## 6. 风险与注意事项

1. **Tick 内 snapshot 唯一性**：提前创建 snapshot 后，`settleProduction` 必须复用而非覆盖。如果遗漏这个修改，采矿/轨采数据会被清零。

2. **minerals 通用资源的 ItemID**：旧式采矿建筑产出的是 `player.Resources.Minerals`（整数），没有具体 ItemID。统计时使用 `"minerals"` 作为 ItemID。需确认这与现有 item 体系不冲突。如果项目中已有 `model.ItemMinerals` 常量，应优先使用。

3. **轨采库存上限截断**：`settleOrbitalCollectors` 中 `add` 可能被 `MaxInventory` 截断，统计的是截断后的实际入库量（`add`），这是正确的——统计的是"真实落库"而非"理论产出"。

4. **不影响现有 recipe 统计**：`settleProduction` 中的 `RecordBuildingOutputs` 调用不变，只是 snapshot 从"新建"变为"复用"，追加写入行为不受影响。

## 7. 验收检查清单

- [ ] `go test ./...` 全部通过（含新增测试）
- [ ] 官方 midgame 场景下 `orbital_collector` running 后 `production_stats.total_output > 0`
- [ ] 官方 midgame 场景下 `advanced_mining_machine` running 后 `production_stats.by_item` 包含对应资源
- [ ] 空转建筑（无配方、缺料、无火箭）仍为 `total_output = 0`
- [ ] CLI `stats` 命令显示采矿/轨采产出
- [ ] `client-web` 总览页显示采矿/轨采产出
