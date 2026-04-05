# T096 设计方案：官方 midgame 下 `ray_receiver power` authoritative 电力回灌收口

## 1. 文档目标

本方案只处理 `docs/process/task/T096_官方midgame下戴森接收站power模式实战不回灌最终电网.md` 描述的问题，不重复回滚或推翻已经在代码里落地的 T094 / T095 修复。

本轮目标有且只有 4 个：

1. 让 `ray_receiver` 在 `power` 模式下的供电收益进入同一份 authoritative tick 结果。
2. 让 `summary`、`stats`、`/world/planets/{planet_id}/networks`、`inspect` 读取同一份最终结算事实，而不是多处各算各的。
3. 消除同一 tick 内多次 `resource_changed` 导致的“中间态闪现，最终态回退”观感。
4. 补一条官方 midgame 风格的真实链路回归测试，锁死任务里的复现路径。

明确不做的事：

- 不在 query 层单独补假值。
- 不为旧口径加兼容 adapter。
- 不把 `power` 模式解释成“自动清空历史 `critical_photon` 库存”。
- 不顺手扩成跨所有星球的总能源汇总；`active planet` 语义保持现状。

## 2. 基于当前代码的事实判断

### 2.1 当前 tick 顺序本身不是主问题

`server/internal/gamecore/core.go` 当前顺序已经是：

1. `settlePowerGeneration`
2. `settleSolarSails`
3. `settleDysonSpheres`
4. `settleRayReceivers`
5. `settlePlanetaryShields`
6. `settleResources`
7. `settleStats`

同时，`server/internal/gamecore/power_generation.go` 会在 tick 开头清空 `ws.PowerInputs`。因此，旧草案里把主因归结为“tick 顺序错了”或“`PowerInputs` 没清空”，在当前代码上已经不成立。

### 2.2 `ray_receiver` 的模式公式本身已经正确

`server/internal/model/ray_receiver.go` 当前已经明确实现：

- `power`：允许产电，不再新增新的 `critical_photon`
- `photon`：只产光子，不产电
- `hybrid`：先产电，再把剩余能量转成光子

`server/internal/gamecore/planet_commands.go` 也已经把 `set_ray_receiver_mode` 直接写回建筑运行态。因此，T096 不应该再按“模式分支实现错了”处理。

### 2.3 当前真正缺的是“单次 authoritative 电力结算”

现状里，电力相关状态在一个 tick 内被多次写入：

- `settlePowerGeneration()` 一边把发电机输出写到 `ws.PowerInputs`，一边直接累加 `player.Resources.Energy`
- `settleRayReceivers()` 一边追加 `PowerSourceRayReceiver`，一边再次直接累加 `player.Resources.Energy`
- `settleResources()` 又按建筑循环逐个扣 `player.Resources.Energy`
- `buildPlayerEnergyStats()` 与 `PlanetNetworks()` 再次从 `ws.PowerInputs` 重新计算网络供给
- `query.Summary()` 则直接读取 tick 结束后的 `player.Resources.Energy`

这导致 4 个观察面虽然都和“电力”有关，但并不共享同一份结算快照：

1. `summary.players[pid].resources.energy` 读的是多次增减后的库存值
2. `stats.energy_stats.generation` 读的是 query 时重算出的网络供给
3. `networks.power_networks[].supply` 也是 query 时重算
4. `inspect` 当前只能看到 `mode / state / inventory`，看不到“本 tick 接收站到底回灌了多少”

也就是说，当前不是“完全没有实现 ray receiver 回灌”，而是“没有单一 authoritative 结算结果”，所以不同观察面只能碰运气一致。

### 2.4 现有测试证明“简化路径能工作”，但没有锁死 T096 的官方 midgame 真实链路

当前工作区里已经有：

- `server/internal/gamecore/t094_ray_receiver_visibility_test.go`
- `server/internal/gamecore/t095_ray_receiver_midgame_test.go`
- `server/internal/gamecore/ray_receiver_settlement_test.go`

这些测试说明：

- `ray_receiver power` 在简化场景和当前 midgame 夹具里并非完全失效
- `power` 模式也已经满足“不再新增新的光子增量”

但 T096 要求的是更严格的口径：

- 必须覆盖任务文档里的真实命令链
- 必须保证最终 authoritative 查询结果一致
- 必须消除 tick 内多次 `resource_changed` 带来的“先升后掉”的误判

因此，本轮设计不应只补查询层或只补一条更弱的测试，而应把电力结果收敛成单次提交。

## 3. 方案对比

### 3.1 方案 A：继续在 query 层补丁式修读数

做法：

