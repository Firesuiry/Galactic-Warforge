# T097 设计方案：基于真实产出快照修正生产统计

## 1. 范围与结论

当前 `docs/process/task` 目录下只有一个未实现项：`T097_戴森深度试玩中生产统计误将空转建筑计入总产出.md`。本设计只覆盖这一个问题，不扩展到其他已收口的戴森中后期玩法。

结论：

- 不推荐继续使用 `Runtime.Functions.Production.Throughput` 作为 `production_stats` 的统计来源。
- 也不推荐让 `stats` 直接解析通用 `EvtResourceChanged` 事件。
- 推荐在 `settleProduction` 内生成一份**强类型、按 world 隔离的生产结算快照**，并让 `updateProductionStats` 只消费这份快照。

这样可以同时满足三个要求：

- 统计口径只来自“本 tick 真正落入库存的产物”。
- `total_output`、`by_building_type`、`by_item` 三个字段来自同一份事实源，不会再相互打架。
- 设计上避免 `stats` 依赖通用事件 payload，降低模块耦合。

## 2. 现状审计

### 2.1 当前错误口径

`server/internal/gamecore/stats_settlement.go` 里的 `updateProductionStats` 现在直接遍历当前 active world 的建筑，只要建筑有 `Runtime.Functions.Production`，就把静态 `Throughput` 加到统计里。

等价逻辑如下：

```go
for _, building := range gc.world.Buildings {
    if building.OwnerID != player.PlayerID {
        continue
    }
    if building.Runtime.Functions.Production == nil {
        continue
    }

    throughput := building.Runtime.Functions.Production.Throughput
    stats.TotalOutput += throughput
    stats.ByBuildingType[string(building.Type)] += throughput
}
```

这个实现有四个直接问题：

- 没有 `recipe_id` 的建筑也会被记产出。
- `input_shortage=true`、`efficiency=0`、实际上没出货的建筑也会被记产出。
- `ByItem` 根本没有真实来源，当前实现只初始化、不填充。
- `Throughput` 是机器能力，不是“本 tick 实际落地的物品数量”；遇到多产物、副产物、停机、堵塞时都会失真。

### 2.2 真实产出事实目前已经存在

`server/internal/gamecore/production_settlement.go` 在建筑真正把产物写入库存时，会发出 `EvtResourceChanged`，payload 中带有：

- `building_id`
- `recipe_id`
- `outputs []ItemAmount`

注意，事件触发点不是“配置了配方”，也不是“开始生产”，而是：

- 配方已经完成；
- 产物确实可以写入库存；
- `PendingOutputs` / `PendingByproducts` 被真正落库。

这正是 T097 要求的“真实产出事实”。

### 2.3 但不能直接把 stats 建在通用事件上

虽然真实产出事件已经存在，但同一个 `EvtResourceChanged` 也被用于：

- `finalizePowerSettlement` 中的玩家能量变化；
- `settleResources` 中的矿物资源变化。

也就是说，事件类型本身不是“生产产出专用通道”，只是一个通用资源变化通知。若 `stats` 直接去解析事件，会产生以下问题：

- 必须依赖 `map[string]any` 的 payload 结构，而不是强类型数据。
- 必须额外区分“产出事件”“能量变化事件”“矿物变化事件”。
- `GameCore` 的 `allEvents` 聚合了多个 world 的事件，而 `/state/stats` 当前只面向 active world；直接从事件层聚合会让 world 边界变模糊。
- 后续如果事件 payload 为了 SSE/UI 演进而调整，`stats` 会被被动牵连。

这和 `docs/process/rules/架构设计规范.md` 里“尽可能解耦合”的要求冲突。

### 2.4 当前消费面

当前数据链路是：

`settleStats` -> `player.Stats` -> `query.Stats` -> `GET /state/stats`

其上层消费者：

- `client-cli` 的 `stats` 命令只做格式化输出，不做二次计算。
- `client-web` 当前总览页主要展示 energy/logistics/combat，不重新推导 production。
- 因此这次改动的关键是**修正服务端统计源头**，而不是改 API 结构或前端算法。

## 3. 设计目标与非目标

### 3.1 目标

