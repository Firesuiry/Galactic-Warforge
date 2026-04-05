# T100 设计方案：终局高阶舰队线开放与公开玩法闭环（Codex）

> 对应任务：`docs/process/task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`
>
> 当前 `docs/process/task/` 下只有这一项未完成任务。本设计只覆盖这一个问题，不再混入已经从当前任务文件移除的太阳帆或其他历史问题。

## 1. 设计结论

这次不再采用“继续隐藏并统一文档口径”的收口方案。

原因很直接：

1. 这条线已经再次留在 `task/`，说明“只维持未开放口径”不能算问题解决。
2. 当前真正缺的不是一个 `hidden=false` 开关，而是整条公开玩法链路。
3. 如果继续把 `produce`、`/catalog`、CLI 帮助和战斗 runtime 分开修，会再次得到“局部可见、整体不可玩”的伪闭环。

本方案推荐的唯一正式实现路径是：

1. 保留 `produce` 的现有语义，只负责地表 `world_unit`。
2. 终局高阶舰队线改成“工业制造载荷 + 部署命令生成 runtime 实体”的两段式公开模型。
3. 先把行星战斗 runtime 和星系舰队 runtime 迁入 authoritative、可存档、可回放的宿主，再最后取消 `prototype / precision_drone / corvette / destroyer` 的隐藏状态。

也就是说，**真正的公开动作放在最后一步**。在此之前，文档仍应维持“未开放”口径，避免再次出现半开放状态。

## 2. 当前代码事实

当前仓库里，与这条线直接相关的真实状态如下。

### 2.1 科技层

- `server/internal/model/tech.go`
  - `prototype`
  - `precision_drone`
  - `corvette`
  - `destroyer`
  仍然都是 `Hidden: true`。
- `/catalog.techs` 当前会返回这些科技，只是带 `hidden=true`。
- `server/internal/gamecore/research.go` 当前 `start_research` 只校验前置和材料，不校验 `Hidden`。也就是说，玩家只要知道 ID，就可能手动启动隐藏科技。这是现有“公开边界”仍然不干净的证据。

### 2.2 单位目录与 `produce`

- `server/internal/model/unit_catalog.go`
  - `/catalog.units` 当前 authoritative 公开目录只有 `worker`、`soldier`。
- `server/internal/gamecore/rules.go` 的 `execProduce`
  - 现在已经不再本地写死 `worker/soldier`；
  - 但它只接受 `PublicProducibleWorldUnitByID()` 返回的公开地表单位。
- `server/internal/model/building_defs.go`
  - 当前只有 `assembling_machine_mk1` 暴露了 `CanProduceUnits: true`；
  - 这进一步说明 `produce` 语义就是“在地表生产建筑旁边生成 world unit”，并不适合承载舰队线。

### 2.3 行星 / 太空运行态

- `server/internal/model/space_runtime.go`
  - 已经存在 snapshot-backed 的 `SpaceRuntimeState`；
  - 当前主要承载 `SolarSailOrbit`；
  - `Fleets` 只是占位数据结构，没有公开命令、查询和结算。
- `server/internal/gamecore/combat_settlement.go`
  - `CombatUnitManager` 仍是 `GameCore` 持有的临时 manager，不在快照里；
  - 当前没有玩家可达命令去生成这些战斗单位。
- `server/internal/gamecore/orbital_settlement.go`
  - `OrbitalPlatformManager` 也是临时 manager，不在快照里。
- `server/internal/gamecore/core.go`
  - 战斗相关结算目前只对 `activeWorld` 执行；
  - 对未来“多行星可部署 squad / 轨道单位 / 星系舰队”的公开玩法来说，这是结构性缺口。

### 2.4 查询面

- `server/internal/query/query.go`
  - `SystemView` 目前只包含恒星和行星静态视图；
  - 不包含舰队、轨道单位或 system runtime。
- `PlanetRuntimeView` 当前只暴露物流、施工、敌军探测等运行态；
  - 没有公开的 combat squad / orbital platform 视图。

