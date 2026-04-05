# T101 设计方案：终局舰队线边界收口与太阳帆 authoritative runtime 修复

> 对应任务：`docs/process/task/T101_戴森深度试玩复测后终局舰队线仍未开放且太阳帆批量发射实体ID冲突.md`
>
> 日期：2026-04-05

## 0. 范围与输入

当前 `docs/process/task/` 下只剩 1 个未完成任务，即 T101。本方案只处理这两个仍未收口的问题：

1. 终局高阶舰队线 `prototype / precision_drone / corvette / destroyer` 当前仍未对玩家开放，仓库需要明确选定“真正开放”或“继续隐藏但口径统一”。
2. `launch_solar_sail --count >= 2` 时，太阳帆在同一玩家、同一 tick 内仍会生成重复 `entity_id`。

本方案基于以下事实来源，而不是历史结论：

- `server/internal/model/tech.go`
- `server/internal/model/entity.go`
- `server/internal/model/orbital_combat.go`
- `server/internal/query/catalog.go`
- `server/internal/gamecore/rules.go`
- `server/internal/gamecore/solar_sail_settlement.go`
- `server/internal/gamecore/dyson_sphere_settlement.go`
- `server/internal/gamecore/ray_receiver_settlement.go`
- `server/internal/gamecore/replay.go`
- `server/internal/gamecore/rollback.go`
- `server/internal/snapshot/snapshot.go`
- `shared-client/src/api.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/util.ts`

本轮基线校验结果：

- `server/` 下执行 `/home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model ./internal/gamecore ./internal/gateway`，通过。
- `client-cli/` 下执行 `npm test -- --runInBand`，通过。

## 1. 当前代码事实

### 1.1 终局舰队线当前不是“差一个开关”

当前仓库里和高阶舰队线相关的状态是割裂的：

- `server/internal/model/tech.go`
  - 原始科技定义仍保留了 `prototype`、`precision_drone`、`corvette`、`destroyer` 的 `TechUnlockUnit`。
  - 这 4 项科技同时又是 `Hidden: true`。
- `server/internal/model/tech.go` 的 `normalizeTechUnlocks()` / `runtimeSupportedUnitUnlocks()`
  - runtime 只保留 `logistics_drone`、`logistics_ship` 这类当前真正有 runtime 支撑的单位解锁。
  - 也就是说，玩家看到的 catalog 已经不是原始科技定义，而是被 normalize 过的一层结果。
- `server/internal/model/entity.go`
  - 公开 `UnitType` 只有 `worker`、`soldier`、`executor`。
  - `UnitStats()` 和 `UnitCost()` 也只覆盖当前这三类。
- `server/internal/gamecore/rules.go`
  - `execProduce()` 只接受 `worker` / `soldier`。
  - 产物直接写入 `ws.Units`，并在生产建筑相邻格出生，这是地表单位模型。
- `shared-client/src/api.ts`
  - `UnitTypeName` 仍是 `'worker' | 'soldier'`。
- `client-cli/src/commands/action.ts`
  - `UNIT_TYPES` 仍是本地硬编码集合，CLI 在本地直接拒绝 `corvette`。
- `client-cli/src/commands/util.ts`
  - `help produce` 也把公开口径硬编码成了 `worker/soldier`。
- `server/internal/model/orbital_combat.go`
  - 已存在 `SpaceFleet`、`FleetFormation`、`OrbitalPlatform` 等模型。
- `server/internal/gamecore/combat_settlement.go` 与 `server/internal/gamecore/orbital_settlement.go`
  - 已存在 `CombatUnitManager`、`OrbitalPlatformManager` 等 runtime 管理器。
  - 但这些 manager 是 `GameCore` 内存态，不进 snapshot/save/replay，也没有公开查询和命令闭环。

结论：

- 终局舰队线当前并没有“公开科技树 + 公开生产入口 + 公开部署/编队/查询入口 + 可回放战斗结果”这条闭环。
- 因此不能用“取消 hidden”或“放开 `produce corvette`”这种局部修改来宣称功能已实现。

### 1.2 太阳帆问题不只是 ID 拼接冲突

当前太阳帆链路的关键事实：

