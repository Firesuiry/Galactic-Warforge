# T095 最终设计方案：戴森接收站 `power` 模式与缺电状态口径收敛

## 1. 文档目标

本文用于给 T095 输出单一定稿方案，而不是继续并列保留不同草案。

需要先说明一个现实情况：当前仓库根目录只有 `docs/process/design_claude.md`，`docs/process/design_codex.md` 已缺失。本文因此采用以下输入综合定稿：

1. 当前 `docs/process/design_claude.md`
2. 同主题的历史 Codex 方案里仍然有效的分析结论
3. 当前代码真实状态与已存在测试

本轮目标只有两个：

1. 收敛 `ray_receiver power` 的真实行为、测试口径和玩家观察面。
2. 收敛缺电场景下 `inspect / scene / building_state_changed / networks` 的状态原因口径。

遵循项目当前约束：

- 不在查询层造第二套“假能源”结果。
- 不为旧口径加兼容层，直接修正真实实现点。
- 不重复改已经在代码里存在的 T094 级修复。

## 2. 基于当前实现的事实判断

### 2.1 `ray_receiver` 的 T094 级修复已经在代码中存在

当前 `server/internal/gamecore/core.go` 的真实 tick 顺序已经是：

1. `settlePowerGeneration`
2. `settleSolarSails`
3. `settleDysonSpheres`
4. `settleRayReceivers`
5. `settlePlanetaryShields`
6. `settleResources`
7. `settleStats`

同时，`server/internal/gamecore/power_generation.go` 已在 tick 开头清空 `ws.PowerInputs`。因此，`design_claude.md` 里把问题 1 主因写成“tick 顺序错误 / PowerInputs 未清空”，在当前代码上已经不成立，不能直接作为最终方案。

### 2.2 `ResolveRayReceiver()` 的模式公式本身是正确的

当前 `server/internal/model/ray_receiver.go` 已明确实现：

- `power`：允许产电，不再新增光子产出
- `photon`：只产光子，不产电
- `hybrid`：先产电，再用剩余能量产光子

`server/internal/gamecore/planet_commands.go` 也已经确认 `set_ray_receiver_mode` 会直接把模式写回建筑运行态。

因此，问题 1 不应再按“模式分支写反了”处理。真正缺的是：

1. 现有自动化回归只覆盖了合成场景，没有锁死官方 midgame 的真实复现链。
2. 当前玩家把 `inspect` 中非零 `critical_photon` 缓冲直接理解成“本 tick 仍在产出”，但代码里并没有定义“切到 power 后自动清空旧库存”。

最终口径必须改成：

- `power` 模式禁止新的 `critical_photon` 增量；
- 但不会自动删除切换前已经存在的 `inventory / output_buffer`。

### 2.3 当前已存在测试证明“合成场景”下的供电回灌成立，但这还不够

现有测试已经覆盖：

- `server/internal/gamecore/t094_ray_receiver_visibility_test.go`
  - 证明在合成场景里，`ray_receiver power` 的收益会同步进入 `summary / stats / networks`
- `server/internal/gamecore/ray_receiver_settlement_test.go`
  - 证明接收站只会消费真实太阳帆 / 戴森能量

这些测试说明底层链路不是“完全失效”，但它们没有覆盖 T095 描述的官方 midgame 场景，也没有覆盖“切模式后光子缓冲不再增长”的行为。

结论：

- 问题 1 的最终方案不应重做整个结算链；
- 应以官方 midgame 复现场景补回归，并明确 `critical_photon` 的验收口径是“增量为 0”，不是“历史库存强行归零”。

### 2.4 问题 2 的确定根因，是 `state_reason` 只在状态变化时才会刷新

`server/internal/gamecore/building_lifecycle.go` 当前的 `applyBuildingState()` 有一个明确问题：

- 当 `prev == next` 时直接返回
- 也就不会刷新 `building.Runtime.StateReason`

这意味着建筑可能先经历：