### 2.5 现有配置素材

- `config/defs/items/combat/` 下已经有：
  - `prototype.yaml`
  - `precision_drone.yaml`
  - `corvette.yaml`
  - `destroyer.yaml`
  - `attack_drone.yaml`
- 但这些文件现在还不是服务端 authoritative item/recipe/runtime 的真实来源，只能作为 ID 与命名参考，不能直接当成“已经实现”。

## 3. 方案比较

### 3.1 方案 A：继续隐藏，只统一“未开放”口径

优点：

- 改动最小。
- 风险最低。
- 能快速避免夸大表述。

缺点：

- 不能完成 `task` 中“补齐公开玩法闭环”的核心目标。
- 问题仍然要继续留在 `docs/process/task/`。
- 只是再次延后，不是解决。

结论：不选。

### 3.2 方案 B：直接取消隐藏，并把 `produce` 放宽到高阶单位

优点：

- 表面上最短路径。
- 可以快速让 `catalog` 与 CLI 看起来“支持更多单位”。

缺点：

- `produce` 现有语义是地表建筑相邻格生成 world unit，本身就不适合 `corvette / destroyer`。
- `CombatUnitManager`、`OrbitalPlatformManager` 仍不是 authoritative runtime。
- `SystemView`、回放、存档、事件流都还没有舰队线的公开可观察结果。
- 会再次制造“科技可见、命令可发、但玩法不是真实闭环”的伪实现。

结论：不选。

### 3.3 方案 C：两段式公开舰队线，最后再做 public cutover

核心思想：

1. 工业系统先制造“单位载荷 item”。
2. 部署命令再把 item 消耗成 authoritative runtime 实体。
3. 行星战斗和星系舰队分别落在各自的 authoritative runtime 宿主。
4. 当且仅当研究、制造、部署、查询、战斗、回放都成立时，才把 4 项科技取消隐藏并对玩家公开。

优点：

- 语义清晰，不污染 `produce`。
- 和现有工业 / 物流 / transfer / building local storage 体系一致。
- 可自然满足任务要求中的“生产入口、部署/编队入口、轨道/星系级查询入口、可观察战斗结果”。
- 能把未来舰队线继续扩展到更高阶体系，而不必再推倒重来。

缺点：

- 范围最大。
- 需要先做 runtime authoritative 化。

结论：采用方案 C。

## 4. 推荐架构

### 4.1 公开能力模型：把“单位是什么、怎么产、怎么部署、去哪查”收口成单一真相来源

当前 `UnitCatalogEntry` 只有 `domain / runtime_class / producible / commands`，对舰队线不够。

推荐把它扩成真正的公开能力目录：

```go
type UnitProductionMode string

const (
    UnitProductionModeWorldProduce UnitProductionMode = "world_produce"
    UnitProductionModeFactoryRecipe UnitProductionMode = "factory_recipe"
    UnitProductionModeInternal UnitProductionMode = "internal"
)

type UnitCatalogEntry struct {
    ID               string           `json:"id"`
    Name             string           `json:"name"`
    Domain           UnitDomain       `json:"domain"`
    RuntimeClass     UnitRuntimeClass `json:"runtime_class"`
    Public           bool             `json:"public"`
    VisibleTechID    string           `json:"visible_tech_id,omitempty"`
    ProductionMode   UnitProductionMode `json:"production_mode"`
    ProducerRecipes  []string         `json:"producer_recipes,omitempty"`
    DeployCommand    string           `json:"deploy_command,omitempty"`
    QueryScopes      []string         `json:"query_scopes,omitempty"`
    Commands         []string         `json:"commands,omitempty"`
    HiddenReason     string           `json:"hidden_reason,omitempty"`
}
```

推荐的公开目录语义如下：