- `summary`、`stats`、`networks` 各自补算一遍接收站收益
- 必要时对 `inspect` 再加单独解释

不采用。

原因：

- 会制造第二套真相
- 与项目“直接重构，不加兼容层”的准则冲突
- 不能解决 `resource_changed` 在 tick 内多次抖动的问题

### 3.2 方案 B：只补更强的官方 midgame 回归，不改运行时时序

做法：

- 保留现有多次写 `player.Resources.Energy` 的方式
- 只新增更强的 end-to-end 测试

不采用。

原因：

- 这条路能更稳定地复现问题，但无法定义修法
- 即使回归用例通过，也不能从模型层保证 4 个观察面读同一份事实

### 3.3 方案 C：引入单次 authoritative 电力结算快照

做法：

- 所有供电输入先汇总到同一份 transient snapshot
- 网络聚合、供电分配、玩家能源库存提交只做一次
- `summary / stats / networks / inspect` 全部读取这份最终结果

采用。

原因：

- 直接命中 T096 的验收口径
- 可以根除“中间态闪现、最终态覆盖”的问题
- 结构上更干净，后续扩展其他动态电源也更自然

## 4. 最终方案

### 4.1 新增 `PowerSettlementSnapshot`，让电力结果只结算一次

在 `server/internal/model` 新增一组只服务运行时的 transient 结构，挂到 `WorldState` 上：