1. 某个早期 tick：`no_power / power_out_of_range`
2. 后续 tick：已经接入电网，但仍因网络短缺保持 `no_power`

这时 `settleResources()` 即使已经判定新原因应为 `under_power`，只要状态仍然是 `no_power`，旧的 `state_reason` 就会残留在 `inspect` 里。

这与 T095 的复现完全吻合：

- `/world/planets/{planet_id}/networks` 已显示 `connected = true`、`shortage = true`
- `inspect` 仍残留 `power_out_of_range`
- 一旦供电恢复，建筑又能直接 `power_restored -> running`

因此，问题 2 的主修复点不在 query 层，而在运行时状态写回逻辑。

### 2.5 `ResolvePowerCoverage()` 对动态电源的识别仍弱于 `ResolvePowerNetworks()`

当前 `server/internal/model/power_grid_coverage.go` 的 `isPowerCoverageSource()` 只认：

- 普通 `Energy` 发电模块
- 有电量的 `EnergyStorage`
- `Params.EnergyGenerate > 0`

它不认本 tick 通过 `ws.PowerInputs` 注入的动态电源，例如：

- `ray_receiver`
- 储能放电写回后的动态输入

而 `ResolvePowerNetworks()` / `ResolvePowerAllocations()` 的供电统计又是直接读 `ws.PowerInputs`。

这会带来两个风险：

1. 只靠 `ray_receiver` 供电的网络，`networks.supply` 可能是正数，但 `coverage` 仍把消费者当成“没有供电源”。
2. 即使本轮 T095 的主要误判来自 `state_reason` 残留，也依然存在 `coverage` 与 `networks` 数据源不完全同构的问题。

所以，最终方案需要顺手把 `coverage` 的电源识别和 `ws.PowerInputs` 对齐，彻底消掉这类边界差异。

## 3. 方案对比与最终取舍

### 3.1 问题 1：`ray_receiver power` 的最终处理方式

#### 方案 A：继续按旧草案重做 tick 顺序与查询补丁

不采用。

原因：

- 当前 tick 顺序已经正确。
- `PowerInputs` 清空逻辑也已经存在。
- 在 query 层补丁式造数会再次制造双重真相。

#### 方案 B：保留当前结算链，只补官方 midgame 回放回归，并把光子口径改为“禁止增量”

采用。

原因：

- 现有代码已经具备 T094 级正确结构；
- T095 需要收口的是“真实官方场景是否仍成立”和“玩家如何解释 photon 缓冲”；
- 这样改动最小，也最符合当前事实。

### 3.2 问题 2：缺电原因误判的处理方式

#### 方案 A：只在 `settleResources()` 里加一次 allocation 交叉校验

不单独采用。

原因：

- 这能缓解一部分误判，但不能修掉旧 `state_reason` 残留。
- 也没有解决 `coverage` 不认动态电源的问题。

#### 方案 B：允许同状态刷新 `state_reason`，必要时同样发出事件；同时让 `coverage` 识别动态电源

采用。

原因：

- 直接命中当前已确认的根因。
- 让 `inspect`、事件流和 `networks` 重新回到同一条运行时真相上。
- 也能顺便消掉 `ray_receiver` 作为动态电源时的边界不一致。

#### 方案 C：只改文档，不改运行时

不采用。

原因：

- 当前问题不是文档表述偏差，而是真实运行态字段已经与网络读数不一致。

## 4. 最终方案

### 4.1 `ray_receiver power`：不重做结算链，改为补官方场景回归并明确模式语义

#### 4.1.1 保持当前真实结算链不变

本轮不再调整：

- `processTick()` 中 `solar_sail -> dyson_sphere -> ray_receiver -> resources -> stats` 的顺序
- `settlePowerGeneration()` 的 `PowerInputs` 清空逻辑
- `ResolveRayReceiver()` 的三模式公式

这些部分在当前代码里已经属于正确实现，不应重复拆改。