| 单位 | Domain | RuntimeClass | ProductionMode | 公开生产入口 | 公开部署入口 | 查询面 |
|------|--------|--------------|----------------|--------------|--------------|--------|
| `worker` | `ground` | `world_unit` | `world_produce` | `produce` | 无 | `planet` |
| `soldier` | `ground` | `world_unit` | `world_produce` | `produce` | 无 | `planet` |
| `prototype` | `air` | `combat_squad` | `factory_recipe` | 通用生产配方 | `deploy_squad` | `planet_runtime` |
| `precision_drone` | `air` | `combat_squad` | `factory_recipe` | 通用生产配方 | `deploy_squad` | `planet_runtime` |
| `corvette` | `space` | `fleet_unit` | `factory_recipe` | 通用生产配方 | `commission_fleet` | `system_runtime` / `fleet` |
| `destroyer` | `space` | `fleet_unit` | `factory_recipe` | 通用生产配方 | `commission_fleet` | `system_runtime` / `fleet` |

约束：

1. `/catalog.units` 直接由这份目录生成。
2. CLI `help produce`、`help deploy_squad`、`help commission_fleet` 都从这份目录衍生。
3. `produce` 只接受 `production_mode == world_produce` 且 `runtime_class == world_unit` 的条目。
4. 以后如果再新增舰队单位，不能绕过这份目录去分别改服务端、CLI、shared-client。

### 4.2 科技与研究：先修公开边界，再做最终公开

#### 4.2.1 研究入口要先堵上隐藏科技穿透

在 `server/internal/gamecore/research.go` 增加“公开可研究科技”判定：

- 默认玩家只能 `start_research` 公开科技；
- `hidden=true` 的科技不能再靠手输 ID 研究；
- 内部测试或 bootstrap 如需直接授予，继续走现有 grant / config 逻辑，不复用公开命令。

这样可以避免在功能尚未落地时，玩家通过 `start_research prototype` 提前穿透边界。

#### 4.2.2 4 项科技的公开顺序

这 4 项科技不在基础 runtime 改造完成前提前公开：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

推荐切换规则：

1. phase 1-3 未完成时：
  - 继续 `hidden=true`
  - `/catalog.units` 不公开
  - 文档继续写“未开放”
2. phase 4 全部完成且测试通过后：
  - 改成 `hidden=false`
  - 恢复 `/catalog.techs[].unlocks` 对应的单位解锁
  - `/catalog.units` 同步公开

这一步是**发布闸门**，不是开发初始动作。

### 4.3 运行态宿主：把战斗相关 manager 迁入 authoritative runtime

#### 4.3.1 新增 `CombatRuntimeState`

`SpaceRuntimeState` 已经是 authoritative 的，但行星战斗和轨道平台仍是临时 manager。

推荐新增并持久化：

```go
type CombatRuntimeState struct {
    EntityCounter int64                          `json:"entity_counter"`
    Planets       map[string]*PlanetCombatRuntime `json:"planets,omitempty"`
}

type PlanetCombatRuntime struct {
    PlanetID          string                       `json:"planet_id"`
    Squads            map[string]*CombatSquad     `json:"squads,omitempty"`
    OrbitalPlatforms  map[string]*OrbitalPlatform `json:"orbital_platforms,omitempty"`
}

type CombatSquad struct {
    ID               string         `json:"id"`
    ArchetypeID      string         `json:"archetype_id"`
    OwnerID          string         `json:"owner_id"`
    PlanetID         string         `json:"planet_id"`
    SourceBuildingID string         `json:"source_building_id"`
    Position         Position       `json:"position"`
    State            string         `json:"state"`
    HP               int            `json:"hp"`
    MaxHP            int            `json:"max_hp"`
    Shield           ShieldState    `json:"shield"`
    Weapon           WeaponState    `json:"weapon"`
    AmmoInventory    int            `json:"ammo_inventory"`
}
```

作用：

1. 取代 `CombatUnitManager` 的临时状态。
2. 取代 `OrbitalPlatformManager` 的临时状态。
3. 进入 save / restore / replay / rollback。
4. 能被 query 层公开读取。

#### 4.3.2 扩展 `SpaceRuntimeState`

`SpaceRuntimeState` 保留 top-level system-scope 宿主角色，但 `Fleets` 需要真正落地：

