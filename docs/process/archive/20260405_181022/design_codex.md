# T104 设计方案：燃料型发电建筑运行态与终局供电观察面收口（Codex）

## 1. 范围与设计结论

当前 `docs/process/task/` 下只有一个未完成任务：

- `docs/process/task/T104_戴森终局人造恒星装燃料后无法稳定供电.md`

因此本设计只覆盖 T104，不再扩展到已经从当前任务目录移出的默认新局、戴森接收站、终局舰队线等历史问题。

本轮结论：

1. 不需要新造一套 query/UI 层“补丁状态”来掩盖现象。
2. 也不需要引入新的“燃烧缓存”“剩余燃烧 tick”“发电中锁存器”持久字段。
3. 推荐直接把**燃料型发电建筑的运行态真相**收口到 `settlePowerGeneration`，并取消 `settleResources` 对同一类建筑的二次 `no_fuel` 判定。
4. `inspect` / `scene` 读的是建筑 runtime，`networks` / `stats` 读的是 `PowerSettlementSnapshot`。只要 tick 内状态归属收口正确，这几条观察面会自然一致。

虽然验收中心是 `artificial_star`，但本次改动会触及共享分支：

- `artificial_star`
- `thermal_power_plant`
- `mini_fusion_power_plant`

设计上应一次收口这三类燃料型发电建筑，避免只给 `artificial_star` 打特判。

## 2. 现状审计

### 2.1 当前 tick 顺序

当前 `server/internal/gamecore/core.go` 的关键顺序是：

1. `settlePowerGeneration`
2. `settleDysonSpheres`
3. `settleRayReceivers`
4. `finalizePowerSettlement`
5. `settleResources`

这意味着：

- 发电输入 `ws.PowerInputs` 在 `settlePowerGeneration` 阶段生成；
- `GET /world/planets/{planet_id}/networks` 与 `GET /state/stats` 依赖的 `ws.PowerSnapshot` 在 `finalizePowerSettlement` 阶段固化；
- `settleResources` 是更靠后的资源结算阶段，不应再对同一类发电建筑重新定义“这一 tick 是否算有燃料在运行”。

### 2.2 当前已有的正确链路

`server/internal/gamecore/power_generation.go` 已经具备一条相对完整的燃料发电链路：

1. 对燃料型发电建筑调用 `fuelBasedGeneratorHasReachableFuel`
2. 无燃料则写入 `no_power / no_fuel`
3. 从 `no_power / no_fuel` 恢复时写入 `running / start`
4. 调用 `model.ResolvePowerGeneration(...)`
5. `ResolvePowerGeneration` 内部通过 `consumeFuel(...)` 真正扣减 `input_buffer + inventory`
6. 输出写入 `ws.PowerInputs`

`server/internal/model/power.go` 的燃料消耗公式本身没有问题：

- 以 `FuelRules.consume_per_tick` 为唯一消耗速率
- `artificial_star` 当前定义为 `antimatter_fuel_rod` 每 tick 消耗 `1`
- 输出仍然按 `OutputPerTick=80` 结算

### 2.3 当前真正冲突的地方

`server/internal/gamecore/rules.go` 的 `settleResources` 里，当前还存在第二次燃料可达性检查：

```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) && !fuelBasedGeneratorHasReachableFuel(b) {
    if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel); evt != nil {
        events = append(events, evt)
    }
    continue
}
```

这个分支的问题不是“又消耗了一次燃料”，而是它在更晚阶段重新定义了同一 tick 的运行态语义：

- `settlePowerGeneration` 说：本 tick 有燃料，已经发过电
- `settleResources` 又说：因为当前库存已经被消耗到 0，所以本 tick 末尾立刻回到 `no_power / no_fuel`

于是出现两个玩家可见问题：

1. `building_state_changed` 会出现过短窗口的 `running -> no_power/no_fuel`
2. `inspect` / `scene` 在用户实际查询时经常已经只能看到 `no_power/no_fuel`

