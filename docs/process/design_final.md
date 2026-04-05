# T100 最终实现方案：终局高阶舰队线 authoritative 开放与公开玩法闭环

## 0. 输入与目标

本文输出一份单一定稿的最终实现方案，不继续并列保留 Claude / Codex 两套意见。

本次综合的输入为：

1. `docs/process/design_codex.md`
2. `docs/process/archive/20260405_101644/design_claude.md`
3. `docs/process/task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`
4. 当前仓库代码与现有文档口径

说明：

- 仓库当前不存在顶层 `docs/process/design_claude.md`。
- 因此本文以同主题、同一轮问题域下最新可用的 Claude 归档稿作为 Claude 输入源。

本文目标不是给出“短期先怎么描述”的文档口径，而是给出一套可以真正把 T100 做完的实现方案，并回答三个核心问题：

1. 终局高阶舰队线本轮到底是继续隐藏，还是按任务要求真实开放。
2. `produce` 是否应继续扩成高阶舰队单位入口。
3. 高阶舰队线应落在哪些 authoritative runtime、命令和查询面上，才能形成可验收的闭环。

## 1. 最终裁决

### 1.1 目标裁决

本方案最终选择：**真实开放终局高阶舰队线，而不是继续长期维持“未开放”口径。**

原因很直接：

1. `T100` 的核心要求就是补齐这条线的公开玩法闭环。
2. 如果最终结论仍是“继续隐藏”，那只能算临时止血，不是该任务的完成方案。
3. 当前仓库已经具备科技、工业、战斗、Dyson、系统视图等大量基础设施，缺的是 authoritative 的运行态承接与公开入口，而不是从零开始另做一套系统。

但这里的“真实开放”不是指一开始就把 `hidden=false` 打开，而是：

1. 先补完 authoritative runtime、生产载荷、部署命令、查询面和战斗结果。
2. 在全部链路可用前，科技与文档继续维持“未开放”口径。
3. 只有到 public cutover 阶段，才统一取消隐藏并对玩家公开。

### 1.2 `produce` 裁决

本方案明确选择：**不把 `produce` 扩成高阶舰队单位入口。**

`produce` 的最终语义必须收口为：

- 作用对象是建筑 ID；
- 仅用于在地表生产公开 `world_unit`；
- 当前和未来都不直接生产 `prototype / precision_drone / corvette / destroyer` 这类高阶战斗实体。

高阶舰队线改用：

- 工业侧先生产“单位载荷 item”；
- 再通过部署命令把 item 消耗成 runtime 实体。

这点采纳 Codex 稿，不采纳 Claude 稿里“直接放宽 `produce`”的实现方式。

### 1.3 运行态裁决

本方案明确选择：**高阶舰队线必须建立在 authoritative runtime 上，不接受临时 manager 或非持久态实现。**

具体原则：

1. `prototype / precision_drone` 落在行星战斗 runtime。
2. `corvette / destroyer` 落在星系空间 runtime。
3. query、事件、save、replay、rollback 读取同一份 runtime 状态。
4. 不允许再出现“命令成功了，但查询看不到 / 回放里没有 / 存档丢状态”的分裂实现。

## 2. 两份方案的综合取舍

### 2.1 采纳 Claude 稿的部分

Claude 稿有三点判断是对的，本文保留：

1. T100 不应再次收缩成纯文档口径问题，最终必须让玩家真的玩到高阶舰队线。
2. 高阶舰队线至少要覆盖：公开科技、生产、部署/编队、查询、战斗结果。
3. MVP 可以先做“同星系内对现有敌军模型产生真实可观察战斗结果”，不必等完整跨星系大战系统落地。

### 2.2 不采纳 Claude 稿的部分

Claude 稿以下实现方式不进入最终方案：

1. 直接取消隐藏并同步放宽 `produce`。
2. 把高阶单位直接塞进通用 `UnitType` / `ws.Units` / `ws.SpaceUnits`，继续沿用偏地表的实体模型。
3. 用“先生产单位，再用 `create_fleet` 把松散 unit IDs 编成舰队”作为主要公开路径。