```go
type FleetUnitInstance struct {
    ID          string      `json:"id"`
    ArchetypeID string      `json:"archetype_id"`
    HP          int         `json:"hp"`
    MaxHP       int         `json:"max_hp"`
    Shield      ShieldState `json:"shield"`
    Weapon      WeaponState `json:"weapon"`
    Ammo        int         `json:"ammo"`
}

type FleetTarget struct {
    PlanetID     string `json:"planet_id,omitempty"`
    EnemyForceID string `json:"enemy_force_id,omitempty"`
    FleetID      string `json:"fleet_id,omitempty"`
}

type SpaceFleet struct {
    ID               string                       `json:"id"`
    OwnerID          string                       `json:"owner_id"`
    SystemID         string                       `json:"system_id"`
    SourceBuildingID string                       `json:"source_building_id"`
    Formation        FormationType                `json:"formation"`
    State            string                       `json:"state"`
    Units            map[string]*FleetUnitInstance `json:"units,omitempty"`
    Target           *FleetTarget                 `json:"target,omitempty"`
}
```

约束：

1. `corvette / destroyer` 只进入 `SpaceRuntimeState`，不落进 `ws.Units`。
2. `prototype / precision_drone` 只进入 `CombatRuntimeState`，不滥用 `ws.Units`。
3. `GameCore` 不再自己持有独立的战斗 manager 作为真相来源，而是只保留薄 wrapper。

#### 4.3.3 Tick 结算位置要调整

当前 `core.go` 只在 `activeWorld` 上结算 `settleCombat()` / `settleOrbitalCombat()` / `settleDroneControl()`。

真正开放后，推荐改成：

1. 行星 combat runtime 在 `sortedWorlds()` 循环里按 planet 结算。
2. system fleet runtime 在 worlds 循环外按 system 结算。
3. 不允许舰队线依赖“当前活动星球”才能更新。

否则，多星球部署和星系舰队一公开就会出现静止或不可回放的问题。

### 4.4 生产模型：不扩 `produce`，改成“制造载荷 item”

#### 4.4.1 把 4 个高阶单位先做成真实可制造 item

推荐把以下 ID 正式纳入 `server/internal/model/item.go` 和 `recipe.go` 的 authoritative 定义：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

它们不是地表 `UnitType`，而是**部署前的工业载荷 item**。

推荐生产路径：

| 载荷 item | 推荐生产建筑 | 公开 tech |
|-----------|--------------|-----------|
| `prototype` | `assembling_machine_mk2` | `prototype` |
| `precision_drone` | `assembling_machine_mk3` | `precision_drone` |
| `corvette` | `recomposing_assembler` | `corvette` |
| `destroyer` | `recomposing_assembler` | `destroyer` |

这样做的理由：

1. 和现有工业生产体系兼容；
2. 不需要再发明第二套“单位制造专用命令”；
3. 玩家可通过已有 `build ... --recipe ...`、物流、`transfer` 完成真实生产准备；
4. `produce` 不被污染。

#### 4.4.2 `battlefield_analysis_base` 变成部署枢纽，不是生产机

`battlefield_analysis_base` 当前已有 combat 建筑身份，但没有部署 runtime。

推荐扩展它：

1. 增加本地存储；
2. 增加 deployment module；
3. 支持 `transfer` 把高阶载荷 item 装入建筑；
4. 部署命令只从该建筑本地存储扣物品。

这样和现有 `launch_solar_sail` / `launch_rocket` 的交互方式一致，玩家语义清晰。

### 4.5 公开命令面

#### 4.5.1 现有 `produce` 的最终语义

`produce <building_id> <unit_type>` 继续保留，但只服务当前公开的 world unit。

推荐服务端行为：

1. `worker / soldier`
  - 正常按当前逻辑处理。
2. 对公开但非 `world_produce` 的单位（未来如 `corvette`）：
  - 返回 authoritative 引导错误；
  - 例如：`unit corvette is not produced via produce; use commission_fleet`