### 2.4 为什么 `networks/stats` 不是主因

本仓库当前 `networks` 和 `stats` 的数据源已经是统一的：

- `finalizePowerSettlement` 生成 `ws.PowerSnapshot`
- `query.PlanetNetworks(...)` 读取 `CurrentPowerSettlementSnapshot(ws)`
- `buildPlayerEnergyStats(...)` 也读取 `CurrentPowerSettlementSnapshot(ws)`

也就是说，`stats/networks` 本身不是两套公式。它们之所以在实测中“看起来也不稳定”，主要是因为可观察窗口太短，玩家往往在燃料已经被同 tick 回写成 `no_fuel` 后再去查。

因此本轮不应该去重写 `query` 或 `stats` 聚合逻辑。

### 2.5 当前测试里已经固化了旧语义

`server/internal/gamecore/t099_fuel_generator_state_test.go` 里目前有一个关键断言：

- 单根 `antimatter_fuel_rod` 经过一个 `processTick()` 后，`artificial_star` 直接回到 `no_power / no_fuel`

这正是 T104 要修掉的旧语义，因此实现时必须同步改测试，否则旧测试会反向把错误行为重新锁死。

## 3. 设计目标与非目标

### 3.1 目标

1. 只要本 tick 通过真实燃料结算成功发电，燃料型发电建筑在该 tick 的 settled runtime 就应保持 `running`。
2. 只有在下一 tick 开始时再次检查发现无可达燃料，才切回 `no_power / no_fuel`。
3. `inspect` / `scene` / `building_state_changed` / `networks` / `stats` 五条观察面围绕同一套 tick 语义工作。
4. 保持现有 `FuelRules.consume_per_tick`、`PowerSettlementSnapshot`、公开 HTTP/CLI 接口结构不变。
5. 对 `thermal_power_plant` / `mini_fusion_power_plant` 保持同一规则，避免共享逻辑分叉。

### 3.2 非目标

1. 本次不把燃料棒改成“一个物品天然持续多 tick”的新经济模型。
2. 本次不新增公开 API 字段，也不新增 CLI 命令。
3. 本次不重做 `query` 层的 `inspect` 或 `scene` 序列化结构。
4. 本次不扩展到更多终局玩法平衡，例如 `artificial_star` 输出数值、燃料配方成本、midgame 物资投放量。

## 4. 方案比较

### 方案 A：只在 query / UI 侧补一个“本 tick 曾发电”的展示层

做法：

- 保留现有 runtime 逻辑不动；
- 额外在 `inspect` / `scene` / Web 上做临时字段或事件缓存，让建筑在刚发过电时看起来像仍在运行。

优点：

- 表面上改动小；
- 能快速改善部分展示效果。

缺点：

- runtime 真相仍然是错的；
- `building_state_changed` 仍会抖动；
- 会制造“建筑状态一套、power snapshot 一套、前端展示再一套”的第三事实源；
- 违反本项目“直接改核心定义，不靠适配层圆谎”的约束。

结论：

- 不采用。

### 方案 B：新增燃料发电建筑内部的“燃烧态/剩余燃烧 tick”状态机

做法：

- 为建筑新增持久化字段，例如 `ActiveFuel`、`BurnTicksRemaining`；
- 每次装入燃料后，先把燃料转换成独立燃烧态，再按燃烧态持续供电。

优点：

- 理论上可以把“库存剩余”和“正在燃烧”区分得更细；
- 如果以后要做更复杂燃料系统，有扩展空间。

缺点：

- 对当前问题来说过度设计；
- 需要新增存档字段、回放/回滚兼容、更多状态同步代码；
- 当前 `FuelRules.consume_per_tick` 已能表达 T104 需求，没必要再造第二层燃烧模型。

结论：

- 不采用。

### 方案 C：把燃料运行态 authoritative 收口到 `settlePowerGeneration`，`settleResources` 只尊重其结果

做法：