- `production_stats.total_output` 只统计本 tick 真实落库的产物数量。
- `production_stats.by_building_type` 与 `production_stats.by_item` 基于同一份真实产出事实同步增长。
- 无 `recipe_id`、空转、缺料、无法落库的建筑不再被算入产出。
- 统计保持 world 级隔离，不把别的行星/world 的产出混进当前 `/state/stats`。
- 保持现有 API 结构、CLI 命令结构不变，只修正数据语义。

### 3.2 非目标

- 本次不顺手重定义 `production_stats` 是否应该覆盖 `Collect` 建筑、轨道采集器、接收站 photon 模式等其他“产出型系统”。
- 本次不修改 `stats` 的返回结构，不新增字段。
- 本次不重做 `efficiency` 的采样体系；它仍然沿用 `ProductionMonitor` 的监控采样口径。
- 本次不把 `client-web` 做成新的生产概览页；只保证它未来接入时拿到的是正确数据。

额外说明：

- 当前 `client-web/src/fixtures/scenarios/baseline.ts` 中存在 `mining_machine` 出现在 `production_stats` 的示例，但现网服务端并不是按 `Collect` 建筑结算这组统计。这个历史不一致不属于 T097 的修复范围，不应在本任务里顺手扩大语义。

## 4. 方案对比

### 方案 A：在现有 `updateProductionStats` 上补过滤条件

做法：

- 继续遍历建筑。
- 增加 `recipe_id != ""`、`input_shortage=false`、`efficiency > 0` 等条件。

优点：

- 改动最少。
- 不需要新增结构体和快照。

缺点：

- 仍然是按静态 `Throughput` 记账，不是真实出货。
- `ByItem` 仍然没有可信来源。
- 只能排掉“明显空转”，不能正确覆盖多产物、副产物、堵塞、配方产量与 throughput 不等的情况。
- 这是打补丁，不是修正统计口径。

结论：

- 不推荐。

### 方案 B：让 `updateProductionStats` 直接解析当前 tick 的 `EvtResourceChanged`

做法：

- 在 `GameCore` 里保存当前 tick 聚合出来的事件列表。
- `updateProductionStats` 遍历事件，找出带 `building_id + recipe_id + outputs` 的那部分。

优点：

- 真实产出事实已经存在，实现上可行。
- 不需要新增新的业务快照概念。

缺点：

- `stats` 直接依赖通用事件 payload，耦合到 `map[string]any`。
- 需要从能量变化、矿物变化等同类事件里手工筛选出“生产产出”。
- 当前 tick 事件是跨 world 聚合的，`/state/stats` 却是 active world 视角；边界不够清晰。
- `stats` 变成“消费事件协议”的模块，而不是“消费生产结算结果”的模块。

结论：

- 可实现，但不够干净，不符合本仓库偏好的直接、低耦合实现。

### 方案 C：新增 `ProductionSettlementSnapshot`，由 `settleProduction` 直接产出

做法：

- 仿照 `PowerSettlementSnapshot`，在 `WorldState` 上挂一份当前 tick 的 `ProductionSnapshot`。
- `settleProduction` 在真正落库时，直接把这次真实产出写入快照。
- `updateProductionStats` 只读取当前 world 的 `ProductionSnapshot`。

优点：

- 强类型，避免解析通用事件 payload。
- 数据源和 world 边界都非常清晰。
- `stats`、未来的 inspect/UI、甚至后续生产分析接口，都可以复用同一份 authoritative snapshot。
- 与现有 `PowerSnapshot` 设计风格一致，仓库内已有先例。

缺点：

- 需要新增快照结构和少量拷贝逻辑。
- 不能像 power 一样从 live world 逆推出“本 tick 真实产出”；必须在结算时同步记录。

结论：

- 推荐采用。

## 5. 推荐方案：ProductionSettlementSnapshot

### 5.1 数据模型

新增一个与 `PowerSettlementSnapshot` 平行的强类型快照，建议放在 `server/internal/model/production_settlement.go` 或新文件 `server/internal/model/production_settlement_snapshot.go`。

建议结构：

```go
type ProductionSettlementSnapshot struct {
    Tick    int64                              `json:"tick"`
    Players map[string]PlayerProductionSnapshot `json:"players,omitempty"`
}

type PlayerProductionSnapshot struct {
    TotalOutput    int            `json:"total_output"`
    ByBuildingType map[string]int `json:"by_building_type,omitempty"`
    ByItem         map[string]int `json:"by_item,omitempty"`
}
```

同时在 `WorldState` 上增加：

