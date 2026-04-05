# T103 设计方案：戴森科技树不可达建筑与空科技节点

> 对应任务：`docs/process/finished_task/T103_戴森科技树不可达建筑与空科技节点.md`

## 1. 目标

本方案的目标不是“把 catalog 表面改顺眼”，而是把玩家公开能力、`/catalog`、研究树、CLI 帮助和 authoritative 规则收口到同一套真相。

本次要解决三件事：

1. `automatic_piler` 与 `satellite_substation` 不能继续处于“`buildable=true` 但没有真实科技路径”的状态。
2. `/catalog.techs[]` 不能继续把“研究后没有直接收益、也不会把玩家引向后续真实科技”的死胡同节点暴露给玩家。
3. 不能用“把所有空科技一刀切隐藏”这种方式误伤当前已经能玩的中后期分支。

## 2. 当前代码事实

### 2.1 真正没有科技解锁路径的玩家建筑，当前只有两个

基于当前 `server/internal/model/tech.go` 的归一化结果反查，`Buildable=true` 但没有任何 `TechUnlockBuilding` 对应科技入口的建筑只有：

- `automatic_piler`
- `satellite_substation`

也就是说，任务文档里指出的“不可达建筑”定位是准确的，这不是文档误报。

对应 authoritative 建造链路也很直接：

- `server/internal/gamecore/rules.go`
  - 先检查 `def.Buildable`
  - 再调用 `CanBuildTech(player, TechUnlockBuilding, buildingID)`
- `server/internal/gamecore/research.go`
  - `CanBuildTech(...)` 只认玩家已完成科技里真实存在的 `Unlocks`

因此，只要科技树里没有 building unlock，`build` 就一定会拒绝。

### 2.2 `/catalog.buildings[].unlock_tech` 现在基本不可用

`server/internal/query/catalog.go` 已经暴露了 `unlock_tech` 字段，但 `server/internal/model/building_catalog.go` 当前没有任何从科技树反向回填的逻辑。

结果是：

- `/catalog.buildings[].buildable` 直接镜像 `BuildingDefinition.Buildable`
- `/catalog.buildings[].unlock_tech` 基本一直为空

这会把两类问题混在一起：

- 真没有科技路径的建筑
- 实际有科技路径，但 catalog 元数据没有回填的建筑

这两类问题必须拆开处理，不能继续靠文档人工解释。

### 2.3 两个不可达建筑的成熟度其实不同

`satellite_substation` 当前已经有显式 runtime 定义：

- `server/internal/model/building_runtime.go`
  - 存在独立条目
  - 有明确 `ConnectionPower` 连接点

`automatic_piler` 当前只有建筑定义，没有专门 runtime 模块，也没有任何结算逻辑引用：

- `server/internal/model/building_defs.go`
  - 有 `Buildable=true`
- `server/internal/model/building_runtime.go`
  - 没有 `BuildingTypeAutomaticPiler` 的专门定义
- `server/internal/gamecore/*`
  - 没有任何 `automatic_piler` 专属结算或行为

这意味着：

- `satellite_substation` 是“功能基本在，只差科技入口”
- `automatic_piler` 不是“只差科技入口”，它现在更像“名字已经进入公开列表，但 runtime 玩法还没有闭合”

任务原文把两个建筑绑定成同一档处理并不精确。设计上应该按成熟度拆开，而不是为了表面一致继续说谎。

### 2.4 任务文档里的 19 个“空科技”，实际上分成两类

按当前 runtime 归一化后的 tech 数据看，这 19 个节点确实满足：

- `unlocks = []`
- `effects = []`
- `max_level = 0`
- `hidden = false`

但它们不是同一种问题。

#### 2.4.1 桥接科技：自己没有直接奖励，但能通往后续真实分支

这 8 个节点不该被当成死胡同：

| 科技 | 当前公开后继 |
| --- | --- |
| `engine` | `battlefield_analysis`、`missile_turret` |
| `steel_smelting` | `environment_modification`、`titanium_smelting` |
| `combustible_unit` | `missile_turret` |
| `crystal_smelting` | `energy_storage`、`plane_filter_smelting` |
| `polymer_chemical` | `high_strength_crystal` |
| `high_strength_glass` | `high_energy_laser` |
| `particle_control` | `information_matrix` |
| `thruster` | `planetary_logistics` |

