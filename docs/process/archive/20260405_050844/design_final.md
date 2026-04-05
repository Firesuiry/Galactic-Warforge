# T097 最终设计方案：以真实落库快照修正生产统计

## 1. 目标与结论

本方案综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md` 两份设计，给出唯一推荐实现路径：

- 生产统计的事实来源必须从“静态产能”改为“本 tick 真实落库的产物数量”。
- 最终实现不让 `stats` 直接解析通用 `EvtResourceChanged` 事件，而是在 `settleProduction` 内同步写入一份按 `WorldState` 隔离的强类型 `ProductionSettlementSnapshot`。
- `production_stats.total_output`、`by_building_type`、`by_item` 全部从这份快照读取。

最终推荐方案：

- 采纳 `design_claude.md` 对“真实产出必须以实际落库为准”的判断。
- 采纳 `design_codex.md` 对“不要让统计模块依赖通用事件 payload，而要使用强类型快照”的架构实现。

## 2. 问题定义

当前 `server/internal/gamecore/stats_settlement.go` 的 `updateProductionStats` 只要看到建筑存在 `Runtime.Functions.Production`，就把其静态 `Throughput` 计入：

- `total_output`
- `by_building_type`

这会导致以下错误：

- 没有 `RecipeID` 的建筑被计入产出。
- 缺料、停机、库存阻塞、空转建筑被计入产出。
- `ByItem` 没有真实来源，初始化后却从未正确填充。
- 统计反映的是机器理论能力，而不是本 tick 实际产出的物品数量。

这会直接污染：

- `GET /state/stats`
- `client-cli` 的 `stats` 命令
- `client-web` 后续展示生产统计时的数据可信度

## 3. 两份方案的共识与裁决

### 3.1 共识

两份设计在核心判断上是一致的：

- 不能继续使用 `Throughput` 作为生产统计来源。
- 真实产出发生的唯一正确时机，是产物真正写入库存的那一刻。
- API shape 不需要改，修复的是服务端统计语义。
- 需要补齐自动化回归测试，并覆盖 midgame 复现场景。

### 3.2 分歧点

分歧只在实现路径：

- `design_claude.md` 倾向于直接遍历当前 tick 的 `EvtResourceChanged` 事件来累计真实产出。
- `design_codex.md` 倾向于在 `settleProduction` 内直接生成强类型快照，让 `stats` 消费快照而非事件。

### 3.3 最终裁决

最终采用“事件定义真实时机，但统计不依赖事件协议”的折中方案：

- `EvtResourceChanged` 仍然是“真实产出发生”的外部广播信号。
- 但 `stats` 不直接解析 `map[string]any` payload。
- 在 `settleProduction` 内，当产物真正落库时，用同一份 `combinedOutputs` 同时：
  - 写入 `ProductionSettlementSnapshot`
  - 生成 `EvtResourceChanged`

这样既保留了 `design_claude.md` 对真实事实源的判断，也满足了 `docs/process/rules/架构设计规范.md` 要求的低耦合。

## 4. 最终设计

### 4.1 新增生产结算快照

在 `server/internal/model/` 下新增强类型快照，建议文件：

- `server/internal/model/production_settlement_snapshot.go`

建议结构：

```go
type ProductionSettlementSnapshot struct {
    Tick    int64                             `json:"tick"`
    Players map[string]PlayerProductionSnapshot `json:"players,omitempty"`
}

