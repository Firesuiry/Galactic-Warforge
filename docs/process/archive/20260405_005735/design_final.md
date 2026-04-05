# T093 最终设计与实现回写：戴森终局科技树与能源局势统计缺口

## 0. 2026-04-04 实现回写

- T093 已按本文路线落地；如果下文仍保留“推荐”“计划”“待实现”等方案推导表述，以本节和当前代码实现为准。
- 已落地的核心结果：
  - `antimatter_capsule`、`gravity_missile` 已补齐到 `item` / `recipe` / `/catalog`，并通过 `recomposing_assembler` + 通用 `build --recipe ...` 进入真实生产闭环。
  - `normalizeTechUnlocks()` 已把 `TechUnlockUnit` 纳入 runtime 过滤；`prototype`、`precision_drone`、`corvette`、`destroyer` 现已 `hidden=true`，`engine` 仅保留前置科技语义，不再对玩家谎称可解锁高阶单位。
  - `victory_rule` 已接入运行时解析，仓库内 `config.yaml`、`config-dev.yaml`、`config-midgame.yaml` 默认改为 `hybrid`；`mission_complete` 完成后会触发 `game_win`，并同步写入 `victory_declared`、`/state/summary`、审计、存档、回放与回滚恢复态。
  - `/state/summary` / `/state/stats` 的 `energy_stats` 已改为基于 power network、power allocation 与 `energy_storage.energy` 聚合，不再复用静态建筑参数或建筑 HP。
- 当前仍保留的边界：
  - 高阶舰队线仍没有公开生产 / 部署 / 太空战入口，因此只做“隐藏与去伪存真”，没有开放为玩家可玩系统。
  - `build_dyson_*` 仍是实验性脚手架入口，主要负责科技校验与戴森结构写入，不承担完整材料化建造语义。
  - `summary` / `stats` 仍保持 active planet 统计语义，不做跨全部已加载行星的总汇总。

## 1. 文档来源与目标

仓库当前存在 `docs/process/design_codex.md`，但不存在同任务对应的顶层 `docs/process/design_claude.md`。因此，本最终方案不能假装“综合了两份同任务草案”，而是基于以下三类输入形成单一定稿：

- `docs/process/design_codex.md`
- `docs/process/task/T093_戴森终局科技树与能源局势统计缺口.md`
- 当前服务端代码的实际实现现状

本文目标不是保留多套备选思路，而是沉淀一份可追溯的最终方案，并回写 2026-04-04 已落地实现。T093 本轮实际收口了 4 类真实缺口：

1. `mass_energy_storage`、`gravity_missile` 的科技解锁存在，但运行时 item / recipe / catalog 不闭环。
2. 一批 `unit unlock` 仍停留在科技定义层，没有真实玩家入口承载。
3. `mission_complete -> game_win` 只存在科技字符串，没有运行时胜利效果。
4. `/state/summary` 与 `/state/stats` 的能源统计读取的是静态参数，不是真实结算结果。

本文遵循仓库既定约束：

- 不保留“科技树看起来有、实际上玩不到”的半真半假口径。
- 不为了旧命名或旧错误引用增加兼容层。
- 能在当前 authoritative world + query + command 架构里闭环的内容，直接补成真的。
- 需要全新太空单位系统才能成立的内容，不在 T093 内硬做半套实现。

## 2. 关键事实判断

### 2.1 终局弹药缺的不是命令，而是 runtime 定义

当前 `build <x> <y> <building_type> --recipe <recipe_id>` 已经是通用生产入口：

- `server/internal/gamecore/rules.go` 在建造时会校验建筑是否支持该 recipe。
- 同一处逻辑也会校验玩家是否已解锁对应 recipe tech。
- `server/internal/gamecore/construction.go` 会把 `recipe_id` 写入建筑生产态。

因此：

- `antimatter_capsule`
- `gravity_missile`

的问题不是“还需要新命令”，而是运行时 `item.go` / `recipe.go` 没有把它们定义出来。

### 2.2 科技 unlock 丢失，是 normalize 主动裁掉的结果

`server/internal/model/tech.go` 的 `normalizeTechDefinitions()` / `normalizeTechUnlocks()` 当前会校验：

- `building unlock` 是否存在于 runtime building catalog
- `recipe unlock` 是否存在于 runtime recipe catalog

所以：

- `mass_energy_storage -> antimatter_capsule`
- `gravity_missile -> gravity_missile`