- `server/internal/gamecore/solar_sail_settlement.go`
  - 使用包级全局变量 `solarSailOrbits map[string]*model.SolarSailOrbitState`。
  - key 只有 `playerID`，没有 `systemID` 维度。
  - `LaunchSolarSail()` 的 ID 规则是 `sail-<playerID>-<launchTick>`。
- `server/internal/gamecore/rules.go`
  - `launch_solar_sail --count N` 在同一个命令、同一个 tick 内循环调用 `LaunchSolarSail(...)`。
  - 因为 `launchTick` 不变，所以同批次所有帆必然冲突。
- `server/internal/gamecore/ray_receiver_settlement.go`
  - 当前仍调用 `GetSolarSailEnergyForPlayer(playerID)`，说明太阳帆能量还是按玩家聚合，而不是按星系聚合。
- `server/internal/snapshot/snapshot.go`
  - 当前 snapshot 只保存多行星 `WorldState` 和 discovery。
  - 太阳帆 orbit state 不在 snapshot/save/replay/rollback 里。
- `server/internal/gamecore/replay.go` / `rollback.go`
  - 只恢复 `WorldState`，不会恢复包级全局 `solarSailOrbits`。

结论：

- 当前问题表面是 ID 冲突，实质是太阳帆属于“游离于 authoritative runtime 之外的全局状态”。
- 如果只把 ID 改成 `sail-<player>-<tick>-<index>`，虽然能消掉表面冲突，但 save/replay/rollback/system-scope 仍然不正确。

### 1.3 当前文档口径已经基本承认高阶舰队线未开放

现有文档已经大体统一为以下事实：

- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`

这些文档都已经说明：

- 高阶舰队线当前继续隐藏。
- `produce` 只支持 `worker / soldier`。
- 当前公开可玩的 DSP 科技树覆盖不包含这条线。

因此，本轮关于终局舰队线的重点不再是“大规模重写文档”，而是把代码、CLI、shared-client、catalog 和文档真正收口到同一真相来源。

## 2. 方案对比

### 2.1 方案 A：本轮继续隐藏舰队线，同时完成 authoritative 收口

做法：

- 终局高阶舰队线继续隐藏，不对玩家开放。
- 清理代码里残留的“伪公开”痕迹，建立 authoritative 的公开单位口径。
- 太阳帆迁入 snapshot-backed、system-scoped 的空间 runtime，并修复实体 ID 与生命周期一致性。

优点：

- 与当前实现真相一致。
- 能直接满足 T101 的验收要求。
- 不会把半成品的太空战/舰队模型包装成“已开放玩法”。

缺点：

- 玩家本轮仍然玩不到 `corvette / destroyer`。

### 2.2 方案 B：本轮真正开放终局舰队线

做法：

- 取消高阶科技隐藏。
- 补齐公开生产、部署、编队、查询、战斗、事件、回放、文档。
- 同时修复太阳帆 runtime。

优点：

- 玩家口径最完整。
- 后续不需要再维护“仍未开放”的边界说明。

缺点：

- 当前 `CombatUnitManager`、`OrbitalPlatformManager`、`SpaceFleet` 都不是 authoritative runtime。
- 当前没有任何公开的舰队查询、部署或回放闭环。
- 范围显著超出 T101 本身，会把“一个边界收口任务”膨胀成“完整太空战系统落地”。

### 2.3 方案 C：局部打补丁

典型做法：

- 只把 CLI allowlist 扩成 `corvette`。
- 只把太阳帆 ID 改成 `sail-<player>-<tick>-<index>`。
- 只改文档，不动服务端 authoritative 数据源。

不采用。

原因：

- 会制造新的多套真相来源。
- 不能通过 T101 对 API、CLI、服务端能力模型、事件、回放一致性的验收要求。
- 与项目“直接重构，不加兼容层”的准则冲突。

## 3. 最终决策

本方案采用方案 A 作为 T101 的正式收口路径：

1. 终局高阶舰队线本轮继续隐藏，但从服务端模型、catalog、shared-client、CLI、文档、测试上彻底收口为同一真实边界。
2. 太阳帆不做字符串补丁，直接迁入 top-level 的空间 authoritative runtime，保证 ID、事件、保存、恢复、回放一致。
3. “未来真正开放高阶舰队线”的完整蓝图会在本文单列，但不混入本轮必做范围。

## 4. 终局舰队线本轮收口设计

### 4.1 建立服务端 authoritative 的公开单位目录

本轮新增一份服务端 authoritative 的公开单位目录，作为玩家可见单位能力的唯一来源，避免以下分裂继续存在：

- 原始科技定义一套。
- normalize 后 catalog 一套。
- shared-client TS union 一套。
- CLI 本地 allowlist 一套。
- 文档再手写一套。

建议新增 `server/internal/model/unit_catalog.go`，定义：

```go
type UnitDomain string

