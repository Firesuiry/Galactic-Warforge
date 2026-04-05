# T096 最终设计方案：`ray_receiver power` authoritative 电力结算收口

## 1. 文档目标

本文综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，并以当前仓库代码现状为准，输出 T096 的单一定稿方案。

本轮只收口 `docs/process/task/T096_官方midgame下戴森接收站power模式实战不回灌最终电网.md` 描述的问题，不顺手扩展成其它电力系统重做任务。

本轮目标只有 4 个：

1. 让 `ray_receiver` 在 `power` 模式下的收益进入同一份 authoritative tick 结果。
2. 让 `summary`、`stats`、`/world/planets/{planet_id}/networks`、`inspect` 在同一 tick 读取同一份结算事实。
3. 消除电力链路在同一 tick 内多次改写 `player.Resources.Energy` 造成的中间态抖动。
4. 补一条官方 midgame 风格的真实链路回归，锁死 T096 复现路径。

明确不做的事：

- 不在 query 层单独补假值。
- 不把 `power` 模式改成“自动清空旧的 `critical_photon` 库存”。
- 不修改 `ray_receiver` 的连接距离或电网拓扑规则。
- 不顺手扩成跨全部星球的总能源统计；保持当前 active planet 语义。

## 2. 基于当前实现的事实判断

### 2.1 当前 tick 顺序本身已经正确

当前 `server/internal/gamecore/core.go` 的相关顺序已经是：

1. `settlePowerGeneration`
2. `settleSolarSails`
3. `settleDysonSpheres`
4. `settleRayReceivers`
5. `settlePlanetaryShields`
6. `settleResources`
7. `settleStats`

因此，`design_claude.md` 中把主因归结为“射线接收站结算发生在太阳帆 / 戴森能量刷新之前”的判断，在当前代码上已经不成立，不能进入最终方案。

### 2.2 `power` / `photon` / `hybrid` 模式公式已经正确

当前 `server/internal/model/ray_receiver.go` 已经满足：

- `power`：产电，不新增新的 `critical_photon`
- `photon`：只产光子，不产电
- `hybrid`：先产电，再把剩余能量转为光子

`server/internal/gamecore/planet_commands.go` 也已经把 `set_ray_receiver_mode` 直接写回建筑运行态。

因此，T096 不应该再按“模式分支实现错误”处理。最终方案只需要保证这份正确语义，能够稳定体现在 authoritative 查询结果中。

### 2.3 当前真实问题是“多写入点 + 多口径读取”

当前电力链路里，`player.Resources.Energy` 会在同一 tick 内被多个阶段直接改写：

- `server/internal/gamecore/power_generation.go`
  - 按常规发电机输出追加 `ws.PowerInputs`
  - 同时直接累加 `player.Resources.Energy`
  - 同时发 `EvtResourceChanged`
- `server/internal/gamecore/ray_receiver_settlement.go`
  - 追加 `PowerSourceRayReceiver`
  - 同时再次直接累加 `player.Resources.Energy`
  - 同时再次发 `EvtResourceChanged`
- `server/internal/gamecore/rules.go` 的 `settleResources()`
  - 先 `settleEnergyStorage(ws)`
  - 再按建筑循环用 `alloc.Allocated` 扣 `player.Resources.Energy`
  - 对部分非发电建筑再次按 `Runtime.Params.EnergyGenerate` 回加能量
  - 再按建筑逐条发 `EvtResourceChanged`

而 4 个观察面当前又不是读同一份状态：

1. `summary` 读的是 tick 末尾的 `player.Resources.Energy`
2. `stats` 读的是 `ResolvePowerNetworks()` / `ResolvePowerAllocations()` 重新聚合出的结果
3. `networks` 也在 query 时重算网络与分配
4. `inspect` 只能看到运行态与库存，无法回答“这个接收站本 tick 到底回灌了多少电”

这说明当前不是“射线接收站完全没回灌”，而是“同一 tick 没有单一 authoritative 电力结算结果”。

### 2.4 电网连通性是诊断点，但不是本轮主修复

`design_claude.md` 提到的“`ray_receiver` 可能因连接范围为 1 而落到孤立网络”是可能的边界情况。

这类情况确实会导致：

- `ray_receiver` 的 `supply` 进入另一个网络
- 主网络看不到这部分供给

