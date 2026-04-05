# T098 最终设计方案：将真实采集产出纳入 authoritative 生产统计

## 1. 文档目标

本文综合现有 `design_claude` 方案与 Codex 方案的核心判断，给出 T098 的唯一推荐实现路径。

基于当前工作区代码，T097 已经完成了第一阶段修正：

- `production_stats` 不再直接读取静态 `Throughput`
- `ProductionSettlementSnapshot` 已存在
- `updateProductionStats()` 已改为只消费当前 world 的 `ProductionSnapshot`

因此，T098 不是重做生产统计架构，而是在已落地的快照架构上，把此前遗漏的两类真实产出补进同一份 authoritative fact source：

- `settleResources()` 中真实发生的采集产出
- `settleOrbitalCollectors()` 中真实发生的轨采产出

最终结论：

- 保留 Codex 方案的强类型快照架构，不让 `stats` 回退为解析通用事件。
- 采纳 Claude 方案对缺失写入点和 tick 顺序的判断。
- 在每个 world 的 tick 内，统一把 recipe、采矿、轨采三类“真实落库/落站”的产出都写进同一份 `ProductionSettlementSnapshot`。

## 2. 当前基线与问题归因

### 2.1 已经正确的部分

当前代码中，下面这条链路已经成立：

`settleProduction()` -> `ProductionSettlementSnapshot` -> `updateProductionStats()` -> `player.Stats` -> `/state/stats` -> CLI/Web

也就是说：

- 统计源头已经从“静态产能”切到了“真实结算快照”
- `ByItem`、`ByBuildingType`、`TotalOutput` 已经共享同一份强类型事实源
- `stats` 层不再需要直接依赖 `EvtResourceChanged` 的 `map[string]any`

这部分不应推翻，也不应为了 T098 再退回到事件驱动统计。

### 2.2 仍然错误的部分

当前遗漏发生在快照写入覆盖范围，而不是统计消费层。

当前 world tick 顺序仍然是：

```go
settleResources(ws)
settleOrbitalCollectors(ws, gc.maps)
...
settleProduction(ws)
```

而当前 `ProductionSnapshot` 仍在 `settleProduction()` 开头初始化，并且只有 recipe 产出会调用 `snapshot.RecordBuildingOutputs(...)`。

结果是：

- `advanced_mining_machine`、`mining_machine`、`water_pump`、`oil_extractor` 等 `Collect` 产出，虽然真实写进了 `Storage` 或玩家矿物池，但没有写入快照
- `orbital_collector` 虽然真实把 `hydrogen/deuterium` 写进了 `LogisticsStation.Inventory`，但没有写入快照
- `updateProductionStats()` 已经是正确的，却只能读到“不完整快照”，最终仍会把真实在产链路显示成 `0`

### 2.3 对 Codex 旧边界的裁定

Codex 在 T097 阶段提出过一个边界：先只修 recipe 产出，不扩到 `Collect` / `orbital_collector`。

这个边界在 T097 当时是合理的，但在 T098 中已经失效，原因很直接：

- 当前任务定义已经明确要求把真实采集产出纳入 authoritative 统计
- 当前代码也已经具备快照基础设施，不再存在“先搭架构、后扩来源”的阻碍

因此，本次综合方案保留的是 Codex 的“快照式统计原则”，而不是 T097 阶段的旧范围限制。

## 3. 最终裁决

两份方案的可合并结论如下：

1. `production_stats` 的 authoritative source 继续使用 `ProductionSettlementSnapshot`
2. `stats`、`query`、CLI、Web 不解析通用事件，不新增第二套统计口径
3. `ProductionSnapshot` 必须在本 tick 第一类产出发生前就已存在
4. 任何产出型结算函数，只要发生了“真实落库/落站”，就立即把**实际成功写入的数量**记入该快照
5. 当前 tick 没有真实落库时，`production_stats` 仍保持 `0`，不回退到理论产能

最终覆盖范围：

- recipe 生产落库
- `Collect` -> `Storage` 的真实采集产出
- `Collect` -> `player.Resources.Minerals` 的真实采集产出
- `orbital_collector` -> `LogisticsStation.Inventory` 的真实轨采产出

