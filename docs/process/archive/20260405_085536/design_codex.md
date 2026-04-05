# T100 设计方案：终局舰队线口径收口与太阳帆实体 ID authoritative 唯一化

## 1. 文档目标

本方案只处理 `docs/process/task/T100_戴森深度试玩后终局舰队线仍未开放且太阳帆批量发射实体ID冲突.md` 中仍未收口的两件事：

1. 终局高阶舰队线当前到底按“继续隐藏并统一口径”处理，还是按“真正开放完整玩法”处理。
2. 太阳帆在同一玩家、同一 tick、批量发射时的 `entity_id` 冲突，以及它背后的 runtime 一致性问题。

若无额外指定，本方案采用推荐路径：

- 本轮按“继续隐藏并彻底收口”处理 `prototype / precision_drone / corvette / destroyer`。
- 同时把“未来真正开放”的完整蓝图写清楚，但不把它混进本轮必做范围。
- 太阳帆问题不做字符串级补丁，而是直接改成可存档、可回放、可扩展的 authoritative runtime 方案。

明确不做的事：

- 不通过“只改 CLI 帮助文案”来伪装功能已收口。
- 不通过“只在当前 ID 后面拼一个循环下标”来掩盖太阳帆 runtime 结构问题。
- 不新增兼容 wrapper 或 adapter；直接重构到新的 authoritative 数据来源。

## 2. 当前代码事实

### 2.1 终局舰队线当前不是“差一个开关”，而是整条公开玩法线没有闭环

当前仓库里与高阶舰队线相关的状态是割裂的：

- `server/internal/model/tech.go`
  - `prototype`、`precision_drone`、`corvette`、`destroyer` 仍存在原始科技定义。
  - 科技定义仍保留了 `TechUnlockUnit` 痕迹，但实际 catalog 暴露依赖 normalize 过滤。
  - `Hidden: true` 已经打开，说明现在的真实口径其实是“未开放”。
- `server/internal/model/tech.go:1715` 附近
  - `runtimeSupportedUnitUnlocks()` 当前只保留物流无人机/货船，不包含这条舰队线。
  - 说明服务端 runtime 已经在用“只有 runtime backed 的单位才算公开解锁”这个原则。
- `shared-client/src/api.ts`
  - `UnitTypeName` 仍是硬编码 `'worker' | 'soldier'`。
- `client-cli/src/commands/action.ts`
  - `UNIT_TYPES` 仍是硬编码集合，CLI 本地直接拒绝 `corvette`。
- `server/internal/model/entity.go`
  - 公开 `UnitType` 仍只有 `worker / soldier / executor`。
- `server/internal/model/combat_unit.go`
  - 已有 `CombatUnit`、`WeaponState`、`ShieldState` 等战斗模型。
- `server/internal/model/orbital_combat.go`
  - 已有 `SpaceFleet`、`FleetFormation`、`OrbitalPlatform` 等模型。
- `server/internal/gamecore/combat_settlement.go`
  - 已有 `CombatUnitManager`，但它是 `GameCore` 内存态，不进 snapshot/save。
- `server/internal/gamecore/orbital_settlement.go`
  - 已有 `OrbitalPlatformManager` 与 `settleFleetFormation()` 骨架，但同样不进 snapshot/save。

结论：

- 现在仓库里存在“战斗/轨道/编队半成品模型”。
- 但这些模型还没有接到玩家侧的公开生产、部署、查询、编队、战斗闭环上。
- 因此不能通过“把 `produce` 放开到 corvette”这类局部修改声称功能已实现。

### 2.2 太阳帆问题表面是 ID 冲突，实质是空间运行态没有 authoritative 宿主

当前太阳帆链路的关键事实：

- `server/internal/gamecore/solar_sail_settlement.go`
  - 使用包级全局变量 `solarSailOrbits map[string]*model.SolarSailOrbitState`。
  - key 只有 `playerID`，没有 `systemID` 维度。
  - `LaunchSolarSail()` 的 ID 生成规则是 `sail-<playerID>-<launchTick>`。