但这不是 T096 的核心系统性修复点。最终方案不能靠改连接范围或放宽拓扑规则来掩盖 authoritative 结算缺失的问题。

正确做法是：

- 保持现有连通性规则不变
- 让 `inspect` / `networks` 能明确暴露 `network_id`
- 把“是否孤网”变成可见诊断事实，而不是隐式猜测

## 3. 方案取舍

### 3.1 方案 A：继续在 query 层补丁式修读数

做法：

- 在 `summary`、`stats`、`networks`、`inspect` 各自补算一次接收站收益

不采用。

原因：

- 会制造第二套真相。
- 与项目“直接重构，不加兼容层”的准则冲突。
- 不能解决 tick 内多次 `resource_changed` 与多次能量写回的问题。

### 3.2 方案 B：只在 `core.go` 末尾做 `resource_changed` 去重

做法：

- 保留现有多个阶段直接改 `player.Resources.Energy`
- 在事件发布前只保留最后一条 `resource_changed`

不采用。

原因：

- 这只能压掉症状，不能统一 `summary / stats / networks / inspect` 的底层事实。
- 只要多写入点还在，最终 `summary` 与 query 重算结果仍可能分叉。
- `settleResources()` 中按建筑扣能量、回加能量的旧路径仍然存在，系统语义依旧混乱。

### 3.3 方案 C：引入单次 authoritative 电力结算快照

做法：

- 本 tick 所有电源先只收集到 `ws.PowerInputs`
- 再统一完成储能参与、网络聚合、供电分配与玩家能量提交
- `summary / stats / networks / inspect` 全部读取这份最终结果

采用。

原因：

- 直接命中 T096 的 4 个目标。
- 可以根除“同一 tick 多次改写电量”的结构性问题。
- 保留现有 `ResolvePowerNetworks()` / `ResolvePowerAllocations()` 算法，不需要推翻已经正确的电网聚合层。

## 4. 最终实现方案

### 4.1 新增 `PowerSettlementSnapshot` 作为本 tick 唯一电力真相

在 `server/internal/model` 新增 transient 结构，并挂到 `WorldState`：

```go
type PowerSettlementSnapshot struct {
    Tick        int64
    Inputs      []PowerInput
    Coverage    map[string]PowerCoverageResult
    Networks    PowerNetworkState
    Allocations PowerAllocationState
    Players     map[string]PlayerPowerSnapshot
    Receivers   map[string]RayReceiverSettlementView
}

type PlayerPowerSnapshot struct {
    StartEnergy int
    Generation  int
    Demand      int
    Allocated   int
    NetDelta    int
    EndEnergy   int
}

type RayReceiverSettlementView struct {
    BuildingID            string
    Mode                  RayReceiverMode
    AvailableDysonEnergy  int
    EffectiveInput        int
    PowerOutput           int
    PhotonOutput          int
    NetworkID             string
    SettledTick           int64
}
```

`WorldState` 新增：

```go
PowerSnapshot *PowerSettlementSnapshot `json:"-"`
```

设计要求：

- `PowerSnapshot` 只表示“本 tick 最终 authoritative 电力结算结果”。
- 它是运行时瞬态，不做新的长期持久化模型。
- query 层优先读取 `ws.PowerSnapshot`。
- 如果在极少数初始化场景下 `PowerSnapshot == nil`，只能调用同一个 builder 生成，不能在 query 层另写一套算法。

### 4.2 各结算阶段改为“只收集输入，不直接提交玩家能量”

#### 4.2.1 `settlePowerGeneration()`

保留：

- 清空 `ws.PowerInputs`
- 计算风机、光伏、燃烧发电等基础电源输出
- 把结果写入 `ws.PowerInputs`

删除：

- `generatedByPlayer`
- 直接写 `player.Resources.Energy`
- 在这里发 `EvtResourceChanged`

结果：

- 本阶段只负责生成 `PowerInput`
- 玩家最终电量只能在统一提交阶段写回

#### 4.2.2 `settleRayReceivers()`

保留：

- 读取太阳帆 / 戴森球可用能量
- 走现有 `ResolveRayReceiver()` 模式公式
- `power` 模式下不新增新的 `critical_photon`
- 保留切模式前已有的 `critical_photon` 库存
- 把 `PowerSourceRayReceiver` 写入 `ws.PowerInputs`

新增：