```go
ProductionSnapshot *ProductionSettlementSnapshot `json:"-"`
```

再提供两个辅助函数：

```go
func NewProductionSettlementSnapshot(tick int64) *ProductionSettlementSnapshot
func CurrentProductionSettlementSnapshot(ws *WorldState) *ProductionSettlementSnapshot
```

其中 `CurrentProductionSettlementSnapshot` 不做 fallback 重建，只做“当前 tick 是否有有效快照”的判断：

```go
func CurrentProductionSettlementSnapshot(ws *WorldState) *ProductionSettlementSnapshot {
    if ws == nil || ws.ProductionSnapshot == nil {
        return nil
    }
    if ws.ProductionSnapshot.Tick != ws.Tick {
        return nil
    }
    return ws.ProductionSnapshot
}
```

原因很简单：

- power 可以从网络和储能状态重新推导；
- 生产真实出货不行，错过结算点就无法从库存状态准确还原“本 tick 新增了多少”。

### 5.2 快照记录接口

建议把聚合逻辑封装进快照自己的方法里，而不是散落在 `gamecore`：

```go
func (s *ProductionSettlementSnapshot) RecordBuildingOutputs(building *Building, outputs []ItemAmount)
```

职责：

- 忽略 `nil building`、空 owner、空 outputs、`qty <= 0` 的条目。
- 按 `building.OwnerID` 找到玩家聚合桶。
- `TotalOutput += sum(outputs.Quantity)`
- `ByBuildingType[string(building.Type)] += sum(outputs.Quantity)`
- `ByItem[itemID] += quantity`

约束：

- `outputs` 应统计主产物和副产物，因为两者都是真实落库的物品。
- 统计单位仍然是“物品数量”，不是“完成了几次配方”。

### 5.3 Tick 数据流

推荐把结算链路调整为下面这个顺序，但不改变现有整体 tick 拓扑：

1. `settleProduction(ws)` 开始时先创建空快照并挂到 `ws.ProductionSnapshot`。
2. 遍历建筑时，只有在以下全部满足时才记账：
   - 建筑有 `Production` 模块；
   - `RecipeID != ""`；
   - 建筑处于 `running`；
   - `PendingOutputs` / `PendingByproducts` 真正通过 `canStoreOutputs` 校验；
   - 产物真正写入库存。
3. 一旦真实落库：
   - 先生成 `combinedOutputs := outputs + byproducts`；
   - 用 `combinedOutputs` 调用 `snapshot.RecordBuildingOutputs(building, combinedOutputs)`；
   - 再用同一份 `combinedOutputs` 组装 `EvtResourceChanged`。

关键伪代码：

```go
func settleProduction(ws *model.WorldState) []*model.GameEvent {
    if ws == nil {
        return nil
    }

    snapshot := model.NewProductionSettlementSnapshot(ws.Tick)
    ws.ProductionSnapshot = snapshot

    var events []*model.GameEvent
    for _, building := range ws.Buildings {
        // ... 前置校验、省略

        if len(state.PendingOutputs) > 0 || len(state.PendingByproducts) > 0 {
            if !canStoreOutputs(...) {
                continue
            }

            combinedOutputs := append(cloneItemAmounts(state.PendingOutputs), cloneItemAmounts(state.PendingByproducts)...)
            storeOutputs(...)
            snapshot.RecordBuildingOutputs(building, combinedOutputs)

            events = append(events, &model.GameEvent{
                EventType: model.EvtResourceChanged,
                Payload: map[string]any{
                    "building_id": building.ID,
                    "recipe_id":   state.RecipeID,
                    "outputs":     combinedOutputs,
                },
            })

            state.PendingOutputs = nil
            state.PendingByproducts = nil
            continue
        }

        // ... 进入下一轮生产
    }
    return events
}
```

这个设计的重点是：

- 事件和快照都来自同一份 `combinedOutputs`；
- `stats` 以后依赖的是快照，不是事件；
- 事件仍然保留给 SSE / 历史 / 调试使用。

### 5.4 `updateProductionStats` 的修改

`server/internal/gamecore/stats_settlement.go` 中的 `updateProductionStats` 应改成“先读快照，再补效率”。

建议逻辑：