3. 对隐藏或不存在的单位：
  - 继续返回统一的 validation 错误。

这样可以一次性收口“`produce` 到底作用于什么目标”的玩家语义。

#### 4.5.2 新增命令

最小公开命令集如下：

1. `deploy_squad <building_id> <prototype|precision_drone> --count <n> [--planet <id>]`
2. `commission_fleet <building_id> <corvette|destroyer> --count <n> --system <id> [--fleet <fleet_id>]`
3. `fleet_assign <fleet_id> <line|vee|circle|wedge>`
4. `fleet_attack <fleet_id> <planet_id> <target_id>`
5. `fleet_disband <fleet_id>`

对应命令语义：

- `deploy_squad`
  - 从基地本地存储扣除 `prototype` 或 `precision_drone` item；
  - 在目标 planet combat runtime 中生成 squad。
- `commission_fleet`
  - 从基地本地存储扣除 `corvette` 或 `destroyer` item；
  - 在目标 `system_id` 的 `SpaceRuntimeState` 中创建或增补舰队。
- `fleet_assign`
  - 只改编队与 runtime 状态，不产生第二套队形数据源。
- `fleet_attack`
  - 先支持同一星系内对目标行星敌军的 orbital strike；
  - 后续如新增 enemy fleet，可沿同一 target 结构扩展。
- `fleet_disband`
  - 把 runtime 中的舰队实体拆散并释放状态；
  - 不自动返还 item，避免无损刷实体。

#### 4.5.3 Command / API 层改动

需要同步更新：

- `server/internal/model/command.go`
  - 新增 command type 常量。
- `server/internal/gamecore/core.go`
  - 增加命令分发。
- `server/internal/gateway/server.go`
  - 增加 payload 校验。
- `shared-client/src/types.ts`
  - 扩命令联合类型。
- `shared-client/src/api.ts`
  - 增加新的客户端方法。
- `client-cli`
  - 增加命令解析、帮助文本和输出格式。

### 4.6 查询面

#### 4.6.1 行星运行态

扩展 `GET /world/planets/{planet_id}/runtime`：

- `combat_squads[]`
- `orbital_platforms[]`
- `combat_alerts[]`（可选）

这样 `prototype / precision_drone` 的部署和战斗结果可以直接在 planet runtime 看见。

#### 4.6.2 星系运行态

新增 `GET /world/systems/{system_id}/runtime`：

```json
{
  "system_id": "sys-1",
  "fleets": [...],
  "solar_sail_orbit": {...},
  "dyson_summary": {...}
}
```

要求：

1. 这不是静态 `SystemView` 的替代，而是 runtime 补充视图。
2. 舰队线公开后，玩家必须能从这里看见：
  - 舰队 ID
  - 所属玩家
  - 编队
  - 成员构成
  - 当前状态
  - 当前目标

#### 4.6.3 舰队明细

新增：

- `GET /world/fleets`
- `GET /world/fleets/{fleet_id}`

CLI 则新增：

- `fleet_status [fleet_id] [--system <id>]`

这样既满足“轨道 / 星系级单位查询入口”，也避免玩家只能靠 SSE 盲猜状态。

### 4.7 战斗结算与可观察结果

#### 4.7.1 行星 squad

`prototype / precision_drone` 走 planet combat runtime：

1. 使用现有 `combat_unit.go` 的伤害、护盾、武器结构；
2. 目标先只接现有 `EnemyForces`；
3. 结算结果反映到：
  - `planet runtime`
  - SSE `damage_applied`
  - SSE `entity_destroyed`
  - 对应敌军数量 / 强度变化

#### 4.7.2 星系 fleet

`corvette / destroyer` 走 `SpaceRuntimeState`：

1. MVP 先支持对同一 `system_id` 下指定 `planet_id` 的 `EnemyForce` 做 orbital strike；
2. 伤害模型复用 `WeaponState` / `ShieldState`，但空间距离按 system/orbit 规则简化，不复用地表 tile 距离；
3. 结果反映到：
  - `system runtime`
  - `fleet detail`
  - 目标 planet 上的 enemy force 变化
  - SSE `damage_applied` / `entity_destroyed`

