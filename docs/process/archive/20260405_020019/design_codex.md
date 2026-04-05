# T094 设计方案：戴森中后期闭环缺口收口

## 1. 任务范围

本设计仅覆盖 `docs/process/task/T094_戴森中后期深度试玩新增闭环缺口.md` 中仍未收口的两项能力：

1. `ray_receiver` 在 `power` 模式下，真实存在的太阳帆 / 戴森结构能量没有稳定映射到玩家可见收益。
2. 官方 `config-midgame.yaml` 场景仍不能直接验证 `advanced_mining_machine` / `pile_sorter` / `recomposing_assembler`。

这不是“再补一套新系统”，而是把已经存在但没有形成稳定验收闭环的能力收口到单一口径。

## 2. 基于代码的现状判断

### 2.1 `ray_receiver` 不是“完全没接入电网”

阅读当前实现后，可以先排除两个错误方向：

1. `ray_receiver` 已经有电网连接点。`server/internal/model/building_runtime.go` 中它带有 `ConnectionPoints.power`，因此会进入 `PowerGrid`。
2. 统计层也不是完全不认 `ray_receiver`。`server/internal/gamecore/t093_endgame_closure_test.go` 已经证明，只要 `ws.PowerInputs` 里存在来自 `ray_receiver` 的输出，`buildPlayerEnergyStats` 和 `ResolvePowerNetworks` 都能把它计入 `generation / network.supply`。

因此，问题 1 的关键不是“补一个假发电机接口”或者“给查询层硬塞戴森能量”，而是：

- 真实 `processTick()` 链路没有对“戴森能量已更新 -> `ray_receiver` 已结算 -> `summary/stats/networks` 可观察”建立端到端保证；
- 当前 helper 级单测只覆盖了局部函数，没覆盖真实 tick 顺序和查询面。

### 2.2 midgame 场景问题本质是“场景配置与文档口径不一致”

`advanced_mining_machine` / `pile_sorter` / `recomposing_assembler` 的实现和建造入口已经存在，阻断点只是官方 midgame bootstrap 没有把对应科技标成已完成：

- `advanced_mining_machine -> photon_mining`
- `pile_sorter -> integrated_logistics`
- `recomposing_assembler -> annihilation`

同时，`applyPlayerBootstrap()` 只是直接写入 `player.Tech.CompletedTechs`，并不会递归校验前置科技链。因此，midgame 场景可以只补这三个叶子科技，而不必为了 `annihilation` 额外预置 `dirac_inversion`。

这点很重要，因为任务明确要求保留 `set_ray_receiver_mode ... photon` 的科技门禁验证。

### 2.3 不需要新增跨星球资源同步层

`runtime_registry.go` 在创建多个星球运行态时复用了同一份 `players` map。也就是说，`summary.players[p1].resources.energy` 本来就应该反映共享玩家态，不需要为了问题 1 额外做“星球间能量同步”。

## 3. 设计目标

### 3.1 目标

1. 在真实 tick 链路中，保证“太阳帆 / 戴森结构能量存在”会在有限 tick 内反馈到：
   - `summary.players[pid].resources.energy`
   - `state/stats.energy_stats.generation`
   - `world/planets/{planet_id}/networks.power_networks[].supply`
2. 官方 midgame 场景成为单一、稳定、可复现的中后期验证入口，不再让文档声称“官方可直接验证”但实际被科技门禁卡住。
3. 不新增兼容层，不引入第二套能源真相来源，不在查询层做“补丁式造数”。

### 3.2 非目标

1. 不重写整个能源系统。
2. 不把 `ray_receiver` 改造成普通 `EnergyModule` 发电机。
3. 不新增 `config-midgame-plus.yaml` 一类的第二官方场景。
4. 不顺手开放 `dirac_inversion`，避免破坏 `photon` 模式门禁验证。

## 4. 方案对比

### 4.1 问题 1：`ray_receiver power` 可见收益

#### 方案 A：调整 tick 结算相位，并补端到端回归

做法：