这些科技当前的问题不是“应该隐藏”，而是 `/catalog.techs[]` 没有告诉玩家它们是桥接前置，所以它们在现有 API 里看起来像空节点。

#### 2.4.2 死胡同科技：既没有直接收益，也不会通向公开收益

这 11 个节点才应该从玩家公开科技树里移除：

- `casimir_crystal`
- `crystal_explosive`
- `crystal_shell`
- `proliferator_mk2`
- `proliferator_mk3`
- `reformed_refinement`
- `super_magnetic`
- `supersonic_missile`
- `titanium_ammo`
- `wave_interference`
- `xray_cracking`

注意 `xray_cracking` 之所以也归到死胡同，不是因为它自己没有后继，而是它唯一公开后继 `reformed_refinement` 仍然是空节点。这个分支需要整段一起收口。

### 2.5 结论：不能采用“统一隐藏所有空科技”的简单方案

如果只按“`unlocks/effects` 为空就隐藏”做，会直接误伤：

- `engine`
- `steel_smelting`
- `crystal_smelting`
- `particle_control`
- `thruster`

以及它们后面当前已经有真实玩法收益的公开分支。

这会把现有公开树再次切断，属于新的回归，不是修复。

## 3. 设计原则

### 3.1 authoritative 优先

公开能力必须从 runtime-backed 数据推导，不能靠：

- 文档手写白名单
- CLI 硬编码帮助文案
- catalog 静态字段自说自话

### 3.2 区分“可建造”和“应该公开给玩家”

对玩家来说，公开能力的标准不是“仓库里有个定义”，而是：

- 有真实科技入口
- 有真实 runtime 行为
- 文档和 CLI 能正确解释获取路径

### 3.3 科技树要表达“直接收益”或“后继价值”二者之一

一个科技节点对玩家可见，至少要满足下面之一：

1. 有真实 `unlock`
2. 有真实 `effect`
3. 虽然没有直接奖励，但有可见的 `leads_to`，且最终能通向公开真实收益

否则它就是公开死胡同，应该隐藏。

## 4. 总体方案

本方案采用“建筑按成熟度拆分 + 科技树按图收口”的方式，而不是把所有问题压成一个布尔开关。

### 4.1 建筑侧

- `satellite_substation`
  - 接回真实科技树
  - 归属 `satellite_power`
- `automatic_piler`
  - 当前版本先从公开可建能力中移除
  - 等 runtime 行为补齐后，再重新开放并挂到 `integrated_logistics`
- 所有 buildable 建筑
  - 都由科技树反向回填 `unlock_tech`

### 4.2 科技树侧

- 为 `/catalog.techs[]` 增加 `leads_to`
- 用“死胡同裁剪”替代“空节点一刀切隐藏”
- 桥接科技继续可见
- 真正死胡同节点改为 `hidden=true`

## 5. 建筑方案细节

### 5.1 `satellite_substation`：接回 `satellite_power`

这是本次应当直接开放的建筑。

#### 改动

- `server/internal/model/tech.go`
  - 在 `satellite_power.Unlocks` 中追加：
    - `{Type: TechUnlockBuilding, ID: string(BuildingTypeSatelliteSubstation)}`

#### 原因

- 科技名与建筑语义完全匹配
- 当前 runtime 已有电网连接定义
- 这是纯粹的“科技树断线”，不是功能未实现

#### 验收语义

- 默认新局玩家在未完成 `satellite_power` 前不能建造
- 完成 `satellite_power` 后可以通过 `build` 成功进入施工队列
- `/catalog.buildings` 中该建筑应回填：
  - `buildable = true`
  - `unlock_tech = ["satellite_power"]`

### 5.2 `automatic_piler`：当前版本先下架，不直接接回科技树

这里不推荐像 `design_claude.md` 那样直接把它塞进 `integrated_logistics`。

原因很简单：那样只能做到“研究后能摆”，做不到“研究后有真实玩法”。当前代码里没有 `automatic_piler` 的专门 runtime 行为，继续对外开放只会把“不可达假入口”换成“可建但空心的假入口”。

#### 本次收口

- `server/internal/model/building_defs.go`
  - 把 `automatic_piler.Buildable` 改为 `false`
- 同步从以下文档中移除“当前可建”口径：
  - `docs/player/玩法指南.md`
  - `docs/dev/客户端CLI.md`
  - `docs/dev/服务端API.md`