- 返回或记录每个接收站的 `RayReceiverSettlementView`
  - `AvailableDysonEnergy`
  - `EffectiveInput`
  - `PowerOutput`
  - `PhotonOutput`
  - `Mode`

删除：

- 在这里直接改 `player.Resources.Energy`
- 在这里发 `EvtResourceChanged`

结果：

- 接收站仍然是动态电源
- 但它的收益只在最终统一提交时进入玩家能量库存

#### 4.2.3 `settleEnergyStorage()`

保留现有方向：

- 根据网络盈亏决定储能充放电
- 放电结果继续写回 `ws.PowerInputs`
- 充放电仍然更新储能建筑内部状态

但明确要求：

- 不能直接改 `player.Resources.Energy`
- 它属于 authoritative 电力结算的一部分，应在统一阶段内参与，而不是成为额外写入点

### 4.3 新增 `finalizePowerSettlement()` 统一提交电力结果

在 `server/internal/gamecore/core.go` 中，在电源都已收集完成之后、`settleResources()` 之前新增统一收口阶段：

```go
receiverViews := settleRayReceivers(ws)
settlePlanetaryShields(ws)
events := finalizePowerSettlement(ws, receiverViews)
events = append(events, settleResources(ws)...)
```

`finalizePowerSettlement()` 的职责：

1. 执行 `settleEnergyStorage(ws)`，拿到最终 `ws.PowerInputs`
2. 通过现有 `ResolvePowerCoverage()` / `ResolvePowerNetworks()` / `ResolvePowerAllocations()` 生成最终 coverage、网络与分配结果
3. 统计每个玩家的：
   - `StartEnergy`
   - `Generation`
   - `Demand`
   - `Allocated`
   - `NetDelta`
   - `EndEnergy`
4. 将 `network_id` 回填到 `RayReceiverSettlementView`
5. 把结果写入 `ws.PowerSnapshot`
6. 一次性提交 `player.Resources.Energy`
7. 对同一玩家在同一 tick 最多发 1 条电力相关 `EvtResourceChanged`

统一提交的核心语义：

- `Generation` 来自最终网络 `Supply`
- `Allocated` 来自最终网络 `Allocated`
- `NetDelta = Generation - Allocated`
- `EndEnergy = clamp(StartEnergy + NetDelta, 0, 10000)`

这里采用 `design_codex.md` 的主思路，但保留 `design_claude.md` 对当前代码路径的核对结论：不重做 tick 顺序，不重写射线接收站公式，而是收敛提交时点。

### 4.4 `settleResources()` 只消费 allocation，不再直接结算玩家电量

`server/internal/gamecore/rules.go` 中的 `settleResources()` 需要保留“建筑按供电比例运行”的职责，但删除“建筑逐个扣写玩家能量”的旧语义。

保留：

- 基于 `ws.PowerSnapshot.Coverage` / `ws.PowerSnapshot.Allocations` 判定建筑是否通电、是否降额运行
- 根据 `alloc.Ratio` 决定建筑是否 `running`、`no_power`、是否降额运行
- 维护费、采集、生产、建筑状态迁移

删除：

- `player.Resources.Energy -= effectiveEnergyCost`
- 对非发电建筑按 `Runtime.Params.EnergyGenerate` 回加能量
- 因电力变化而在这里重复发 `EvtResourceChanged`

结果：

- 建筑是否拿到电，完全由 authoritative allocation 决定
- 玩家电量只在 `finalizePowerSettlement()` 提交一次
- 建筑遍历顺序不再影响最终能量结果

### 4.5 `inspect / stats / networks / summary` 全部对齐到 snapshot

#### 4.5.1 `summary`

`server/internal/query/query.go` 继续读取 `player.Resources.Energy`。

但此时该字段已经是 authoritative 提交后的最终值，因此会与网络与统计口径一致。

#### 4.5.2 `stats`

`server/internal/gamecore/stats_settlement.go` 的 `buildPlayerEnergyStats()` 改为优先读取：

- `ws.PowerSnapshot.Players[playerID].Generation`
- `ws.PowerSnapshot.Players[playerID].Allocated`

只有在 `snapshot` 缺失时，才允许调用同一个 builder 做同源 fallback。

#### 4.5.3 `networks`

`server/internal/query/networks.go` 改为优先读取：

- `ws.PowerSnapshot.Coverage`
- `ws.PowerSnapshot.Networks`
- `ws.PowerSnapshot.Allocations`