const (
    UnitDomainGround UnitDomain = "ground"
    UnitDomainAir    UnitDomain = "air"
    UnitDomainSpace  UnitDomain = "space"
)

type UnitRuntimeClass string

const (
    UnitRuntimeClassWorld  UnitRuntimeClass = "world_unit"
    UnitRuntimeClassCombat UnitRuntimeClass = "combat_unit"
    UnitRuntimeClassFleet  UnitRuntimeClass = "fleet_unit"
)

type UnitCatalogEntry struct {
    ID           string           `json:"id"`
    Name         string           `json:"name"`
    Domain       UnitDomain       `json:"domain"`
    RuntimeClass UnitRuntimeClass `json:"runtime_class"`
    Public       bool             `json:"public"`
    Producible   bool             `json:"producible"`
    Commands     []string         `json:"commands,omitempty"`
    HiddenReason string           `json:"hidden_reason,omitempty"`
}
```

当前目录只需要 authoritative 地表达两类公开单位：

- `worker`
- `soldier`

明确不进公开目录的对象：

- `executor`
- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`
- `corvette_attack_drone`

这样做的目的不是“现在就实现未来单位”，而是先把“什么是公开能力”做成单一真相来源。

### 4.2 `/catalog` 新增 `units[]`

在 `server/internal/query/catalog.go` 的 `CatalogView` 中新增：

```go
type CatalogView struct {
    Buildings []BuildingCatalogEntry `json:"buildings,omitempty"`
    Items     []ItemCatalogEntry     `json:"items,omitempty"`
    Recipes   []RecipeCatalogEntry   `json:"recipes,omitempty"`
    Techs     []TechCatalogEntry     `json:"techs,omitempty"`
    Units     []UnitCatalogEntry     `json:"units,omitempty"`
}
```

`units[]` 只返回玩家当前公开可理解的单位目录，不返回隐藏单位，也不返回内部执行体。

本轮目标：

- `/catalog.units` 只包含 `worker`、`soldier`。
- `prototype / precision_drone / corvette / destroyer` 不出现在 `units[]` 中。
- `techs[].hidden` 继续保留为终局舰队线的 UI 边界。

这样，客户端和 CLI 不需要再从 `tech.unlocks` 的残留信息里猜“是不是应该支持某种单位”。

### 4.3 直接重构 `produce` 的公开能力边界

当前 `produce` 的真实语义是：

- 目标必须是地表生产建筑。
- 单位在建筑相邻格出生。
- 单位直接写入 `ws.Units`。

这只适用于当前公开地面单位，不适用于未来太空舰队单位。

因此本轮 `produce` 的 authoritative 规则应改为：

- 只接受公开单位目录里 `Producible=true` 且 `RuntimeClass=world_unit` 的单位。
- 不再在多个层面重复硬编码 `worker / soldier`。

对应改动：

- `server/internal/gamecore/rules.go`
  - `execProduce()` 改为查询 authoritative 单位目录，而不是 `switch utype`。
- `shared-client/src/api.ts`
  - `UnitTypeName` 不再承担“公开能力边界”的职责。
  - 直接改成 `string`，由服务端和 catalog 定义真实边界。
- `client-cli/src/commands/action.ts`
  - 删除本地 `UNIT_TYPES` allowlist。
  - CLI 不再本地拒绝 `corvette`；统一交给服务端返回 authoritative 错误。
- `client-cli/src/commands/util.ts`
  - `help produce` 不再写死 `worker/soldier`。
  - 当能拿到 `/catalog.units` 时，按运行期目录渲染。
  - 若未连接服务端，则退化为不枚举具体单位，只说明“生产当前公开地表单位”。

这样改完之后：