原因是这些做法没有真正解决 `produce` 语义污染、runtime 宿主不清晰、查询与存档一致性不足的问题。

### 2.3 采纳 Codex 稿的部分

Codex 稿作为最终方案主体，采纳以下关键点：

1. 用 authoritative 单位目录统一公开能力边界。
2. 高阶舰队线使用“工业载荷 item + 部署命令生成 runtime 实体”的两段式模型。
3. 行星战斗与星系舰队分别落在不同 runtime 宿主中。
4. public cutover 必须放在最后一步。
5. `produce` 明确只保留给 `world_unit`。

### 2.4 对 Codex 稿的补充

本文在 Codex 稿基础上补两点，使其更适合直接进入实现：

1. 保留 Claude 稿对 MVP 范围的要求，不把目标退回“继续隐藏”，而是明确这次就是为了最终开放。
2. 在命令面上进一步收束，优先使用“部署即建队”的用户路径，避免先生成松散太空单位、再二次编组造成多源状态。

## 3. 最终推荐架构

### 3.1 authoritative 公开单位目录

新增服务端 authoritative 的单位能力目录，作为以下内容的唯一来源：

- `/catalog.units`
- `produce` 的合法性判断
- CLI `help produce`
- CLI 对高阶单位入口的提示
- 文档中的公开单位能力描述

建议模型：

```go
type UnitProductionMode string

const (
    UnitProductionModeWorldProduce UnitProductionMode = "world_produce"
    UnitProductionModeFactoryRecipe UnitProductionMode = "factory_recipe"
    UnitProductionModeInternal      UnitProductionMode = "internal"
)

type UnitCatalogEntry struct {
    ID             string             `json:"id"`
    Name           string             `json:"name"`
    Domain         UnitDomain         `json:"domain"`
    RuntimeClass   UnitRuntimeClass   `json:"runtime_class"`
    Public         bool               `json:"public"`
    VisibleTechID  string             `json:"visible_tech_id,omitempty"`
    ProductionMode UnitProductionMode `json:"production_mode"`
    ProducerRecipes []string          `json:"producer_recipes,omitempty"`
    DeployCommand  string             `json:"deploy_command,omitempty"`
    QueryScopes    []string           `json:"query_scopes,omitempty"`
    Commands       []string           `json:"commands,omitempty"`
    HiddenReason   string             `json:"hidden_reason,omitempty"`
}
```

最终公开语义应收口为：

| 单位 | RuntimeClass | ProductionMode | 公开生产入口 | 公开部署入口 | 查询面 |
|------|--------------|----------------|--------------|--------------|--------|
| `worker` | `world_unit` | `world_produce` | `produce` | 无 | `planet` |
| `soldier` | `world_unit` | `world_produce` | `produce` | 无 | `planet` |
| `prototype` | `combat_squad` | `factory_recipe` | 工厂配方 | `deploy_squad` | `planet_runtime` |
| `precision_drone` | `combat_squad` | `factory_recipe` | 工厂配方 | `deploy_squad` | `planet_runtime` |
| `corvette` | `fleet_unit` | `factory_recipe` | 工厂配方 | `commission_fleet` | `system_runtime` / `fleet` |
| `destroyer` | `fleet_unit` | `factory_recipe` | 工厂配方 | `commission_fleet` | `system_runtime` / `fleet` |

约束：

1. `/catalog.units` 直接由这份目录生成。
2. CLI 不能再手写另一套单位 allowlist。
3. 文档里对“公开可玩单位”的描述必须以该目录为准。

### 3.2 科技与研究边界

科技处理分两步：

1. 在真正开放前，`prototype / precision_drone / corvette / destroyer` 继续 `hidden=true`。
2. `start_research` 必须先补“隐藏科技不可直接研究”的 authoritative 校验，堵住手输 ID 穿透边界的问题。

public cutover 条件全部满足后，再统一执行：

1. 将 4 项科技改为 `hidden=false`。
2. 恢复 `/catalog.techs` 中可见的单位解锁关系。
3. 同步公开 `/catalog.units` 中对应的高阶单位条目。

这一步必须是发布闸门，而不是开发一开始就执行。

### 3.3 runtime 宿主