之所以在 `/catalog.techs[].unlocks` 里消失，不是 query 漏显示，而是 tech 定义引用了不存在的 recipe，运行时把它们主动裁掉了。

### 2.3 `unit unlock` 当前没有玩法承载层

当前公开单位生产入口仍只有：

- `produce <entity_id> worker`
- `produce <entity_id> soldier`

`server/internal/gamecore/rules.go` 的 `execProduce()` 只接受 `worker|soldier`。同时，虽然代码里已经有：

- 物流无人机
- 物流运输船
- 若干 orbital / combat 模型草稿

但并不存在一套可公开使用的“高阶单位系统”，包括：

- 通用 unit registry
- 玩家生产入口
- 部署 / 编队入口
- 轨道 / 星系级查询视图
- 太空战结算

所以 `engine`、`prototype`、`precision_drone`、`corvette`、`destroyer` 这一支现在不是“差最后一步”，而是根本没有可玩的承载层。

### 2.4 胜利规则配置存在，但运行时仍只有消灭胜

`server/internal/config/config.go` 已经定义了 `battlefield.victory_rule`，但运行时仍然只调用 `checkVictory()`。而当前 `checkVictory()` 的含义只有：

- 谁最后还保留 `battlefield_analysis_base`，谁获胜

这意味着：

- 完成 `mission_complete` 不会触发额外效果
- `/state/summary` 只能返回 `winner`
- save state 也只保存 `winner`

### 2.5 能源摘要统计当前读取了错误的数据源

`server/internal/gamecore/stats_settlement.go` 当前的 `updateEnergyStats()`：

- `generation` 直接累加建筑静态 `OutputPerTick`
- `consumption` 直接累加静态 `ConsumePerTick`
- `current_stored` 直接误用 `building.HP`

而真实电网结果其实来自：

- `ws.PowerInputs`
- `ResolvePowerNetworks()`
- `ResolvePowerAllocations()`
- `building.EnergyStorage.Energy`

所以摘要统计和：

- `/world/planets/{planet_id}/networks`
- `inspect building`

天然不一致。

### 2.6 `Hidden` 已能作为“降级出玩家可见主线”的正式手段

`query/catalog.go` 会把 tech 的 `Hidden` 字段暴露出来，`client-web` 当前也已经对 `hidden` tech 做过滤。因此，T093 没必要再发明一套新的“未实现 tech 屏蔽系统”，直接复用现有 `Hidden` 语义即可。

## 3. 方案取舍

### 3.1 不采用“把所有终局内容全部补齐”

如果这轮连太空单位线一起补齐，至少要同时引入：

- unit registry
- 新生产入口
- 部署 / 编队命令
- 轨道 / 星系层实体状态
- 查询展示
- 太空作战结算

这已经不是 T093 的量级。

### 3.2 不采用“把终局问题全部删掉”

直接删掉终局弹药、科技胜利等内容虽然风险最低，但会把已经接近闭环的 DSP 终局主线整体回退，不符合任务目标。

### 3.3 最终采用的路线

最终采用：

- 对当前架构已经能承载的内容，直接补成真：
  - `antimatter_capsule`
  - `gravity_missile`
  - `mission_complete -> game_win`
  - 能源统计
- 对当前没有承载层的内容，明确降级：
  - `prototype`
  - `precision_drone`
  - `corvette`
  - `destroyer`
  - 以及相关伪造 `unit unlock`

这条路线能把 catalog、玩法、文档重新拉回一致，同时不把任务扩成新的“太空舰队系统”阶段工程。

## 4. 最终实现方案

### 4.1 终局弹药线真实补齐

#### 4.1.1 统一 runtime canonical id

本轮以服务端 runtime 为唯一真相，采用以下 canonical id：

- `antimatter_capsule`
- `gravity_missile`

不新增任何兼容 alias，不保留：

- `gravity_missile_set -> gravity_missile`

这类过渡映射。

#### 4.1.2 新增 runtime item 定义

在 `server/internal/model/item.go` 中新增：

1. `antimatter_capsule`
   - `category = ammo`
   - `form = solid`
   - `stack_limit = 100`
   - `unit_volume = 1`
2. `gravity_missile`
   - `category = ammo`
   - `form = solid`
   - `stack_limit = 100`
   - `unit_volume = 1`

这样它们就能自然进入：

- 玩家库存
- 建筑库存
- 物流系统
- `/catalog.items`
- `inspect`

#### 4.1.3 新增 runtime recipe 定义

在 `server/internal/model/recipe.go` 中补两条 recipe：

