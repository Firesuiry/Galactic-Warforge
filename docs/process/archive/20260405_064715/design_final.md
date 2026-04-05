# T097 最终实现方案：以真实落库快照修正生产统计

## 0. 输入说明

当前仓库根路径下不存在用户描述的 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`。本文基于仓库中最新一组同时存在的归档设计稿综合生成：

- `docs/process/archive/20260405_050844/design_claude.md`
- `docs/process/archive/20260405_050844/design_codex.md`

综合原则：

- 保留 Claude 方案对“真实产出必须以实际落库为准”的判断。
- 采用 Codex 方案对“统计模块不直接依赖通用事件 payload，而改为消费强类型快照”的实现方式。
- 最终方案必须符合 `docs/process/rules/架构设计规范.md` 中“尽可能解耦合、实现简单直接”的要求。

## 1. 目标与最终裁决

本次修复的目标不是继续优化“理论产能统计”，而是把 `production_stats` 的事实来源彻底改为“当前 tick 内真实落库的产物数量”。

最终裁决如下：

1. 不再使用 `Runtime.Functions.Production.Throughput` 作为 `production_stats` 的统计来源。
2. 不让 `updateProductionStats` 直接解析通用 `EvtResourceChanged` 事件。
3. 在 `settleProduction` 内，当产物真实写入库存时，同步写入一份挂在 `WorldState` 上的强类型 `ProductionSettlementSnapshot`。
4. `production_stats.total_output`、`by_building_type`、`by_item` 全部从这份快照读取。
5. `Efficiency` 继续沿用 `ProductionMonitor` 的采样口径，但每 tick 必须显式重置，避免残留上一 tick 的值。

这条路径同时满足两份设计稿的核心诉求：

- 统计口径必须真实。
- 模块边界必须清晰。

## 2. 问题定义

当前错误的根因是：旧实现把“具备生产能力”误当成“已经产生了真实产出”。

典型错误表现：

- 没有 `RecipeID` 的建筑也会被算进 `total_output`
- 缺料、空转、库存阻塞、停机建筑会被算进 `total_output`
- `ByItem` 没有可信来源，初始化后却没有被真实填充
- 统计结果反映的是建筑理论能力，而不是本 tick 实际落库的物品数量

这会直接污染以下消费面：

- `GET /state/stats`
- `client-cli` 的 `stats` 命令
- `client-web` 后续任何依赖 `production_stats` 的展示

## 3. 两份方案的共识与取舍

### 3.1 共识

两份设计在下面几个判断上完全一致：

- `Throughput` 不能继续作为真实产出统计来源
- 只有“产物真正写入库存”这一刻，才算真实产出发生
- 本次不需要修改 API shape，也不需要新增 CLI 命令
- 必须补齐自动化测试，并覆盖官方 midgame 的复现场景

### 3.2 分歧

分歧仅在“统计如何接入真实产出事实”：

- Claude 方案主张：直接遍历当前 tick 的 `EvtResourceChanged` 事件来累计真实产出
- Codex 方案主张：在生产结算阶段同步写强类型快照，让 `stats` 只读快照

### 3.3 取舍理由

最终采用 Codex 的快照实现，但保留 Claude 对事实时机的判断。

原因：

- `EvtResourceChanged` 是通用资源变化事件，不只服务生产
- 事件 payload 是 `map[string]any`，直接依赖它会让 `stats` 与外部广播协议耦合
- `WorldState` 级快照天然具备 world 边界，避免跨星球事件混入当前统计
- 生产结算与统计消费之间通过强类型快照连接，结构更直接，也更符合本仓库的架构偏好

最终依赖方向必须固定为：

- `生产结算 -> ProductionSettlementSnapshot`
- `生产结算 -> EvtResourceChanged`
- `stats / query / API / CLI / Web -> ProductionSettlementSnapshot`

不能做成：

- `生产结算 -> EvtResourceChanged -> stats`

## 4. 最终架构设计

### 4.1 新增 authoritative 生产快照

在 `server/internal/model/production_settlement_snapshot.go` 中定义：

```go
type ProductionSettlementSnapshot struct {
    Tick    int64                               `json:"tick"`
    Players map[string]PlayerProductionSnapshot `json:"players,omitempty"`
}