type PlayerProductionSnapshot struct {
    TotalOutput    int            `json:"total_output"`
    ByBuildingType map[string]int `json:"by_building_type,omitempty"`
    ByItem         map[string]int `json:"by_item,omitempty"`
}
```

同时在 `server/internal/model/world.go` 的 `WorldState` 上增加：

```go
ProductionSnapshot *ProductionSettlementSnapshot `json:"-"`
```

再提供两个 helper：

```go
func NewProductionSettlementSnapshot(tick int64) *ProductionSettlementSnapshot
func CurrentProductionSettlementSnapshot(ws *WorldState) *ProductionSettlementSnapshot
```

约束：

- 只返回当前 `ws.Tick` 的快照。
- 不做 fallback 重建。
- 如果本 tick 没有快照，则视为没有真实产出统计，而不是退回到静态 `Throughput`。

### 4.2 快照记录接口

把聚合逻辑放进快照方法里，避免散落在 `gamecore`：

```go
func (s *ProductionSettlementSnapshot) RecordBuildingOutputs(building *Building, outputs []ItemAmount)
```

职责：

- 忽略 `nil building`、空 owner、空 outputs、`qty <= 0` 的条目。
- 以 `building.OwnerID` 聚合玩家级统计。
- `TotalOutput += sum(outputs.Quantity)`
- `ByBuildingType[string(building.Type)] += sum(outputs.Quantity)`
- `ByItem[itemID] += quantity`

统计口径：

- 主产物计入。
- 副产物也计入。
- 单位是“实际落库的物品数量”，不是“完成了几次配方”。

### 4.3 生产结算链路调整

修改 `server/internal/gamecore/production_settlement.go`。

`settleProduction(ws)` 的新职责：

1. tick 开始时创建空的 `ProductionSettlementSnapshot` 并挂到 `ws.ProductionSnapshot`。
2. 仅当建筑真实完成本轮生产且产物成功写入库存时，才记账。
3. 主产物与副产物合并为同一份 `combinedOutputs`。
4. 用这份 `combinedOutputs` 同时写快照和发事件。

关键时机必须满足：

- 建筑具备 `Production` 模块。
- `RecipeID != ""`。
- 建筑确实处于可运行状态。
- `PendingOutputs` / `PendingByproducts` 通过 `canStoreOutputs`。
- 产物真正写入库存。

伪代码：

```go
func settleProduction(ws *model.WorldState) []*model.GameEvent {
    if ws == nil {
        return nil
    }

    snapshot := model.NewProductionSettlementSnapshot(ws.Tick)
    ws.ProductionSnapshot = snapshot

    var events []*model.GameEvent
    for _, building := range ws.Buildings {
        // ... 现有前置校验

        if len(state.PendingOutputs) > 0 || len(state.PendingByproducts) > 0 {
            if !canStoreOutputs(...) {
                continue
            }

            combinedOutputs := append(
                cloneItemAmounts(state.PendingOutputs),
                cloneItemAmounts(state.PendingByproducts)...,
            )

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
    }

    return events
}
```

关键约束：

- 事件与快照必须来自同一份 `combinedOutputs`。
- 不允许做成 `生产结算 -> 事件 -> 统计`。
- 正确依赖方向应为：
  - `生产结算 -> 快照`
  - `生产结算 -> 事件`
  - `统计/API/UI -> 快照`

### 4.4 生产统计改为读取快照

修改 `server/internal/gamecore/stats_settlement.go` 中的 `updateProductionStats`。

新逻辑：

- 每 tick 先清空 `TotalOutput`、`ByBuildingType`、`ByItem`、`Efficiency`。
- 从 `model.CurrentProductionSettlementSnapshot(gc.world)` 读取当前 world 的快照。
- 若存在当前玩家的聚合结果，则拷贝到 `player.Stats.ProductionStats`。
- `Efficiency` 仍使用 `ProductionMonitor` 的采样值单独计算。

建议结构：

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

    // efficiency 保持现有监控口径，单独统计
}
```

这里顺手修复一个现有隐患：

- 当本 tick 没有符合条件的生产建筑时，`Efficiency` 必须显式归零，避免沿用上一 tick 的残留值。

### 4.5 world 边界保持清晰

因为快照直接挂在 `WorldState` 上，所以：

- 当前 active world 只读取自己的生产快照。
- 不会混入其他星球或其他 world 的产出。
- `query.Stats`、`GET /state/stats`、`client-cli`、`client-web` 都无需引入额外 world 过滤逻辑。

这比从 `GameCore` 聚合事件列表中反向筛选更干净。

## 5. 文件改动范围

### 5.1 必改文件

- `server/internal/model/world.go`
- `server/internal/model/production_settlement_snapshot.go`（新增）
- `server/internal/gamecore/production_settlement.go`
- `server/internal/gamecore/stats_settlement.go`

### 5.2 预期无需改行为的文件

- `server/internal/query/stats.go`
- `server/internal/gateway/server.go`
- `client-cli/src/format.ts`
- `client-web` 现有生产统计消费代码

原因：

- 本次不修改 API 结构。
- 只修正服务端统计事实来源与语义。

## 6. 对外语义与文档同步

本次不改接口 shape，但会改变字段语义，实施完成后必须同步文档：

- `docs/dev/服务端API.md`
  - 明确 `production_stats.total_output`、`by_building_type`、`by_item` 表示“当前 active world、当前 tick、真实落库的产物数量”。
- `docs/dev/客户端CLI.md`
  - 如果 `stats` 命令描述中写了“总产出”语义，必须同步为相同口径。

说明：

- `total_output` 的数值相较旧实现会显著下降，这是正确修复，不是回归。

## 7. 测试方案

### 7.1 结算级回归测试

新增建议：

- `server/internal/gamecore/stats_settlement_test.go`

至少覆盖以下用例：

1. `TestProductionStats_NoRecipe_ZeroOutput`
   - 有生产模块，但 `RecipeID == ""`
   - 断言 `total_output == 0`
   - 断言 `by_building_type` 不含该建筑类型
   - 断言 `by_item` 为空

2. `TestProductionStats_InputShortage_ZeroOutput`
   - 有合法配方，但不给输入原料
   - 断言 `total_output == 0`

3. `TestProductionStats_SiloNoRocket_ZeroOutput`
   - `vertical_launching_silo` 挂默认配方但无输入
   - 断言 `total_output == 0`
   - 断言 `by_item` 为空

4. `TestProductionStats_RealProduction_Counted`
   - 提供完整原料，确保建筑真实完成一次落库
   - 断言 `total_output > 0`
   - 断言 `by_building_type[buildingType] > 0`
   - 断言 `by_item` 有对应产物
   - 断言 `sum(by_building_type) == total_output`
   - 断言 `sum(by_item) == total_output`

5. `TestProductionStats_Byproducts_Counted`
   - 选择带副产物的配方
   - 断言主产物和副产物都进入 `by_item`
   - 断言 `total_output` 等于两者数量之和

### 7.2 官方场景回归

建议新增 midgame 回归测试，例如：

- `server/internal/gamecore/t097_midgame_stats_test.go`

复现官方中盘档中暴露问题的建筑状态，至少覆盖：

- `recomposing_assembler` 无配方
- `self_evolution_lab` 无配方或缺料
- `vertical_launching_silo` 有默认配方但无输入

断言：

- `production_stats.total_output == 0`
- `by_building_type` 不再出现这些虚假产出
- `by_item` 为空

### 7.3 实施后的人工验证

实现完成后需要做最小人工复测：

- `client-cli`
  - 执行 `stats`，确认不再显示虚假的生产建筑产出。
- `client-web`
  - 用浏览器打开并检查页面正常展示，确保建筑操作、兵力调配、局势展示没有因统计语义修正而出错。

## 8. 实施顺序

1. 在 `model` 层新增 `ProductionSettlementSnapshot` 与 helper。
2. 在 `WorldState` 上挂 `ProductionSnapshot`。
3. 修改 `settleProduction`，在真实落库时用 `combinedOutputs` 同步写快照和发事件。
4. 修改 `updateProductionStats`，改为消费快照并显式清零 `Efficiency`。
5. 补结算级测试与 midgame 回归测试。
6. 更新 `docs/dev/服务端API.md` 与 `docs/dev/客户端CLI.md`。
7. 跑服务端测试，并完成 CLI/Web 人工复测。

## 9. 风险与边界

### 9.1 不做补丁式过滤方案

不采用“继续遍历建筑，再补 `recipe_id` / `input_shortage` / `efficiency` 过滤”的方案，因为它仍然有两个根本问题：

- 统计来源仍是静态 `Throughput`
- `ByItem` 仍没有可信事实源

这只能减轻失真，不能修正口径。

### 9.2 不让 stats 依赖通用事件 payload

不采用“让 `updateProductionStats` 直接遍历 `EvtResourceChanged`”作为最终实现，因为：

- 会让统计逻辑依赖 `map[string]any`
- 需要手工区分生产、能量、资源变化事件
- 会放大事件协议调整对统计模块的影响

事件保留，但只作为对外广播，不作为统计内部依赖。

### 9.3 本次不扩大统计边界

本次只修复“空转生产建筑误计入产出”。

不顺手把以下系统并入 `production_stats`：

- `Collect` 建筑
- 轨道采集器
- 接收站 photon 模式

如果后续产品定义要扩大统计范围，应单独立项，在那次统一扩展快照记录来源。

## 10. 最终结论

最终方案确定为：

- 用“真实落库”替换“静态产能”作为生产统计事实源。
- 用 `ProductionSettlementSnapshot` 作为内部 authoritative state。
- 事件继续保留，但不作为 `stats` 的直接输入。

这是当前代码库里最直接、最解耦、也最不容易再次失真的实现方式。