这样即使当前仓库还没有完整的 enemy fleet，也能用现有敌军模型交付“真实可观察的高阶舰队战斗结果”。

#### 4.7.3 事件

推荐新增事件：

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

1. 事件 payload 里的实体 ID 必须来自 authoritative runtime；
2. query、save/replay、事件三者用同一份实体状态；
3. 不允许再出现“命令成功了，但 query 看不到 / replay 不存在”的分裂行为。

### 4.8 `corvette_attack_drone` 的处理

当前任务文件要求的公开目标只有：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

因此本轮推荐：

1. `corvette_attack_drone` 不作为玩家公开目录条目；
2. 如需给 `destroyer` 增加附属无人机，作为 destroyer 的内部 child archetype 处理；
3. 只有当其拥有独立公开生产、部署、查询语义时，才进入 `/catalog.units`。

这样可以避免再次出现“目录里多了一个名字，但玩家没有入口”的旧问题。

## 5. 发布闸门：真正开放前，先维持“未实现”口径

这一条不是保守，而是为了防止再次把半成品包装成已实现。

推荐把实施过程拆成 4 个阶段：

### 阶段 1：runtime authoritative 化

- 新增 `CombatRuntimeState`
- 扩展 `SpaceRuntimeState.Fleets`
- 接入 save / restore / replay / rollback
- `prototype / precision_drone / corvette / destroyer` 继续 `hidden=true`
- 文档继续明确“未开放”

### 阶段 2：工业载荷与部署命令

- item / recipe 真正接入 authoritative catalog
- `battlefield_analysis_base` 增加 deployment runtime
- 新命令接入
- 仍然不公开 4 项科技

### 阶段 3：查询与战斗闭环

- `planet runtime` / `system runtime` / `fleet detail` 查询完成
- squad / fleet 战斗和事件闭环完成
- 回放验证完成
- 仍然不公开 4 项科技

### 阶段 4：public cutover

只有当以下条件同时成立，才允许改成公开：

1. 研究可以真实推进；
2. 载荷可以真实生产；
3. 部署命令可用；
4. query 能看到实体；
5. 战斗结果和事件可观察；
6. save / replay / rollback 不丢状态。

然后再统一做：

- `hidden=false`
- `/catalog.units` 公开
- CLI 帮助更新
- 玩家文档改写为“已开放”

在这之前，所有玩家文档都必须继续维持：

> 这条高阶舰队线当前仍未开放，不能宣称 DSP 终局玩法已完整实现。

## 6. 测试设计

### 6.1 基础边界测试

1. 隐藏科技不能通过 `start_research` 直接穿透。
2. `produce b-1 worker`、`produce b-1 soldier` 行为不回退。
3. `produce b-1 corvette` 在公开 cutover 后返回单一 authoritative 引导错误，而不是旧式模糊报错。

### 6.2 生产与部署测试

1. 研究 `prototype` 后，对应 recipe 出现在公开 catalog。
2. 通过真实工厂把 `prototype` item 生产出来。
3. `transfer` 把载荷装入 `battlefield_analysis_base`。
4. `deploy_squad` 消耗载荷并在 `planet runtime` 里出现 squad。
5. `commission_fleet` 消耗载荷并在 `system runtime` 里出现 fleet。

### 6.3 战斗与查询测试

1. `fleet_assign` 后 `fleet_status` 能看到 formation 变化。
2. `fleet_attack` 后目标 enemy force 强度下降。
3. SSE 能看到 `damage_applied` / `entity_destroyed`。
4. `planet runtime` / `system runtime` / `fleet detail` 三处状态一致。

### 6.4 持久化测试

1. save 后 restore，squad / fleet 仍存在。
2. replay digest 包含 squad / fleet 统计。
3. rollback 后 runtime 恢复到历史状态。

### 6.5 回归测试