这样 `networks.power_networks[].supply` 与 `stats.energy_stats.generation` 保证来自同一份底层结果。

#### 4.5.4 `inspect`

`server/internal/query/planet_inspector.go` 需要在 `PlanetInspectView` 上新增只读观测字段，例如：

```go
type PlanetInspectView struct {
    ...
    Building *model.Building          `json:"building,omitempty"`
    Power    *BuildingPowerInspectView `json:"power,omitempty"`
}
```

其中 `Power` 的结构为：

```go
type BuildingPowerInspectView struct {
    NetworkID            string `json:"network_id,omitempty"`
    SettledTick          int64  `json:"settled_tick,omitempty"`
    AvailableDysonEnergy int    `json:"available_dyson_energy,omitempty"`
    EffectiveInput       int    `json:"effective_input,omitempty"`
    PowerOutput          int    `json:"power_output,omitempty"`
    PhotonOutput         int    `json:"photon_output,omitempty"`
}
```

该字段的数据源统一来自 `ws.PowerSnapshot.Receivers[buildingID]`。

这样可以直接回答：

- 接收站本 tick 是否真的在回灌电网
- 它属于哪个网络
- 它是否仍在新增光子

并把“孤立网络”从推测问题变成可见事实。

### 4.6 事件口径收敛

T096 里真正要消掉的是“同一 tick 电力链多次改写 energy”的抖动，而不是强行禁止所有 `resource_changed`。

最终口径定为：

- 电力链路对同一玩家在同一 tick 最多产生 1 条 energy-changing `EvtResourceChanged`
- 这条事件携带的是统一提交后的最终 `EndEnergy`
- 其它非电力资源变化仍可按现有路径保留
- 但这些路径不能再二次修改 `player.Resources.Energy`

这意味着实现时不应再走“全局去重最后一条事件”的补丁，而是从源头删掉多余写入点。

## 5. 需要改动的文件

### 5.1 运行时模型

- `server/internal/model/world.go`
  - 增加 `PowerSnapshot`
- `server/internal/model/power_settlement.go`（新增）
  - 定义 snapshot 结构与 builder

### 5.2 电力结算

- `server/internal/gamecore/power_generation.go`
  - 删除直接写玩家能量与事件
- `server/internal/gamecore/ray_receiver_settlement.go`
  - 删除直接写玩家能量与事件
  - 返回 / 记录接收站本 tick 观测结果
- `server/internal/gamecore/energy_storage_settlement.go`
  - 保持只操作储能状态与 `ws.PowerInputs`
- `server/internal/gamecore/core.go`
  - 插入 `finalizePowerSettlement()`
- `server/internal/gamecore/rules.go`
  - `settleResources()` 改为只基于 allocation 驱动建筑状态与效率
  - 删除玩家电量直接增减路径
- `server/internal/gamecore/stats_settlement.go`
  - 改读 snapshot

### 5.3 查询层

- `server/internal/query/networks.go`
  - 改读 snapshot
- `server/internal/query/planet_inspector.go`
  - 增加接收站本 tick 电力观测字段

原则上不需要改：

- `server/internal/model/power_grid_aggregation.go`
- `server/internal/model/power_allocation.go`
- `server/internal/model/ray_receiver.go`

因为这几处在当前代码上已经是正确的基础算法，不需要为 T096 重写。

## 6. 测试设计

### 6.1 官方 midgame 端到端回归

新增一条 T096 级真实链路回归，必须覆盖任务文档中的官方 midgame 玩法，而不是只测内存构造态。

测试步骤：

1. 加载 `config-midgame.yaml + map-midgame.yaml`
2. 在 `planet-1-2` 建出：
   - `orbital_collector`
   - `vertical_launching_silo`
   - `ray_receiver`
   - `em_rail_ejector`
   - 以及若干 `tesla_tower / wind_turbine`
3. 执行：
   - `build_dyson_node`
   - `transfer solar_sail`
   - `transfer small_carrier_rocket`
   - `launch_solar_sail`
   - `launch_rocket`
   - `set_ray_receiver_mode ... power`