- 服务端、shared-client、CLI、本地帮助文案都会围绕同一份 authoritative `units[]`。
- 再也不会出现“tech 看起来有 unlock、CLI 本地又拦掉、服务端再返回另一种错误”的分裂状态。

### 4.4 高阶科技的原始定义直接表达“未开放”

当前 `server/internal/model/tech.go` 的原始科技定义仍保留了高阶单位 `TechUnlockUnit`，只是在 normalize 阶段被 runtime 过滤掉。

这种写法的坏处是：

- 原始数据在说“这里解锁单位”。
- runtime 输出又在说“这里没有公开单位解锁”。
- 维护者需要知道 normalize 规则，才知道哪一层才是真相。

本轮建议直接重构为：

- 保留 `prototype / precision_drone / corvette / destroyer` 的科技本体、成本、前置和 `Hidden: true`。
- 从原始 `Unlocks` 里移除这些 `TechUnlockUnit`。

这样做的好处：

- 原始定义、catalog 输出、CLI 边界、文档口径完全一致。
- `normalizeTechUnlocks()` 继续只承担“清理别名与无效引用”的职责，而不是承担“掩盖伪公开解锁”的职责。
- `server/internal/model/tech_alignment_test.go` 的断言会从“依赖 normalize 的间接行为”变成“原始定义本身就是真相”。

### 4.5 本轮关于高阶舰队线的测试与文档要求

测试至少补三层：

1. 服务端 catalog/tech 对齐
   - `/catalog.units` 只含当前公开单位。
   - `prototype / precision_drone / corvette / destroyer` 继续 `hidden=true`。
   - 这 4 项科技在原始定义中不再暴露 `TechUnlockUnit`。
2. `produce` 命令边界
   - `worker / soldier` 仍可正常生产。
   - `corvette` 等非公开单位会返回单一 authoritative 错误。
3. CLI 边界
   - `cmdProduce(['b-1', 'corvette'])` 不再被本地 allowlist 特判成另一套错误。
   - `help produce` 不再硬编码 `worker/soldier`，而是体现 authoritative 目录或 generic 文案。

文档同步：

- `docs/dev/服务端API.md`
  - 新增 `/catalog.units` 说明。
  - 明确高阶舰队线继续隐藏，不在当前公开单位目录内。
- `docs/dev/客户端CLI.md`
  - 说明 `produce` 以服务端公开单位目录为准。
- `docs/player/玩法指南.md`
  - 保留“高阶舰队线未开放”的说明。
- `docs/player/已知问题与回归.md`
  - 当前口径基本正确，只需跟随最终 API/CLI 语义微调。

## 5. 太阳帆 authoritative runtime 设计

### 5.1 新增 top-level `SpaceRuntimeState`

太阳帆不应继续挂在包级全局变量上。本轮新增 top-level 的空间 runtime 容器，由 `GameCore` 持有，并进入 snapshot/save/replay：

```go
type SpaceRuntimeState struct {
    EntityCounter int64                           `json:"entity_counter"`
    Players       map[string]*PlayerSpaceRuntime  `json:"players,omitempty"`
}

type PlayerSpaceRuntime struct {
    PlayerID string                           `json:"player_id"`
    Systems  map[string]*PlayerSystemRuntime  `json:"systems,omitempty"`
}

type PlayerSystemRuntime struct {
    SystemID       string                    `json:"system_id"`
    SolarSailOrbit *SolarSailOrbitState      `json:"solar_sail_orbit,omitempty"`
    Fleets         map[string]*SpaceFleet    `json:"fleets,omitempty"`
}
```

这里把 `Fleets` 一起预留出来，不是为了本轮开放高阶舰队线，而是避免未来再造一份新的空间 runtime 宿主。

### 5.2 `SpaceRuntimeState` 挂在 snapshot 顶层，而不是某个 planet world 内

太阳帆是星系级状态，不属于单个 `WorldState`。因此不能把它塞进某个 planet snapshot 里。

建议直接修改 `server/internal/snapshot/snapshot.go`：