#### 未来重新开放的前提

`automatic_piler` 只有在下面两项都完成后才应重新开放：

1. 新增专门 runtime 模块
   - 推荐新增 `PilerModule`
   - 明确输入/输出方向、堆叠上限、吞吐规则
2. 新增 authoritative 结算
   - 基于现有 conveyor buffer / `MaxStack` 语义合并相邻同类物品
   - 保证不是纯展示建筑

#### 未来重开后的科技归属

等 runtime 补齐后，再把它挂到：

- `integrated_logistics`

这个科技归属是合理的，但不应在 runtime 还空着时提前开放。

## 6. 科技树方案细节

### 6.1 给 `/catalog.techs[]` 增加 `leads_to`

当前 tech catalog 只暴露：

- `prerequisites`
- `unlocks`
- `effects`

但没有暴露“这个科技会导向哪些后继科技”。这正是桥接科技被误判为空的根因。

建议在以下位置新增 `leads_to`：

- `server/internal/model/tech.go`
  - 给 `TechDefinition` 增加派生字段，或新增只读 helper
- `server/internal/query/catalog.go`
  - 给 `TechCatalogEntry` 增加 `LeadsTo []string`
- `docs/dev/服务端API.md`
  - 同步更新 `/catalog.techs[]` 字段说明

`leads_to` 的来源不需要手填，直接由 prerequisites 反向建图得到。

### 6.2 用“死胡同裁剪”替代“空字段裁剪”

推荐在 `normalizeTechDefinitions(...)` 之后增加第二阶段派生：

1. 先得到归一化后的 `Unlocks`
2. 基于 `Prerequisites` 构建反向依赖图
3. 迭代标记死胡同 tech

死胡同判定条件：

- `Hidden == false`
- `MaxLevel == 0`
- `len(Unlocks) == 0`
- `len(Effects) == 0`
- 所有公开后继都已经被标记为隐藏，或根本没有公开后继

这里必须做“迭代裁剪”，不能只看一层子节点。

例如：

- `reformed_refinement` 是死胡同
- `xray_cracking` 的唯一公开后继就是 `reformed_refinement`
- 所以 `xray_cracking` 也必须跟着隐藏

### 6.3 桥接科技保留可见，但必须带 `leads_to`

保留可见的桥接节点如下：

- `engine`
- `steel_smelting`
- `combustible_unit`
- `crystal_smelting`
- `polymer_chemical`
- `high_strength_glass`
- `particle_control`
- `thruster`

这些节点在裁剪完成后仍应满足：

- `hidden = false`
- `unlocks = []`
- `effects = []`
- `leads_to` 非空

这样玩家在科技树里能看懂：

- 这不是直接奖励科技
- 这是通往后继公开分支的桥接科技

### 6.4 真正死胡同节点隐藏名单

本次应直接转为 `hidden=true` 的节点：

- `casimir_crystal`
- `crystal_explosive`
- `crystal_shell`
- `proliferator_mk2`
- `proliferator_mk3`
- `reformed_refinement`
- `super_magnetic`
- `supersonic_missile`
- `titanium_ammo`
- `wave_interference`
- `xray_cracking`

这些节点隐藏后：

- `start_research` 会按现有逻辑拒绝直接研究
- `/catalog.techs[]` 不再把它们暴露给玩家
- 玩家文档也不应再把它们写成当前开放树的一部分

## 7. 实现落点

### 7.1 服务端模型层

#### `server/internal/model/tech.go`

需要增加三类改动：

1. `satellite_power` 增加 `satellite_substation` building unlock
2. 技术树反向图派生
   - 计算 `leads_to`
3. 死胡同裁剪
   - 迭代设置派生 `Hidden`

推荐不要把这套逻辑塞进 query 层临时拼装，而是直接在 tech catalog 初始化阶段完成派生。这样：

- `CanBuildTech(...)`
- `/catalog`
- 测试

都能看到同一份 tech 真相。

#### `server/internal/model/building_catalog.go`

需要新增“科技反向回填”步骤：

- 遍历所有非隐藏 tech
- 找出其中的 `TechUnlockBuilding`
- 把 tech ID 写回对应 `BuildingDefinition.UnlockTech`

这样 `/catalog.buildings[].unlock_tech` 才有 authoritative 含义。