明确不做：

- 不让 `stats` 直接解析 `EvtResourceChanged`
- 不新增 API 字段
- 不新增 CLI 命令
- 不修改 `production_stats` 的“当前 tick 实际产出”时间窗口语义

## 4. 详细设计

### 4.1 `ProductionSnapshot` 生命周期前移

`server/internal/gamecore/core.go` 中，每个 world 的结算循环开始后，应先初始化当前 tick 的 `ProductionSnapshot`，再进入所有可能产生产出的结算函数。

建议位置：进入 `for _, ws := range worlds` 后、任何生产/采集型结算前。

示意：

```go
for _, ws := range worlds {
    ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

    env := currentPlanetEnvironment(gc.maps, ws.PlanetID)
    allEvents = append(allEvents, settlePowerGeneration(ws, env)...)
    ...
    allEvents = append(allEvents, settleResources(ws)...)
    settleOrbitalCollectors(ws, gc.maps)
    ...
    allEvents = append(allEvents, settleProduction(ws)...)
}
```

这样做的原因：

- `settleResources()` 和 `settleOrbitalCollectors()` 都能安全复用同一份快照
- 后续如果再增加新的真实产出来源，也不会再因为“初始化太晚”丢数据
- `ProductionSnapshot` 的生命周期和 `PowerSnapshot` 一样，变成明确的“per-world per-tick authoritative result”

### 4.2 `settleProduction()` 改为复用已存在快照

`server/internal/gamecore/production_settlement.go` 不能再无条件重建快照，否则会抹掉前面已经写入的采矿/轨采数据。

改法：

```go
snapshot := model.CurrentProductionSettlementSnapshot(ws)
if snapshot == nil {
    snapshot = model.NewProductionSettlementSnapshot(ws.Tick)
    ws.ProductionSnapshot = snapshot
}
```

然后保持现有 recipe 产出逻辑不变：

- 主产物和副产物继续合并成 `combinedOutputs`
- 只有在 `canStoreOutputs(...)` 通过、并且真实写入 `Storage` 后才记录
- 用同一份 `combinedOutputs`：
  - `storeOutputs(...)`
  - `snapshot.RecordBuildingOutputs(...)`
  - 生成 `EvtResourceChanged`

这部分是对现有 T097 实现的延续，不是重做。

### 4.3 `settleResources()` 记录真实采集产出

`server/internal/gamecore/rules.go` 中需要补两类写入点。

#### A. 采集结果写入 `building.Storage`

这是 `advanced_mining_machine`、`mining_machine`、`water_pump`、`oil_extractor` 等主要路径。

当前逻辑已经先做：

- `PreviewReceive`
- `mineResource(...)`
- `b.Storage.Receive(...)`

最终统计必须使用 `mined` 这个**真实成功落库的数量**，而不是理论 `YieldPerTick`。

示意：

```go
if mined > 0 {
    _, _, _ = b.Storage.Receive(itemID, mined)
    if snap := model.CurrentProductionSettlementSnapshot(ws); snap != nil {
        snap.RecordBuildingOutputs(b, []model.ItemAmount{{
            ItemID:   itemID,
            Quantity: mined,
        }})
    }
}
```

#### B. 采集结果直接写入 `player.Resources.Minerals`

当前 `settleResources()` 里仍保留一条“直充矿物池”的 `Collect` 分支。即使本轮复现主要聚焦 `advanced_mining_machine`，这条分支和 T098 的统计缺口本质相同，应该一并收口，否则 authoritative 口径仍然不完整。

关键点：

- 统计写入必须使用本次真实采出的 `minerals`
- 不能用 `oldM != player.Resources.Minerals` 的净变化值，因为其中会混入 maintenance 扣减等非产出因素

建议增加一个仅用于统计的常量，例如：

```go
const ProductionStatMinerals = "minerals"
```

推荐放在 `server/internal/model/production_settlement_snapshot.go` 同域位置，而不是塞进 `itemCatalog`：

- 它是统计标签，不是真实库存 item
- 不应参与物品校验、转运、堆叠规则

写入示意：

