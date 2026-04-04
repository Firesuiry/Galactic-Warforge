# T090 戴森球计划剩余建筑、科技树与玩法闭环收口 - 最终实现方案

## 1. 文档目标

本文用于收敛 `docs/process/task/T090_戴森球计划剩余建筑科技树与玩法闭环.md` 的最终实现口径，给后续实现提供唯一基线。

说明：

- 当前工作区不存在 `docs/process/design_claude.md` 实体文件。
- 因此本文以现有 `docs/process/design_codex.md` 为主，结合 T090 任务文档，以及归档里 Claude 方案一贯强调的三条原则综合得出最终方案：
  - 必须通过公开命令完成玩法闭环；
  - 必须在官方场景中可复现验收；
  - 必须同步测试与玩家文档，不能只改底层定义。

本文的目标不是“再写一版可选设计”，而是把 T090 定成可直接实施的最终取舍。

## 2. 最终取舍

T090 采用“分层收口、最小真实闭环”的方案，拒绝以下两种做法：

1. 只修表层问题。
   - 例如只补几个命令、几个 `buildable=true`、几个文档说明。
   - 结果会继续保留“定义存在但玩法不成立”的假完成态。
2. 一次性做完整宇宙级重构。
   - 例如把多星球、防御体系、黑雾建筑、完整殖民系统一起重写。
   - 这会让范围失控，无法在 T090 内稳定验收。

最终采用如下收口方式：

1. 统一矩阵物品、科技成本和科研推进，改成真实矩阵实物驱动。
2. 只把已有底层支撑、能够形成玩法闭环的 4 个建筑并入主线。
3. 对无法在本轮做成可玩闭环的 4 个建筑明确降级为未实现。
4. 为多星球经营补齐“多行星运行态注册表 + active planet 切换 + 双据点 midgame 场景 + 跨星球星际物流”。
5. 为 `ray_receiver` 增加专用模式命令。
6. 修复 `client-cli` 的批量输入串行语义。

## 3. 总体原则

### 3.1 唯一真 ID

矩阵、科技成本、配方输出、查询字段必须使用同一套 canonical ID：

- `electromagnetic_matrix`
- `energy_matrix`
- `structure_matrix`
- `information_matrix`
- `gravity_matrix`
- `universe_matrix`

不保留 `matrix_blue` 这类旧别名作为主数据。遵守仓库“激进式演进”原则，直接改正定义与调用点，不新增兼容包装层。

### 3.2 完成标准必须是玩法标准

一个建筑只有同时满足以下 4 条，才算“已覆盖”：

1. `/catalog` 中 `buildable=true`
2. 有明确科技解锁入口
3. 有真实 runtime 模块与结算效果
4. 玩家可通过公开 API / CLI / Web 至少一种入口验证效果

缺任何一条，都必须从“已实现覆盖”文档中移出。

### 3.3 公开命令优先

T090 的所有新增能力必须能通过公开命令或公开查询验证，不允许依赖：

- 手改存档
- 手填数据库
- 隐藏调试开关
- 仅开发者可见的内部 helper

### 3.4 官方场景可复现

默认局和 midgame 局都必须成为官方验收入口：

- 默认局负责验证“无矩阵不可凭空科研”
- midgame 局负责验证“气态行星采集、多星球切换、星际物流、射线接收模式”

## 4. 范围边界

### 4.1 本轮必须完成

- `orbital_collector` 真正进入 `running`
- 研究系统改成矩阵实物驱动
- `advanced_mining_machine`、`pile_sorter`、`recomposing_assembler`、`energy_exchanger` 并入主线
- `ray_receiver` 模式切换入口
- 多星球运行态、查询、切换、保存与同星系跨星球物流最小闭环
- `client-cli` 输入串行化
- 文档、测试、官方验证路线同步

### 4.2 本轮明确不做

- 任意新星球自由殖民与自动建前哨
- 通用 building mode 框架
- 防御后期建筑与黑雾建筑的完整玩法实现
- 完整跨恒星系舰队移动模拟

这些内容若底层未成型，一律标注为未实现，不再维持“半真半假”的展示状态。