#### `server/internal/model/building_defs.go`

需要把 `automatic_piler.Buildable` 调整为 `false`。

这里不建议新增“仅 catalog 隐藏、但 runtime 仍允许 build”的双轨字段；那只会制造另一套真相。

### 7.2 查询层

#### `server/internal/query/catalog.go`

需要：

- 给 `TechCatalogEntry` 新增 `LeadsTo []string`
- 输出派生后的 `hidden`
- 输出派生后的 `unlock_tech`

### 7.3 文档层

需要同步更新：

- `docs/player/玩法指南.md`
  - 移除 `automatic_piler` 的“当前可建”表述
  - 把 `satellite_substation` 明确标成 `satellite_power` 解锁
  - 科技树说明补充“桥接科技会通过 `leads_to` 暴露后继方向”
- `docs/dev/客户端CLI.md`
  - `build` 示例与建筑列表移除 `automatic_piler`
  - 标明 `satellite_substation` 需要 `satellite_power`
- `docs/dev/服务端API.md`
  - `/catalog.techs[]` 新增 `leads_to`
  - `/catalog.buildings[].unlock_tech` 改为 authoritative 反查入口之一
  - 说明 `automatic_piler` 当前未公开

## 8. 测试设计

### 8.1 建筑可达性回归

新增或扩展 gamecore/model 测试，至少覆盖：

1. `satellite_substation`
   - 新玩家不能建
   - 完成 `satellite_power` 后可以建
2. `automatic_piler`
   - `/catalog.buildings` 不再显示 `buildable=true`
   - `build automatic_piler` 被 authoritative 拒绝为 not buildable

### 8.2 catalog 一致性回归

新增断言：

1. 所有 `buildable=true` 的公开建筑，必须满足下面之一：
   - 属于初始完成科技解锁
   - `unlock_tech` 非空
2. `satellite_substation.unlock_tech == ["satellite_power"]`
3. `automatic_piler` 不在公开可建集合

### 8.3 科技树回归

新增断言：

1. 桥接科技仍可见且 `leads_to` 非空
2. 死胡同科技全部 `hidden=true`
3. `/catalog.techs[]` 中不再存在同时满足下面条件的公开节点：
   - `hidden=false`
   - `max_level=0`
   - `len(unlocks)==0`
   - `len(effects)==0`
   - `len(leads_to)==0`

注意这里的回归条件必须升级，不能继续只看 `unlocks/effects`，否则桥接科技会被误判。

## 9. 对任务原始验收口径的修正

任务原文里关于两个建筑的验收被写成：

- 未解锁前建造失败
- 解锁后建造成功

这对 `satellite_substation` 成立，但对当前的 `automatic_piler` 不成立，因为它还没有真实 runtime 行为。

如果继续强行要求两个建筑都走同一验收，会逼着实现做出一种很差的方案：

- 只是给 `automatic_piler` 补科技入口
- 但继续把空心建筑公开给玩家

因此本方案建议把验收拆成两条：

1. `satellite_substation`
   - 未解锁前不能建
   - 解锁后能建
2. `automatic_piler`
   - 当前版本不再公开
   - 等 runtime 补齐后，再单独开一条 reopen 任务

这比继续制造“可建但无玩法”的假入口更符合项目准则。

## 10. 最终建议

本次不建议采用 `design_claude.md` 中“两个建筑都直接接回科技树 + 所有空科技自动隐藏”的方案。那个方案有两个关键问题：

1. 它把 `automatic_piler` 当成了“只差科技入口”，忽略了当前并没有专门 runtime 行为。
2. 它会把 `engine`、`steel_smelting`、`particle_control` 这类桥接科技误判为死节点，进而切断当前已经存在的公开分支。

推荐落地方案是：

1. 立即把 `satellite_substation` 接回 `satellite_power`。
2. 立即把 `automatic_piler` 从公开可建能力中移除。
3. 给 tech catalog 增加 `leads_to`，把桥接科技与死胡同科技区分开。
4. 只隐藏真正的死胡同 tech 子树。
5. 给 building catalog 反向回填 `unlock_tech`，让 `/catalog`、CLI、文档和 authoritative 规则从同一份数据推导。

这样可以在不破坏现有中后期可玩分支的前提下，把 T103 里暴露出来的“公开口径不真实”问题一次收干净。