#### 4.1.2 明确 `power` 模式的最终验收语义

T095 对 `power` 模式的最终语义定为：

1. 本 tick 不再新增 `critical_photon`
2. 电网供给必须能在真实回放里表现为正增量
3. 历史 `critical_photon` 库存不会因切模式被自动清除

因此验收时比较的是：

- `critical_photon` 在切到 `power` 之后的增长量
- `summary.players[].resources.energy`、`stats.energy_stats.generation`、`networks.power_networks[].supply` 的增量

而不是要求 `inspect` 一看到 `critical_photon > 0` 就判定失败。

#### 4.1.3 用官方 midgame 场景补一条真实回放回归

新增一条 T095 级回归测试，直接复现任务文档里的官方 midgame 路径，而不是继续只靠合成场景：

1. 加载 `config-midgame.yaml` 对应的世界态或等价测试夹具
2. 放置 / 激活：
   - `vertical_launching_silo`
   - `em_rail_ejector`
   - `ray_receiver`
   - 同网基础供电与典型负载
3. 创建戴森层产能，并显式执行：
   - `set_ray_receiver_mode ... power`
   - `launch_solar_sail`
   - `launch_rocket`
4. 记录切模式后的基线：
   - 玩家 `energy`
   - `generation`
   - 网络 `supply`
   - `critical_photon` 总量
5. 跑若干真实 tick 后断言：
   - `energy / generation / supply` 高于基线
   - `critical_photon` 相对基线不再增长

这条测试才是 T095 的主防线。现有 `t094_ray_receiver_visibility_test.go` 保留，但不再单独承担验收责任。

#### 4.1.4 代码修改范围应限制在接收站链路本身，禁止改 query 造数

如果上述官方场景回归在实现阶段仍失败，本轮允许调整的范围只包括：

- `server/internal/gamecore/ray_receiver_settlement.go`
- 接收站模式切换后的状态读写链路
- 与接收站直接相关的测试夹具

明确禁止：

- 在 `query` 层直接给 `generation` / `supply` / `summary.energy` 补假值
- 为 `ray_receiver` 再套一层兼容发电机 wrapper

### 4.2 缺电状态误判：把“状态写回”和“覆盖判定”一起收口

#### 4.2.1 修改 `applyBuildingState()`，允许同状态刷新原因

`server/internal/gamecore/building_lifecycle.go` 需要改成：

1. 如果 `prev != next`，保持当前状态迁移逻辑不变。
2. 如果 `prev == next` 但 `StateReason` 发生变化，也要更新 `building.Runtime.StateReason`。
3. 对于 `no_power` 这类原因敏感状态，同状态 reason 变化时也发出 `building_state_changed` 事件。

推荐事件语义：

- `prev_state` 与 `next_state` 可以相同
- `reason` 写入新的原因
- 额外带上 `prev_reason`，方便 SSE 与快照消费方理解这是“病因变了，不是状态恢复了”

这样能直接修复：

- `inspect` 中旧 `power_out_of_range` 残留
- SSE 中观察不到“已从铺线问题转成缺电问题”的问题

#### 4.2.2 让 `settleResources()` 每 tick 都以当前分配结果重新判定病因

`server/internal/gamecore/rules.go` 中电力判定保持以下优先级：

1. 真正没有接入或没有电源：
   - `power_no_connector`
   - `power_no_provider`
   - `power_out_of_range`
2. 已接入当前网络，但当前 tick 分配为 0 或供电不足：
   - `under_power`

也就是说，`under_power` 必须严格代表：

- 建筑已经属于可供电网络
- 当前只是因为 `shortage / allocation` 拿不到电

这里可以保留 `allocation` 交叉校验作为防御，但它不再是唯一修复点；真正的落点是“每 tick 刷新原因”。

#### 4.2.3 让 `ResolvePowerCoverage()` 识别 `ws.PowerInputs` 中的动态电源