type PlayerProductionSnapshot struct {
    TotalOutput    int            `json:"total_output"`
    ByBuildingType map[string]int `json:"by_building_type,omitempty"`
    ByItem         map[string]int `json:"by_item,omitempty"`
}
```

并在 `server/internal/model/world.go` 的 `WorldState` 上挂载：

```go
ProductionSnapshot *ProductionSettlementSnapshot `json:"-"`
```

同时提供两个 helper：

```go
func NewProductionSettlementSnapshot(tick int64) *ProductionSettlementSnapshot
func CurrentProductionSettlementSnapshot(ws *WorldState) *ProductionSettlementSnapshot
```

约束：

- 只认当前 `ws.Tick` 的快照
- 不做 fallback 重建
- 当前 tick 没有快照时，统计视为无真实产出，而不是回退到静态 `Throughput`

### 4.2 快照负责聚合真实产出

聚合逻辑不散落在 `gamecore`，而是封装成：

```go
func (s *ProductionSettlementSnapshot) RecordBuildingOutputs(building *Building, outputs []ItemAmount)
```

该方法负责：

- 忽略 `nil building`
- 忽略空 owner
- 忽略空输出和 `qty <= 0` 条目
- 以 `building.OwnerID` 聚合玩家维度统计
- 更新 `TotalOutput`
- 更新 `ByBuildingType`
- 更新 `ByItem`

统计单位为“真实落库的物品数量”，不是“完成了几次配方”。

主产物和副产物都要计入。

### 4.3 `settleProduction` 改为在真实落库时写快照

`server/internal/gamecore/production_settlement.go` 的职责调整为：

1. 为当前 tick 准备 `ProductionSettlementSnapshot`
2. 遍历可生产建筑
3. 只有在真实落库时才记账
4. 用同一份 `combinedOutputs` 同时驱动快照与事件

真实落库成立的前提必须同时满足：

- 建筑拥有 `Production` 模块
- `RecipeID != ""`
- 建筑处于 `running`
- `PendingOutputs` 或 `PendingByproducts` 存在
- `canStoreOutputs(...)` 通过
- `storeOutputs(...)` 成功把产物写入库存

推荐伪代码：

```go
func settleProduction(ws *model.WorldState) []*model.GameEvent {
    if ws == nil {
        return nil
    }

    snapshot := model.CurrentProductionSettlementSnapshot(ws)
    if snapshot == nil {
        snapshot = model.NewProductionSettlementSnapshot(ws.Tick)
        ws.ProductionSnapshot = snapshot
    }

    var events []*model.GameEvent
    for _, building := range ws.Buildings {
        // 现有前置校验...

        if len(state.PendingOutputs) > 0 || len(state.PendingByproducts) > 0 {
            combinedOutputs := combineItemAmounts(state.PendingOutputs, state.PendingByproducts)
            if !canStoreOutputs(building.Storage, combinedOutputs) {
                continue
            }

            storeOutputs(building.Storage, combinedOutputs)
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
    }
    return events
}
```

关键约束：

- 事件与快照必须来自同一份 `combinedOutputs`
- 只有真实落库后才允许写快照
- 不能先发事件，再让统计去反向猜测真实产出

### 4.4 `updateProductionStats` 只消费快照

`server/internal/gamecore/stats_settlement.go` 中的 `updateProductionStats` 改为：

1. 每 tick 显式重置 `TotalOutput`、`ByBuildingType`、`ByItem`、`Efficiency`
2. 读取 `CurrentProductionSettlementSnapshot(gc.world)`
3. 如果当前玩家有快照数据，则拷贝到 `player.Stats.ProductionStats`
4. `Efficiency` 仍单独基于 `ProductionMonitor` 计算

推荐结构：

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

    // efficiency 继续沿用 ProductionMonitor 的采样值
}
```

这里的重点不是“怎么重新统计效率”，而是：

- `production_stats` 的数量类字段完全来自快照
- `Efficiency` 必须每 tick 清零后重算，不能残留旧值

### 4.5 world 边界保持不变

由于快照直接挂在 `WorldState` 上，因此：

- 当前 active world 只读取自己的 `ProductionSnapshot`
- 不会混入其他星球/world 的产出
- `query.Stats`、`GET /state/stats`、CLI、Web 都无需额外增加 world 过滤逻辑

这也是快照方案优于“从 `GameCore` 全量事件列表中回捞”的关键原因之一。

## 5. 文件改动范围

### 5.1 必改代码文件

- `server/internal/model/world.go`
- `server/internal/model/production_settlement_snapshot.go`（新增）
- `server/internal/gamecore/production_settlement.go`
- `server/internal/gamecore/stats_settlement.go`

### 5.2 大概率无需改代码的文件

- `server/internal/query/stats.go`
- `server/internal/gateway/server.go`
- `client-cli/src/format.ts`
- `client-web`

这些模块当前只是消费 `player.Stats` 或其 API 结果，不负责重新计算产出。

### 5.3 需要同步更新的文档

虽然 API 结构不变，但语义修正后仍要同步更新说明：

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`

需要明确：

- `production_stats.total_output`
- `production_stats.by_building_type`
- `production_stats.by_item`

这三项表示的是“当前 active world、当前 tick、真实落库的产物数量”。

## 6. 实施步骤

推荐按下面顺序实施：

1. 新增 `ProductionSettlementSnapshot` 与 `WorldState.ProductionSnapshot`
2. 在 `settleProduction` 中把真实落库的 `combinedOutputs` 写入快照
3. 修改 `updateProductionStats`，改为只消费快照并显式重置效率
4. 补齐回归测试
5. 更新 API / CLI 文档中的统计语义说明
6. 用官方 midgame 场景做一次手工复测

## 7. 测试与验收

### 7.1 结算级回归测试

建议新增或完善 `server/internal/gamecore/stats_settlement_test.go`，至少覆盖：

1. `TestProductionStats_NoRecipe_ZeroOutput`
   - 无配方建筑不计入产出
2. `TestProductionStats_InputShortage_ZeroOutput`
   - 有配方但缺料时不计入产出
3. `TestProductionStats_SiloNoRocket_ZeroOutput`
   - 默认挂配方但空转的 silo 不计入产出
4. `TestProductionStats_RealProduction_Counted`
   - 真实产出时 `total_output`、`by_building_type`、`by_item` 同步增长
5. `TestProductionStats_Byproducts_Counted`
   - 副产物也计入同一统计口径

关键断言：

- `sum(by_building_type) == total_output`
- `sum(by_item) == total_output`

### 7.2 官方 midgame 复现回归

建议增加专门的 midgame 回归测试，例如：

- `server/internal/gamecore/t097_midgame_stats_test.go`

覆盖场景：

- `recomposing_assembler` 无配方
- `self_evolution_lab` 无配方或缺料
- `vertical_launching_silo` 默认挂配方但没有真实火箭产出

断言：

- `production_stats.total_output == 0`
- `by_building_type` 中不出现这些空转建筑的虚假产出
- `by_item` 为空
- `Efficiency` 在无有效采样时被重置为 `0`

### 7.3 手工验收

手工验收至少覆盖：

- `client-cli` 的 `stats` 输出不再出现空转建筑的虚假产出
- `GET /state/stats` 返回的 `production_stats` 与真实玩法一致
- `client-web` 在读取修正后的统计数据时不报错

## 8. 风险与边界

### 8.1 不做事件驱动统计

事件仍然保留，但其职责是广播，不是 authoritative 统计源。

这样可以避免：

- `stats` 依赖 `map[string]any`
- 不同类型的 `EvtResourceChanged` 混在一起后再额外筛选
- 后续 SSE payload 变更时被动破坏统计模块

### 8.2 当前 tick 没有快照时宁可为 0，也不回退到理论值

这是刻意选择，而不是缺陷。

原因：

- 真实产出是结算事实，不应该由统计层事后猜测
- 回退到 `Throughput` 会重新引入本次要修掉的失真问题

### 8.3 后续扩展应复用同一快照

如果未来要把采矿、轨采、接收站 photon 模式或其他真实产出链路也纳入 `production_stats`，应继续复用同一份 `ProductionSettlementSnapshot`，而不是再加第二套统计通道。

也就是说，这次方案不仅修 T097，本质上也确立了未来所有“真实产出统计”应遵循的统一结构。

## 9. 最终结论

最终方案确定为：

- 用“真实落库”替代“静态产能”作为生产统计事实来源
- 用 `ProductionSettlementSnapshot` 替代“直接解析通用事件”作为统计实现路径
- 用同一份 authoritative 快照统一驱动 `total_output`、`by_building_type`、`by_item`

这是两份设计稿中唯一同时满足“统计真实”“实现直接”“模块低耦合”的方案，也是本仓库最应该采用的最终实现路径。