- `server/internal/gamecore/rules.go`
  - `launch_solar_sail --count N` 在同一个命令、同一个 tick 内循环调用 `LaunchSolarSail(...)`。
  - 因为 `launchTick` 不变，所以同批次所有帆天然冲突。
- `server/internal/gamecore/ray_receiver_settlement.go`
  - 太阳帆能量读取仍是 `GetSolarSailEnergyForPlayer(playerID)`。
  - 这意味着太阳帆当前还是“按玩家聚合”，不是“按星系聚合”。
- `server/internal/snapshot`
  - `WorldSnapshot` 只捕获 world/buildings/units/logistics/resources 等。
  - 太阳帆 orbit state 不在 snapshot/save/replay 里。

结论：

- 当前冲突不是单纯的字符串拼接 bug。
- 当前太阳帆还是一个游离于 authoritative 存档/回放体系之外的全局运行态。
- 如果只把 ID 改成 `sail-<player>-<tick>-<i>`，同一批次冲突会消失，但 save/replay/多星系扩展仍然脆弱。

## 3. 方案对比

### 3.1 方案 A：本轮继续隐藏舰队线，并补齐 authoritative 收口

做法：

- 终局舰队线继续隐藏，不对玩家开放。
- 删除代码里仍会误导人的“伪公开”痕迹，统一到一个 authoritative 的公开单位口径。
- 太阳帆改成 snapshot-backed 的空间运行态，保证实体 ID 唯一且生命周期一致。

优点：

- 与当前仓库真实实现最一致，范围可控。
- 可以直接满足 T100 的验收口径。
- 不会把未落地的终局太空战半成品包装成“已经可玩”。

缺点：

- 不能让玩家本轮就玩到 `corvette / destroyer`。

### 3.2 方案 B：本轮真正开放终局舰队线

做法：

- 公开科技树。
- 补齐高阶单位的生产、部署、编队、查询、战斗、事件、文档。
- 同时修复太阳帆 runtime。

优点：

- 玩家口径最完整。
- 以后不需要再写“仍未开放”的边界说明。

缺点：

- 范围远大于 T100 表面上展示的缺口。
- 当前 `CombatUnitManager`、`OrbitalPlatformManager`、`SpaceFleet` 都还不是 authoritative runtime。
- 若强行并入本轮，极易做成“命令可输、状态不可查、战斗不可回放”的伪闭环。

### 3.3 方案 C：局部放开或局部补丁

典型做法：

- 只把 CLI 的 `worker/soldier` allowlist 扩成 `corvette/destroyer`。
- 只把太阳帆 ID 改成 `sail-<player>-<tick>-<i>`。
- 只改文档，不改 API 和测试。

不采用。

原因：

- 这会制造第三套真相。
- 与项目“直接重构，不写兼容层”的准则冲突。
- 无法通过 T100 对 API、CLI、事件、回放一致性的验收要求。

## 4. 最终决策

本方案采用方案 A 作为 T100 的正式收口方案：

1. 终局高阶舰队线本轮继续隐藏，并把服务端、CLI、shared-client、文档、测试统一到同一口径。
2. 太阳帆实体改为 authoritative 空间运行态分配 ID，彻底消除同 tick 批量冲突。
3. 未来若要真正开放舰队线，按本文第 7 节的完整蓝图另起实现，不在当前“隐藏收口”方案上打补丁。

## 5. 终局舰队线本轮收口设计

### 5.1 建立单一公开单位口径，替代当前分散硬编码

本轮需要新增一份 authoritative 的“公开单位目录”，避免以下分裂继续存在：

- 服务端 tech normalize 一套。
- `shared-client` TypeScript union 一套。
- CLI 本地 allowlist 一套。
- 文档手写再来一套。

建议在服务端模型层新增：

