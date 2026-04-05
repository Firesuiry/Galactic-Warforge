# T093 设计方案：戴森终局科技树与能源局势统计缺口（Codex）

## 1. 文档目标

`docs/process/task/` 当前只有一个待处理任务：`T093_戴森终局科技树与能源局势统计缺口.md`。

本设计文档只服务这一个任务，目标是把当前“catalog / 文档宣称可用”和“服务端真实可玩”重新拉回一致，重点收口 4 类问题：

1. `mass_energy_storage`、`gravity_missile` 已存在科技定义，但真实 item / recipe / catalog 不闭环。
2. 一批 `unit unlock` 仍停留在科技定义层，没有玩家可达的生产、部署、编队、太空战玩法。
3. `mission_complete -> game_win` 只有科技字符串，没有运行时胜利效果。
4. `summary/stats` 的能源统计读取的是静态参数，不是真实结算结果。

本方案遵循仓库现有约束：

- 不保留“半真半假”的可玩结论。
- 不为旧口径加兼容层。
- 能在现有架构里真实闭环的能力直接补齐。
- 明显超出当前实现边界的部分，直接降级出当前可玩主线。

## 2. 基于当前代码的事实判断

### 2.1 `build --recipe` 已经是通用生产入口

当前服务端并不缺“生产配方的公开入口”：

- `build <x> <y> <building_type> --recipe <recipe_id>` 已可走通。
- `server/internal/gamecore/rules.go` 会在建造时校验：
  - 建筑是否支持该 recipe
  - 玩家是否已解锁对应 recipe tech
- `server/internal/gamecore/construction.go` 会把 `recipe_id` 写入建筑生产态。

所以 `antimatter_capsule` 和 `gravity_missile` 的问题不是“还要再发明一条命令”，而是运行时 item / recipe / tech unlock 自身没接上。

### 2.2 tech catalog 之所以出现“tech 在但 unlock 消失”，是因为运行时会做规范化裁剪

`server/internal/model/tech.go` 在 `normalizeTechDefinitions()` 里会把 tech unlock 做规范化：

- `building` unlock 只保留运行时存在的建筑；
- `recipe` unlock 只保留运行时存在的配方。

因此：

- `mass_energy_storage -> antimatter_capsule`
- `gravity_missile -> gravity_missile`

之所以在 `/catalog.techs[]` 里变成 `unlocks = null`，不是 query 层漏显示，而是运行时判定它们引用了不存在的 recipe，于是被主动裁掉了。

### 2.3 当前“单位解锁”不是差一点，而是整条玩法链都没接上

当前公开单位生产入口只有：

- `produce <entity_id> worker`
- `produce <entity_id> soldier`

`server/internal/gamecore/rules.go` 的 `execProduce()` 也只接受：

- `worker`
- `soldier`

而 `engine`、`prototype`、`precision_drone`、`corvette`、`destroyer` 这些 tech 解锁出来的 unit id：

- 不存在统一的运行时 unit registry
- 不在 `execProduce()` 白名单里
- 没有部署、编队、轨道/太空查询或战斗命令
- `server/internal/model/orbital_combat.go`、`combat_unit.go` 虽然有若干模型草稿，但没有接入当前 authoritative world、query、command 流程

这意味着“真补齐单位线”和“给 catalog 去伪存真”不是一个量级的工作。

### 2.4 `VictoryRule` 配置存在，但当前 tick 只跑消灭胜

配置层已经有：

- `battlefield.victory_rule`

但当前核心循环仍然固定调用 `checkVictory()`，而 `checkVictory()` 的语义只有：

- 谁最后还保留 `battlefield_analysis_base`，谁获胜

因此：

- `mission_complete` 完成后不会触发任何额外逻辑
- `/state/summary.winner` 只能反映 `elimination`
- save / replay 里也没有胜利原因

### 2.5 能源统计当前读取的是“建筑静态能力”，不是“电网真实结果”

`server/internal/gamecore/stats_settlement.go` 当前的 `updateEnergyStats()`：