```go
type Snapshot struct {
    Version        int                         `json:"version"`
    Tick           int64                       `json:"tick"`
    Timestamp      time.Time                   `json:"timestamp"`
    ActivePlanetID string                      `json:"active_planet_id,omitempty"`
    Players        map[string]*model.PlayerState `json:"players,omitempty"`
    PlanetWorlds   map[string]*WorldSnapshot   `json:"planet_worlds,omitempty"`
    World          *WorldSnapshot              `json:"world,omitempty"`
    Discovery      *mapstate.DiscoverySnapshot `json:"discovery,omitempty"`
    Space          *model.SpaceRuntimeState    `json:"space,omitempty"`
}
```

并直接重构这些调用链：

- `snapshot.CaptureRuntime(...)`
- `Snapshot.RestoreRuntime()`
- `GameCore.ExportSaveFile()`
- `GameCore.NewFromSave()`
- 自动 snapshot 保存
- replay / rollback 的快照恢复

目标是：太阳帆状态进入和 `PlanetWorlds` 同等级的 authoritative 保存面，而不是再依赖任何包级全局状态。

### 5.3 空间实体 ID 改由 runtime 分配

`SpaceRuntimeState` 提供统一的 ID 分配器：

```go
func (rt *SpaceRuntimeState) NextEntityID(prefix string) string
```

太阳帆发射时的规则改为：

- 每发射一张帆，都调用一次 `spaceRuntime.NextEntityID("sail")`。
- 典型 ID 形态：`sail-1`、`sail-2`、`sail-3`。

不再把 `playerID`、`tick` 拼进 ID 本体。

理由：

- 唯一性应该由 runtime 计数器保证，而不是由业务字段碰运气组合。
- 同一玩家、同一 tick、同一命令循环发射不会冲突。
- 保存和恢复后，只要 `EntityCounter` 一起恢复，后续 ID 仍然连续。

### 5.4 太阳帆轨道必须至少按 `player + system` 分桶

当前 orbit 只按 `playerID` 聚合，这对多星系扩展不成立。

本轮直接改成：

- `spaceRuntime.Players[playerID].Systems[systemID].SolarSailOrbit`

因此以下 API 也要一并重构：

- 删除 `GetSolarSailOrbit(playerID string)`
- 改成 `GetSolarSailOrbit(playerID, systemID string)`
- 删除 `GetSolarSailEnergyForPlayer(playerID string)`
- 改成 `GetSolarSailEnergy(playerID, systemID string)`

这一步虽然看起来超出“同 tick ID 唯一性”本身，但它和 ID 修复是同一个结构问题的两个表面：

- 一个是对象不能唯一定位。
- 另一个是能量不能唯一归属。

### 5.5 `GameCore`、save、replay、rollback 一起切到空间 runtime

`GameCore` 新增：

```go
type GameCore struct {
    ...
    spaceRuntime *model.SpaceRuntimeState
}
```

初始化与恢复要求：

- `New()` 时初始化空的 `SpaceRuntimeState`。
- `NewFromSave()` 时从 snapshot 恢复 `SpaceRuntimeState`。
- `ExportSaveFile()` 和自动快照时都要带上 `SpaceRuntimeState`。
- `Replay()`、`Rollback()` 不能只恢复 `WorldState`，也必须恢复 `SpaceRuntimeState`。
- live rollback 应直接替换 `gc.spaceRuntime`，而不是保留旧对象。

否则会出现新一轮错误：

- 行星世界回滚成功了，但太阳帆 orbit 还停留在旧 tick。
- `entity_created` / `entity_destroyed` 重新开始对不上。

### 5.6 发射、结算、事件的数据流

修复后的 authoritative 数据流应为：

1. `execLaunchSolarSail`
   - 校验建筑、库存、轨道参数。
   - 解析当前 `systemID`。
   - 每张帆都调用 `spaceRuntime.NextEntityID("sail")`。
   - 追加到 `player + system` 对应 orbit。
   - 每张帆各发一条 `entity_created`。
2. `settleSolarSails`
   - 遍历 `player -> system -> orbit`。
   - 计算寿命，移除到期帆。
   - 对每个到期帆发一条带同一 `entity_id` 的 `entity_destroyed`。
   - 重新计算该 orbit 的 `TotalEnergy`。
3. `snapshot/save`
   - 保存 `SpaceRuntimeState`、`EntityCounter`、各 orbit 成员和剩余寿命。
4. `restore/replay/rollback`
   - 恢复 orbit、实体 ID 和计数器。
   - 后续事件继续沿用恢复后的 authoritative ID。

