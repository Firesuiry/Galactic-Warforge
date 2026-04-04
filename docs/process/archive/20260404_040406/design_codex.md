# T090 戴森球计划剩余建筑、科技树与玩法闭环收口设计方案（Codex）

## 1. 文档目标

本文针对 `docs/process/task/T090_戴森球计划剩余建筑科技树与玩法闭环.md`，基于当前工作区代码与任务描述，给出一份可直接指导实现的详细设计方案。

本方案只解决 T090 明确列出的 6 类问题，并遵守仓库的“激进式演进”原则：

- 直接修正错误的数据模型与接口，不保留旧的半真半假定义态。
- 优先让玩家可见玩法闭环成立，再决定哪些历史占位定义应降级为“未实现”。
- 不假设当前工作区里的未提交修改已经完成验收，验收基线仍以 T090 问题描述为准。

本文的核心目标有三条：

1. 把当前已经露出接口、但实际上不能跑通的主线能力补成真正可玩。
2. 把确实还没有底层支撑的建筑和玩法从“已覆盖”文档中剥离出去。
3. 为后续实现保留清晰边界，避免为了兼容旧设计再引入包装层。

## 2. 现状约束

### 2.1 已确认的真实断点

当前代码里与 T090 直接相关的断点如下：

- `orbital_collector` 已可建造，但 `server/internal/model/building_runtime.go` 里没有电网 `connection_points`，而 `settleOrbitalCollectors()` 又只在 `building.Runtime.State == running` 时产出资源，因此实机永远卡在 `no_power`。
- 研究系统仍是抽象“研究点”模型。`server/internal/gamecore/research.go` 直接把科技成本按数量求和后推进，并不读取或扣减任何矩阵物品。
- 矩阵命名与科技成本并不一致。科技树成本大量使用 `electromagnetic_matrix`、`energy_matrix`、`structure_matrix`、`information_matrix`、`gravity_matrix`、`universe_matrix`，但当前服务端物品表只定义了 `matrix_blue`、`matrix_red`、`matrix_yellow`、`matrix_universe` 四个实物，后两色矩阵根本不存在。
- 多星球运行态仍然只有一个 `WorldState`。`query/runtime.go` 与 `query/networks.go` 对非 active planet 直接返回 `available=false`，存档结构 `snapshot.WorldSnapshot` 也只持久化单星球。
- `ray_receiver` 的三种模式已经在 `server/internal/model/ray_receiver.go` 中实现，但没有任何公开命令能改 `Mode`。
- `client-cli/src/repl.ts` 对 `line` 事件直接 `async` 发送，没有串行队列，连续粘贴会并发发命令。

### 2.2 T090 中 8 个“定义存在但不可建造”的建筑现状

当前这 8 个建筑应分成两组看：

| 建筑 | 现状 | 结论 |
| --- | --- | --- |
| `advanced_mining_machine` | 只有 building definition，没有 runtime 模块 | 可在 T090 内补成真实建筑 |
| `pile_sorter` | 已有 `SorterModule`，只是 `Buildable=false` | 可在 T090 内补成真实建筑 |
| `recomposing_assembler` | 已有配方引用，但没有 runtime 模块 | 可在 T090 内补成真实建筑 |
| `energy_exchanger` | 已被电网/储能逻辑识别为 energy hub，但无明确模块与公开语义 | 可在 T090 内补成“简化可玩版” |
| `jammer_tower` | 无 runtime，防御/干扰结算未落地 | 不应继续伪装成已覆盖 |
| `sr_plasma_turret` | 无 runtime，现有炮塔结算只覆盖带 `CombatModule` 的建筑 | 不应继续伪装成已覆盖 |
| `planetary_shield_generator` | 无 runtime，护盾结算链不存在 | 不应继续伪装成已覆盖 |
| `self_evolution_lab` | 只通过隐藏科技 alias 映射，底层 dark fog 闭环未成型 | 不应继续伪装成已覆盖 |

这里必须明确一个现实：T090 不应该把“战斗后期建筑”和“黑雾专属建筑”一起偷渡成主线已实现。前四个可以依赖现有采集、分拣、生产、电网体系直接落地；后四个背后需要新的防御/黑雾玩法层，本轮应降级文档而不是强行上壳体。

### 2.3 额外一致性风险