- 保留现有 `ResolvePowerGeneration` 和 `PowerSnapshot`；
- 删除 `settleResources` 中对燃料型发电建筑的二次 `no_fuel` 判定；
- 让 `settlePowerGeneration` 成为唯一“本 tick 是否因燃料不足停机”的判定点。

优点：

- 改动集中，符合当前架构；
- 不引入新状态结构；
- 直接修复 `inspect/scene/events` 的窗口问题；
- `networks/stats` 已有统一 snapshot，能自然获益。

缺点：

- 需要重新定义一个细节语义：最后一根燃料在本 tick 被消耗完后，该 tick 末建筑仍可能显示 `running`，但库存已是 `0`。

结论：

- 推荐采用。

## 5. 推荐方案：单一 authoritative 燃料结算语义

### 5.1 新语义定义

本次明确规定：

- `runtime.state` 表示的是**刚刚完成结算的这个 tick 的工作结果**，不是“下一 tick 的预测状态”。
- 因此，如果 `artificial_star` 在 tick N 成功消耗了最后一根 `antimatter_fuel_rod` 并发出了 `+80` 供电：
  - tick N 结束时仍可显示 `running`
  - tick N 的 `networks/stats` 仍应体现这次供电
  - 此时本地库存已经为 `0` 是合法现象
  - 如果没有新燃料补入，则 tick N+1 才切到 `no_power / no_fuel`

这个定义正好满足 T104 的核心验收：

- 有效发电 tick 可被玩家稳定观察到；
- 不再出现“同一个 tick 里先 running 又立刻 no_fuel”的闪烁；
- 多根燃料棒的持续时间与 `consume_per_tick` 一致。

### 5.2 模块职责重新收口

#### A. `settlePowerGeneration`

继续作为以下事实的唯一来源：

1. 当前 tick 是否有可达燃料
2. 是否从 `no_power/no_fuel` 恢复到 `running`
3. 本 tick 消耗了多少燃料
4. 本 tick 产生了多少 `PowerInput`

这部分逻辑保留在：

- `server/internal/gamecore/power_generation.go`
- `server/internal/gamecore/fuel_generators.go`
- `server/internal/model/power.go`

#### B. `finalizePowerSettlement`

无需重构，继续负责：

1. 基于 `ws.PowerInputs` 生成 `ws.PowerSnapshot`
2. 回写玩家 energy
3. 作为 `networks/stats` 的唯一 authoritative snapshot

涉及文件：

- `server/internal/gamecore/power_settlement.go`
- `server/internal/model/power_settlement.go`
- `server/internal/gamecore/stats_settlement.go`

#### C. `settleResources`

职责改为：

1. 不再重新读取燃料库存并覆写 `no_fuel`
2. 只尊重前序阶段已经确定的停机态
3. 对已经处于 `no_power/no_fuel` 的燃料型发电建筑，直接跳过后续资源结算

也就是说，`settleResources` 只做“尊重状态”，不再做“重新定义状态”。

### 5.3 文件级改造设计

#### 5.3.1 `server/internal/gamecore/rules.go`

删除现有这段重复检查：

```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) && !fuelBasedGeneratorHasReachableFuel(b) {
    if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonNoFuel); evt != nil {
        events = append(events, evt)
    }
    continue
}
```

替换为更窄的“尊重前序 no_fuel 结果”分支：

```go
if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) {
    if b.Runtime.State == model.BuildingWorkNoPower && b.Runtime.StateReason == stateReasonNoFuel {
        continue
    }
}
```

这样做的结果：

- 若本 tick 在 `settlePowerGeneration` 已成功发电，则 `settleResources` 不会再把它打回 `no_fuel`
- 若本 tick 一开始就无燃料，前序已写入 `no_power/no_fuel`，这里会直接跳过，避免误写 `running`

#### 5.3.2 `server/internal/gamecore/power_generation.go`

这里不需要大改结构，但实现时应明确加注释，说明：

