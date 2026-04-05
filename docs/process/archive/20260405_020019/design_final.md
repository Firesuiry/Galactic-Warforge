# T094 最终设计方案：戴森中后期闭环缺口收口

## 1. 文档目标

本文综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，输出 T094 的单一定稿方案。目标不是保留两份草案的并列意见，而是给出一份可直接进入实现阶段的最终实现方案。

本轮只收口 `docs/process/task/T094_戴森中后期深度试玩新增闭环缺口.md` 中的两个问题：

1. `ray_receiver` 在 `power` 模式下，没有把真实存在的太阳帆 / 戴森结构能量稳定映射到玩家可见收益。
2. 官方 `config-midgame.yaml` 场景仍不能直接覆盖 `advanced_mining_machine`、`pile_sorter`、`recomposing_assembler`。

最终方案遵循仓库的“激进式演进”原则：

- 不在查询层造第二套能源真相。
- 不为了兼容旧判断增加适配层。
- 不新增第二套 “midgame-plus” 官方验证场景。
- 直接修正阻断闭环的真实实现点，并把文档口径收敛为一份。

## 2. 基于当前实现的事实判断

### 2.1 `ray_receiver` 已接入电网与统计链

综合两份草案后，需要先明确一个已经可被代码证伪的问题：`ray_receiver` 不是“根本没进电网”。

当前实现里：

- `server/internal/model/building_runtime.go` 已为 `BuildingTypeRayReceiver` 定义 `ConnectionPoints.power`。
- `server/internal/model/power_grid.go` 的 `BuildPowerGridGraph()` / `AddBuilding()` 会把带 power connector 的建筑纳入电网图。
- `server/internal/model/power_grid_aggregation.go` 的 `ResolvePowerNetworks()` 会优先读取 `ws.PowerInputs`，并把对应建筑输出计入 `network.Supply`。
- `server/internal/gamecore/stats_settlement.go` 的 `buildPlayerEnergyStats()` 直接聚合 `ResolvePowerNetworks()` 的结果。
- 现有测试 `server/internal/gamecore/t093_endgame_closure_test.go` 已证明：只要 `ws.PowerInputs` 中存在来自 `ray_receiver` 的输出，`generation` 与网络 `supply` 都会被正确统计。

结论：

- 问题 1 不需要再去补 `ray_receiver` 的电网连接器。
- 也不需要修改 `ResolvePowerNetworks()`、`query/networks.go` 或额外新增查询补丁字段。

### 2.2 真正缺口在真实 tick 相位顺序，而不是局部结算公式

当前 `server/internal/gamecore/core.go` 的真实 tick 顺序是：

1. `settlePowerGeneration(ws, env)`
2. `settleRayReceivers(ws)`
3. `settlePlanetaryShields(ws)`
4. `settleSolarSails(ws.Tick)`
5. `settleDysonSpheres(ws.Tick)`
6. `settleResources(ws)`

这意味着 `settleRayReceivers()` 在读取 `GetSolarSailEnergyForPlayer()` / `GetDysonSphereEnergyForPlayer()` 时，拿到的不是当前 tick 刷新的最新值，而是前一拍或未初始化值。

现有 `server/internal/gamecore/ray_receiver_settlement_test.go` 之所以能通过，是因为测试里手动先调用了 `settleDysonSpheres()`，绕开了真实 `processTick()` 顺序问题。它证明了局部 helper 能工作，但没有证明真实 tick 链路可见收益闭环已成立。

结论：

- 问题 1 的核心修复点是 `processTick()` 中的结算相位顺序。
- 还必须补一组真实 tick + query 级别的端到端回归，不能继续只靠 helper 单测。

### 2.3 midgame bootstrap 只写 `CompletedTechs`，不会递归校验前置链

两份草案的第二个关键分歧，是 midgame 是否必须补全整条前置科技链。当前代码给出的答案是否定的。

当前实现里：

- `server/internal/gamecore/core.go` 的 `applyPlayerBootstrap()` 只是把 `bootstrap.completed_techs` 逐项写进 `player.Tech.CompletedTechs`。
- `server/internal/gamecore/research.go` 的 `CanBuildTech()` 会遍历 `CompletedTechs`，只要任一已完成科技声明了解锁目标，就允许建造。
- 建造门禁 `server/internal/gamecore/rules.go` 也只是调用 `CanBuildTech()`，不会回头递归检查这个 bootstrap 科技在自然科研路径上的前置链是否完整。