T090 之外还存在与本任务强相关的历史错配：

- `antimatter_fuel_rod`、`annihilation_constraint_sphere` 配方目前仍引用不存在的 `controlled_annihilation` tech id。
- 多个“已 buildable 的战斗建筑”在 building definition 中可建，但 runtime 并不完整，不应被拿来作为“只要 buildable=true 就算完成”的先例。

因此本设计要求实现时同步做一次“科技解锁与运行时模块对齐”清洗，至少保证本轮触及的建筑、配方、文档三者一致。

## 3. 方案对比

### 3.1 方案 A：只修 6 个表层问题，不统一底层模型

做法：

- 给 `orbital_collector` 补连接点。
- 给 `ray_receiver` 和 active planet 各加一个命令。
- 把 CLI 改串行。
- 把那 8 个建筑里能建的设为 `Buildable=true`。
- 研究继续保留抽象点数，只在 `start_research` 前加一次库存检查。

问题：

- 科研仍然不是实物驱动，只是“点数驱动前加门禁”。
- 多星球仍然没有可持久的 planet runtime 结构，切换与续档会继续不一致。
- 建筑覆盖仍然会留下大量“buildable 但空壳”的假完成态。

结论：不推荐。

### 3.2 方案 B：直接做完整 UniverseRuntime 重构 + 全部晚期建筑补齐

做法：

- 把 `WorldState` 拆成“全局状态 + 行星局部状态”。
- 多星球完整并行 Tick。
- 同时补齐战斗后期塔、防护罩、黑雾实验室。

问题：

- 范围明显超出 T090。
- 会把科研、物流、多星球、防御、黑雾五条线耦合到一次提交里，验证风险过高。

结论：不适合作为 T090 落地方案。

### 3.3 方案 C：推荐方案

采用分层收口：

1. 直接统一矩阵物品与科技成本的命名体系，改成真实矩阵实物驱动研究。
2. 只把“已有底层模块可依赖”的 4 个建筑并入主线，把另外 4 个明确降级为未实现。
3. 为多星球玩法引入“多行星运行态注册表 + active planet 切换命令 + 官方双据点 midgame 场景”，不顺手实现通用殖民系统。
4. 为 `ray_receiver` 增加专用模式命令，并让模式受科技解锁约束。
5. 修复 CLI 输入串行语义，并补自动化测试。

这是最小但真实的玩法闭环方案。

## 4. 总体设计原则

### 4.1 统一用真实、唯一的 ID

研究成本、物品定义、配方输出必须使用同一套矩阵 ID。推荐直接以科技树和 `config/defs/items/science/*.yaml` 中已经存在的 canonical id 为准：

- `electromagnetic_matrix`
- `energy_matrix`
- `structure_matrix`
- `information_matrix`
- `gravity_matrix`
- `universe_matrix`

不保留 `matrix_blue` 这类内部别名型主数据。

### 4.2 只把有完整运行时语义的建筑算作“已覆盖”

对建筑的完成标准固定为四项同时成立：

1. `buildable=true`
2. 有明确科技解锁入口
3. 有真实 runtime 模块与结算效果
4. 玩家已有公开入口能验证该效果

缺任何一项，都必须在文档中标注为未实现。

### 4.3 多星球只补“可经营闭环”，不补“完整殖民系统”

T090 的目标是让 gas giant 和 rocky planet 真正形成资源链，不是一次性补完整跨星球开荒、殖民、舰队航行系统。

因此本轮允许：

- 通过官方场景预置双据点
- 通过 `switch_active_planet` 在已拥有据点的星球间切换

本轮不做：

- 任意新星球自动落地建前哨
- 执行体真实跨星际移动
- 全宇宙任意多据点无前置接管

## 5. 详细设计

### 5.1 `orbital_collector`：采用“接入电网后运行”的方案

#### 5.1.1 选型

采用 T090 要求里的方案 A：

- 保持 `orbital_collector` 是吃电建筑
- 补齐电网连接点与验收测试
- 不新造“燃料型轨采器”分支规则

原因：

- 当前 settlement 已经基于 `running` 状态产出。
- 当前 power grid 体系已经成熟，补连接点即可闭环。
- 文档里已有“补风机、电塔”验证路径，改成非电网方案反而会制造更多分歧。

#### 5.1.2 运行时定义