`server/internal/model/power_grid_coverage.go` 需要与 `ResolvePowerNetworks()` 对齐：

1. `isPowerCoverageSource()` 不再只看静态 `EnergyModule / EnergyStorage / EnergyGenerate`
2. 需要把本 tick `ws.PowerInputs` 中 `output > 0` 的建筑也视为真实供电源
3. 特别是：
   - `ray_receiver`
   - 储能放电
   - 未来任何只通过 `PowerInputs` 表达输出的动态电源

这样可以避免：

- `networks.supply` 已有正供给，但 `coverage` 仍说 `no_provider/out_of_range`
- 接收站成为主电源后，消费者仍被误报为“未接电网”

### 4.3 文档与外部口径同步

本轮实现落地后，需要同步修正以下文档：

1. `docs/dev/服务端API.md`
   - 说明 `building_state_changed` 现在也可能用于“同状态原因变化”
   - 补充 `prev_reason` 字段
2. `docs/dev/客户端CLI.md`
   - 更新对 `building_state_changed` 的读取说明
3. `docs/player/玩法指南.md`
   - 明确 `ray_receiver power` 的验收是“停止新的光子增长”，不是“清空旧缓冲”
4. `docs/player/已知问题与回归.md`
   - 在修复完成后移除或标记 T095 已收口

## 5. 需要改动的文件

### 5.1 服务端实现

- `server/internal/gamecore/building_lifecycle.go`
  - 支持同状态刷新 `state_reason`
  - 支持同状态原因变化时发事件
- `server/internal/gamecore/rules.go`
  - 统一当前 tick 的缺电原因判定
  - 保留必要的 allocation 防御性校验
- `server/internal/model/power_grid_coverage.go`
  - 让 coverage 识别 `ws.PowerInputs` 中的动态电源

### 5.2 测试

- `server/internal/gamecore/ray_receiver_settlement_test.go`
  - 明确覆盖 `power / photon / hybrid` 三种模式
  - 断言 `power` 模式下 `PhotonOutput == 0`
- `server/internal/gamecore/t095_ray_receiver_midgame_test.go`
  - 新增官方 midgame 级真实回放回归
  - 断言 `energy / generation / supply` 增长
  - 断言 `critical_photon` 在切到 `power` 后不再增长
- `server/internal/gamecore/power_shortage_test.go`
  - 新增“同为 `no_power`，reason 从 `power_out_of_range` 刷成 `under_power`”的回归
  - 断言会产生对应事件
- `server/internal/model/power_grid_coverage_test.go`
  - 新增 `ray_receiver` / 动态 `PowerInputs` 被识别为供电源的用例

### 5.3 文档

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`

## 6. 验证标准

实现完成后必须同时通过以下验证：

1. 官方 midgame 场景中，存在戴森能量输出且 `ray_receiver` 设为 `power` 时：
   - `summary.players[].resources.energy` 增长
   - `stats.energy_stats.generation` 增长
   - `world/planets/{planet_id}/networks.power_networks[].supply` 增长
   - `critical_photon` 相对切模式后的基线不再增长
2. 缺电场景中，若建筑已连入同一电网但未获分配：
   - `inspect` 显示 `under_power`
   - `scene` 与 SSE 事件原因一致
   - `/world/planets/{planet_id}/networks` 显示 `connected = true`、`shortage = true`
3. 当 `ray_receiver` 或储能成为动态电源时：
   - `coverage` 与 `networks` 不再出现“一个说有供电、一个说无电源”的分叉

## 7. 实施顺序

1. 先补测试：
   - `t095_ray_receiver_midgame_test`
   - `power_shortage` 原因刷新测试
   - `power_grid_coverage` 动态电源测试
2. 再改运行时：
   - `building_lifecycle.go`
   - `power_grid_coverage.go`
   - `rules.go`
3. 运行相关 Go 测试并复核官方 midgame 路径
4. 最后同步玩家文档、CLI 文档和服务端 API 文档