## 5. 最终设计

### 5.1 `orbital_collector`：采用接入电网后运行

最终选择 T090 要求中的方案 A，不改成特殊燃料或独立规则建筑。

原因：

- 当前结算逻辑已经以 `building.Runtime.State == running` 为前提；
- 当前电网系统已存在，只缺接入点；
- 文档和 midgame 路线已经围绕“供电后运行”组织，沿用这一模型改动最小且最真实。

具体设计：

- 在 `server/internal/model/building_runtime.go` 为 `orbital_collector` 增加 `power` 类 `connection_points`
- 保留 `EnergyConsume=4`
- 保留 `OrbitalModule` 的 `hydrogen` / `deuterium` 输出
- 不修改 `settleOrbitalCollectors()` 的主体逻辑，只修正其前置运行条件

验收要求：

1. midgame 局在 `planet-1-2` 建造 `orbital_collector`
2. 供电后状态从 `no_power` 进入 `running`
3. `inspect` 能看到 `state_reason` 清空或转为运行态原因
4. 建筑库存或物流站库存中 `hydrogen` / `deuterium` 持续增长

### 5.2 建筑覆盖：4 个并入主线，4 个正式降级

#### 5.2.1 本轮并入主线的 4 个建筑

| 建筑 | 对应科技 | 最终语义 | 必需模块 | 玩家入口 |
| --- | --- | --- | --- | --- |
| `advanced_mining_machine` | `photon_mining` | 高阶采矿机，仍要求压资源点 | `collect + storage + energy` | `build` |
| `pile_sorter` | `integrated_logistics` | 更高吞吐/更远距离的分拣器 | `sorter` | `build` |
| `recomposing_assembler` | `annihilation` | 高阶组装建筑，承载后期配方 | `production + storage + energy` | `build` |
| `energy_exchanger` | `interstellar_power` | 简化版电网储能中枢/energy hub | `energy_exchanger + energy_storage` | `build` |

设计要求：

- `advanced_mining_machine`
  - 直接作为 `mining_machine` 的高阶版本实现
  - 不新增独立采矿体系
  - 通过更高 `YieldPerTick`、更高耗电、更大缓存体现升级
- `pile_sorter`
  - 直接复用已有 `SorterModule`
  - 只补可建造性、科技解锁、成本和 catalog 暴露
- `recomposing_assembler`
  - 接入现有 `ProductionModule`
  - 承载当前已有高阶配方
  - 同步把 `controlled_annihilation` 错误 tech id 改为真实 `annihilation`
- `energy_exchanger`
  - 本轮不照搬原版完整充放电物品交换系统
  - 只落成“可玩的电网储能枢纽”
  - 新增显式 `EnergyExchangerModule`，替代靠建筑类型硬编码判断 energy hub 的做法

#### 5.2.2 本轮降级为未实现的 4 个建筑

| 建筑 | 原因 | T090 处理 |
| --- | --- | --- |
| `jammer_tower` | 没有干扰/减速结算链 | 从玩家文档与覆盖文档移出 |
| `sr_plasma_turret` | 没有完整炮塔 runtime 与攻击结算 | 从玩家文档与覆盖文档移出 |
| `planetary_shield_generator` | 没有世界级护盾状态与伤害结算 | 从玩家文档与覆盖文档移出 |
| `self_evolution_lab` | 黑雾物料、实验室运行时、玩法闭环均未成型 | 从玩家文档与覆盖文档移出 |

最终原则：

- 不再把这 4 个建筑列入“主线已覆盖”
- 不为了 catalog 完整性维持 `buildable=false 但默认算实现` 的旧说法
- 若后续要做，必须走新的独立任务和独立设计

### 5.3 研究系统：改成矩阵实物驱动

#### 5.3.1 主数据统一

直接统一以下内容：

- `server/internal/model/item.go`
- `server/internal/model/recipe.go`
- `server/internal/model/tech.go`

统一要求：

- 删除 `matrix_blue` 这类颜色别名型主数据
- 配方输出、科技成本、查询返回全部使用 canonical matrix id
- 旧 fixture、示例配置、测试断言同步改新 ID