`server/internal/model/building_runtime.go`

- 为 `orbital_collector` 增加 `ConnectionPoints`：
  - `power`
  - `Kind = power`
  - `Capacity = 1`
- 保留 `EnergyConsume = 4`
- 保留 `OrbitalModule.Outputs = hydrogen/deuterium`

#### 5.1.3 结算语义

不改 `settleOrbitalCollectors()` 的核心思路，只修前置条件：

- 建筑在气态行星上
- 拥有供电覆盖
- `Runtime.State == running`
- 持有物流站库存

额外要求：

- `inspect` 返回里必须能看到 `state_reason` 从 `power_out_of_range` 变成空值或运行态原因
- 至少一类库存字段要持续增长：
  - `building.logistics_station.inventory`
  - 或 `building.storage`

#### 5.1.4 验证

新增端到端验证：

1. midgame 场景在 `planet-1-2` 建 `orbital_collector`
2. 补足供电后等待若干 tick
3. `inspect planet-1-2 building <id>` 观察 `running`
4. 库存中 `hydrogen` / `deuterium` 持续增加

### 5.2 建筑覆盖：只提升 4 个，明确降级 4 个

#### 5.2.1 本轮应提升为主线可玩的建筑

| 建筑 | 对应科技 | `buildable` 目标 | 必需模块 | 公开入口 |
| --- | --- | --- | --- | --- |
| `advanced_mining_machine` | `photon_mining` | `true` | `collect + storage + energy` | `build` |
| `pile_sorter` | `integrated_logistics` | `true` | `sorter` | `build` |
| `recomposing_assembler` | `annihilation` | `true` | `production + storage + energy` | `build` |
| `energy_exchanger` | `interstellar_power` | `true` | `energy_exchanger + energy_storage` | `build` |

设计要点：

- `advanced_mining_machine`
  - 直接作为 `mining_machine` 的高阶版本实现，不另造新采集规则。
  - 仍要求压在资源点上。
  - 通过更高 `YieldPerTick`、更高缓冲、更高耗电体现升级。
- `pile_sorter`
  - 当前已有 `SorterModule`，直接补建造成本、科技解锁和 catalog。
  - 不新增专用命令，继续走现有 sorter/传送带输入输出逻辑。
- `recomposing_assembler`
  - 作为高阶组装建筑接入现有 `ProductionModule`。
  - 先只承载当前已存在的 `antimatter_fuel_rod` 等高阶配方，不额外扩一批新配方。
  - 同步修正配方 tech id，把 `controlled_annihilation` 统一到真实 tech `annihilation`。
- `energy_exchanger`
  - 不照搬原版充放电站的全部物品交换系统。
  - 本轮落成“简化可玩版”：它是电网里的储能中枢，能开启当前 `NetworkHasEnergyHub()` 所依赖的均衡策略，并拥有自身少量储能。
  - 为降低耦合，应新增显式 `EnergyExchangerModule`，替换现在按 building type 硬编码识别 energy hub 的做法。

#### 5.2.2 本轮必须降级为“未实现”的建筑

| 建筑 | 原因 | T090 处理 |
| --- | --- | --- |
| `jammer_tower` | 没有干扰/减速结算链 | 从玩法指南与覆盖文档中移出 |
| `sr_plasma_turret` | 没有炮塔 runtime 与攻击结算 | 从玩法指南与覆盖文档中移出 |
| `planetary_shield_generator` | 没有护盾世界态与结算 | 从玩法指南与覆盖文档中移出 |
| `self_evolution_lab` | 隐藏科技存在，但 dark fog 物料与实验室运行时都未完成 | 从玩法指南与覆盖文档中移出 |

这四个建筑本轮不应继续出现在“主线可玩”“已覆盖建筑”列表中。

### 5.3 研究系统：改成矩阵实物驱动

#### 5.3.1 先做一次主数据统一

推荐直接重构以下主数据：

- `server/internal/model/item.go`
  - 删除颜色命名矩阵常量
  - 改成 canonical 矩阵常量
- `server/internal/model/recipe.go`
  - 矩阵配方的 `ID`、`Outputs[].ItemID`、`TechUnlock` 与新矩阵 ID 对齐
- `server/internal/model/tech.go`
  - 科技成本沿用当前 canonical matrix id，不再需要额外转换

矩阵体系统一为：