这意味着：

- 对 midgame 来说，直接补 `integrated_logistics`、`photon_mining`、`annihilation` 就足以开放对应建筑。
- 不需要为了 `annihilation` 再去额外补 `dirac_inversion` 及更深前置。

### 2.4 不需要新增跨星球资源同步层

`server/internal/gamecore/runtime_registry.go` 中 `buildSharedPlayers()` 创建的是共享 `players` map，并被多个行星 `WorldState` 复用。因此玩家资源本来就是跨星球共享玩家态，不需要为了 T094 再设计一层“跨星球能量同步”。

结论：

- 问题 1 只修 tick 相位与验证链路，不扩写额外同步机制。

## 3. 方案对比与最终取舍

### 3.1 问题 1：`ray_receiver power` 可见收益

#### 方案 A：调整 tick 相位顺序，并补端到端回归

做法：

- 在 `processTick()` 中先刷新太阳帆 / 戴森结构能量，再结算 `ray_receiver`。
- 保持现有 `太阳帆/戴森态 -> settleRayReceivers -> ws.PowerInputs -> ResolvePowerNetworks -> stats/query` 这条链路不变。
- 新增真实 tick 场景回归，覆盖 `summary`、`stats`、`networks` 三个观察面。

优点：

- 直接修正真实运行时问题，改动最小。
- 不新增冗余缓存或重复状态。
- 与当前电网、统计、查询逻辑完全同源。

缺点：

- 需要把测试从 helper 级提升到 processTick 级。

#### 方案 B：新增“可用戴森能量快照”供结算层与查询层共享

不采用。

原因：

- 会平白引入一层新状态。
- 查询层容易绕开真实 `ws.PowerInputs`，形成双重真相。
- 对当前问题属于明显过度设计。

#### 方案 C：不改 tick，只在查询层直接补能源统计

不采用。

原因：

- 玩家会看到“统计里有收益”，但真实电网分配和建筑供电并未同步变化。
- 这会把运行时行为与查询口径彻底分叉。

#### 结论

问题 1 采用方案 A。

### 3.2 问题 2：midgame 场景覆盖 3 个高级建筑

#### 方案 A：扩充官方 `config-midgame.yaml` 的 bootstrap 叶子科技

做法：

- 对 `p1` 与 `p2` 的 `completed_techs` 统一追加：
  - `integrated_logistics`
  - `photon_mining`
  - `annihilation`
- 明确保留 `dirac_inversion` 未完成。

优点：

- 继续维持单一官方中后期验证入口。
- 只改配置和测试，风险最低。
- 能直接兑现“这些建筑已实现且官方 midgame 可直接验证”的对外口径。
- 保留 `set_ray_receiver_mode ... photon` 的科技门禁验证。

缺点：

- midgame bootstrap 会出现“叶子科技已完成，但自然科研前置未完整展开”的形态。
- 需要在文档中明确这是一套官方验证场景，不代表自然科研档。

#### 方案 B：保留当前配置，只把文档改成“这 3 个建筑暂不可直接验证”

不采用。

原因：

- 任务要求已经给了“可直接补进官方场景”的选项。
- 继续保留“实现存在，但官方场景不可验”的状态，会让文档和回归路径持续分裂。

#### 方案 C：补完整前置科技链

不采用。

原因：

- 当前 bootstrap 机制根本不需要自然科研链完整成立。
- 为了让 `annihilation` 合法沿科研链成立，势必要继续补 `dirac_inversion` 及更多前置，等于主动破坏 `photon` 模式门禁验证。
- 这会让 midgame 场景承担多余能力，扩大变更面，没有收益。

#### 结论

问题 2 采用方案 A。

## 4. 最终方案

### 4.1 修正 `ray_receiver power` 的真实收益闭环

#### 4.1.1 目标行为

在任一已加载星球上，只要同时满足：

1. 玩家已有 `solar sail orbit energy > 0` 或 `dyson sphere total_energy > 0`
2. `ray_receiver.mode = power`
3. 建筑处于 `running`

则在 1 到 2 个 tick 内必须同时看到：