必须继续回归当前任务文件已明确“不要重复记录缺失”的既有链路：

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

要求是不因舰队线改造发生回退。

## 7. 文档同步要求

真正开放 cutover 发生后，必须同步更新：

- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`

同步原则：

1. `produce` 明确只负责 world unit。
2. 高阶舰队线明确写成“生产载荷 + 部署命令”的两段式。
3. 只在 phase 4 完成后，才允许把高阶舰队线从“未开放”改成“已开放”。

## 8. 影响文件建议

推荐会涉及以下模块。

### 8.1 服务端模型

- `server/internal/model/tech.go`
- `server/internal/model/unit_catalog.go`
- `server/internal/model/item.go`
- `server/internal/model/recipe.go`
- `server/internal/model/command.go`
- `server/internal/model/space_runtime.go`
- 新增 `server/internal/model/combat_runtime.go`
- `server/internal/model/building_defs.go`
- `server/internal/model/building_runtime.go`

### 8.2 服务端 gamecore / query / gateway

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

### 8.3 shared-client / CLI

- `shared-client/src/types.ts`
- `shared-client/src/api.ts`
- `client-cli/src/api.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/util.ts`
- `client-cli/src/commands/index.ts`
- 相关 CLI tests

## 9. 验收映射

与当前任务文件的验收项对应如下。

### 验收 1

> `/catalog.techs` 中 `prototype / precision_drone / corvette / destroyer` 不再只是隐藏名词，玩家可以通过公开科技树看到并推进这条线。

对应设计：

- phase 4 cutover 时取消隐藏；
- 研究入口改成公开科技 authoritative 校验；
- 只有 runtime 与部署链路完成后才公开。

### 验收 2

> `/catalog.units` 与 CLI / API 中存在与这条线一致的公开入口，不再只剩 `worker / soldier`。

对应设计：

- 扩展 `UnitCatalogEntry`；
- `/catalog.units` 公开 4 个高阶单位条目；
- CLI 帮助按 `production_mode` 和 `deploy_command` 正确展示入口。

### 验收 3

> 玩家能通过公开命令真实完成至少一条高阶单位链路：研究、生产、部署 / 查询、看到实际战斗或可观察运行结果。

对应设计：

- `build ... --recipe ...` 生产载荷；
- `deploy_squad` / `commission_fleet` 部署；
- `planet runtime` / `system runtime` / `fleet detail` 查询；
- `fleet_attack` / squad combat 产生真实事件和结果。

### 验收 4

> `produce` 的目标语义、帮助文本、错误口径与文档完全一致。

对应设计：

- `produce` 永远只做 world unit；
- 高阶单位统一引导到部署命令；
- CLI 和文档不再把 `produce` 当成舰队线入口。

### 验收 5

> 本轮已确认可用的中后期建筑与戴森主链不能回退。

对应设计：

- 将现有 midgame / Dyson 命令链路列入强制回归集；
- 舰队线改造不碰现有戴森公开命令的外部语义。

## 10. 不在本轮范围内

本设计明确不把以下内容当成 T100 必须项：

- `client-web` 的舰队线可视化页面
- 跨星系舰队迁移与 warp 航线系统
- 玩家对玩家的完整太空战争平衡
- `destroyer` 自动释放附属攻击无人机的复杂 AI
- 轨道轰炸、地面协同、多层指挥点系统

这些都可以在高阶舰队线公开之后继续演进，但不应成为本轮最小可玩闭环的前置条件。

## 11. 最终建议

本任务不应该再做成“改几个 help 文案 + 取消隐藏”的表层修补。

推荐的落地顺序是：

1. 先把 combat / orbital / fleet runtime authoritative 化。
2. 再把高阶单位做成真实工业载荷。
3. 再开放部署命令、查询和战斗。
4. 最后统一把科技树、`/catalog.units`、CLI 和文档切到公开状态。

这样完成后，`docs/process/task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md` 才能真正从“未实现问题”转入完成记录，而不是再次被文档口径临时压住。