| 物品 ID | 说明 |
| --- | --- |
| `electromagnetic_matrix` | 蓝矩阵 |
| `energy_matrix` | 红矩阵 |
| `structure_matrix` | 黄矩阵 |
| `information_matrix` | 紫矩阵 |
| `gravity_matrix` | 绿矩阵 |
| `universe_matrix` | 白矩阵 |

#### 5.3.2 补齐缺失的两级矩阵

为了让“实物科研”不在 10 级以后再次断裂，本轮应补上：

- `information_matrix`
- `gravity_matrix`

配方不要求 1:1 复刻原版，但必须满足两点：

1. 只依赖当前项目已存在或本轮同时补齐的物品链。
2. 能把现有后期科技成本真正落到实物消费上。

建议做法：

- `information_matrix`：依赖 `processor`、`quantum_chip`、现有中后期材料
- `gravity_matrix`：依赖 `quantum_chip`、`strange_matter`
- `universe_matrix`：改成显式消耗前五色矩阵与 `antimatter`

这样可以让科技树的后半段重新自洽，而不是只让默认开局前几级变成“半实物科研”。

#### 5.3.3 `matrix_lab` 的科研模式

本轮不新增复杂 UI 配方切换系统，而是采用最直接、最稳定的规则：

- `matrix_lab` 若设置了生产配方，则按生产建筑结算，不参与科研。
- `matrix_lab` 若没有 `RecipeID`，则视为研究实验室。
- 研究只会从“运行中的研究实验室”的本地库存中消耗矩阵。

这个方案的好处：

- 不需要新增“实验室模式切换”命令。
- 玩家已经可以通过 `build`、物流、`transfer`、现有 IO 规则往实验室喂矩阵。
- `inspect` 就能直接看到实验室库存与当前科研状态。

#### 5.3.4 研究推进规则

`server/internal/gamecore/research.go` 需要从“点数推进”改为“实物消费推进”：

- `start_research`
  - 仍做前置科技校验
  - 新增物料来源校验：
    - 至少存在 1 个运行中的研究实验室
    - 所需矩阵类型在研究实验室总库存中至少各出现一次
- `settleResearch`
  - 统计所有运行中的研究实验室总 `ResearchPerTick`
  - 按剩余需求消耗矩阵实物
  - 只以“实际消耗的矩阵数量”推进进度
  - 矩阵不足时不完成研究，而是停在 `waiting_matrix` 或等价状态

建议在 `PlayerResearch` 中新增：

- `RequiredCost []ItemAmount`
- `ConsumedCost map[string]int`
- `BlockedReason string`

这样 API 与 CLI 可以直接展示“还差什么矩阵”，不必再靠玩家猜。

#### 5.3.5 API 暴露

以下查询要同步增强：

- `/state/summary`
- `/state/stats`
- `inspect ... building <matrix_lab_id>`

建议补充字段：

- `required_cost`
- `consumed_cost`
- `remaining_cost`
- `blocked_reason`

如果 CLI 端展示不够直观，可以额外新增只读查询命令 `research_status`，但这不是必须项。

### 5.4 多星球经营：采用“多行星运行态注册表 + active planet 切换”

#### 5.4.1 为什么不能只加一个切换命令

当前系统只有单个 `WorldState`，所以只增加 `switch_active_planet` 命令还不够：

- 切过去以后没有第二颗星球的本地建筑/库存/物流运行态。
- 存档也只会保存当前这一颗星球。
- 星际站和轨采器无法跨星球稳定结算。

因此 T090 的最小正确方案必须先让多颗星球各自拥有运行态。

#### 5.4.2 运行态结构

推荐在 `GameCore` 中引入多行星注册表：

```go
type PlanetRuntimeRegistry struct {
    ActivePlanetID string
    Worlds map[string]*model.WorldState
}
```

落地规则：

- 每个已加载的星球拥有独立 `WorldState`
- `gc.world` 只作为 `Worlds[ActivePlanetID]` 的快捷引用
- 玩家、科技、统计、戴森结构属于全局态，不应再按星球复制

为了避免一次性重构过大，T090 可以采用“共享全局玩家指针 + 各星球局部世界”的过渡实现，但保存结构必须已经按多星球设计落盘，不能继续只存单星球。

#### 5.4.3 切换命令

新增命令：