```go
type PowerSettlementSnapshot struct {
    Tick         int64
    Inputs       []PowerInput
    Networks     PowerNetworkState
    Allocations  PowerAllocationState
    Players      map[string]PlayerPowerSnapshot
    Receivers    map[string]RayReceiverSettlementView
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

- `PowerSnapshot` 只表示“本 tick 最终 authoritative 电力结果”
- query 层优先读 `ws.PowerSnapshot`
- 如果在极少数初始化场景下 `PowerSnapshot == nil`，只能调用同一个纯函数生成 snapshot，不能在 query 层另外写一套算法

### 4.2 改造电力结算：供电输入先收集，再统一提交玩家能量

本轮不再允许 `settlePowerGeneration()`、`settleRayReceivers()`、`settleResources()` 在各自阶段直接多次改写 `player.Resources.Energy`。

新的职责划分如下。

#### 4.2.1 `settlePowerGeneration()`

保留：

- 清空 `ws.PowerInputs`
- 按环境与燃料规则收集普通发电机输出

删除：

- 直接累加 `player.Resources.Energy`
- 在这里发 `EvtResourceChanged`

结果：

- 本阶段只负责“收集供电输入”，不负责提交玩家最终能量库存

#### 4.2.2 `settleRayReceivers()`

保留：

- 读取太阳帆和戴森球能量
- 根据 `power / photon / hybrid` 模式解析输出
- `power` 模式下不新增新的 `critical_photon`
- 保留切模式前已有的 `critical_photon`

新增：

- 把每个接收站本 tick 的 `AvailableDysonEnergy / EffectiveInput / PowerOutput / PhotonOutput` 记录到 `PowerSnapshot.Receivers`

删除：

- 在这里直接改 `player.Resources.Energy`
- 在这里发 `EvtResourceChanged`

结果：

- 接收站仍然往 `ws.PowerInputs` 写供电条目
- 但真正的玩家库存增长，只能在统一提交阶段发生

#### 4.2.3 `settleEnergyStorage()`

保留当前“按网络差额补放电 / 充电”的方向，但它也只允许操作：

- `ws.PowerInputs`
- 储能设备内部 charge/discharge 状态

不允许直接改 `player.Resources.Energy`。

#### 4.2.4 新增统一结算函数 `finalizePowerSettlement(ws)`

在 `settleRayReceivers()` 与 `settleResources()` 之间新增统一收口阶段，例如：

```go
snapshot := finalizePowerSettlement(ws)
ws.PowerSnapshot = snapshot
applyPlayerEnergySnapshot(ws, snapshot)
emitPowerResourceChanged(ws, snapshot)
```

它负责：

1. 从最终 `ws.PowerInputs` 构建 `Networks`
2. 计算 `Allocations`
3. 汇总每个玩家的 `Generation / Demand / Allocated`
4. 统一计算玩家本 tick `EndEnergy`
5. 把 `network_id` 回填给 `RayReceiverSettlementView`

核心语义：

- `Generation` 来自网络供给聚合
- `Allocated` 来自真实供电分配
- `NetDelta = Generation - Allocated`
- `EndEnergy = clamp(StartEnergy + NetDelta, 0, 10000)`

这意味着：

- 如果 `ray_receiver power` 让真实网络供给提高，且网络此时存在净盈余，则 `summary.players[pid].resources.energy` 会稳定上涨
- 如果新增供给刚好被同 tick 负载吃掉，则不会再出现“事件里看起来涨过，但最终态没定义到底算不算涨”的歧义

### 4.3 `settleResources()` 不再按建筑循环直接扣玩家电量

`server/internal/gamecore/rules.go` 中 `settleResources()` 需要改成只做两类事：

1. 基于 `snapshot.Allocations` 判定建筑本 tick 是否获得足够供电
2. 用 `alloc.Ratio` 缩放采集、生产、运行态

必须删除或迁移的逻辑：

- `player.Resources.Energy -= effectiveEnergyCost`
- 循环中按建筑多次发 `EvtResourceChanged`
- 对同一套电量既先在发电阶段加一次，又在资源阶段按建筑逐个减一次

这样做的结果是：

- 建筑供电是否成功，完全由网络分配决定，而不是由“遍历到当前建筑时玩家库存还剩多少”决定
- 建筑遍历顺序不再影响最终电力结果
- `summary.energy` 的提交时点与 `stats/networks` 保持一致

### 4.4 `resource_changed` 改成每玩家每 tick 最多一次电力提交

T096 明确指出 `events/snapshot` 中会看到同一 tick 内多次 `resource_changed`，而最终 `summary` 又回到旧值。

为此，本轮要求：

- 电力结算链路里，`EvtResourceChanged` 只能在统一提交阶段发出
- 同一玩家在同一 tick 的电力变化最多一条
- 该事件携带的是最终 `EndEnergy`，而不是中间态

如果某个 tick 同时发生了别的资源变化来源，本轮仍然允许保留非电力路径的事件，但电力链本身不能再重复发“半成品能量值”。

### 4.5 `inspect` 需要能看到接收站本 tick 的真实回灌结果

当前 `inspect` 返回建筑原始运行态，只能看到：

- `mode`
- `state`
- `inventory / input_buffer / output_buffer`

这不足以回答 T096 的核心问题：“这个接收站本 tick 到底有没有回灌电网”。

因此，`server/internal/query/planet_inspector.go` 需要为 `ray_receiver` 增加只读观测字段，来源统一取自 `ws.PowerSnapshot.Receivers[buildingID]`，建议结构如下：

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

最终表现：

- `inspect` 不再只能靠“有没有历史光子库存”侧推当前模式是否生效
- 玩家能直接看到本 tick `power_output > 0` 且 `photon_output == 0`

### 4.6 `stats` 与 `networks` 全部改读 snapshot

#### 4.6.1 `stats`

`server/internal/gamecore/stats_settlement.go` 中的 `buildPlayerEnergyStats()` 改为优先读取 `ws.PowerSnapshot.Players[playerID]`：

- `generation = snapshot.Generation`
- `consumption = snapshot.Allocated`

若 `snapshot` 缺失，只允许调用统一的 snapshot builder 生成同源数据，不能另写一套聚合逻辑。

#### 4.6.2 `networks`

`server/internal/query/networks.go` 改为直接读取：

- `ws.PowerSnapshot.Networks`
- `ws.PowerSnapshot.Allocations`

避免 query 时再次“现场重算”。

这样才能满足 T096 对 authoritative 结果的要求：同一个 tick 上，`stats.generation` 与 `networks.supply` 来自同一份底层对象。

#### 4.6.3 `summary`

`server/internal/query/query.go` 继续读取 `player.Resources.Energy`，但该值已由统一提交阶段一次性写入，因此与 `stats / networks` 同步。

## 5. 需要改动的文件

### 5.1 运行时模型

- `server/internal/model/world.go`
  - 增加 `PowerSnapshot`
- `server/internal/model/power_settlement.go`（新增）
  - 定义 snapshot 结构与统一 builder

### 5.2 电力结算

- `server/internal/gamecore/power_generation.go`
  - 去掉直接改玩家能量与中间态事件
- `server/internal/gamecore/ray_receiver_settlement.go`
  - 去掉直接改玩家能量
  - 记录接收站本 tick 观测结果
- `server/internal/gamecore/energy_storage_settlement.go`
  - 保持只操作 `PowerInputs` 与储能内部状态
- `server/internal/gamecore/rules.go`
  - `settleResources()` 改为只依据 allocation 驱动建筑状态与效率
  - 删除按建筑直接扣电的路径
- `server/internal/gamecore/core.go`
  - 插入 `finalizePowerSettlement()` 调用
  - 在统一提交后再进入 `settleResources()`
- `server/internal/gamecore/stats_settlement.go`
  - 改读 snapshot

### 5.3 查询层

- `server/internal/query/query.go`
  - 继续读玩家最终库存，但库存已是统一提交后的结果
- `server/internal/query/stats.go`
  - 确保输出来自 snapshot 对应统计
- `server/internal/query/networks.go`
  - 改读 snapshot networks / allocations
- `server/internal/query/planet_inspector.go`
  - 为 `ray_receiver` 增加本 tick 电力观测字段

## 6. 测试设计

### 6.1 官方 midgame 端到端回归

新增或重写一条黑盒级别更高的回归测试，覆盖任务文档里的真实链路：

1. 加载 `config-midgame.yaml + map-midgame.yaml`
2. 使用真实命令链构建场景：
   - `build orbital_collector`
   - `build vertical_launching_silo`
   - `build ray_receiver`
   - `build em_rail_ejector`
   - 补 `tesla_tower / wind_turbine`
3. 执行：
   - `build_dyson_node`
   - `transfer solar_sail`
   - `transfer small_carrier_rocket`
   - `launch_solar_sail`
   - `launch_rocket`
   - `set_ray_receiver_mode ... power`
4. 拆掉高耗电建筑，制造“主网络不缺电且能看出净增量”的稳定基线
5. 连续推进若干 tick
6. 同 tick 断言：
   - `inspect` 中 `power_output > 0`
   - `inspect` 中 `photon_output == 0`
   - `summary.players[p1].resources.energy` 高于基线
   - `stats.energy_stats.generation` 高于基线
   - `/world/planets/{planet_id}/networks.power_networks[].supply` 高于基线
   - `critical_photon` 总量相对切模式后的基线不再增长
   - 同 tick 内该玩家的 `resource_changed` 不超过 1 条电力提交事件

### 6.2 统一提交单元测试

新增针对 `PowerSettlementSnapshot` 的纯单元测试，覆盖：

- 多种供电源同时存在时，`Generation` 聚合正确
- `Allocated` 与 `NetDelta` 正确
- `EndEnergy` 只提交一次
- 建筑遍历顺序变化不影响最终 `EndEnergy`

### 6.3 接收站观测测试

新增 `inspect` 相关测试，确认：

- `power` 模式下 `power_output > 0`
- `power` 模式下 `photon_output == 0`
- 历史 `critical_photon` 库存存在时，观测字段仍显示本 tick 没有新增光子

## 7. 风险与处理

### 7.1 风险：会影响当前“玩家库存即电网实时余额”的隐含语义

这是故意的。

当前语义本来就不稳定，因为它依赖结算顺序和建筑遍历顺序。T096 的目标正是把它改成“tick 结束后的最终能源库存”。

### 7.2 风险：某些旧逻辑依赖中间态 `player.Resources.Energy`

本轮需要逐一检查：

- `settleResources()` 内部的能量充足判断
- 是否还有其它 tick 内模块在依赖“发电阶段已经先把能量写进玩家库存”

原则是：

- 电网供电判定只看 snapshot allocation
- 玩家库存只在统一提交后更新

### 7.3 风险：query 在 snapshot 缺失时退回旧计算

不允许直接退回旧实现。

允许的唯一 fallback 是调用同一个 snapshot builder；这样仍然是同源算法，不是两套口径。

## 8. 验收标准

1. 官方 midgame 场景中，`ray_receiver` 切到 `power` 且存在太阳帆 / 戴森层能量时：
   - `inspect` 可见本 tick `power_output > 0`
   - `inspect` 可见本 tick `photon_output == 0`
   - `summary.players[pid].resources.energy` 稳定高于切模式前基线
   - `stats.energy_stats.generation` 稳定高于切模式前基线
   - `/world/planets/{planet_id}/networks.power_networks[].supply` 稳定高于切模式前基线
2. 同一 tick 中，电力链路对同一玩家最多发 1 条最终 `resource_changed`
3. `power` 模式不新增新的 `critical_photon`，但切换前已有库存允许保留
4. `summary / stats / networks / inspect` 在同一 tick 读取的是同一份 authoritative 电力结算结果

## 9. 实施顺序

1. 先补 `PowerSettlementSnapshot` 与统一 builder
2. 再改 `power_generation / ray_receiver / settleResources` 的能量提交流程
3. 接着把 `stats / networks / inspect` 切到 snapshot
4. 最后补官方 midgame 端到端回归与事件次数断言

这样做可以保证：

- 每一步都有明确中间目标
- 不需要在 query 层打补丁兜底
- 最终结果符合项目当前“直接重构、废弃错误口径”的设计哲学