#### 3.3.1 行星战斗 runtime

新增 `CombatRuntimeState`，持久化以下内容：

- 每个行星上的 `CombatSquad`
- 轨道平台运行态
- 战斗实体计数器

用途：

1. 取代当前临时 `CombatUnitManager` 的真相来源地位。
2. 让 `prototype / precision_drone` 的状态进入 snapshot、save、replay、rollback。
3. 让查询层可以直接读取 squad 状态。

#### 3.3.2 星系空间 runtime

扩展 `SpaceRuntimeState`，让 `Fleets` 变成真实可持久化状态，而不是占位字段。

建议舰队实体最少包含：

- `fleet_id`
- `owner_id`
- `system_id`
- `source_building_id`
- `formation`
- `state`
- `units`
- `target`

约束：

1. `corvette / destroyer` 只进入 `SpaceRuntimeState`。
2. 不把舰队成员再映射回地表 `ws.Units`。
3. 不允许舰队运行依赖“当前 activeWorld 才会 tick”。

#### 3.3.3 结算位置调整

`core.go` 的 tick 结算需要调整为：

1. 行星 squad 结算在 world/planet 循环里执行。
2. 星系 fleet 结算在 system scope 上执行。
3. 不允许未来舰队线因为玩家没切到对应星球而静止。

### 3.4 生产模型：载荷 item，而不是直接产出舰队实体

将以下 4 个高阶单位 authoritative 化为可制造 item：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

它们在工业阶段是 item，不是 world unit。

推荐生产入口：

| 载荷 item | 推荐建筑 |
|-----------|----------|
| `prototype` | `assembling_machine_mk2` |
| `precision_drone` | `assembling_machine_mk3` |
| `corvette` | `recomposing_assembler` |
| `destroyer` | `recomposing_assembler` |

这样做的收益：

1. 完全复用现有工业、配方、物流、转运体系。
2. 不再为舰队线发明第二套“直接产单位”的特例。
3. 玩家可以真实经历研究、制造、转运、部署的链路。

### 3.5 部署枢纽与命令面

`battlefield_analysis_base` 作为部署枢纽，而不是生产建筑。

需要扩展能力：

1. 具备本地存储。
2. 具备 deployment module。
3. 可以通过 `transfer` 装入高阶载荷 item。
4. 部署命令只从该建筑本地存储扣除载荷。

最小公开命令集采用 Codex 稿这一组：

1. `deploy_squad <building_id> <prototype|precision_drone> --count <n> [--planet <id>]`
2. `commission_fleet <building_id> <corvette|destroyer> --count <n> --system <id> [--fleet <fleet_id>]`
3. `fleet_assign <fleet_id> <line|vee|circle|wedge>`
4. `fleet_attack <fleet_id> <planet_id> <target_id>`
5. `fleet_disband <fleet_id>`

命令语义：

- `deploy_squad`
  - 扣除载荷 item；
  - 在目标行星 runtime 中生成 squad。
- `commission_fleet`
  - 扣除载荷 item；
  - 在目标 system runtime 中创建或补充舰队。
- `fleet_assign`
  - 只改变编队和状态，不引入第二套编队数据源。
- `fleet_attack`
  - MVP 先支持同星系内对指定行星敌军目标发起 orbital strike。
- `fleet_disband`
  - 解散 runtime 舰队；
  - 不返还载荷 item，避免刷实体。

### 3.6 `produce` 的最终语义

`produce <building_id> <unit_type>` 最终只承担当前公开 world unit 的生产。

服务端行为应统一为：

1. `worker / soldier` 按既有 world unit 逻辑处理。
2. 对公开但非 `world_produce` 的单位，返回 authoritative 引导错误，例如：
   `unit corvette is not produced via produce; use commission_fleet`
3. 对隐藏或不存在的单位，返回统一 validation 错误。

这样可以一次性解决 T100 要求中的“统一 `produce` 玩家入口语义”。

### 3.7 查询面

最小查询闭环应包含三类入口：

1. 行星 runtime：
   - `GET /world/planets/{planet_id}/runtime`
   - 新增 `combat_squads[]`、`orbital_platforms[]`