- 服务端命令：`switch_active_planet`
- CLI 命令：`switch_active_planet <planet_id>`

规则：

- 玩家必须已发现该星球
- 玩家必须在该星球拥有落脚点

本轮“落脚点”定义为：

- 该星球上存在当前玩家拥有的 `battlefield_analysis_base`
- 或存在带执行体的官方场景前哨

本轮不实现“无据点空降建站”。

#### 5.4.4 midgame 场景的双据点

为了让 T090 的多星球验收可执行，官方 midgame 场景必须扩成“双据点”：

- `planet-1-2`：气态行星轨采前哨
- `planet-1-1`：主工厂星

推荐新增场景配置能力：

```yaml
players:
  - player_id: p1
    bootstrap_planets:
      - planet_id: planet-1-2
        base_position: {x: 2, y: 2}
        with_executor: true
      - planet_id: planet-1-1
        base_position: {x: 6, y: 6}
        with_executor: true
```

这样多星球切换在官方场景中可以稳定复现，而不必先补完整殖民系统。

#### 5.4.5 星际物流的跨星球重构

当前 `settleInterstellarDispatch()` 把所有星际站都假设在同一个 `WorldState` 内，并用地面曼哈顿距离计算路程，这不符合多星球经营需求。

T090 需要把星际物流改成“跨 planet runtime 选择目标”：

- 站点注册项增加 `planet_id`
- 船状态增加 `origin_planet_id`、`target_planet_id`
- 派发器从 `PlanetRuntimeRegistry.Worlds` 汇总全部星际站供需
- 路由距离规则：
  - 同星球：沿用当前地面曼哈顿距离
  - 同恒星系不同星球：使用轨道距离近似
  - 不同恒星系：使用系统距离矩阵 + 轨道补偿

T090 的验收只需要同恒星系 rocky/gas giant 运输闭环，但距离模型应一次设计成支持跨 system，而不是再塞一层特判。

#### 5.4.6 存档结构

当前 `snapshot.WorldSnapshot` 只持久化一颗星球，必须升级。

推荐改成：

```go
type RuntimeSnapshot struct {
    Tick int64
    ActivePlanetID string
    Players map[string]*model.PlayerState
    PlanetWorlds map[string]*snapshot.WorldSnapshot
    Discovery *mapstate.DiscoverySnapshot
}
```

保存与恢复都基于这个新结构，不再让 `save.json` 与真实运行态脱节。

### 5.5 `ray_receiver`：增加公开模式控制入口

#### 5.5.1 命令形态

采用专用命令，不做泛化 building mode 系统：

- 服务端命令：`set_ray_receiver_mode`
- CLI 命令：`set_ray_receiver_mode <building_id> <power|photon|hybrid>`

原因：

- 当前只有 `ray_receiver` 真实需要此入口
- 用专用命令最直接，避免为未来假想模式系统过度设计

#### 5.5.2 校验规则

- 建筑存在且归属当前玩家
- 建筑类型必须是 `ray_receiver`
- `mode` 必须属于 `power|photon|hybrid`
- `photon` 模式应要求科技 `dirac_inversion` 已完成，或至少拥有 `photon_mode` special unlock

默认值：

- 新建 `ray_receiver` 默认 `hybrid`

#### 5.5.3 查询与文档

- `inspect` 返回必须能看到当前 `mode`
- CLI help、服务端 API 文档、玩家指南都要写清：
  - `power`：只发电
  - `photon`：只产 `critical_photon`
  - `hybrid`：先发电，再用剩余输入产光子

### 5.6 `client-cli`：命令输入串行化

#### 5.6.1 修复策略

`client-cli/src/repl.ts` 不能再直接在 `line` 事件里并发 `dispatch()`。

推荐改成显式串行队列：

```ts
let pending = Promise.resolve();
rl.on('line', (line) => {
  pending = pending.then(() => handleLine(line)).catch(reportError);
});
```

或者提取成 `enqueueLine()`/`flushLine()` 形式，只要满足“同一 REPL 输入按顺序执行”即可。

#### 5.6.2 输出一致性

串行后必须保证：

- 输入顺序
- `ACCEPTED request_id`
- SSE `command_result.request_id`

三者一一对应。

本轮不需要在 CLI 里再做二次重排，只要请求发送顺序恢复串行，服务端回包顺序就会自然稳定。