```go
func (gc *GameCore) updateProductionStats(player *model.PlayerState) {
    stats := &player.Stats.ProductionStats
    stats.TotalOutput = 0
    stats.ByBuildingType = make(map[string]int)
    stats.ByItem = make(map[string]int)
    stats.Efficiency = 0

    if snapshot := model.CurrentProductionSettlementSnapshot(gc.world); snapshot != nil {
        if ps, ok := snapshot.Players[player.PlayerID]; ok {
            stats.TotalOutput = ps.TotalOutput
            stats.ByBuildingType = cloneIntMap(ps.ByBuildingType)
            stats.ByItem = cloneIntMap(ps.ByItem)
        }
    }

    // efficiency 仍然沿用 ProductionMonitor 的采样值
    // 这里只负责避免把旧 tick 的效率残留到新 tick
}
```

注意点：

- 这里要显式 `stats.Efficiency = 0`，否则当前代码在 `buildingCount == 0` 时会把上一 tick 的效率残留到本 tick。
- `ByBuildingType` / `ByItem` 要做 map 拷贝，避免把 snapshot 的内部 map 直接暴露给 `player.Stats`。

### 5.5 world 边界与 active planet 语义

当前 `/state/stats` 通过 `core.World()` 返回 active world，再由 `query.Stats` 透传 `player.Stats`。本方案不改变这一点。

因为 `ProductionSnapshot` 是挂在每个 `WorldState` 上的，所以：

- `planet-1-1` 的快照只包含 `planet-1-1` 的真实产出；
- `planet-1-2` 的快照只包含 `planet-1-2` 的真实产出；
- `updateProductionStats` 在 active world 上运行时，不会把其他行星的输出混进来。

这比从 `GameCore.allEvents` 里回捞数据更清晰。

## 6. 影响面设计

### 6.1 必改文件

- `server/internal/model/world.go`
  - 新增 `ProductionSnapshot` 字段。
- `server/internal/model/production_settlement_snapshot.go`（建议新增）
  - 定义生产结算快照与 helper。
- `server/internal/gamecore/production_settlement.go`
  - 在真实落库时记录 snapshot。
- `server/internal/gamecore/stats_settlement.go`
  - 改为消费 snapshot，而不是静态 throughput。

### 6.2 大概率无需改代码的文件

- `server/internal/query/stats.go`
  - 仍然只是返回 `player.Stats`。
- `server/internal/gateway/server.go`
  - `GET /state/stats` 仍然透传查询结果。
- `client-cli/src/format.ts`
  - 格式化逻辑无需变化。
- `client-web`
  - 当前总览页没有直接渲染 production stats，因此无需为了 T097 改 UI 代码。

### 6.3 需要同步的文档

虽然本次不改 API shape，但语义发生了纠偏，实施时应同步更新：

- `docs/dev/服务端API.md`
  - 明确 `production_stats.total_output / by_building_type / by_item` 表示“当前 active world、当前 tick、真实落库的产物数量”。
- `docs/dev/客户端CLI.md`
  - 若 `stats` 命令描述了产出语义，保持同口径。

## 7. 测试设计

测试应分成“结算级回归”和“官方 midgame 复现”两层。

### 7.1 结算级回归测试

建议新增 `server/internal/gamecore/stats_settlement_test.go`，覆盖最小闭环世界：

#### 用例 1：无配方建筑不记产出

- 建筑：`recomposing_assembler`
- 条件：
  - `Runtime.Functions.Production != nil`
  - `Production.RecipeID == ""`
  - `Runtime.State = running`
- 断言：
  - `stats.production_stats.total_output == 0`
  - `by_building_type` 不含 `recomposing_assembler`
  - `by_item` 为空

#### 用例 2：有配方但缺料，不记产出

- 建筑：`self_evolution_lab`
- 条件：
  - 设置合法 `RecipeID`
  - 不提供输入物料
  - 让 `settleProduction` 跑一个 tick
- 断言：
  - `total_output == 0`
  - `by_building_type` 不含 `self_evolution_lab`

#### 用例 3：默认挂配方但空转的 silo 不记产出

- 建筑：`vertical_launching_silo`
- 条件：
  - `RecipeID = small_carrier_rocket`
  - 不提供任何输入
  - `Runtime.State = running`
- 断言：
  - `total_output == 0`
  - `by_building_type` 不含 `vertical_launching_silo`
  - `by_item` 为空

#### 用例 4：真实产出时三组统计同步增长