- `generation` 直接累加 `building.Runtime.Functions.Energy.OutputPerTick`
- `consumption` 直接累加 `ConsumePerTick`
- `current_stored` 直接误用 `building.HP`

而真实电网结果其实来自：

- `ws.PowerInputs`
- `ResolvePowerNetworks()`
- `ResolvePowerAllocations()`
- `building.EnergyStorage.Energy`

所以当前 stats 和：

- `/world/planets/{planet_id}/networks`
- 建筑 `inspect`

天然不一致。

## 3. 方案对比

### 3.1 方案 A：把 4 类问题全部真实实现

做法：

- 补齐终局弹药。
- 补齐太空单位生产、部署、编队、轨道/星际战。
- 补齐 `mission_complete -> game_win`。
- 修能源统计。

优点：

- 终局能力最完整。
- 文档可以直接声称“终局主线完全闭环”。

问题：

- 太空单位这一块已经超出 T093 的可控范围。
- 会同时牵动：
  - 新 unit registry
  - 命令系统
  - query 展示
  - 多星球/星系层实体归属
  - 编队与轨道战结算
- 很容易把当前任务拖成新的大阶段工程。

结论：**不推荐。**

### 3.2 方案 B：能闭环的真实补齐，明显超范围的直接降级

做法：

- 真实补齐：
  - `antimatter_capsule`
  - `gravity_missile`
  - `mission_complete -> game_win`
  - 能源统计
- 明确降级：
  - 当前不可玩的太空单位解锁分支

优点：

- 能把 T093 指出的“假可用”基本清空。
- 改动范围与现有架构相容。
- 不会为了做单位线把整套星际战系统半成品地塞进当前回合。

问题：

- 当前版本仍不会真正开放 `corvette/destroyer` 玩法。
- 文档必须老实承认这条支线尚未进入可玩范围。

结论：**推荐。**

### 3.3 方案 C：把所有不完整内容都从当前版本移除

做法：

- 不补任何终局弹药与胜利逻辑。
- 所有相关 tech 全部隐藏或文档删除。
- 只修能源统计。

优点：

- 风险最小。

问题：

- 会浪费目前已经基本跑通的戴森中后期链路。
- 会让项目从“差最后几处收口”倒退成“终局主线直接回避”。

结论：**不推荐。**

## 4. 推荐方案

本轮采用 **方案 B**：

1. 真实补齐两个终局弹药的 runtime item / recipe / catalog / 生产闭环。
2. 不在 T093 内硬做太空单位系统，而是把当前不可玩的 unit unlock 从“玩家以为可玩”的状态降级为明确未实现。
3. 让 `mission_complete` 真正能产生 `game_win`，并明确它和 `elimination` 的关系。
4. 让 `summary/stats` 直接读取真实电网与储能状态。

推荐原则只有一句话：

**能在当前 authoritative world + query + command 架构里闭环的，就直接做成真；需要新世界层、舰队层和专用 UI/命令才能成立的，就不要继续冒充当前版本已实现。**

## 5. 详细设计

### 5.1 终局弹药线收口

#### 5.1.1 运行时 canonical ID

本轮以服务端 runtime 为准，不以 `config/defs` 里的参考文件名为准。

推荐采用以下 canonical id：

- `antimatter_capsule`
- `gravity_missile`

处理原则：

- `mass_energy_storage` 继续解锁 `antimatter_capsule`
- `gravity_missile` 科技继续解锁 `gravity_missile`
- `config/defs/items/combat/gravity_missile_set.yaml` 应在后续同步中改名并对齐为 `gravity_missile`
- 不新增 `gravity_missile_set -> gravity_missile` 这种兼容 alias

原因：

- 当前 tech tree 已经在 runtime 中使用 `gravity_missile`
- 再套一层 alias 只会继续制造“文档名 / config 名 / runtime 名”三套口径

#### 5.1.2 item 定义

在 `server/internal/model/item.go` 中新增两个 runtime item：