### 5.7 射线接收站改按当前星系读取太阳帆能量

`server/internal/gamecore/ray_receiver_settlement.go` 当前做法是：

```go
availableDysonEnergy := GetSolarSailEnergyForPlayer(player.PlayerID) + GetDysonSphereEnergyForPlayer(player.PlayerID)
```

本轮至少要把太阳帆这一半改成：

- 由 `ws.PlanetID -> maps.Planet(...) -> systemID`
- 再读取 `GetSolarSailEnergy(playerID, systemID)`

关于戴森球能量，本轮不强制一起做系统级重构，但接口形态要为未来预留：

- 太阳帆部分先改成 system scope。
- 戴森球能量仍保持当前行为，但在文档里标记为后续空间 runtime 统一化的剩余技术债。

理由：

- T101 的直接问题是太阳帆实体与轨道状态。
- 如果本轮把戴森球能量也一起彻底改造，范围会明显扩大。
- 但至少不能继续让太阳帆停留在 player-only 语义。

### 5.8 replay digest 要覆盖空间 runtime

当前 `server/internal/gamecore/replay.go` 的 `digestWorld()` 只统计 `WorldState`：

- players
- buildings
- units
- resources
- `WorldState.EntityCounter`

如果本轮把太阳帆移入 top-level `SpaceRuntimeState`，但 digest 仍不包含空间态，replay 即使丢了太阳帆也可能误判为“无漂移”。

因此建议把 `ReplayDigest` 扩展为至少包含：

- `space_entity_counter`
- `solar_sail_count`
- `solar_sail_systems`
- `solar_sail_total_energy`

并在 `shared-client/src/types.ts` 同步更新对应类型。

### 5.9 本轮至少需要补的自动化测试

服务端至少补 5 类测试：

1. 同 tick 批量唯一性
   - 同一玩家、同一 tick、`launch_solar_sail --count 4`
   - orbit 内 4 张帆的 ID 全唯一
   - `entity_created` 中 4 个 `entity_id` 全唯一
2. 生命周期一致性
   - 帆到期后发出的 `entity_destroyed.entity_id` 必须能和创建事件逐一对应
3. save / restore 一致性
   - 发射后保存并恢复
   - orbit 中帆数量、ID、剩余寿命、space entity counter 保持一致
4. replay / rollback 一致性
   - replay 后 digest 包含空间态
   - rollback 后 live runtime 中 orbit 与目标 tick 一致
5. system scope
   - 不同 system 的太阳帆不串 orbit
   - 接收站只读取当前所在 system 的太阳帆能量

CLI 至少补 2 类测试：

1. `cmdProduce(['b-1', 'corvette'])` 不再本地 hard reject 为旧文案
2. `help produce` 不再写死 `worker/soldier`

## 6. 未来若要真正开放终局高阶舰队线

这一节不是 T101 本轮必做内容，而是为了防止以后再次把“半成品模型”包装成“已开放玩法”。

### 6.1 未来开放前必须先完成 authoritative runtime 迁移

未来真正开放前，至少要把以下对象迁入可保存、可回放、可查询的 authoritative runtime：

- `CombatUnitManager`
- `OrbitalPlatformManager`
- `SpaceFleet`
- 与舰队相关的 deployment / status / combat state

如果这一步没做完，就不能把高阶舰队线从 `hidden` 改成公开。

### 6.2 不继续滥用 `produce`

未来不建议直接把 `produce` 扩成 `produce corvette`。

原因：

- `produce` 当前语义是“地表建筑相邻格生成单位”。
- `corvette / destroyer` 是星系级或太空级实体，不属于地表格子实体。
- 即使 `prototype / precision_drone` 最终被建模为战斗单位，也不该混进当前地表 `ws.Units` 语义里。

未来更合理的公开命令面应拆成两段：

1. 制造载荷
   - 用现有生产建筑制造舰队单元或战斗中队载荷。
2. 部署/编队
   - 用专门命令把载荷转换为战斗 runtime 实体。

### 6.3 未来公开命令面的最小集合

真正开放时至少需要新增以下公开命令：