2. 星系 runtime：
   - `GET /world/systems/{system_id}/runtime`
   - 返回 `fleets[]`、`solar_sail_orbit`、`dyson_summary`
3. 舰队明细：
   - `GET /world/fleets`
   - `GET /world/fleets/{fleet_id}`

CLI 至少补：

- `fleet_status [fleet_id] [--system <id>]`

要求是玩家不需要依赖 SSE 猜测当前舰队状态。

### 3.8 战斗结算与可观察结果

#### 3.8.1 行星 squad

`prototype / precision_drone` 走行星战斗 runtime：

1. 复用现有 `combat_unit` 伤害、护盾、武器结构。
2. MVP 目标先只接现有 `EnemyForces`。
3. 结果同步到 planet runtime、SSE 事件和敌军状态变化。

#### 3.8.2 星系 fleet

`corvette / destroyer` 走 `SpaceRuntimeState`：

1. MVP 先支持同一 `system_id` 下对指定 `planet_id` 的敌军目标实施 orbital strike。
2. 伤害模型复用 `WeaponState` / `ShieldState`，但不复用地表 tile 距离。
3. 结果反映到 `system runtime`、`fleet detail`、目标 planet 的敌军变化以及 SSE。

#### 3.8.3 事件

新增事件建议：

- `squad_deployed`
- `fleet_commissioned`
- `fleet_assigned`
- `fleet_attack_started`
- `fleet_disbanded`

同时继续复用：

- `entity_created`
- `damage_applied`
- `entity_destroyed`

原则：

1. 事件 ID 必须来自 authoritative runtime。
2. 事件、查询、回放读取同一份实体状态。

## 4. 实施阶段

### 阶段 1：runtime authoritative 化

完成内容：

1. 新增 `CombatRuntimeState`。
2. 扩展 `SpaceRuntimeState.Fleets`。
3. 接入 snapshot、save、restore、replay、rollback。
4. 研究入口补 hidden gate。

阶段要求：

- 4 项高阶科技继续 `hidden=true`。
- 玩家文档继续写“未开放”。

### 阶段 2：工业载荷与部署命令

完成内容：

1. 高阶单位 item/recipe authoritative 化。
2. `battlefield_analysis_base` 增加本地存储与 deployment module。
3. `deploy_squad` / `commission_fleet` / `fleet_assign` / `fleet_attack` / `fleet_disband` 接入命令分发。

阶段要求：

- 仍不公开 4 项科技。
- `produce` 已完成新语义收口。

### 阶段 3：查询与战斗闭环

完成内容：

1. `planet runtime` / `system runtime` / `fleet detail` 查询完成。
2. squad / fleet 战斗结算完成。
3. 事件流、save、replay、rollback 验证完成。

阶段要求：

- 仍不公开 4 项科技。
- 先用测试和真实 playtest 证明闭环成立。

### 阶段 4：public cutover

只有同时满足以下条件，才允许公开：

1. 研究可以真实推进。
2. 载荷可以真实生产。
3. 部署命令可用。
4. 查询能稳定看到实体。
5. 战斗结果和事件可观察。
6. save / replay / rollback 不丢状态。

然后统一执行：

1. `hidden=false`
2. `/catalog.units` 公开 4 个高阶单位条目
3. CLI 帮助改写为正式玩家口径
4. 玩家和开发文档改写为“已开放”

## 5. 测试与验收设计

### 5.1 边界测试

1. `start_research prototype` 在公开前不能穿透 hidden gate。
2. `produce b-1 worker`、`produce b-1 soldier` 行为不回退。
3. `produce b-1 corvette` 在 cutover 后返回统一引导错误，而不是旧式模糊报错。

### 5.2 生产与部署测试

1. 研究 `prototype` 后，对应 recipe 在 catalog 可见。
2. 真实工厂能生产 `prototype` 载荷。
3. `transfer` 能把载荷装入 `battlefield_analysis_base`。
4. `deploy_squad` 后 `planet runtime` 能看到 squad。
5. `commission_fleet` 后 `system runtime` 能看到 fleet。

### 5.3 战斗与查询测试