1. `ItemAntimatterCapsule`
   - `category = ammo`
   - `form = solid`
   - `stack_limit = 100`
   - `unit_volume = 1`

2. `ItemGravityMissile`
   - `category = ammo`
   - `form = solid`
   - `stack_limit = 100`
   - `unit_volume = 1`

理由：

- 与现有 `ammo_bullet`、`ammo_missile` 同属弹药类。
- 数值直接沿用 `config/defs/items/combat/*.yaml` 的轻量弹药尺度。
- 不新增新的 item category，也不引入“combat”专用大类。

#### 5.1.3 recipe 定义

推荐直接补两条终局 recipe，不再引入新的中间材料：

1. `antimatter_capsule`
   - 输入：
     - `antimatter x2`
     - `annihilation_constraint_sphere x1`
     - `titanium_alloy x1`
   - 输出：
     - `antimatter_capsule x1`
   - 建筑：
     - `recomposing_assembler`
   - 设计理由：
     - 强绑定当前已实现的反物质终局链
     - 不发明新容器物品
     - 与 `antimatter_fuel_rod` 共用高阶制造建筑

2. `gravity_missile`
   - 输入：
     - `ammo_missile x1`
     - `strange_matter x1`
     - `gravity_matrix x1`
   - 输出：
     - `gravity_missile x1`
   - 建筑：
     - `recomposing_assembler`
   - 设计理由：
     - 直接复用现有导弹弹药线
     - 用 `strange_matter + gravity_matrix` 把它拉到真正终局层级
     - 不需要新弹药工厂

这两条 recipe 的核心目标不是还原原版全部细节，而是：

- 让 tech unlock 不再指向空气
- 让玩家能通过当前真实生产系统制造它们
- 让 late-game item 可进入库存、物流、catalog、inspect

#### 5.1.4 公开生产入口

本轮不新增任何新命令。

真实生产入口直接复用当前体系：

```text
build <x> <y> recomposing_assembler --recipe antimatter_capsule
build <x> <y> recomposing_assembler --recipe gravity_missile
```

建造命令、配方权限校验、库存 / 物流流转，全部复用现有代码。

#### 5.1.5 catalog 与 tech unlock 对齐

有了 runtime item / recipe 之后，`normalizeTechDefinitions()` 会自然保留：

- `mass_energy_storage -> recipe: antimatter_capsule`
- `gravity_missile -> recipe: gravity_missile`

因此 `/catalog` 不需要额外写特殊补丁。

这一步的正确做法是“补齐运行时定义”，不是“放宽 normalize 让错误引用也显示出来”。

#### 5.1.6 本轮刻意不做的事

这轮不顺手引入“高阶弹药消耗系统”。

也就是：

- `sr_plasma_turret`
- `missile_turret`

仍继续按当前“供电即攻击”的模型工作，不在 T093 内强行改成必须吞弹药才能攻击。

原因：

- 这会把范围再次扩展到所有防御建筑的供弹 / 补弹 / 停机语义。
- 当前任务的最低真实闭环是“tech、item、recipe、生产入口一致”，不是“整套弹药经济重写”。

文档里应明确写清：

- 这两个 item 当前已经可生产、可运输、可存储；
- 真正的“炮塔消耗终局弹药”属于后续独立收口项。

### 5.2 `unit unlock` 支线降级为明确未实现

#### 5.2.1 为什么不在 T093 内直接补齐

要让这批 unit 真能玩，至少还要补：

- unit definition registry
- 单位生产语义
- 单位归属到 planet / system / orbit 的状态模型
- 查询视图
- 命令入口
- 编队与太空战结算

这已经不是 tech tree 收口，而是新的战斗系统阶段任务。

#### 5.2.2 推荐收口方式

本轮采用“去伪存真”而不是“硬补半套太空战”：

1. 引入一份运行时可支持的 `TechUnlockUnit` registry
   - 当前至少保留：
     - `logistics_drone`
     - `logistics_ship`
   - 这些 unit unlock 在现有系统里已有真实表现