- 在 `processTick()` 中先更新太阳帆与戴森结构能量，再结算 `ray_receiver`；
- 保留现有 `ws.PowerInputs -> ResolvePowerNetworks -> buildPlayerEnergyStats` 这条统计链；
- 新增真实 tick + query 层回归测试，覆盖 `summary / stats / networks` 三个观察面。

优点：

- 改动最小，直接修正运行时顺序问题；
- 不引入新的缓存或重复状态；
- 与现有 `PowerInputs`、电网聚合、查询层保持同一套数据源。

缺点：

- 需要把当前“helper 单测足够”的测试策略升级成端到端测试。

#### 方案 B：新增一层“戴森可用能量快照”，让 `ray_receiver` 和查询层都读快照

做法：

- 新建每 tick 统一刷新的 `available_dyson_energy` 缓存；
- `ray_receiver` 和统计查询都依赖这个缓存。

优点：

- 能显式表达“本 tick 的外部可用能量”。

缺点：

- 会平白多出一层状态；
- 查询层如果也读快照，很容易绕开真实 `PowerInputs` 与电网供给，形成双重真相；
- 对当前问题来说是过度设计。

#### 方案 C：不改 tick，只在 `stats/networks/summary` 查询时直接补戴森能量

优点：

- 表面上实现快。

缺点：

- 这是错误方案；
- 玩家看到“有电”，但真实 `PowerInputs`、电网分配和建筑供电并没有同步变化；
- 会把运行时行为和查询口径彻底分叉。

#### 结论

问题 1 采用方案 A。

### 4.2 问题 2：midgame 场景覆盖 3 个高级建筑

#### 方案 A：扩充官方 `config-midgame.yaml` 的 bootstrap 科技

做法：

- 给每个玩家追加：
  - `integrated_logistics`
  - `photon_mining`
  - `annihilation`
- 明确保留 `dirac_inversion` 未完成。

优点：

- 官方场景继续作为唯一中后期验证入口；
- 不需要新增 CLI 命令或新场景；
- 只改配置与文档，风险极低；
- 能直接兑现仓库当前“这些建筑已经实现”的对外表述。

缺点：

- bootstrap 科技集合会出现“叶子科技已完成，但前置科技不全列出”的情况；
- 需要在文档里明确说明这是官方验证场景的预置能力，不代表自然科研路径已走完。

#### 方案 B：保留当前配置，只修改玩家侧文档

优点：

- 完全不改运行时。

缺点：

- 官方 midgame 会继续是一个“部分可验、部分不可验”的场景；
- 用户必须记住哪些建筑虽然实现了，但这条官方路线不能直接测；
- 文档复杂度上升，回归路径变差。

#### 方案 C：新增第二套扩展 midgame 场景

优点：

- 可以把“保留门禁”和“全量验证”分开。

缺点：

- 直接把单一官方入口拆成两条路线；
- 文档、测试、脚本都要双维护；
- 违背当前仓库已经在收口“官方 midgame 就是中后期验证场景”的方向。

#### 结论

问题 2 采用方案 A。

## 5. 详细设计

### 5.1 `ray_receiver power` 的可见收益闭环

#### 5.1.1 目标行为

在任一已加载星球上，只要同时满足：

1. 玩家已有 `solar_sail orbit energy > 0` 或 `dyson_sphere total_energy > 0`
2. `ray_receiver.runtime.functions.ray_receiver.mode = power`
3. 建筑处于 `running`

那么在若干 tick 内必须出现以下结果：

1. `settleRayReceivers()` 向 `ws.PowerInputs` 追加 `SourceKind = ray_receiver` 的输出；
2. 玩家共享资源 `Resources.Energy` 出现可见增长；
3. `buildPlayerEnergyStats()` 得到更高的 `generation`；
4. `/world/planets/{planet_id}/networks` 中至少一个 `power_network.supply` 反映这份新增供给。

#### 5.1.2 运行时相位调整

当前 `processTick()` 顺序里，`settleRayReceivers()` 早于 `settleSolarSails()` / `settleDysonSpheres()`。设计上应改成“先更新外部戴森能量，再做接收和入网”：

1. `settlePowerGeneration(ws, env)`
2. `settleSolarSails(ws.Tick)`
3. `settleDysonSpheres(ws.Tick)`
4. `settleRayReceivers(ws)`
5. 其余依赖电力状态或资源状态的结算