- 建筑：任选一个稳定好构造的生产建筑，建议 `chemical_plant` 或 `assembling_machine_mk1`
- 条件：
  - 提供完整输入
  - 跑到产物真正落库
- 断言：
  - `total_output > 0`
  - `by_building_type[building.Type] > 0`
  - `by_item` 包含对应产物
  - `sum(by_building_type) == total_output`
  - `sum(by_item) == total_output`

#### 用例 5：副产物也进入同一口径

- 选择带副产物的 recipe，例如项目里已有副产物逻辑覆盖的配方
- 断言：
  - 主产物与副产物都出现在 `by_item`
  - `total_output == 主产物数量 + 副产物数量`

这个用例不是 T097 的显式验收项，但它能证明“真实产出统计”不是偷懒只看第一种输出。

### 7.2 官方 midgame 复现测试

建议新增单独的集成回归，例如 `server/internal/gamecore/t097_midgame_stats_test.go`：

- 复用 `newOfficialMidgameTestCore(t)`
- 在 `planet-1-2` 上复现任务文档中的三座建筑状态：
  - `b-51 recomposing_assembler` 无配方
  - `b-52 self_evolution_lab` 无配方
  - `b-35 vertical_launching_silo` 有默认配方但无输入
- 调用 `core.processTick()`
- 通过 `query.Stats(ws, "p1")` 或网关 handler 对应路径断言：
  - `production_stats.total_output == 0`
  - `by_building_type` 不出现上述三种虚假产出
  - `by_item` 为空

价值：

- 这不是纯单元推断，而是把本次真实试玩暴露的问题锁进自动回归。

### 7.3 API/消费面验证

因为 CLI 和 Web 都是透传或直接消费 `/state/stats`，这次不需要给它们加“重新计算产出”的测试。

但实现完成后建议至少做一次最小人工验证：

- `client-cli`
  - `stats` 输出不再出现虚假的 `recomposing_assembler / self_evolution_lab / vertical_launching_silo`
- `client-web`
  - 总览页正常加载，不因 `production_stats.by_item` 从空转为真实值而报错

## 8. 实施顺序

推荐按下面顺序做实现：

1. 在 `model` 层新增 `ProductionSettlementSnapshot` 与 world 字段。
2. 修改 `settleProduction`，把真实落库的 `combinedOutputs` 写入 snapshot。
3. 修改 `updateProductionStats`，改为消费 snapshot。
4. 顺手修复 `stats.Efficiency` 的残留值问题，确保每 tick 先清零。
5. 补单元测试与 midgame 回归测试。
6. 更新 `docs/dev/服务端API.md`，必要时同步 `docs/dev/客户端CLI.md`。
7. 用官方 midgame 场景做一次 CLI/Web 手工复测。

## 9. 风险与边界

### 9.1 快照必须在结算时同步写入

生产真实出货无法像 power 一样通过 live state 逆推出“本 tick 新增量”。因此：

- 如果 `settleProduction` 忘记写 snapshot，`stats` 就应该回到 0，而不是尝试猜测；
- 这是刻意设计，宁可显式缺失，也不要回退到静态 throughput 这种错误口径。

### 9.2 不要让 stats 反向依赖事件协议

事件是对外广播协议，快照是内部 authoritative state。两者的依赖方向应保持为：

- 生产结算 -> 快照
- 生产结算 -> 事件
- 统计/API/UI -> 快照

不要做成：

- 生产结算 -> 事件 -> 统计

否则后续只要 SSE payload 调整一次，统计口径就会一起抖动。

### 9.3 本次不扩大到 collect / orbital / receiver photon

如果后续产品定义要把采矿机、轨道采集器、接收站 photon 模式也纳入 `production_stats`，应该单独立项做“产出统计语义扩展”，并在那次统一扩展 snapshot 的记录来源。T097 只修“空转生产建筑被算进产出”的 bug，不应顺手把统计边界改大。

## 10. 最终推荐

采用**方案 C：ProductionSettlementSnapshot**。

原因不是“它看起来更正式”，而是它在这个代码库里同时满足了三件最重要的事：

- 统计来源正确：只认真实落库。
- 结构解耦：`stats` 不解析通用事件 payload。
- world 语义清晰：与现有 `PowerSnapshot` 一样按 `WorldState` 挂载。

这会把 T097 从“补一个过滤条件”提升为“一次把生产统计事实源头纠正过来”，并且不会引入新的包装层或兼容层。