2. `normalizeTechUnlocks()` 对 `TechUnlockUnit` 也做校验
   - 不在 registry 里的 unit unlock 一律从 catalog 输出中移除

这样做以后，`engine` / `prototype` / `precision_drone` / `corvette` / `destroyer` / `corvette_attack_drone` 不会再在 `/catalog.techs[].unlocks` 里继续冒充“可玩的 unit 解锁”。

#### 5.2.3 tech 可见性策略

不能一刀切把所有相关 tech 都删掉，因为其中有一部分同时承担已实现地面战分支的前置门禁。

推荐拆成两类：

1. 保留可见，但不再宣称解锁 unit
   - `engine`
   - 理由：
     - 它仍是已实现 combat tech 的前置节点
     - 去掉伪造的 `unit unlock` 后，可以作为“分支 prerequisite tech”继续存在

2. 直接降级出当前玩家可见主线
   - `prototype`
   - `precision_drone`
   - `corvette`
   - `destroyer`
   - 处理方式：
     - `Hidden = true`
     - 从玩家指南、CLI 示例、能力盘点中移出当前可玩主线

原因：

- 这 4 个 tech 在去掉伪造 unit unlock 后，对当前可玩内容已无实际贡献
- 继续挂在公开科技树里只会制造新的“研究了但什么都没发生”

#### 5.2.4 文档口径

文档需要统一成下面这套说法：

- 当前版本的公开可玩战斗分支：
  - 地面防御
  - 行星防御
  - 物流单位
- 当前版本未进入公开可玩范围的支线：
  - `prototype`
  - `precision_drone`
  - `corvette`
  - `destroyer`

也就是让“未实现”变成明确事实，而不是继续让玩家从 catalog 自己猜。

### 5.3 `mission_complete -> game_win` 的真实终局玩法

#### 5.3.1 胜利规则枚举

推荐把 `battlefield.victory_rule` 真正做成运行时语义，而不是保留死配置。

新增 3 种明确模式：

- `elimination`
  - 只有当前基地消灭胜
- `mission_complete`
  - 只有 `mission_complete` 触发的科技胜利
- `hybrid`
  - `elimination` 和 `mission_complete` 二者都有效，谁先满足谁获胜

默认值继续保持：

- `elimination`

DSP 相关配置推荐改成：

- `hybrid`

这样不会破坏现有非 DSP 战场，同时能让终局科研真的有意义。

#### 5.3.2 触发条件

`mission_complete` 的真实效果定义为：

- 玩家完成该科技研究后，立即满足 `game_win`

不再引入额外命令，也不再要求玩家手动“提交任务完成”。

理由：

- 当前 tech 本身已经代表巨量宇宙矩阵投入后的最终研究
- 再加一步提交动作只会制造新的“科技完成但还没算赢”的歧义

#### 5.3.3 核心流程

推荐把当前 `checkVictory()` 改成统一的 `resolveVictory()`：

1. 读取当前 world / config 中的 `victory_rule`
2. 若规则允许 `mission_complete`
   - 扫描玩家已完成科技
   - 若有人完成 `mission_complete`，直接产生 `game_win`
3. 若规则允许 `elimination`
   - 继续执行现有基地消灭胜逻辑
4. 一旦有 winner，winner 锁定，不再回退

#### 5.3.4 并发与平局处理

当前 runtime 只有单一 `winner string`，因此不引入多赢家语义。

若多个玩家同 tick 满足 `mission_complete`：

- 以稳定排序后的首个 `player_id` 作为 winner

这样虽然简化，但至少：

- 可复现
- 可测试
- 不需要为 T093 引入新的多人平局结算系统

#### 5.3.5 事件、摘要与持久化

为了让“任务完成”不是只改一个布尔值，推荐同步补 3 个输出面：

1. 新增事件
   - `victory_declared`
   - payload 至少包含：
     - `winner_id`
     - `reason`
     - `victory_rule`
     - `tech_id`（若因 `mission_complete` 触发）