- 燃料型发电建筑的 `no_fuel` / `running` 转换由本阶段 authoritative 管理；
- 后续 `settleResources` 不得再重复检查燃料可达性。

如果实现时想让语义更清晰，可以把现有逻辑抽成一个小 helper，例如：

- `settleFuelGeneratorAvailability(...)`
- 或 `fuelGeneratorStateBeforeGeneration(...)`

但这只是整理代码，不是新增能力；不要为了 T104 新造一层复杂策略对象。

#### 5.3.3 `server/internal/gamecore/fuel_generators.go`

建议补一个小的状态判断 helper，避免 `rules.go` 和其他测试重复硬编码：

```go
func fuelGeneratorStoppedByNoFuel(building *model.Building) bool
```

职责仅限：

- 判断当前建筑是否是燃料型发电建筑；
- 且 runtime 是否已经是 `no_power/no_fuel`

这属于低耦合的小抽象，能减少状态字符串散落。

#### 5.3.4 不需要改动的文件

以下文件本轮应明确保持不动，避免误扩散：

- `server/internal/model/power.go`
- `server/internal/query/planet_inspector.go`
- `server/internal/query/query.go` 中的 `PlanetScene`
- `server/internal/query/networks.go`
- `server/internal/gamecore/stats_settlement.go`

原因很简单：

- 它们当前消费的事实源已经正确；
- 问题在于前序 tick runtime 语义被后置阶段覆盖，而不是这些模块自己算法错了。

### 5.4 观察面一致性设计

#### 5.4.1 `inspect`

当前 `inspect` 已直接返回建筑 runtime 和 storage。

修复后应满足：

- 有燃料运行期：`runtime.state = running`
- 最后一根燃料被本 tick 消耗完时：
  - `runtime.state` 仍可为 `running`
  - `storage.inventory + input_buffer` 已为 `0` 也是合法结果
- 下一 tick 若未补燃料，才转为 `no_power / no_fuel`

也就是说，`inspect` 不需要新字段，关键是 runtime 语义要正确。

#### 5.4.2 `scene`

`scene` 当前直接暴露视野内建筑对象。

因此实现层只要修正 runtime，`scene` 就会自动与 `inspect` 一致，不需要 scene 专用逻辑。

#### 5.4.3 `building_state_changed`

修复后事件序列应收敛为：

1. 无燃料时：
   - `running -> no_power (reason=no_fuel)`，或保持 `no_power/no_fuel`
2. 补燃料后首次成功发电的 tick：
   - `no_power/no_fuel -> running (reason=start)`
3. 中间连续有燃料的 tick：
   - 不再反复抖动事件
4. 最后一根燃料已经在上一 tick 用尽、下一 tick 开始无燃料时：
   - `running -> no_power (reason=no_fuel)`

禁止再出现：

- 同一个 tick 中先 `running(start)` 又立刻 `no_power(no_fuel)`

#### 5.4.4 `GET /world/planets/{planet_id}/networks` 与 `GET /state/stats`

两者继续维持现有 snapshot 事实源，不新增任何特殊分支。

修复后的预期是：

- 在燃料存在且本 tick 成功发电的阶段：
  - `power_networks[].supply` 包含 `artificial_star` 的 `+80`
  - `stats.energy_stats.generation` 同步增长
- 下一 tick 如果确实无燃料：
  - 两者一起回落

### 5.5 为什么这次不需要改 `inspect` 的 power 子对象

当前 `inspect.power` 主要是 `ray_receiver` 专用视图，燃料型发电建筑没有额外 power 结算子对象。

这不是 T104 的缺口，原因是：

- `artificial_star` 的核心观察项本来就来自 `runtime + storage`
- `供电收益` 则已经由 `networks/stats` 提供 authoritative 视图

如果未来要做“建筑级逐 tick 发电明细”接口，那是新任务；T104 不应顺手扩大范围。

## 6. 测试设计

### 6.1 测试文件边界

推荐拆成两部分：