这一步不做兼容别名层。旧 save、旧 fixture 若仍引用旧矩阵 ID，统一按仓库“激进式演进”原则直接更新。

#### 5.3.2 补齐矩阵配方

为保证科技树后半段真正可研究，本轮至少补齐：

- `information_matrix`
- `gravity_matrix`

并修正：

- `universe_matrix` 显式消耗前五色矩阵与 `antimatter`

约束：

1. 配方只依赖当前项目已存在或本轮同时补齐的物品链
2. 配方必须能支撑现有科技树的真实物料消费

#### 5.3.3 `matrix_lab` 的科研模式

采用最直接规则：

- `matrix_lab` 设置了 `RecipeID` 时，按普通生产建筑运行
- `matrix_lab` 没有 `RecipeID` 时，视为研究实验室
- 科研只会消耗“运行中的研究实验室”本地库存中的矩阵

不新增额外的模式切换命令。这样玩家仍然只通过现有 `build`、物流、`transfer`、`inspect` 就能完成科研闭环。

#### 5.3.4 研究推进规则

`server/internal/gamecore/research.go` 从“点数推进”改为“实物消费推进”：

- `start_research`
  - 继续校验前置科技
  - 新增校验：
    - 至少存在 1 个运行中的研究实验室
    - 所需矩阵类型在研究实验室总库存中至少各出现一次
- `settleResearch`
  - 汇总所有运行中的研究实验室 `ResearchPerTick`
  - 按剩余需求消耗矩阵实物
  - 只以“实际消耗的矩阵数量”推进进度
  - 矩阵不足时停在阻塞态，而不是继续凭空推进

建议扩展 `model.PlayerResearch`：

- `RequiredCost []ItemAmount`
- `ConsumedCost map[string]int`
- `BlockedReason string`

这样查询层可以直接暴露“还差什么矩阵”，不需要玩家自己推断。

#### 5.3.5 查询与文档暴露

以下查询需要同步增强：

- `/state/summary`
- `/state/stats`
- `inspect ... building <matrix_lab_id>`

推荐新增或补充字段：

- `required_cost`
- `consumed_cost`
- `remaining_cost`
- `blocked_reason`

如果现有摘要视图不够直观，可新增只读查询 `research_status`，但这不是必需项。

### 5.4 多星球经营：采用多行星运行态注册表

#### 5.4.1 为什么不能只加一个切换命令

当前 `query/runtime.go` 和 `query/networks.go` 都直接把“非 active planet”视为不可用。当前 snapshot/save 结构也只持久化单个 `WorldState`。因此只补 `switch_active_planet` 不能解决真实问题：

- 非 active planet 没有独立运行态
- 存档恢复后会丢失另一颗星球的建筑与物流状态
- 星际物流无法稳定跨星球派发与结算

#### 5.4.2 运行态结构

在 `GameCore` 中引入多行星运行态注册表：

```go
type PlanetRuntimeRegistry struct {
    ActivePlanetID string
    Worlds map[string]*model.WorldState
}
```

最终语义：

- 每颗已加载星球拥有独立 `WorldState`
- `active planet` 只是默认操作上下文，不再决定“其他星球是否存在运行态”
- 玩家、科技、戴森结构、发现状态属于全局态
- 各星球共享全局玩家指针，但局部建筑、物流、施工、资源节点属于本地 world

#### 5.4.3 保存结构

当前 `snapshot.Snapshot` 和 `save.json` 都围绕单个 `WorldSnapshot` 组织，必须升级成多星球版本。

推荐结构：

```go
type RuntimeSnapshot struct {
    Tick int64
    ActivePlanetID string
    Players map[string]*model.PlayerState
    PlanetWorlds map[string]*snapshot.WorldSnapshot
    Discovery *mapstate.DiscoverySnapshot
}
```

要求：

- 保存和恢复都基于 `PlanetWorlds`
- 不再让 `save.json` 只记录当前 active world
- 存档格式版本同步提升

#### 5.4.4 查询层调整

以下查询改为按指定星球读取注册表中的 world，而不是仅允许 `ws.PlanetID == planetID`：