```go
player.Resources.Minerals += minerals
if minerals > 0 {
    if snap := model.CurrentProductionSettlementSnapshot(ws); snap != nil {
        snap.RecordBuildingOutputs(b, []model.ItemAmount{{
            ItemID:   model.ProductionStatMinerals,
            Quantity: minerals,
        }})
    }
}
```

### 4.4 `settleOrbitalCollectors()` 记录真实轨采产出

`server/internal/gamecore/orbital_collector_settlement.go` 当前已经按真实库存上限裁剪 `add`，并把结果写入 `building.LogisticsStation.Inventory`。

统计应在这一步之后立即记录：

```go
if add > 0 {
    building.LogisticsStation.Inventory[output.ItemID] = current + add
    if snap := model.CurrentProductionSettlementSnapshot(ws); snap != nil {
        snap.RecordBuildingOutputs(building, []model.ItemAmount{{
            ItemID:   output.ItemID,
            Quantity: add,
        }})
    }
}
```

这里必须使用 `add`，而不是 `output.Quantity`，因为：

- `MaxInventory` 可能截断本 tick 实际入站量
- authoritative 统计要记的是“真实落站”，不是“理论应产出”

### 4.5 消费面保持不变

这次不应再动 `stats` API 结构，也不需要让查询层或前端重新计算。

保持不变的部分：

- `server/internal/gamecore/stats_settlement.go`
- `server/internal/query/stats.go`
- `GET /state/stats`
- `client-cli` 的 `stats`
- `client-web` 对 `production_stats` 的读取方式

原因是：

- 当前消费层已经建立在 `player.Stats.ProductionStats` 之上
- 只要 authoritative 快照完整，所有展示面都会自动拿到同一口径的数据

唯一需要同步的是文档语义：

- `docs/服务端API.md` 要说明 `production_stats` 现在覆盖 recipe、采集、轨采三类真实落库/落站产出
- `docs/cli.md` 要同步 `stats` 命令的统计口径说明

## 5. 文件改动范围

### 5.1 必改代码文件

- `server/internal/gamecore/core.go`
  - 将 `ProductionSnapshot` 初始化前移到 world tick 结算开始阶段
- `server/internal/gamecore/production_settlement.go`
  - 改为复用已有快照，禁止覆盖前序采集记录
- `server/internal/gamecore/rules.go`
  - 在真实采集落库/落矿物池后写入 snapshot
- `server/internal/gamecore/orbital_collector_settlement.go`
  - 在真实轨采落站后写入 snapshot

### 5.2 可能需要的小范围模型改动

- `server/internal/model/production_settlement_snapshot.go`
  - 如采用 `ProductionStatMinerals` 常量，则在这里定义

### 5.3 文档改动

- `docs/服务端API.md`
- `docs/cli.md`

### 5.4 明确不需要改动

- `server/internal/gamecore/stats_settlement.go`
  - 现有“从快照读统计”的方向是正确的
- `server/internal/query/stats.go`
- `server/internal/gateway/server.go`
- `client-cli` 命令结构
- `client-web` 数据读取结构

## 6. 测试方案

### 6.1 单元/结算级测试

建议把新增断言主要放进 `server/internal/gamecore/stats_settlement_test.go`，因为这里已经集中覆盖了 T097 的统计口径回归。

#### 用例 1：`Collect -> Storage` 被计入统计

建议名称：

`TestProductionStats_CollectStorageOutput_Counted`

覆盖点：

- 构造一个压在资源点上的 `advanced_mining_machine`
- 保证其 `Runtime.State = running`
- 先初始化当 tick 的 `ProductionSnapshot`
- 调用 `settleResources(ws)`，再 `updateProductionStats(player)`
- 断言：
  - `TotalOutput > 0`
  - `ByBuildingType["advanced_mining_machine"] > 0`
  - `ByItem` 包含 `fire_ice` 或对应资源物品

#### 用例 2：`Collect -> player.Resources.Minerals` 被计入统计

建议名称：

`TestProductionStats_DirectMineralsCollect_Counted`

覆盖点：

- 使用现有直充矿物池路径的建筑或最小测试夹具
- 断言 `ByItem[model.ProductionStatMinerals] > 0`
- 断言 `TotalOutput` 与 `ByItem`/`ByBuildingType` 聚合一致