1. 修改现有 `server/internal/gamecore/t099_fuel_generator_state_test.go`
2. 新增 `server/internal/gamecore/t104_artificial_star_stable_power_test.go`

理由：

- T099 文件里已经有燃料发电建筑基础状态回归；
- T104 需要新增“持续时间与观察面一致性”测试，不适合把所有时序细节都塞回 T099。

### 6.2 必改旧测试

`TestT099ArtificialStarFallsBackToNoFuelAfterLastRodIsConsumed`

旧预期：

- 单根燃料经过一个 `processTick()` 后，立刻 `no_power/no_fuel`

新预期应改成两段：

1. 第一个 tick：
   - `runtime.state = running`
   - `PowerInput.Output = 80`
   - `networks/stats` 有正向收益
2. 第二个 tick（未补燃料）：
   - `runtime.state = no_power`
   - `runtime.state_reason = no_fuel`

### 6.3 新增测试矩阵

#### 用例 1：空燃料基线不回归

场景：

- `artificial_star` 无燃料

预期：

- `runtime.state = no_power`
- `runtime.state_reason = no_fuel`
- `power_networks[].supply = 0`
- `stats.energy_stats.generation` 不增加

#### 用例 2：单根燃料至少形成一个可观测运行 tick

场景：

- 装入 `1` 根 `antimatter_fuel_rod`

预期：

- 第 1 个结算 tick：
  - `inspect` 显示 `running`
  - `scene` 中该建筑也为 `running`
  - `networks/stats` 反映 `+80`
  - 允许库存已经降到 `0`
- 第 2 个结算 tick：
  - 回到 `no_power/no_fuel`

#### 用例 3：多根燃料按 `consume_per_tick` 持续

场景：

- 装入 `3` 根 `antimatter_fuel_rod`

预期：

- 连续 `3` 个 tick 保持 `running`
- 连续 `3` 个 tick `supply/generation` 保持包含 `+80`
- 第 `4` 个 tick 才回落为 `no_power/no_fuel`
- 期间不会在中途出现 `running -> no_power -> running` 抖动

#### 用例 4：事件序列不再抖动

场景：

- 从空燃料恢复，再耗尽

预期：

- 只出现一条 `no_power/no_fuel -> running(start)`
- 只在下一次真正无燃料 tick 出现一条 `running -> no_power/no_fuel`
- 不出现同 tick 反向翻转

#### 用例 5：共享分支回归

场景：

- `thermal_power_plant` 装煤
- `mini_fusion_power_plant` 装 `hydrogen_fuel_rod`

预期：

- 两类建筑也遵守同一“最后一根燃料消耗后的下一 tick 才 no_fuel”的语义

### 6.4 查询层验证方式

T104 的新测试建议在 `GameCore + query.Layer` 层完成，而不是只测内部函数：

- 用 `newE2ETestCore(...)`
- 用 `query.New(...)`
- 同时调用：
  - `PlanetInspect(...)`
  - `PlanetScene(...)`
  - `PlanetNetworks(...)`
- 再读取 `ws.Players["p1"].Stats.EnergyStats`

这样可以一次锁住任务要求中的五条观察面，而不必上升到网关 HTTP 用例。

## 7. 文档同步设计

### 7.1 `docs/player/已知问题与回归.md`

实现完成后，这里需要把 T104 从“新增问题”改成“已修复回归”。

建议保留的信息：

- 真实复现环境
- 问题曾经的表现
- 修复后的新语义：
  - 单根燃料至少形成一个可观察发电 tick
  - 多根燃料按 `consume_per_tick` 持续
  - 下一 tick 才回到 `no_power/no_fuel`

### 7.2 `docs/player/玩法指南.md`

在发电与电网一节补一段终局能源说明：

- `artificial_star` 使用 `antimatter_fuel_rod`
- 当前按 `1` 根 / tick 消耗
- 成功发电的 settled tick 内会显示 `running`
- 最后一根燃料在该 tick 被消耗完后，若未补料，则下一 tick 才转为 `no_power/no_fuel`