```go
type PublicUnitDomain string

const (
    PublicUnitDomainGround   PublicUnitDomain = "ground"
    PublicUnitDomainAir      PublicUnitDomain = "air"
    PublicUnitDomainSpace    PublicUnitDomain = "space"
)

type UnitCatalogEntry struct {
    ID             string           `json:"id"`
    Name           string           `json:"name"`
    Domain         PublicUnitDomain `json:"domain"`
    Public         bool             `json:"public"`
    Producible     bool             `json:"producible"`
    Deployable     bool             `json:"deployable"`
    QueryScopes    []string         `json:"query_scopes,omitempty"`
    HiddenReason   string           `json:"hidden_reason,omitempty"`
}
```

设计要求：

- `CatalogView` 新增 `units[]`，由服务端 authoritative 生成。
- `units[]` 只返回玩家当前可见、可解释的单位定义。
- `executor` 属于内部执行体，不进 `units[]`。
- `prototype / precision_drone / corvette / destroyer` 在本轮不进 `units[]`。
- CLI 帮助与本地校验以后都从 `units[]` 或服务端校验结果推导，不再维护独立常量表。

### 5.2 `produce` 命令继续只服务当前公开地面单位

`produce` 当前的真实语义是：

- 目标必须是 `CanProduceUnits` 的地面生产建筑。
- 单位在建筑相邻格生成。
- 命令直接消耗玩家资源，并写入 `ws.Units`。

这个语义只适合当前公开的地面单位，不适合 `corvette / destroyer` 这类太空舰队实体。

因此本轮收口要求是：

- `produce` authoritative 只接受当前公开地面单位。
- CLI 不再在代码里硬编码 `worker / soldier` 文案，而是从 authoritative 目录渲染。
- shared-client 的 `cmdProduce` 入参不再把“公开单位范围”写死在 TS union 上；以服务端为准。

对应直接重构：

- `shared-client/src/api.ts`
  - `UnitTypeName` 不再承担“公开单位边界”职责。
- `client-cli/src/commands/action.ts`
  - 删除本地 `UNIT_TYPES` allowlist，改为透传到服务端或基于运行期 catalog 校验。
- `client-cli/src/commands/util.ts`
  - `help produce` 文案由 authoritative 公开单位目录生成。
- `server/internal/gamecore/rules.go`
  - `execProduce()` 从 authoritative 公开单位目录判断是否可生产。

### 5.3 终局科技定义必须直接表达“未开放”，不再依赖 normalize 隐藏半真相

当前 `prototype / precision_drone / corvette / destroyer` 的问题之一是：

- 原始 `tech.go` 仍写了 unit unlock。
- 但 catalog 最终结果靠 normalize 把它们裁掉。

这会给后续维护者造成错觉：代码里明明“解锁了单位”，为什么玩家就是不能玩。

本轮应直接重构为：

- `prototype / precision_drone / corvette / destroyer`
  - 保留科技定义与前置关系。
  - 保留 `Hidden: true`。
  - 从原始科技定义里删除 `TechUnlockUnit`。
- `engine`
  - 继续作为前置科技，不宣称解锁高阶作战单位。

这样做的好处：

- 原始定义、catalog、CLI、文档都表达同一个事实。
- 不需要继续依赖“normalize 后才看起来正确”的隐式规则。

### 5.4 文档与测试收口

文档要同步到同一口径：

- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- 任何仍宣称“DSP 相关科技树/玩法都已实现”的现状文档

测试要锁死三类事实：

1. 玩家公开能力边界
   - `/catalog.units` 只返回当前公开单位。
   - `/catalog.techs` 中高阶舰队线继续 `hidden=true`。
   - 高阶舰队相关 tech 不再暴露 unit unlock。
2. CLI 口径
   - `help produce` 只展示当前公开单位。
   - 直接输入 `corvette` 时，不再由本地常量表和服务端返回两套矛盾错误。
3. 文档/API 一致性
   - 服务端 API 文档明确当前不开放这条线。
   - CLI 文档不再暗示存在 `deploy destroyer` 一类命令。