1. `antimatter_capsule`
   - 输入：
     - `antimatter x2`
     - `annihilation_constraint_sphere x1`
     - `titanium_alloy x1`
   - 输出：
     - `antimatter_capsule x1`
   - 建筑：
     - `recomposing_assembler`

2. `gravity_missile`
   - 输入：
     - `ammo_missile x1`
     - `strange_matter x1`
     - `gravity_matrix x1`
   - 输出：
     - `gravity_missile x1`
   - 建筑：
     - `recomposing_assembler`

这两条 recipe 的目标不是还原原版所有细枝末节，而是让当前 runtime 真正形成：

- tech unlock
- item catalog
- recipe catalog
- 生产入口

的一致闭环。

#### 4.1.4 继续复用现有生产入口

本轮不新增任何新命令。公开生产方式直接使用现有命令：

```text
build <x> <y> recomposing_assembler --recipe antimatter_capsule
build <x> <y> recomposing_assembler --recipe gravity_missile
```

这会自然复用现有的：

- recipe 技术校验
- 建筑支持校验
- 产线库存 / 物流流转

#### 4.1.5 不顺手扩成“炮塔必须吞终局弹药”

本轮只补：

- item
- recipe
- catalog
- tech unlock
- 生产闭环

不把 `sr_plasma_turret`、`missile_turret` 等建筑改成必须实际吞用这些新弹药，否则任务范围会立刻扩展到完整供弹 / 断弹 / 补弹语义重写。

#### 4.1.6 同步参考配置命名

`config/defs/items/combat/gravity_missile_set.yaml` 需要在后续文档 / 参考配置同步时改成与 runtime 一致的 canonical 名称 `gravity_missile`。这里直接改名，不做兼容包装。

### 4.2 `unit unlock` 支线明确降级

#### 4.2.1 引入“runtime 支持的 unit unlock 名单”

在 `server/internal/model/tech.go` 中扩展 `normalizeTechUnlocks()`，让 `TechUnlockUnit` 也进入 runtime 校验。

新增一份明确的支持名单，初始只保留：

- `logistics_drone`
- `logistics_ship`

原因不是它们能通过 `produce` 命令制造，而是它们已经有真实运行时载体：

- 物流站
- 物流调度
- 运行时查询视图

#### 4.2.2 过滤掉伪造的高阶 unit unlock

完成 `TechUnlockUnit` 校验后，以下解锁将不再出现在 tech unlock 输出中：