2. 扩展 `/state/summary`
   - 在现有 `winner` 之外新增：
     - `victory_reason`
     - `victory_rule`

3. 扩展 runtime save state
   - 当前只保存 `winner`
   - 推荐同时保存：
     - `victory_reason`
     - `victory_rule`

这样 summary、事件、save/replay 的口径才能一致。

#### 5.3.6 与 `research_completed` 的关系

`research_completed` 事件继续保留；
`victory_declared` 不替代它，而是补一层更高语义。

也就是：

- 先有 `research_completed(tech_id=mission_complete)`
- 同 tick 再有 `victory_declared(reason=game_win)`

这比把所有含义都塞进 `research_completed` payload 更清晰。

### 5.4 能源摘要统计改为读取真实结算值

#### 5.4.1 单一事实来源

`summary/stats` 不应该再自己发明一套能源算法。

推荐抽一层共享 helper，例如：

- `BuildPlayerEnergyStats(ws, playerID)`

这个 helper 直接基于当前 tick 已结算完成后的 runtime 状态构建玩家能源摘要。

#### 5.4.2 计算口径

推荐采用以下定义：

1. `generation`
   - `Σ PowerNetwork.Supply`
   - 来源于 `ResolvePowerNetworks()`
   - 自动包含：
     - 风机
     - 火电
     - 射线接收站 `power` 模式实际回灌
     - 储能建筑放电形成的 `PowerInput`

2. `consumption`
   - `Σ PowerAllocationNetwork.Allocated`
   - 表示当前 tick 真实被满足的用电量
   - 不再使用静态 `ConsumePerTick` 累加

3. `storage`
   - `Σ EnergyStorageModule.Capacity`

4. `current_stored`
   - `Σ building.EnergyStorage.Energy`
   - 不再误用 `building.HP`

5. `shortage_ticks`
   - 若任一玩家自有网络在本 tick 处于 `Shortage=true`，则 `+1`

#### 5.4.3 为什么必须基于 network / allocation

只有这一层才同时具备：

- 实际供电值
- 实际分配值
- 缺电状态
- 储能充放电后的结果

继续直接扫建筑静态 runtime，只会重复当前 bug。

#### 5.4.4 和现有 query 的对齐关系

修完之后，以下三组数据必须同源：

1. `/world/planets/{planet_id}/networks`
2. `/state/summary.players[pid].stats.energy_stats`
3. `/state/stats.energy_stats`

其中：

- `networks` 负责显示网络级明细
- `summary/stats` 负责显示玩家级聚合

但两者都必须从同一套 network / allocation / energy_storage 状态推导。

#### 5.4.5 作用域约定

本轮不把 `summary/stats` 改成“跨所有 planet 的总和”。

继续保持与当前 active runtime 一致：

- `summary/stats` 代表当前 active planet 对应 world 的玩家统计

原因：

- 现有 query 体系本来就是围绕 active planet runtime 展开
- 跨 planet 汇总会把这轮任务从“数值真实性修复”升级成“全局统计语义重构”

### 5.5 文档与参考配置同步策略

本轮实现后，需要同步以下几处口径：

1. `docs/player/玩法指南.md`
   - 增加终局弹药的生产路径
   - 明确当前版本未开放太空舰队单位线
   - 写清 `mission_complete` 的胜利意义

2. `docs/dev/服务端API.md`
   - 更新 `/state/summary`、`/state/stats` 的能源统计语义
   - 补充 `victory_declared` 事件

3. `docs/dev/客户端CLI.md`
   - 说明终局弹药使用现有 `build --recipe` 生产

4. `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`
   - 修正终局科技树与单位线当前实现结论

5. 参考配置目录
   - `config/defs/items/combat/gravity_missile_set.yaml` 应改为与 runtime 一致的 canonical 命名

## 6. 建议实施顺序

### 6.1 第一阶段：先把假 unlock 清掉

先做：

- `antimatter_capsule` / `gravity_missile` 的 item + recipe
- `TechUnlockUnit` 的 runtime 校验

这样 catalog 会先恢复真实性。