## 6. 太阳帆 authoritative runtime 设计

### 6.1 新增 `SpaceRuntimeState`，给空间实体一个可存档的宿主

太阳帆不应继续挂在包级全局变量里。本轮新增一个专门承载空间运行态的 runtime 容器：

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
    SystemID        string                `json:"system_id"`
    SolarSailOrbit  *SolarSailOrbitState  `json:"solar_sail_orbit,omitempty"`
    Fleets          map[string]*SpaceFleet `json:"fleets,omitempty"`
}
```

设计要求：

- `GameCore` 持有 `spaceRuntime`。
- `snapshot.Snapshot` 或等价 runtime save payload 新增 `SpaceRuntimeState` 持久化。
- `launch_solar_sail`、太阳帆寿命结算、未来的 `SpaceFleet` 都从这里取状态。
- 不再使用 `solarSailOrbits` 这种包级全局 map。

这样做的直接收益：

- 太阳帆生命周期进入 save/replay。
- 同一份空间运行态可以为未来舰队线复用。
- 后续不会再出现“命令成功了，但重载后所有轨道实体丢失”的隐性问题。

### 6.2 太阳帆 ID 改为 runtime 分配，不再依赖 tick 拼接

`SpaceRuntimeState` 提供统一的空间实体分配器：

```go
func (rt *SpaceRuntimeState) NextEntityID(prefix string) string
```

太阳帆发射时的规则改为：

- 每发射一张帆，都调用一次 `spaceRuntime.NextEntityID("sail")`。
- 生成结果示例：`sail-1`、`sail-2`、`sail-3`。
- 不再把 `playerID` 和 `tick` 编进 ID 本体。

原因：

- 唯一性由 runtime 计数器保证，而不是由业务字段碰运气组合。
- save/restore 后只要 `EntityCounter` 一起恢复，后续 ID 仍连续且不冲突。
- 事件、回放、可视化、审计都只依赖稳定实体 ID。

### 6.3 太阳帆 orbit key 必须至少细化到 `player + system`

当前 orbit 只按 `playerID` 聚合，这对多星系扩展天然不成立。

本轮直接改成：

- `PlayerSpaceRuntime.Systems[systemID]` 维度存放 orbit。
- `GetSolarSailOrbit(playerID, systemID)` 替代现有只按玩家查询的入口。
- `settleSolarSails()` 遍历 `player -> system -> orbit`。

这一步虽然超出 T100 文案表面，但它是把同一个 bug 修到位所必需的结构调整：

- 否则太阳帆虽然 ID 唯一了，能量归属仍然是按玩家混算。
- 未来一旦多星系同时存在太阳帆，接收站收益会串系统。

### 6.4 射线接收站改按当前星系读取太阳帆能量

与 orbit key 调整配套，`settleRayReceivers()` 也必须同步改语义：

- 当前逻辑：
  - `GetSolarSailEnergyForPlayer(playerID)`
- 新逻辑：
  - 先通过 `ws.PlanetID -> maps.Planet(...) -> systemID`
  - 再读取 `GetSolarSailEnergy(playerID, systemID)`

本轮只要求太阳帆按 system scope authoritative 化。

对戴森球能量可以先保持现状，但接口形态要预留成同样的 system scope，避免以后再做一次大改：

```go
GetSolarSailEnergy(playerID, systemID string) int
GetDysonSphereEnergy(playerID, systemID string) int
```

即使暂时只把太阳帆先改完，也不要把新接口继续做成“只按 player 聚合”。

### 6.5 发射、结算、事件、回放的数据流

修复后的 authoritative 流程应为：

1. `execLaunchSolarSail`
   - 校验建筑、库存、轨道参数。
   - 解析当前 `systemID`。
   - 对每张太阳帆分配唯一 `entity_id`。
   - 追加到 `spaceRuntime.players[playerID].systems[systemID].solar_sail_orbit.sails`。
   - 发出一条 `entity_created` 事件，payload 中的 `entity_id` 与 orbit 内成员完全一致。
2. `settleSolarSails`
   - 按当前 tick 计算寿命衰减。
   - 到期帆从 orbit 中移除。
   - 为每张到期帆发出带同一 `entity_id` 的 `entity_destroyed`。
   - 重新计算 orbit `TotalEnergy`。
3. `snapshot/save`
   - 一并持久化 `SpaceRuntimeState`。
4. `restore/replay`
   - 恢复 orbit 内实体及 `EntityCounter`。
   - 后续事件继续沿用恢复后的 authoritative ID。

### 6.6 本轮最少需要补的自动化测试

服务端至少补四类测试：

1. 同 tick 批量唯一性
   - 同一玩家、同一 tick、`launch_solar_sail --count 4`
   - orbit 中 4 张帆的 `ID` 全唯一
   - 4 条 `entity_created` 的 `entity_id` 全唯一
2. 生命周期一致性
   - 到期销毁时 `entity_destroyed.payload.entity_id` 必须能一一对应创建时的 ID
3. save/restore 一致性
   - 发射后保存并恢复
   - orbit 内帆数量、ID、剩余寿命、`EntityCounter` 都保持一致
4. system scope
   - 不同 system 的太阳帆不互相串 orbit
   - 接收站只读取自己所在 system 的太阳帆能量

## 7. 若未来选择“真正开放终局舰队线”的完整蓝图

这一节不是 T100 本轮必须实现的内容，而是后续正式开放时必须遵守的边界，避免再次走到“半开放”状态。

### 7.1 不继续滥用 `produce`，改成“制造单位载荷 + 部署命令”两段式

不建议把 `produce` 直接扩成 `produce corvette`，原因是它的现有语义与太空舰队不匹配：

- `produce` 当前是地面建筑相邻格生成。
- `corvette / destroyer` 是星系级或太空级实体，不属于地面格子实体。
- `prototype / precision_drone` 也更接近战斗中队，而不是裸露在地表的普通 `ws.Units`。

更合理的未来设计是：

1. 制造阶段
   - 新增单位载荷物品/配方，由现有生产建筑制造。
   - 例如：原型机单元、精准无人机单元、护卫舰模块、驱逐舰模块。
2. 部署阶段
   - 通过 `battlefield_analysis_base` 或未来的专用舰队中枢执行部署。
   - 命令负责把库存中的单位载荷转换为 runtime 实体。

这样能把“生产闭环”和“战斗 runtime”解耦。

### 7.2 未来公开舰队线的 authoritative 数据模型

真正开放时，建议新增单位原型目录：

```go
type CombatArchetypeID string