1. `settleRayReceivers()` 向 `ws.PowerInputs` 写入 `SourceKind = ray_receiver` 的供电记录。
2. `summary.players[pid].resources.energy` 明显增长。
3. `state/stats.energy_stats.generation` 高于未接入戴森收益时的基线值。
4. `world/planets/{planet_id}/networks.power_networks[].supply` 至少有一个网络反映新增供给。

#### 4.1.2 运行时相位调整

将 `server/internal/gamecore/core.go` 中相关结算顺序调整为：

1. `settlePowerGeneration(ws, env)`
2. `settleSolarSails(ws.Tick)`
3. `settleDysonSpheres(ws.Tick)`
4. `settleRayReceivers(ws)`
5. `settlePlanetaryShields(ws)`
6. `settleResources(ws)`
7. 其余物流、生产、战斗、统计阶段保持原有职责边界

这样做的理由：

1. `settlePowerGeneration()` 仍应先清空并建立本 tick 的基础发电输入。
2. `settleSolarSails()` 与 `settleDysonSpheres()` 负责刷新外部戴森可用能量，必须先于 `settleRayReceivers()`。
3. `settleRayReceivers()` 的职责只是把外部能量转成“本地电网输入 + 玩家资源变化”，不应再自己承担刷新戴森态的职责。
4. `settlePlanetaryShields()` 继续放在射线接收站之后，使其看到本 tick 已入网的供电结果。

#### 4.1.3 数据口径保持单一

实现时必须坚持一条唯一事实链：

`solar_sail_orbit / dyson_sphere -> settleRayReceivers -> ws.PowerInputs -> ResolvePowerNetworks -> stats/query`

明确禁止：

1. 在 `query` 层根据 `dyson_sphere.TotalEnergy` 直接给 `generation` 或 `network.supply` 造数。
2. 为 `ray_receiver` 再伪造一套普通发电机适配层。
3. 增加额外“戴森收益字段”绕过真实电网聚合。

#### 4.1.4 测试设计

新增真实 tick 级回归测试，推荐文件：

- `server/internal/gamecore/t094_ray_receiver_visibility_test.go`

测试应覆盖三段：

1. 基线阶段
   - 创建 `wind_turbine + ray_receiver + consumer` 同网场景。
   - 记录未注入戴森收益时的：
     - `summary.players.p1.resources.energy`
     - `stats.energy_stats.generation`
     - `sum(networks.power_networks[].supply)`
2. 注入阶段
   - 构造 `dyson sphere total_energy > 0` 或 `solar sail orbit energy > 0`。
   - 将 `ray_receiver` 显式切到 `power`。
   - 跑真实 `processTick()` 1 到 2 次。
3. 断言阶段
   - `summary` 玩家能量高于基线。
   - `stats.energy_stats.generation` 高于基线。
   - `networks.power_networks[].supply` 总和高于基线。
   - `ws.PowerInputs` 中存在 `SourceKind = ray_receiver`。

保留现有局部测试：

- `server/internal/gamecore/ray_receiver_settlement_test.go`
- `server/internal/gamecore/t093_endgame_closure_test.go`

它们继续验证局部结算和聚合能力；新测试负责锁死真实 tick 闭环。

#### 4.1.5 预计修改文件

- `server/internal/gamecore/core.go`
- `server/internal/gamecore/t094_ray_receiver_visibility_test.go`

不建议改动：

- `server/internal/model/building_runtime.go`
- `server/internal/model/power_grid.go`
- `server/internal/model/power_grid_aggregation.go`
- `server/internal/query/networks.go`

### 4.2 扩充官方 midgame 场景，直接覆盖 3 个高级建筑

#### 4.2.1 目标行为

在官方 `config-midgame.yaml + map-midgame.yaml` 场景下，以下命令不再被“requires research to unlock”拦截：

- `build 8 6 recomposing_assembler`
- `build 8 7 pile_sorter`
- `build 10 7 advanced_mining_machine`

是否能最终进入 `running`，仍由位置、供电、资源点、库存等正常运行时规则决定。

#### 4.2.2 bootstrap 调整

对 `server/config-midgame.yaml` 中 `p1` 与 `p2` 的 `completed_techs` 统一追加：

- `integrated_logistics`
- `photon_mining`
- `annihilation`

同时明确保持：

- 不追加 `dirac_inversion`

这样可以同时满足：