## 6. 涉及文件范围

### 6.1 服务端

- `server/internal/model/item.go`
- `server/internal/model/recipe.go`
- `server/internal/model/tech.go`
- `server/internal/model/building_defs.go`
- `server/internal/model/building_runtime.go`
- `server/internal/model/ray_receiver.go`
- `server/internal/model/command.go`
- `server/internal/model/energy_storage.go`
- `server/internal/gamecore/research.go`
- `server/internal/gamecore/orbital_collector_settlement.go`
- `server/internal/gamecore/core.go`
- `server/internal/gamecore/rules.go`
- `server/internal/gamecore/logistics_interstellar_dispatch.go`
- `server/internal/gamecore/logistics_ship_settlement.go`
- `server/internal/query/runtime.go`
- `server/internal/query/networks.go`
- `server/internal/snapshot/*`
- `server/internal/gamedir/files.go`
- `server/config-midgame.yaml`
- `server/map-midgame.yaml`

### 6.2 CLI / shared client

- `client-cli/src/repl.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/index.ts`
- `client-cli/src/command-catalog.ts`
- `shared-client/src/api.ts`
- `shared-client/src/types.ts`

### 6.3 文档

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`

## 7. 测试设计

### 7.1 服务端单元/集成测试

- `orbital_collector`
  - 气态行星有供电时进入 `running`
  - `hydrogen/deuterium` 库存持续增长
- `research`
  - 零矩阵时 `start_research` 失败
  - 研究实验室库存满足时可启动
  - 研究推进真实扣减矩阵
  - 矩阵不足时研究停在 `waiting_matrix`
- 建筑提升
  - 4 个提升建筑能 build、能运行、能被 `/catalog` 与科技解锁看到
- 多星球
  - `switch_active_planet` 成功切换
  - 双星球 world save/load 一致
  - gas giant -> rocky interstellar 最小闭环成立
- `ray_receiver`
  - 三种模式切换成功
  - `photon` 模式受科技门槛约束

### 7.2 CLI 测试

- 连续粘贴 3 条命令时按输入顺序调用 API
- `set_ray_receiver_mode` help 与参数解析正确
- 若新增 `switch_active_planet`，CLI 命令帮助与参数解析正确

### 7.3 手动回归

#### 默认开局

- 无矩阵、无研究实验室时不能直接完成 `electromagnetism`
- 补矩阵实验室与矩阵库存后，研究才能推进

#### midgame 场景

1. 在 `planet-1-2` 建 `orbital_collector`
2. 确认产出 `hydrogen/deuterium`
3. 切到 `planet-1-1`
4. 配置气态行星供给、主工厂星需求
5. 验证主工厂星库存增加
6. 建 `ray_receiver` 并切换 `power/photon/hybrid`

## 8. 文档同步要求

### 8.1 玩法指南

必须删除当前这类已经不真实的描述：

- “active planet 基本还是主经营舞台”
- “研究已经可玩，但还不是矩阵实物消耗版”
- “这 8 个建筑有定义，但不算主线可玩”

更新成：

- 哪 4 个建筑已并入主线
- 哪 4 个明确未实现
- 多星球路线如何切换和验证
- `ray_receiver` 如何切模式
- 科研如何依赖矩阵实验室库存

### 8.2 服务端 API 与 CLI 文档

需要新增或更新：

- `switch_active_planet`
- `set_ray_receiver_mode`
- 研究状态新增字段
- 多星球查询可用性变化
- CLI 串行语义说明

### 8.3 官方验证文档

`docs/player/上手与验证.md` 的 midgame 路线必须升级成真正的双星球路线，而不是只在气态行星上做局部验证。

## 9. 最终建议

T090 不应被实现成“再补几个命令和几个 `buildable=true`”。真正需要收口的是三件事：

1. 科技树要和矩阵实物统一成一套真数据。
2. 建筑覆盖要从“定义存在”升级到“运行时可验证”，做不到的就降级文档。
3. 多星球至少要拥有可持久、可切换、可运输的最小运行态，而不是继续依赖单 `WorldState` 假装有星际物流。

按本文方案落地后，T090 的 6 个问题都能进入“玩家可见且可回归”的状态，同时不会把战斗后期/黑雾这些尚未成型的系统硬塞成假完成项。