type CombatArchetype struct {
    ID               CombatArchetypeID `json:"id"`
    Domain           string            `json:"domain"`            // ground | air | space
    RuntimeClass     string            `json:"runtime_class"`     // combat_unit | fleet_unit
    LaunchSlotCost   float64           `json:"launch_slot_cost"`  // corvette=0.25
    CommandPointCost int               `json:"command_point_cost"`// destroyer=4
    ChildArchetypes  []string          `json:"child_archetypes,omitempty"`
}
```

建议对应参考语义：

- `prototype`
  - 地面/空中作战中队入口，至少支持“+1 地面中队”的公开可观察结果。
- `precision_drone`
  - 空中高精度打击单位，归入 planetary combat runtime。
- `corvette`
  - 太空战斗单位，每 4 艘占 1 发射槽。
- `destroyer`
  - 太空战斗单位，每艘占 4 指挥点。
- `corvette_attack_drone`
  - 由 `destroyer` 解锁并随舰出现的附属单位。

### 7.3 未来公开舰队线需要的新命令面

真正开放时至少需要以下玩家可用命令：

- `deploy_squad <base_id> <prototype|precision_drone> --count <n> [--planet <id>]`
- `commission_fleet <base_id> <corvette|destroyer> --count <n> --system <id>`
- `fleet_assign <fleet_id> <formation>`
- `fleet_move <fleet_id> <system_id|orbit_id>`
- `fleet_attack <fleet_id> <target_id>`
- `fleet_status [fleet_id]`

注意：

- 这是一套新的公开命令面。
- 不建议把它们塞进旧 `produce` 里。
- CLI、shared-client、服务端 API 文档都应围绕这套新命令写，而不是继续扩老语义。

### 7.4 未来公开舰队线需要的新查询面

真正开放时至少要补以下查询：

- `system` 视图或新 `fleet` 视图中，能看到：
  - 舰队 ID
  - 所属玩家
  - system / orbit 位置
  - 编队
  - 成员构成
  - 发射槽占用
  - 指挥点占用
- 事件流能看到：
  - `entity_created(entity_type=fleet|combat_unit)`
  - `entity_updated`
  - `damage_applied`
  - `entity_destroyed`
- 回放里能复盘：
  - 部署
  - 编队变化
  - 交战
  - 损毁

如果没有这些公开查询面，就不能宣称“舰队线已开放”。

### 7.5 未来开放的实施顺序

真正开放时建议按 4 个阶段推进，而不是一次性全开：

1. 先做 authoritative runtime
   - 把 `CombatUnitManager`、`OrbitalPlatformManager`、`SpaceFleet` 全部迁入 snapshot-backed runtime。
2. 再做公开部署命令
   - 只开放部署和查询，不急着上复杂 AI 交战。
3. 再做编队与基础交战
   - 保证事件、伤害、毁伤、回放一致。
4. 最后开放科技树与玩家文档口径
   - 只有当前三步都稳定后，才把 `prototype / precision_drone / corvette / destroyer` 从 hidden 改为公开。

## 8. 影响文件建议

本轮推荐方案至少会涉及以下模块：

- 服务端模型
  - `server/internal/model/tech.go`
  - `server/internal/model/space_runtime.go`（新增）
  - `server/internal/model/solar_sail_orbit.go`
  - `server/internal/query/catalog.go`
- 服务端 runtime
  - `server/internal/gamecore/rules.go`
  - `server/internal/gamecore/solar_sail_settlement.go`
  - `server/internal/gamecore/ray_receiver_settlement.go`
  - `server/internal/gamecore/save_state.go`
  - `server/internal/snapshot/snapshot.go`
- shared-client / CLI
  - `shared-client/src/api.ts`
  - `shared-client/src/types.ts`
  - `client-cli/src/commands/action.ts`
  - `client-cli/src/commands/util.ts`
- 文档
  - `docs/player/玩法指南.md`
  - `docs/player/已知问题与回归.md`
  - `docs/dev/客户端CLI.md`
  - `docs/dev/服务端API.md`

## 9. 验收映射

本方案与 T100 验收标准的对应关系如下：

1. 终局高阶舰队线口径二选一
   - 本方案明确选“当前仍未实现，继续隐藏，并统一所有文档/API/CLI 口径”。
2. `produce`、CLI 帮助、API 类型、服务端能力模型不再矛盾
   - 通过 authoritative 公开单位目录统一。
3. 太阳帆批量发射唯一 ID
   - 通过 `SpaceRuntimeState.NextEntityID("sail")` 保证唯一。
   - 通过 snapshot-backed runtime 保证创建、销毁、回放引用同一 ID。
4. 已验证链路不回退
   - 发射与接收逻辑保留当前命令面，只重构其底层 runtime 宿主和 ID 生成。

## 10. 推荐实施顺序

为避免本轮收口再次做成“局部正确”，推荐按以下顺序实现：

1. 先清理舰队线的公开口径
   - 原始 tech unlock 清除
   - authoritative 公开单位目录建立
   - CLI/shared-client 取消本地分裂口径
2. 再引入 `SpaceRuntimeState`
   - save/snapshot 先打通
3. 再改太阳帆发射与寿命结算
   - ID 分配、orbit key、事件一致性
4. 最后补测试和文档
   - 锁死边界与回归链路