这样做的理由：

1. `settlePowerGeneration()` 会清空并重建本 tick 的基础 `PowerInputs`，所以仍应放在电力相位开头；
2. `settleSolarSails()` 与 `settleDysonSpheres()` 负责刷新外部能量可用量，必须发生在 `settleRayReceivers()` 之前；
3. `settleRayReceivers()` 只负责把“外部能量”转成“本星球电力输入 + 玩家共享资源变化”，不应再自己承担“刷新戴森态”的职责。

这里不新增新的统一缓存结构，也不额外拆一层 adapter。现有 `solarSailOrbits[*].TotalEnergy` 与 `dysonSphereStates[*].TotalEnergy` 已经足够表达权威状态，问题只是 tick 读取时机错误。

#### 5.1.3 数据口径保持单一

设计要求保持以下链路为唯一事实来源：

`太阳帆/戴森态 -> settleRayReceivers -> ws.PowerInputs -> ResolvePowerNetworks/buildPlayerEnergyStats/query`

禁止做法：

1. 在 `query` 层根据 `dysonSphere.TotalEnergy` 直接给 `generation` 或 `network.supply` 造数。
2. 为 `ray_receiver` 伪造一套额外的 `EnergyModule` 发电机定义。
3. 在 `summary` 层单独补“戴森收益字段”来绕过实际电网结算。

这样可以保证玩家看到的 `summary/stats/networks` 都来自同一条运行时链路。

#### 5.1.4 测试设计

现有测试只说明局部函数能工作，不足以覆盖 T094 的真实缺口。需要新增一组 processTick 级回归：

1. 基线阶段
   - 创建带 `wind_turbine + ray_receiver + consumer` 的同网场景；
   - 记录未注入戴森能量时的：
     - `summary.players.p1.resources.energy`
     - `stats.energy_stats.generation`
     - `sum(power_networks[].supply)`
2. 注入阶段
   - 构造 `dyson_sphere total_energy > 0` 的玩家态；
   - 将 `ray_receiver` 模式显式设为 `power`；
   - 运行 1 到 2 个 `processTick()`
3. 断言阶段
   - `summary` 中玩家能量高于基线；
   - `stats.energy_stats.generation` 高于基线；
   - `networks.power_networks[].supply` 总和高于基线；
   - `ws.PowerInputs` 中存在 `SourceKind = ray_receiver`

推荐新增测试文件：

- `server/internal/gamecore/t094_ray_receiver_visibility_test.go`

保留并继续使用现有局部测试：

- `server/internal/gamecore/ray_receiver_settlement_test.go`
- `server/internal/gamecore/t093_endgame_closure_test.go`

新测试不是替代，而是把 helper 级验证补成真实 tick 闭环验证。

#### 5.1.5 预计修改文件

- `server/internal/gamecore/core.go`
  - 调整 tick 内的电力相关结算顺序；
  - 在代码注释中明确“外部戴森能量刷新”与“本地接收入网”是两个相邻相位。
- `server/internal/gamecore/t094_ray_receiver_visibility_test.go`
  - 新增端到端回归测试。

不建议改动：

- `server/internal/model/building_runtime.go`
- `server/internal/model/power_grid_aggregation.go`
- `server/internal/query/networks.go`

原因是这些模块已经具备接纳 `ray_receiver PowerInputs` 的能力，当前没有必要为了 T094 引入额外复杂度。

### 5.2 midgame 场景覆盖 3 个高级建筑

#### 5.2.1 目标行为

在官方 `config-midgame.yaml + map-midgame.yaml` 场景下，玩家执行：

- `build 8 6 recomposing_assembler`
- `build 8 7 pile_sorter`
- `build 10 7 advanced_mining_machine`

应当不再被“requires research to unlock”拦截。是否能进入 `running`，仍由位置、电网、资源点等正常规则决定。

#### 5.2.2 bootstrap 设计

对 `p1` 与 `p2` 的 `completed_techs` 统一追加：

- `integrated_logistics`
- `photon_mining`
- `annihilation`

同时明确保留：

- 不追加 `dirac_inversion`