### 6.2 第二阶段：补胜利逻辑

再做：

- `victory_rule` 运行时化
- `mission_complete -> game_win`
- `victory_declared`

原因：

- 这部分会动 core loop 和 save state
- 适合在 catalog 收口完成后独立验证

### 6.3 第三阶段：修能源摘要

最后做：

- 新能源统计 helper
- `/summary` 与 `/stats` 对齐测试

原因：

- 这一块完全可以建立在当前 power settlement 结果上，不依赖前两阶段

## 7. 测试设计

### 7.1 catalog / tech 一致性测试

至少新增 1 组模型级测试，覆盖：

- `mass_energy_storage` 能看到 `recipe: antimatter_capsule`
- `gravity_missile` 能看到 `recipe: gravity_missile`
- `Item("antimatter_capsule")` 存在
- `Item("gravity_missile")` 存在
- `Recipe("antimatter_capsule")` 存在
- `Recipe("gravity_missile")` 存在

同时新增负向断言：

- 不支持的 `TechUnlockUnit` 不再出现在 catalog tech unlock 里

### 7.2 终局单位支线降级测试

至少覆盖：

- `engine` 不再暴露假的 `unit unlock`
- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`
- `corvette_attack_drone`

在 catalog 中要么：

- `hidden = true`

要么：

- 不再暴露假的 unit unlock，且文档已明确标未实现

### 7.3 科技胜利测试

至少新增 1 组 gamecore 测试，覆盖：

1. `victory_rule = mission_complete`
   - 玩家完成 `mission_complete` 后立即获胜

2. `victory_rule = hybrid`
   - `mission_complete` 与 `elimination` 任一满足都会出 winner

3. `victory_rule = elimination`
   - 完成 `mission_complete` 不应误触发科技胜利

4. 事件验证
   - 会出现 `victory_declared`
   - payload 中 `reason=game_win`

### 7.4 能源统计一致性测试

至少新增 1 组回归测试，覆盖官方 midgame 或等价夹具场景中的：

- `ray_receiver` 切到 `power`
- `energy_exchanger` / `accumulator` 接入同一网络
- 完成若干 tick 结算后读取：
  - `/world/planets/{planet_id}/networks`
  - `/state/summary`
  - `/state/stats`
  - `inspect building`

断言：

- `summary.energy_stats.generation == networks.power_networks[].supply 聚合`
- `stats.energy_stats.generation == summary.energy_stats.generation`
- `current_stored == inspect.energy_storage.energy 聚合`

## 8. 风险与边界

### 8.1 当前不会顺手变成“完整太空舰队版本”

本方案明确不在 T093 内补：

- `corvette`
- `destroyer`
- 编队命令
- 轨道/星际单位 query 展示

否则任务会失控。

### 8.2 `engine` 仍会保留为分支 prerequisite tech

`engine` 去掉假的 `unit unlock` 后，会变成一个当前主要承担分支前置作用的 tech。

这不是问题，前提是：

- catalog 不再谎称它解锁了某个可玩单位
- 文档不再把它写成“当前已开放的单位科技”

### 8.3 能源统计仍是 active planet 语义

这轮修的是“真假问题”，不是“全宇宙聚合统计”。

如果以后需要跨 planet 总统计，应单独开任务，而不是把 T093 的修复和统计语义重写混在一起。

## 9. 结论

T093 最合理的收口方式不是“把所有终局名词都硬做完”，而是：

- 对已经有足够底座的内容，直接补成真实闭环：
  - 终局弹药
  - 科技胜利
  - 能源统计
- 对当前根本没有玩法承载层的内容，明确降级：
  - 太空单位支线

这样改完以后，当前版本至少能做到：

1. catalog 不再展示会凭空消失的终局 unlock。
2. `mission_complete` 不再只是一个装饰科技，而是真正有胜利含义。
3. CLI / Web 看到的能源局势会回到真实电网数值。
4. 玩家和文档都不会再被“可见但不可玩”的 unit unlock 误导。