- `server/internal/query/runtime.go`
- `server/internal/query/networks.go`
- `server/internal/query/query.go`

最终效果：

- 非 active planet 只要已发现并已加载运行态，就能返回真实 runtime / networks 视图
- `active_planet_id` 仍继续对外返回，作为默认上下文提示

#### 5.4.5 切换命令

新增公开命令：

- 服务端：`switch_active_planet`
- CLI：`switch_active_planet <planet_id>`

规则：

- 玩家必须已发现目标星球
- 玩家必须在目标星球已有落脚点

本轮“落脚点”定义为：

- 目标星球存在该玩家拥有的 `battlefield_analysis_base`
- 或官方场景预置的执行体前哨

本轮不支持无据点空降建站。

#### 5.4.6 midgame 双据点场景

为了让 T090 验收可复现，midgame 场景升级成双据点：

- `planet-1-1`：主工厂星
- `planet-1-2`：气态行星轨采前哨

场景配置应支持同一玩家同时在多颗星球预置据点与执行体，确保测试不依赖临时造前哨。

#### 5.4.7 星际物流跨星球化

`settleInterstellarDispatch()` 与相关物流状态需要按多星球重构：

- 星际站注册项增加 `planet_id`
- 船状态增加 `origin_planet_id`、`target_planet_id`
- 派发器从 `PlanetRuntimeRegistry.Worlds` 汇总全部星际站供需

距离规则：

- 同星球：继续沿用当前地面距离近似
- 同恒星系不同星球：使用轨道距离近似
- 不同恒星系：使用系统距离矩阵 + 轨道补偿

T090 的验收只要求同恒星系 rocky / gas giant 闭环，但距离模型设计一次到位，不再引入额外特判层。

### 5.5 `ray_receiver`：增加专用模式命令

采用专用命令，不做通用 building mode 系统。

新增：

- 服务端命令：`set_ray_receiver_mode`
- CLI 命令：`set_ray_receiver_mode <building_id> <power|photon|hybrid>`

规则：

- 建筑存在且归属当前玩家
- 建筑类型必须是 `ray_receiver`
- `mode` 只能是 `power`、`photon`、`hybrid`
- `photon` 模式要求相关科技已完成，建议直接绑定 `dirac_inversion`
- 默认模式保持 `hybrid`

查询与文档要求：

- `inspect` 返回中必须能看到当前 `mode`
- 玩家文档、CLI 文档、服务端 API 文档必须明确写清：
  - `power`：只发电
  - `photon`：只产 `critical_photon`
  - `hybrid`：先发电，再用剩余输入产光子

### 5.6 `client-cli`：输入串行化

`client-cli/src/repl.ts` 不能继续在 `line` 事件里直接并发 `dispatch()`。

最终要求：

- 同一 REPL 中的输入按严格顺序串行执行
- 连续粘贴多条命令时：
  - 输入顺序
  - `ACCEPTED request_id`
  - `command_result.request_id`
  三者一一对应

推荐实现方式：

```ts
let pending = Promise.resolve();
rl.on('line', (line) => {
  pending = pending.then(() => handleLine(line)).catch(reportError);
});
```

本轮不需要在 CLI 端再做事件重排。只要发送顺序恢复串行，服务端结果顺序就能稳定。

## 6. 实施顺序

T090 按以下顺序实施，避免交叉返工。

### 阶段 1：清洗主数据与科研闭环

先做：

- 矩阵 ID 统一
- 缺失矩阵配方补齐
- `matrix_lab` 研究模式
- `PlayerResearch` 扩展
- `research.go` 改实物推进

原因：

- 科研是多项建筑和科技解锁的前提
- 不先统一主数据，后续建筑和文档都会继续引用错误 ID

### 阶段 2：建筑覆盖收口

依次完成：

- `orbital_collector` 供电运行
- `advanced_mining_machine`
- `pile_sorter`
- `recomposing_assembler`
- `energy_exchanger`
- 文档中降级 4 个未实现建筑

### 阶段 3：多星球运行态与星际物流

依次完成：