这样可以同时满足：

1. `pile_sorter` / `advanced_mining_machine` / `recomposing_assembler` 可直接建造；
2. `set_ray_receiver_mode ... photon` 依旧会因为 `dirac_inversion` 缺失而被拒绝；
3. midgame 仍是一条单一官方验证路径。

这里接受“场景预置科技不要求前置链完整展开”的设定，因为当前 bootstrap 机制本来就是直接写 `CompletedTechs`，不会校验前置。官方 midgame 的职责是构造可验证场景，不是模拟一条自然科研档。

#### 5.2.3 文档同步策略

后续实现时，需要同步更新以下文档：

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`

新的统一口径应为：

1. 官方 midgame 现在可直接验证：
   - `advanced_mining_machine`
   - `pile_sorter`
   - `recomposing_assembler`
   - 既有的 `orbital_collector` / `vertical_launching_silo` / `em_rail_ejector` / `ray_receiver` / 防御建筑
2. 官方 midgame 仍然不会预置 `dirac_inversion`；
3. 因此 `photon` 模式仍保留为科技门禁验证项。

#### 5.2.4 回归测试

推荐新增配置回归测试，而不是只靠文档或人工记忆：

- `server/internal/startup/t094_midgame_bootstrap_test.go`

测试断言：

1. 使用实际 `config-midgame.yaml + map-midgame.yaml` 启动时，`p1` 的 `CompletedTechs` 包含：
   - `integrated_logistics`
   - `photon_mining`
   - `annihilation`
2. 同时不包含：
   - `dirac_inversion`

如需更进一步，也可以补一条命令级回归，在加载 midgame 后直接验证这三个 `build` 不再因科技门禁失败。

#### 5.2.5 预计修改文件

- `server/config-midgame.yaml`
- `server/internal/startup/t094_midgame_bootstrap_test.go`
- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`

## 6. 实施顺序

推荐按以下顺序落地：

1. 先改 `ray_receiver` 的 tick 相位，并补端到端测试
   - 这是 T094 的核心闭环缺口；
   - 先把真实运行时行为固定住，避免后续继续围绕错误现象写文档。
2. 再扩充 `config-midgame.yaml`
   - 这是低风险纯配置改动；
   - 完成后文档才能统一改成“官方 midgame 可直接验证”。
3. 最后统一更新玩家侧 / 开发侧文档
   - 保证场景能力、CLI 样例、API 文档口径完全一致。

## 7. 验收矩阵

### 7.1 问题 1

1. 在存在 `dyson_sphere total_energy > 0` 的场景里，`ray_receiver` 切到 `power` 后，1 到 2 个 tick 内：
   - `summary.players.p1.resources.energy` 增长；
   - `stats.energy_stats.generation` 增长；
   - `sum(networks.power_networks[].supply)` 增长。
2. `ws.PowerInputs` 出现 `SourceKind = ray_receiver` 的记录。
3. 不新增查询层补丁字段，不新增第二套能源统计口径。

### 7.2 问题 2

1. 官方 midgame 下三个建筑不再因科技门禁失败：
   - `advanced_mining_machine`
   - `pile_sorter`
   - `recomposing_assembler`
2. `dirac_inversion` 仍未预置。
3. `set_ray_receiver_mode <id> photon` 仍保持被门禁拒绝。
4. 玩家侧与开发侧文档都不再出现“这三个建筑官方 midgame 可直接验证 / 不可直接验证”并存的双重表述。

## 8. 最终推荐

T094 应按以下方式收口：

1. 对问题 1，修正 `processTick()` 中的电力相关结算顺序，把“太阳帆 / 戴森态刷新”前置到 `ray_receiver` 结算之前，并用真实 tick + query 回归测试锁死 `summary / stats / networks` 三面一致性。
2. 对问题 2，直接扩充官方 `config-midgame.yaml` 的 bootstrap 科技，补齐 `integrated_logistics`、`photon_mining`、`annihilation`，同时刻意保持 `dirac_inversion` 未预置。

这样改动最直接，也最符合当前仓库的设计方向：不用兼容层，不造第二真相，把官方 midgame 场景收口成真正可执行的中后期验证入口。