- `deploy_squad <base_id> <prototype|precision_drone> --count <n> [--planet <id>]`
- `commission_fleet <base_id> <corvette|destroyer> --count <n> --system <id>`
- `fleet_assign <fleet_id> <formation>`
- `fleet_move <fleet_id> <system_id|orbit_id>`
- `fleet_attack <fleet_id> <target_id>`
- `fleet_status [fleet_id]`

这些命令必须对应真实 runtime，而不是只做命令回显。

### 6.4 未来公开查询面的最小集合

真正开放时至少需要补以下查询和事件能力：

- `system` 或独立 `fleet` 视图中可见：
  - 舰队 ID
  - 所属玩家
  - 所在 system/orbit
  - 编队
  - 成员构成
  - 当前状态
- 事件流可见：
  - `entity_created`
  - `entity_updated`
  - `damage_applied`
  - `entity_destroyed`
- replay 能复盘：
  - 部署
  - 编队变化
  - 交战
  - 损毁

如果没有这些查询面和事件链路，就不能宣称舰队线“已开放可玩”。

### 6.5 未来开放的建议顺序

建议按以下顺序推进，而不是一次性全开：

1. 先把 combat/orbital/fleet runtime authoritative 化
2. 再开放部署命令和查询
3. 再实现基础编队与战斗结算
4. 最后取消高阶科技隐藏并更新玩家文档

## 7. 影响文件建议

本轮推荐方案至少会影响以下模块：

- 服务端模型
  - `server/internal/model/tech.go`
  - `server/internal/model/entity.go`
  - `server/internal/model/unit_catalog.go`（新增）
  - `server/internal/model/space_runtime.go`（新增）
  - `server/internal/model/solar_sail_orbit.go`
  - `server/internal/model/replay.go`
- 服务端查询与命令
  - `server/internal/query/catalog.go`
  - `server/internal/gamecore/core.go`
  - `server/internal/gamecore/rules.go`
  - `server/internal/gamecore/solar_sail_settlement.go`
  - `server/internal/gamecore/ray_receiver_settlement.go`
  - `server/internal/gamecore/replay.go`
  - `server/internal/gamecore/rollback.go`
  - `server/internal/gamecore/save_state.go`
- 快照与存档
  - `server/internal/snapshot/snapshot.go`
- shared-client / CLI
  - `shared-client/src/api.ts`
  - `shared-client/src/types.ts`
  - `client-cli/src/api.ts`
  - `client-cli/src/commands/action.ts`
  - `client-cli/src/commands/util.ts`
  - `client-cli/src/commands/action.test.ts`
  - `client-cli/src/commands/index.test.ts`
- 文档
  - `docs/dev/服务端API.md`
  - `docs/dev/客户端CLI.md`
  - `docs/player/玩法指南.md`
  - `docs/player/已知问题与回归.md`

## 8. 验收映射

本方案与 T101 验收标准的对应关系如下：

1. 终局高阶舰队线二选一
   - 本方案明确选“当前仍未实现，继续隐藏，并统一口径”。
2. `produce`、CLI 帮助、API 类型定义、服务端能力模型不再矛盾
   - 通过 authoritative 公开单位目录 + `/catalog.units` 统一真相来源。
3. 同一玩家、同一 tick 批量发射太阳帆时 ID 全唯一
   - 通过 `SpaceRuntimeState.NextEntityID("sail")` 保证唯一。
   - 通过 snapshot-backed runtime 保证创建、销毁、保存、恢复、回放一致。
4. 已验证可用链路不回退
   - `launch_solar_sail`、`build_dyson_*`、`launch_rocket`、`set_ray_receiver_mode` 等公开命令面保持不变，只直接重构底层 authoritative 数据宿主。

## 9. 推荐实施顺序

为避免再次做成“局部正确、整体割裂”，推荐按以下顺序实现：

1. 先收口高阶舰队线的公开边界
   - 建立 authoritative 单位目录
   - `/catalog.units`
   - 清理原始 tech unlock 残留
   - shared-client / CLI 去掉本地分裂口径
2. 再引入 `SpaceRuntimeState`
   - 先打通 snapshot/save/restore/replay/rollback
3. 再改太阳帆发射与寿命结算
   - `player + system` 分桶
   - 空间实体 ID
   - 事件一致性
4. 最后补测试和文档
   - 锁定边界
   - 锁定回放一致性
   - 锁定玩家文档口径