这样玩家不会再误以为“库存为 0 但 state 还是 running”是新 bug。

### 7.3 `docs/dev/服务端API.md`

需要同步修正文档口径，重点有两处：

1. `GET /world/planets/{planet_id}/inspect`
   - 明确燃料型发电建筑的 `running/no_fuel` 语义是“按已结算 tick 展示”
2. `building_state_changed`
   - 明确补燃料后不会再同 tick 立刻抖回 `no_fuel`

还应补一句说明：

- 在最后一根燃料刚被本 tick 消耗完时，`inspect` 可能出现“`runtime.state=running` 但库存为 `0`”；
- 这是因为该 tick 已经真实完成发电，下一 tick 若未补料才会进入 `no_power/no_fuel`。

### 7.4 不需要改的文档

本次不涉及 CLI 指令变化，因此：

- `docs/dev/客户端CLI.md` 不需要因为 T104 单独改命令说明

## 8. 风险与实现注意事项

### 8.1 最大认知风险

修复后最容易让人误解的一点是：

- “为什么库存已经 0 了，建筑这一 tick 还是 running？”

这不是新 bug，而是本设计刻意采用的 settled-tick 语义。

如果不接受这个语义，就必须走方案 B，新增独立燃烧状态；但那对 T104 来说明显过重。

### 8.2 共享分支风险

因为 `rules.go` 改的是共享燃料发电逻辑，所以必须覆盖：

- `artificial_star`
- `thermal_power_plant`
- `mini_fusion_power_plant`

不能只回归 `artificial_star`。

### 8.3 不要做的事

实现时应避免以下错误方向：

1. 不要在 query 层缓存“上一次 running”
2. 不要给 `artificial_star` 单独加特判
3. 不要修改 `FuelRules.consume_per_tick` 来伪装持续时间
4. 不要新增一套和 `PowerSnapshot` 平行的 generator stats 结构

## 9. 与验收标准的逐条对应

### 验收 1

> `transfer <artificial_star_id> antimatter_fuel_rod <n>` 后，只要燃料仍有剩余，`inspect` 中该建筑就持续显示 `running`。

对应设计：

- `settlePowerGeneration` 作为唯一燃料运行态判定点
- `settleResources` 不再在同 tick 覆盖 `no_fuel`

### 验收 2

> `GET /world/planets/{planet_id}/networks` 与 `GET /state/stats.energy_stats` 在燃料存在期间能持续看到 `artificial_star` 对供电的贡献。

对应设计：

- 保持 `PowerSettlementSnapshot` 为唯一事实源
- 修复运行窗口后，`networks/stats` 自然稳定可见

### 验收 3

> 多根燃料棒的持续时间与 `consume_per_tick` 一致，不再出现“3 根燃料棒仅维持约 2 tick 就全部消失”的现象。

对应设计：

- 不改 `FuelRules.consume_per_tick`
- 只改 tick 内状态收口，保证 `3` 根就是 `3` 个发电 tick

### 验收 4

> 燃料真正耗尽后，建筑才回到 `no_power / no_fuel`，并伴随一致的 `building_state_changed` 事件。

对应设计：

- 下一 tick 开始无燃料时才切 `no_power/no_fuel`
- 事件流不再同 tick 自相矛盾

## 10. 最终建议

T104 不应被实现成“再补几条文档说明”或“给 query 打补丁”。

最直接、最符合当前仓库风格的做法是：

- 保留现有 `ResolvePowerGeneration + PowerSnapshot` 主链
- 把燃料型发电建筑的运行态 authoritative 归属收口到 `settlePowerGeneration`
- 让 `settleResources` 停止对同一类建筑做第二次燃料判定

这样改完之后，`artificial_star` 才会真正从“能建、能装燃料、但观察面像坏的”变成“终局供电可稳定观察、可自动化验收”的完成态。