#### 用例 3：`orbital_collector` 被计入统计

建议名称：

`TestProductionStats_OrbitalCollector_Counted`

覆盖点：

- 构造气态行星 world
- 放置 `orbital_collector`
- 初始化 `LogisticsStation.Inventory`
- 初始化当 tick 的 `ProductionSnapshot`
- 调用 `settleOrbitalCollectors(ws, maps)`，再 `updateProductionStats(player)`
- 断言：
  - `TotalOutput > 0`
  - `ByBuildingType["orbital_collector"] > 0`
  - `ByItem` 包含 `hydrogen` / `deuterium`

#### 用例 4：无真实产出时保持 0

建议名称：

- `TestProductionStats_CollectStorageNoResource_ZeroOutput`
- `TestProductionStats_OrbitalCollectorFullInventory_ZeroOutput`

覆盖点：

- 无资源节点、不产生真实落库时不计产出
- 轨采库存已满时，由于 `add == 0`，不计产出

### 6.2 既有 T097 回归必须保留

必须继续通过：

- `TestProductionStats_NoRecipe_ZeroOutput`
- `TestProductionStats_InputShortage_ZeroOutput`
- `TestProductionStats_SiloNoRocket_ZeroOutput`
- `TestT097OfficialMidgameIdleProductionBuildingsDoNotInflateStats`

这些测试锁的是“空转不计产出”的底线，不能因为 T098 扩统计来源而回退。

### 6.3 midgame 真实链路回归

建议新增一条官方 midgame 风格的端到端测试，例如：

`TestT098OfficialMidgameRealCollectAndOrbitalOutputsAppearInStats`

目标：

- 以官方 midgame 测试基线启动 world
- 让 `advanced_mining_machine` 与 `orbital_collector` 进入 `running`
- 结算若干 tick 后断言：
  - `production_stats.total_output > 0`
  - `production_stats.by_building_type` 包含 `advanced_mining_machine`、`orbital_collector`
  - `production_stats.by_item` 包含 `fire_ice`、`hydrogen`、`deuterium`

如果这条测试实现成本过高，至少要保留结算级单测 + 手工 midgame 验证两层保障。

### 6.4 手工验证

按任务描述在官方 midgame 场景验证：

- `GET /state/stats`
- CLI `stats`
- `client-web` 总览页

确认它们看到的是同一口径：

- `orbital_collector` 有真实入站时不再显示为 `0`
- `advanced_mining_machine` 有真实库存增长时不再显示为 `0`
- 空转建筑仍不误记产出

## 7. 风险与注意事项

1. **快照唯一性**
   - `core.go` 前移初始化后，`settleProduction()` 必须改为复用，而不是覆盖。
   - 否则前序写入会被清空，T098 实际无效。

2. **统计必须使用实际成功写入量**
   - `Collect` 使用 `mined`
   - `orbital_collector` 使用 `add`
   - 都不能回退为理论 `YieldPerTick` / `output.Quantity`

3. **`minerals` 只是统计标签**
   - 不应把它伪装成 inventory item 并注册进 item catalog
   - 否则会把统计语义和物品系统错误耦合在一起

4. **world 边界不能丢**
   - `ProductionSnapshot` 继续挂在 `WorldState` 上
   - `/state/stats` 继续读取 active world 对应快照
   - 不从跨 world 事件池反向筛数据

5. **不重复记账**
   - 只在产出源头首次真实落库/落站时记一次
   - 后续 sorter、storage、logistics 内部搬运不属于新增产出，不能再次计入

## 8. 验收标准

- `production_stats.total_output` 能反映 recipe、采矿、轨采三类真实产出
- `production_stats.by_building_type` 包含真实在产的 `advanced_mining_machine`、`orbital_collector` 等建筑
- `production_stats.by_item` 包含 `fire_ice`、`hydrogen`、`deuterium`，以及需要时的 `minerals`
- 空转建筑、缺料建筑、无资源节点建筑、满仓轨采建筑仍保持不计产出
- `GET /state/stats`、CLI `stats`、`client-web` 总览页看到同一口径结果
- `go test ./...` 通过
- `docs/服务端API.md` 与 `docs/cli.md` 完成同步更新