- `engine`
- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`
- `corvette_attack_drone`

其中：

- `engine` 保留为可见 tech，但不再谎称自己解锁了可玩单位
- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

统一设置 `Hidden = true`，从当前玩家可见主线中降级出去

#### 4.2.3 为什么保留 `engine`

`engine` 仍是现有已实现战斗分支的前置节点。它可以作为 prerequisite tech 继续存在，但不能再继续暴露假的 `unit unlock`。

#### 4.2.4 为什么隐藏后续 4 个 tech

`prototype`、`precision_drone`、`corvette`、`destroyer` 在去掉伪造 unlock 后，对当前可玩内容已没有正向贡献。继续在玩家可见科技树里展示，只会制造“研究了但什么都没发生”的误导。

#### 4.2.5 本轮明确不做的事

本轮不新增：

- 高阶单位生产命令
- 部署 / 编队命令
- 轨道 / 星系级单位 query
- 太空战结算

T093 只做“去伪存真”，不做半成品太空舰队系统。

### 4.3 `mission_complete -> game_win` 接入真实胜利逻辑

#### 4.3.1 将 `victory_rule` 从配置项变成运行时语义

运行时正式支持 3 种模式：

- `elimination`
- `mission_complete`
- `hybrid`

默认值仍保持 `elimination`，避免影响没有 DSP 终局语义的其他战场。

当前公开 DSP 配置改为显式使用：

- `server/config.yaml`
- `server/config-dev.yaml`
- `server/config-midgame.yaml`

中的 `victory_rule: hybrid`

这样终局科研获胜与现有消灭胜都可以成立。

#### 4.3.2 胜利触发条件

`mission_complete` 的效果定义为：

- 玩家完成该科技研究后，立即触发 `game_win`

不增加额外“提交任务完成”命令，也不增加新的交付动作。

#### 4.3.3 统一胜利解析流程

将当前只返回字符串的 `checkVictory()` 升级成统一的胜利解析流程，例如 `resolveVictory()`，返回完整胜利信息：

- `winner_id`
- `reason`
- `victory_rule`
- `tech_id`（仅科技胜利时）

解析顺序固定为：

1. 若规则允许 `mission_complete`，先检查是否已有玩家完成 `mission_complete`
2. 若规则允许 `elimination`，再执行当前基地消灭胜逻辑
3. 一旦产生 winner，即锁定胜利状态，不再回退

这样在 `hybrid` 模式下，即使同 tick 同时存在科技完成与消灭胜，也能得到稳定、可复现的结果。

#### 4.3.4 作用域约定

本轮不重写现有多行星消灭胜规则。

- `mission_complete` 胜利依据玩家全局科技状态判定
- `elimination` 仍保持当前 active world 的基地消灭语义

T093 只把科技胜利接入当前框架，不顺手做“全宇宙统一胜负判定重构”。

#### 4.3.5 平局与并发

若多个玩家同 tick 同时满足 `mission_complete`，按稳定排序后的 `player_id` 取第一个 winner。

这样虽然不引入多赢家语义，但能保证：

- 可测试
- 可重放
- 不需要为 T093 新增复杂平局机制

#### 4.3.6 事件、摘要、持久化、审计同步

为避免科技胜利只改一个内存字段，本轮同步补 4 个输出面：

1. 新增事件类型 `victory_declared`
   - payload 至少包含：
     - `winner_id`
     - `reason`
     - `victory_rule`
     - `tech_id`（科技胜利时）
2. 扩展 `/state/summary`
   - 在现有 `winner` 之外新增：
     - `victory_reason`
     - `victory_rule`
3. 扩展 save state
   - `gamedir.RuntimeState` 除 `Winner` 外，再保存：
     - `VictoryReason`
     - `VictoryRule`
4. 增加审计记录
   - 新增一条 `action = victory` 的 audit entry
   - details 至少包含：
     - `winner_id`
     - `reason`
     - `victory_rule`
     - `tech_id`

#### 4.3.7 与 `research_completed` 的关系

`research_completed` 事件继续保留，不与 `victory_declared` 合并。

语义顺序为：

1. `research_completed(tech_id=mission_complete)`
2. `victory_declared(reason=game_win, tech_id=mission_complete)`

这比把所有含义都塞进一个事件更清楚。

### 4.4 能源摘要统计改为读取真实结算值

#### 4.4.1 单一事实来源

`/state/summary` 和 `/state/stats` 不再自己发明一套能源算法，而是统一从当前 tick 已结算完成的 runtime 状态推导。

建议抽出一层共享 helper，例如：

- `buildPlayerEnergyStats(ws, playerID)`

#### 4.4.2 统计口径

最终采用以下定义：

1. `generation`
   - 玩家所属 power networks 的 `Supply` 总和
   - 自动包含：
     - 风机等发电建筑
     - `ray_receiver` 在 `power` 模式下的真实回灌
     - 储能建筑放电产生的供电
2. `consumption`
   - 玩家所属 power allocation networks 的 `Allocated` 总和
   - 代表本 tick 真实被满足的耗电量
3. `storage`
   - 玩家自有储能建筑的容量总和
4. `current_stored`
   - `building.EnergyStorage.Energy` 总和
5. `shortage_ticks`
   - 若玩家任一网络在该 tick 处于 `Shortage=true`，则 `+1`

#### 4.4.3 为什么不能继续扫建筑静态参数

只有 network / allocation / energy storage 这几层，才同时包含：

- 实际供电值
- 实际分配值
- 缺电状态
- 储能充放电后的当前电量

继续直接扫建筑静态 `OutputPerTick` / `ConsumePerTick`，只会重复现在的错误。

#### 4.4.4 与现有查询的对齐要求

修完之后，以下结果必须同源：

- `/world/planets/{planet_id}/networks`
- `/state/summary.players[pid].stats.energy_stats`
- `/state/stats.energy_stats`
- `inspect building` 中的 `energy_storage.energy`

其中：

- `networks` 负责网络级明细
- `summary` / `stats` 负责玩家级聚合

但聚合结果必须从同一套 runtime 状态推导。

#### 4.4.5 作用域保持 active planet 语义

本轮不把摘要统计改成“跨所有 planet 汇总”。继续保持：

- `/state/summary`
- `/state/stats`

都表示当前 active world / active planet 的玩家统计。

T093 修的是“真假问题”，不是“全宇宙统计语义重构”。

## 5. 需要修改的主要文件

### 5.1 服务端 runtime

- `server/internal/model/item.go`
- `server/internal/model/recipe.go`
- `server/internal/model/tech.go`
- `server/internal/model/event.go`
- `server/internal/gamecore/core.go`
- `server/internal/gamecore/rules.go`
- `server/internal/gamecore/stats_settlement.go`
- `server/internal/gamecore/save_state.go`
- `server/internal/gamedir/files.go`
- `server/internal/query/query.go`

### 5.2 场景配置

- `server/config.yaml`
- `server/config-dev.yaml`
- `server/config-midgame.yaml`

### 5.3 文档与参考配置

- `docs/player/玩法指南.md`
- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`
- `config/defs/items/combat/gravity_missile_set.yaml`