- `PlanetRuntimeRegistry`
- query 层按 planet 取 world
- `switch_active_planet`
- snapshot/save 升级
- midgame 双据点
- 跨星球星际物流派发与结算

### 阶段 4：玩家入口与 CLI 语义

完成：

- `set_ray_receiver_mode`
- `client-cli` 串行队列
- CLI 帮助与参数解析

### 阶段 5：文档与验收回归

最后统一完成：

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- 默认局与 midgame 局手动回归
- 自动化测试补齐

## 7. 涉及文件范围

### 7.1 服务端

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
- `server/internal/query/query.go`
- `server/internal/snapshot/*`
- `server/internal/gamedir/files.go`
- `server/config-midgame.yaml`
- `server/map-midgame.yaml`

### 7.2 CLI / shared client

- `client-cli/src/repl.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/index.ts`
- `client-cli/src/command-catalog.ts`
- `shared-client/src/api.ts`
- `shared-client/src/types.ts`

### 7.3 文档

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`

## 8. 测试与验收

### 8.1 服务端自动化测试

- `orbital_collector`
  - 气态行星供电后进入 `running`
  - `hydrogen` / `deuterium` 库存持续增长
- `research`
  - 零矩阵时 `start_research electromagnetism` 失败
  - 有研究实验室和矩阵库存时可启动
  - 推进过程真实扣减矩阵
  - 矩阵不足时进入 `blocked_reason=waiting_matrix` 或等价状态
- 建筑覆盖
  - 4 个提升建筑可解锁、可建造、可运行
  - 4 个降级建筑不再出现在“主线可玩”文档断言里
- 多星球
  - `switch_active_planet` 可切换
  - `runtime` / `networks` 可读取非 active planet 真实视图
  - 双星球存档保存与恢复一致
  - gas giant -> rocky 星球最小跨星球物流闭环成立
- `ray_receiver`
  - 三种模式切换成功
  - `photon` 模式受科技门槛约束

### 8.2 CLI 自动化测试

- 连续粘贴多条命令时按输入顺序调用 API
- `set_ray_receiver_mode` 的 help 与参数解析正确
- `switch_active_planet` 的 help 与参数解析正确

### 8.3 手动回归

默认局：

1. 登录新局
2. 不建设矩阵产线，不注入矩阵库存
3. 执行 `start_research electromagnetism`
4. 预期不能凭空完成研究
5. 补矩阵实验室与矩阵供给后，研究才推进

midgame 局：

1. 在 `planet-1-2` 建 `orbital_collector`
2. 供电并确认 `running`
3. 观察 `hydrogen` / `deuterium` 增长
4. 切到 `planet-1-1`
5. 配置气态行星供给和主工厂星需求
6. 验证主工厂星库存增长
7. 建 `ray_receiver` 并切换 `power` / `photon` / `hybrid`

## 9. 文档同步要求

### 9.1 玩家玩法指南

必须同步改写为真实口径：

- 哪 4 个建筑已经并入主线
- 哪 4 个建筑明确未实现
- 科研如何依赖矩阵实验室库存
- 多星球如何切换与经营
- `ray_receiver` 如何切模式

### 9.2 服务端 API 与 CLI 文档

必须新增或更新：

- `switch_active_planet`
- `set_ray_receiver_mode`
- 研究状态新增字段
- 多星球查询语义
- CLI 串行输入语义

### 9.3 官方验证路线

`docs/player/上手与验证.md` 中的 midgame 路线必须升级成真正的双星球路线，而不是只在气态行星上做局部验证。

## 10. 最终结论

T090 的核心不是“再补几个命令”，而是把以下三件事一次收口：

1. 科技树与矩阵实物必须统一成一套真实数据和真实消耗规则。
2. 建筑覆盖必须从“定义存在”升级到“运行时可验证”，做不到的立即降级文档。
3. 多星球至少要拥有可保存、可切换、可查询、可物流的最小运行态，而不是继续依赖单 `WorldState` 假装存在星际经营。

按本文方案落地后，T090 的 6 个问题都能进入“玩家可见、可回归、可文档化”的状态，同时不会把防御后期和黑雾体系硬塞成假完成项。