4. 拆除高耗电建筑，制造“主网络不缺电且可观察净增量”的基线
5. 连续推进若干 tick
6. 在同一轮最终查询结果中断言：
   - `inspect` 中 `power_output > 0`
   - `inspect` 中 `photon_output == 0`
   - `summary.players[p1].resources.energy` 高于切模式前基线
   - `stats.energy_stats.generation` 高于基线
   - `networks.power_networks[].supply` 高于基线
   - `critical_photon` 相对切模式后的基线不再增长
   - 同一 tick 内 energy-changing `resource_changed` 对该玩家最多 1 条

### 6.2 authoritative snapshot 单元测试

新增围绕 `PowerSettlementSnapshot` / `finalizePowerSettlement()` 的单元测试，覆盖：

- 多种电源同时存在时，`Generation` 聚合正确
- `Allocated`、`NetDelta`、`EndEnergy` 计算正确
- 玩家电量只提交一次
- 建筑遍历顺序变化不影响最终 `EndEnergy`
- `ray_receiver` 所属 `network_id` 能正确回填到 `Receivers`

### 6.3 接收站结算测试改造

现有 `server/internal/gamecore/ray_receiver_settlement_test.go` 当前是按“`settleRayReceivers()` 直接改玩家电量”写的。

本轮需要把它改造成两类断言：

- `settleRayReceivers()` 负责：
  - 生成正确的 `PowerInput`
  - 维护正确的 `PhotonOutput`
  - 记录正确的 `RayReceiverSettlementView`
- `finalizePowerSettlement()` 负责：
  - 统一提交玩家电量
  - 统一发出 energy-changing `EvtResourceChanged`

## 7. 风险与边界

### 7.1 风险：现有逻辑可能隐式依赖 tick 中间态电量

需要重点核查：

- `settleResources()` 内部对电量余额的判断
- 是否还有其它 tick 阶段依赖“发电阶段已经先把能量写进玩家库存”

最终原则：

- 电网供电判定只看 allocation
- 玩家能量库存只看 unified snapshot commit

### 7.2 风险：`resource_changed` 的统计口径误判

如果测试直接断言“同一 tick 总共只有 1 条 `resource_changed`”，很可能把矿物或库存引发的资源事件也误算进去。

因此测试应锁死的口径是：

- 同一玩家同一 tick 内，energy-changing `resource_changed` 最多 1 条

### 7.3 边界：不修改 `ray_receiver` 的连线规则

如果接收站真的因为位置问题形成孤立网络，最终实现应该让它在：

- `inspect.power.network_id`
- `networks.power_networks`

中被清楚看见，而不是把这个边界情况通过“加大连线范围”掩盖掉。

## 8. 验收标准

1. 官方 midgame 场景下，`ray_receiver` 切到 `power`，且玩家已具备太阳帆 / 戴森层能量时：
   - `inspect` 可见本 tick `power_output > 0`
   - `inspect` 可见本 tick `photon_output == 0`
   - `summary.players[pid].resources.energy` 稳定高于切模式前基线
   - `stats.energy_stats.generation` 稳定高于切模式前基线
   - `/world/planets/{planet_id}/networks.power_networks[].supply` 稳定高于切模式前基线
2. 上述增益必须出现在最终 authoritative 查询结果中，而不是只在中间 `resource_changed` 事件里短暂闪现。
3. `power` 模式不新增新的 `critical_photon`，但切换前已有库存允许保留。
4. 同一 tick 中，电力链路对同一玩家最多发 1 条 energy-changing `resource_changed`。
5. `summary / stats / networks / inspect` 在同一 tick 读取的是同一份 authoritative 电力结算结果。

## 9. 实施顺序

1. 先补 `PowerSettlementSnapshot` 与 builder，把 authoritative 结果结构定义出来。
2. 再改 `power_generation`、`ray_receiver_settlement`、`energy_storage_settlement`，删除玩家电量的中间态直接写入。
3. 接着插入 `finalizePowerSettlement()`，把玩家电量提交与事件发射收敛为一次。
4. 再改 `settleResources()`，删掉按建筑逐个扣写 / 回加玩家能量的旧路径。
5. 然后把 `stats / networks / inspect` 全部切到 snapshot。
6. 最后补官方 midgame 回归、snapshot 单测，并同步更新服务端 API 文档中 `inspect` 与相关查询返回的口径说明。

这份顺序的好处是：

- 先建立唯一真相，再迁移读写方
- 不需要在 query 层做过渡补丁
- 每一步都能通过测试明确验证是否仍然保持电网行为正确