1. `fleet_assign` 后 `fleet_status` 能看到编队变化。
2. `fleet_attack` 后目标 enemy force 强度下降。
3. SSE 能看到 `damage_applied` / `entity_destroyed`。
4. `planet runtime`、`system runtime`、`fleet detail` 三处状态一致。

### 5.4 持久化测试

1. save 后 restore，squad / fleet 仍存在。
2. replay 中能看到 squad / fleet 相关状态。
3. rollback 后 runtime 恢复到历史状态。

### 5.5 回归测试

必须继续回归 T100 已明确“不要再重复记录缺失”的既有链路：

- `orbital_collector`
- `vertical_launching_silo`
- `em_rail_ejector`
- `ray_receiver`
- `jammer_tower`
- `sr_plasma_turret`
- `planetary_shield_generator`
- `self_evolution_lab`
- `energy_exchanger`
- `artificial_star`
- `recomposing_assembler`
- `pile_sorter`
- `advanced_mining_machine`
- `build_dyson_*`
- `launch_solar_sail`
- `launch_rocket`
- `set_ray_receiver_mode`

高阶舰队线改造不能造成这些现有中后期与戴森主链回退。

## 6. 文档同步要求

当 API 与 CLI 行为发生变化后，必须同步更新：

- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`

同步原则：

1. `produce` 只负责 world unit。
2. 高阶舰队线明确写成“研究 -> 生产载荷 -> 部署 -> 查询/战斗”的两段式。
3. 在 phase 4 完成前，所有玩家侧文档都必须继续明确“未开放”。
4. phase 4 完成后，再统一改写为“已开放”。

## 7. 影响文件建议

建议重点影响以下模块：

### 7.1 服务端模型

- `server/internal/model/tech.go`
- `server/internal/model/unit_catalog.go`
- `server/internal/model/item.go`
- `server/internal/model/recipe.go`
- `server/internal/model/command.go`
- `server/internal/model/space_runtime.go`
- 新增 `server/internal/model/combat_runtime.go`
- `server/internal/model/building_defs.go`
- `server/internal/model/building_runtime.go`

### 7.2 服务端 gamecore / query / gateway

- `server/internal/gamecore/core.go`
- `server/internal/gamecore/research.go`
- `server/internal/gamecore/rules.go`
- 新增 `server/internal/gamecore/deployment_commands.go`
- 新增 `server/internal/gamecore/combat_runtime_settlement.go`
- 新增 `server/internal/gamecore/space_fleet_settlement.go`
- `server/internal/query/catalog.go`
- `server/internal/query/query.go`
- 新增 `server/internal/query/fleet_runtime.go`
- `server/internal/gateway/server.go`
- `server/internal/snapshot/snapshot.go`

### 7.3 shared-client / CLI

- `shared-client/src/types.ts`
- `shared-client/src/api.ts`
- `client-cli/src/api.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/util.ts`
- `client-cli/src/commands/index.ts`
- 相关 CLI tests

## 8. 不在本轮范围内

本方案明确不把以下内容设为 T100 前置：

- `client-web` 的舰队线可视化页面
- 跨星系舰队迁移 / warp 航线
- 玩家对玩家完整太空战争平衡
- `destroyer` 自动释放附属攻击无人机的复杂 AI
- 轨道轰炸与多层协同指挥的完整体系

这些可以在高阶舰队线公开后继续演进，但不应该阻塞 T100 的最小可玩闭环。

## 9. 最终建议

这次不应再做成“取消隐藏 + 改 help 文案”的表层修补，也不应继续把任务压回“暂未开放”的文档口径。

唯一推荐路径是：

1. 先把 combat / fleet runtime authoritative 化。
2. 再把高阶单位做成真实工业载荷。
3. 再开放部署命令、查询和战斗。
4. 最后统一执行 public cutover。

这样综合后，既保留了 Claude 稿对“任务最终必须真实开放”的目标要求，也采纳了 Codex 稿对“必须先修 runtime 与能力边界、不能污染 `produce`”的架构路线。只有按这条路推进，`T100` 才能从“终局高阶舰队线仍未开放”真正转入完成状态。