1. `pile_sorter`、`advanced_mining_machine`、`recomposing_assembler` 可直接建造。
2. `set_ray_receiver_mode <id> photon` 仍因为缺少 `dirac_inversion` 被门禁拒绝。
3. 官方 midgame 继续保持单一路径，不引入第二套验证场景。

#### 4.2.3 回归测试

推荐补两层回归：

1. 配置契约测试
   - 文件建议：`server/internal/startup/t094_midgame_bootstrap_test.go`
   - 断言 midgame 启动后：
     - `CompletedTechs` 包含 `integrated_logistics`、`photon_mining`、`annihilation`
     - 不包含 `dirac_inversion`
2. 命令级回归测试
   - 文件建议：`server/internal/gamecore/t094_midgame_unlock_test.go`
   - 断言在实际加载 midgame 场景后：
     - 三个 `build` 命令不再因科技门禁失败
     - `set_ray_receiver_mode ... photon` 仍返回门禁拒绝

#### 4.2.4 预计修改文件

- `server/config-midgame.yaml`
- `server/internal/startup/t094_midgame_bootstrap_test.go`
- `server/internal/gamecore/t094_midgame_unlock_test.go`

### 4.3 文档同步口径

实现完成后，需要同步更新以下文档：

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`

统一口径应为：

1. 官方 midgame 现在可直接验证：
   - `advanced_mining_machine`
   - `pile_sorter`
   - `recomposing_assembler`
   - 以及已在前几轮收口的 `orbital_collector`、`vertical_launching_silo`、`em_rail_ejector`、`ray_receiver`、防御建筑
2. 官方 midgame 仍然不会预置 `dirac_inversion`
3. 因此 `photon` 模式继续保留为科技门禁验证项
4. `ray_receiver power` 的可见收益现在同时会反映到：
   - `summary.players[pid].resources.energy`
   - `state/stats.energy_stats.generation`
   - `world/planets/{planet_id}/networks.power_networks[].supply`

## 5. 实施顺序

建议按以下顺序落地：

1. 先修 `ray_receiver` 的 tick 相位，并补端到端回归
   - 这是 T094 的核心玩法闭环缺口
   - 先把真实运行时行为锁定，再改场景与文档
2. 再扩充 `config-midgame.yaml`
   - 这是低风险配置改动
   - 完成后可用统一官方场景验证剩余建筑
3. 最后同步玩家侧与开发侧文档
   - 保证玩法指南、CLI 文档、API 文档不再出现双重表述
4. 做一次完整回归
   - `go test ./...`
   - 按 T094 任务文档至少手动回放一次 midgame 路径

## 6. 验收矩阵

### 6.1 问题 1

1. 在存在 `dyson sphere total_energy > 0` 或 `solar sail orbit energy > 0` 的场景里，`ray_receiver` 切到 `power` 后，1 到 2 个 tick 内：
   - `summary.players.p1.resources.energy` 增长
   - `stats.energy_stats.generation` 增长
   - `sum(networks.power_networks[].supply)` 增长
2. `ws.PowerInputs` 中出现 `SourceKind = ray_receiver` 的记录
3. 不新增查询层补丁字段，不新增第二套能源统计口径

### 6.2 问题 2

1. 官方 midgame 下以下建筑不再因科技门禁失败：
   - `advanced_mining_machine`
   - `pile_sorter`
   - `recomposing_assembler`
2. `dirac_inversion` 仍未预置
3. `set_ray_receiver_mode <id> photon` 仍保持门禁拒绝
4. 玩家侧与开发侧文档不再同时出现“这 3 个建筑官方可直接验证 / 不可直接验证”两套口径

## 7. 最终推荐

T094 应按以下方式收口：

1. 对问题 1，修正 `processTick()` 中的电力相关结算顺序，把“太阳帆 / 戴森态刷新”前置到 `ray_receiver` 结算之前，并用真实 tick + query 回归测试锁死 `summary / stats / networks` 三面一致性。
2. 对问题 2，直接扩充官方 `config-midgame.yaml` 的 bootstrap 科技，只补 `integrated_logistics`、`photon_mining`、`annihilation` 三个叶子科技，同时刻意保持 `dirac_inversion` 未预置。

这样改动最直接，也最符合当前仓库的设计方向：不加兼容层，不造第二真相，把官方 midgame 场景收口成真正可执行的中后期验证入口。