## 6. 建议实施顺序

### 第一阶段：先恢复 catalog 真实性

先做：

- `antimatter_capsule` / `gravity_missile` 的 item + recipe
- `TechUnlockUnit` runtime 校验
- `prototype` / `precision_drone` / `corvette` / `destroyer` 降级

这样能最快把“tech 在、unlock 丢失 / unit 假解锁”的问题清掉。

### 第二阶段：接入科技胜利

再做：

- `resolveVictory()`
- `victory_declared`
- `summary` / save / audit 扩展
- DSP 配置切到 `hybrid`

这一步会触及 core loop 和持久化，适合单独验证。

### 第三阶段：修能源摘要

最后做：

- 统一能源统计 helper
- `summary` / `stats` 回归测试

这部分建立在现有 power settlement 结果之上，和前两阶段耦合最小。

## 7. 测试设计

### 7.1 科技树与 catalog 一致性测试

至少覆盖：

- `mass_energy_storage` 能看到 `recipe: antimatter_capsule`
- `gravity_missile` 能看到 `recipe: gravity_missile`
- `antimatter_capsule` item 存在
- `gravity_missile` item 存在
- `antimatter_capsule` recipe 存在
- `gravity_missile` recipe 存在

### 7.2 `unit unlock` 降级测试

至少覆盖：

- `engine` 不再暴露假的 `unit unlock`
- `prototype.hidden = true`
- `precision_drone.hidden = true`
- `corvette.hidden = true`
- `destroyer.hidden = true`
- `corvette_attack_drone` 不再通过 tech unlock 对玩家暴露

### 7.3 科技胜利测试

至少覆盖：

1. `victory_rule = mission_complete`
   - 完成 `mission_complete` 后立即获胜
2. `victory_rule = hybrid`
   - `mission_complete` 与 `elimination` 任一满足都能产生 winner
3. `victory_rule = elimination`
   - 完成 `mission_complete` 不会误触发科技胜利
4. 事件 / 持久化 / 审计验证
   - 会出现 `victory_declared`
   - `/state/summary` 带有 `victory_reason`、`victory_rule`
   - save state 能恢复 `winner`、`victory_reason`、`victory_rule`
   - audit 中存在对应 `victory` 记录

### 7.4 能源统计一致性测试

至少覆盖一个包含以下元素的场景：

- `ray_receiver` 切到 `power`
- `energy_exchanger` 或 `accumulator` 接入同一电网
- 经过若干 tick 结算后对比：
  - `/world/planets/{planet_id}/networks`
  - `/state/summary`
  - `/state/stats`
  - `inspect building`

断言：

- `summary.energy_stats.generation == networks.supply 聚合`
- `stats.energy_stats.generation == summary.energy_stats.generation`
- `current_stored == inspect.energy_storage.energy 聚合`

## 8. 验收口径

实现完成后，应满足以下结果：

1. `mass_energy_storage` 与 `gravity_missile` 不再出现“tech 在、unlock 消失”。
2. `prototype` / `precision_drone` / `corvette` / `destroyer` 不再以“当前可玩单位科技”误导玩家。
3. `mission_complete` 不再只是装饰科技，而是真正能触发 `game_win`。
4. `/state/summary` 与 `/state/stats` 的能源摘要回到真实结算值。
5. 文档、catalog、运行时行为三者口径一致。

## 9. 结论

T093 的正确收口方式不是“把所有终局名词都硬做完”，而是：

- 对已经有运行时承载能力的内容，直接补成真：
  - 终局弹药
  - 科技胜利
  - 能源统计
- 对当前没有承载层的内容，明确降级：
  - 太空高阶单位线

这样改完后，当前版本至少能做到：

1. catalog 不再展示会凭空消失的终局 unlock。
2. `mission_complete` 具有真实胜利意义。
3. CLI / Web 看到的能源局势与真实电网一致。
4. 玩家不会再被“可见但不可玩”的 unit unlock 误导。
