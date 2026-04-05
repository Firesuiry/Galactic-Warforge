# T101 设计方案：终局舰队线开放 + 太阳帆批量发射 ID 冲突修复

> 基于 `docs/process/task/T101_戴森深度试玩复测后终局舰队线仍未开放且太阳帆批量发射实体ID冲突.md`
>
> 日期：2026-04-05

---

## 问题 1：太阳帆批量发射时实体 ID 冲突

### 1.1 根因分析

当前 `server/internal/gamecore/solar_sail_settlement.go:17` 的 ID 生成逻辑为：

```go
sail.ID = "sail-" + playerID + "-" + strconv.FormatInt(launchTick, 10)
```

同一玩家在同一 tick 内批量发射多张帆时，所有帆的 `launchTick` 相同，导致 ID 完全一致。

而项目中已有全局唯一 ID 生成器 `WorldState.NextEntityID(prefix)` (`server/internal/model/world.go:117-121`)，通过递增 `EntityCounter` 保证唯一性。太阳帆的 ID 生成没有使用这个机制，是唯一的例外。

### 1.2 修复方案

**核心改动：让太阳帆 ID 走 `WorldState.NextEntityID("sail")` 统一路径。**

#### 1.2.1 修改 `LaunchSolarSail` 函数签名

文件：`server/internal/gamecore/solar_sail_settlement.go`

```go
// 改前
func LaunchSolarSail(playerID, systemID string, orbitRadius, inclination float64, launchTick int64) *model.SolarSail

// 改后：增加 ws 参数以获取全局唯一 ID
func LaunchSolarSail(ws *model.WorldState, playerID, systemID string, orbitRadius, inclination float64, launchTick int64) *model.SolarSail
```

ID 生成改为：

```go
sail := &model.SolarSail{
    ID:            ws.NextEntityID("sail"),
    // ... 其余字段不变
}
```

#### 1.2.2 修改调用点

文件：`server/internal/gamecore/rules.go:1707`

```go
// 改前
sail := LaunchSolarSail(playerID, systemID, orbitRadius, inclination, ws.Tick)

// 改后
sail := LaunchSolarSail(ws, playerID, systemID, orbitRadius, inclination, ws.Tick)
```

#### 1.2.3 回放 / 回滚兼容

- `replay.go` / `rollback.go` 中如果有对太阳帆 ID 格式的硬编码解析（如 `strings.Split(id, "-")` 取 tick），需要同步适配新格式 `sail-<counter>`。
- 检查 `settleSolarSails` 中的 `entity_destroyed` 事件，确认只依赖 `sail.ID` 字段而非格式解析——当前代码直接使用 `sail.ID`，无需改动。

#### 1.2.4 存档兼容

- 已有存档中的旧格式 ID（`sail-p1-5141`）在加载后仍然有效，因为 `SolarSailOrbitState.Sails` 是按值存储的，ID 只是字符串字段。
- 新发射的帆会使用新格式，不会与旧帆冲突（`EntityCounter` 从存档恢复后继续递增）。

#### 1.2.5 测试计划

新增测试文件：`server/internal/gamecore/solar_sail_id_test.go`

覆盖场景：

| 场景 | 验证点 |
|------|--------|
| 同一玩家、同一 tick、`count=4` | 4 个帆的 `entity_id` 互不相同 |
| 同一玩家、不同 tick、各发射 1 张 | ID 仍然唯一且递增 |
| 不同玩家、同一 tick、各发射 2 张 | 跨玩家 ID 也唯一 |
| `entity_created` 事件中的 `entity_id` | 与返回的 `sail.ID` 一致 |
| `entity_destroyed` 事件（寿命到期） | 使用的 ID 与创建时一致 |

---

## 问题 2：终局高阶舰队线未对玩家开放

### 2.1 现状分析

当前终局舰队线涉及 4 项科技和 5 种高阶单位：

| 科技 ID | 名称 | Level | Hidden | 解锁单位 |
|---------|------|-------|--------|---------|
| `prototype` | 原型机 | 4 | true | `prototype` |
| `precision_drone` | 精准无人机 | 5 | true | `precision_drone` |
| `corvette` | 护卫舰 | 9 | true | `corvette` |
| `destroyer` | 驱逐舰 | 11 | true | `destroyer` + `corvette_attack_drone` |

当前代码中的缺口：

1. **科技层**：4 项科技 `hidden=true`，`/catalog` 不对玩家展示
2. **服务端 produce**：`rules.go:657-663` 硬编码只接受 `worker` / `soldier`
3. **服务端 model**：`entity.go` 的 `UnitType` 只有 `worker` / `soldier` / `executor`，无高阶单位类型
4. **服务端 model**：`UnitStats()` 和 `UnitCost()` 没有高阶单位的属性和费用定义
5. **CLI**：`action.ts:37` 的 `UNIT_TYPES` 只有 `worker` / `soldier`
6. **无部署/编队系统**：没有太空单位的部署、编队、查询 API
7. **无太空战斗结算**：`combat_settlement.go` 只处理地面 `CombatUnit`，没有太空战斗逻辑
8. **无轨道/太空层**：没有太空区域的概念，单位只有行星表面的 2D 位置

### 2.2 方案选择

任务要求二选一：

- **方案 A**：真正实现公开玩法线
- **方案 B**：继续隐藏，但修正文档口径

**推荐方案 A**：真正实现终局高阶舰队线。

理由：
- 项目已经有完整的战斗单位模型（`combat_unit.go`）和战斗结算引擎（`combat_settlement.go`），扩展到高阶单位的基础设施已经就绪
- 科技树定义已经完整（前置、费用、解锁关系都已配好），只需取消 `hidden` 并补齐运行时支持
- DSP 参考文档中的单位属性和层级关系清晰，可以直接映射

### 2.3 详细设计

#### 2.3.1 新增单位类型定义

文件：`server/internal/model/entity.go`

新增 `UnitType` 常量：

```go
const (
    UnitTypeWorker         UnitType = "worker"
    UnitTypeSoldier        UnitType = "soldier"
    UnitTypeExecutor       UnitType = "executor"
    UnitTypePrototype      UnitType = "prototype"       // 原型机
    UnitTypePrecisionDrone UnitType = "precision_drone"  // 精准无人机
    UnitTypeCorvette       UnitType = "corvette"         // 护卫舰
    UnitTypeDestroyer      UnitType = "destroyer"        // 驱逐舰
    UnitTypeCorvetteAttackDrone UnitType = "corvette_attack_drone" // 护卫舰攻击无人机
)
```

单位分类标记：

```go
// UnitDomain 单位活动域
type UnitDomain string

const (
    UnitDomainGround UnitDomain = "ground"  // 地面
    UnitDomainAir    UnitDomain = "air"     // 空中
    UnitDomainSpace  UnitDomain = "space"   // 太空
)

// UnitDomainOf 返回单位的活动域
func UnitDomainOf(utype UnitType) UnitDomain {
    switch utype {
    case UnitTypePrototype:
        return UnitDomainAir
    case UnitTypePrecisionDrone:
        return UnitDomainAir
    case UnitTypeCorvette, UnitTypeDestroyer, UnitTypeCorvetteAttackDrone:
        return UnitDomainSpace
    default:
        return UnitDomainGround
    }
}
```

#### 2.3.2 高阶单位属性定义

文件：`server/internal/model/entity.go`

扩展 `UnitStats()` 和 `UnitCost()`：

| 单位 | HP | Attack | Defense | AttackRange | MoveRange | VisionRange | 矿石费用 | 能量费用 |
|------|-----|--------|---------|-------------|-----------|-------------|---------|---------|
| prototype | 150 | 20 | 8 | 4 | 3 | 6 | 200 | 100 |
| precision_drone | 80 | 35 | 4 | 6 | 5 | 8 | 300 | 200 |
| corvette | 400 | 50 | 20 | 8 | 4 | 10 | 800 | 500 |
| destroyer | 800 | 100 | 40 | 12 | 3 | 15 | 1500 | 1000 |
| corvette_attack_drone | 60 | 25 | 3 | 5 | 6 | 7 | 400 | 300 |

设计依据：
- `prototype` 定位为基础战斗无人机，属性介于 `soldier` 和 `precision_drone` 之间
- `precision_drone` 高攻击、低血量、高机动，适合精确打击
- `corvette` 作为小型太空战舰，全面强于地面单位
- `destroyer` 作为中型太空战舰，是当前最强单位
- `corvette_attack_drone` 是驱逐舰的配套无人机，轻量高速

#### 2.3.3 太空层模型

文件：新增 `server/internal/model/space_fleet.go`

```go
// SpaceFleet 太空舰队
type SpaceFleet struct {
    ID        string   `json:"id"`
    PlayerID  string   `json:"player_id"`
    SystemID  string   `json:"system_id"`
    Units     []string `json:"units"`      // 舰队成员单位 ID 列表
    State     FleetState `json:"state"`
    TargetID  string   `json:"target_id,omitempty"` // 攻击目标（舰队或建筑 ID）
}

// FleetState 舰队状态
type FleetState string

const (
    FleetStateIdle      FleetState = "idle"
    FleetStatePatrol    FleetState = "patrol"
    FleetStateAttacking FleetState = "attacking"
    FleetStateRetreating FleetState = "retreating"
)
```

太空单位不使用行星表面的 `Position`，而是挂在 `SpaceFleet` 上，以 `SystemID` 标识所在恒星系。

#### 2.3.4 WorldState 扩展

文件：`server/internal/model/world.go`

在 `WorldState` 中新增：

```go
type WorldState struct {
    // ... 现有字段 ...
    SpaceFleets map[string]*SpaceFleet `json:"space_fleets,omitempty"` // fleet_id -> fleet
    SpaceUnits  map[string]*Unit       `json:"space_units,omitempty"` // unit_id -> unit (太空单位)
}
```

太空单位与地面单位分开存储，避免影响现有地面逻辑。

#### 2.3.5 科技取消隐藏

文件：`server/internal/model/tech.go`

将以下 4 项科技的 `Hidden: true` 改为 `Hidden: false`：

- `prototype`（约第 615 行）
- `precision_drone`（约第 805 行）
- `corvette`（约第 1279 行）
- `destroyer`（约第 1493 行）

#### 2.3.6 生产入口扩展

文件：`server/internal/gamecore/rules.go`

修改 `execProduce` 函数：

1. 移除 `switch utype` 中的硬编码白名单，改为查表验证：

```go
// 改前
switch utype {
case model.UnitTypeWorker, model.UnitTypeSoldier:
default:
    res.Code = model.CodeValidationFailed
    res.Message = fmt.Sprintf("unknown unit type: %s", utype)
    return res, nil
}

// 改后
if !model.IsValidUnitType(utype) {
    res.Code = model.CodeValidationFailed
    res.Message = fmt.Sprintf("unknown unit type: %s", utype)
    return res, nil
}
```

2. 高阶单位需要科技前置检查：

```go
// 在费用检查之前增加科技门禁
requiredTech := model.UnitRequiredTech(utype)
if requiredTech != "" {
    techState := ws.PlayerTechs[playerID]
    if techState == nil || !techState.HasTech(requiredTech) {
        res.Code = model.CodeTechRequired
        res.Message = fmt.Sprintf("requires tech: %s", requiredTech)
        return res, nil
    }
}
```

3. 太空单位生产后放入 `SpaceUnits` 而非 `Units`：

```go
if model.UnitDomainOf(utype) == model.UnitDomainSpace {
    ws.SpaceUnits[id] = u
} else {
    ws.Units[id] = u
    tileKey := model.TileKey(spawnPos.X, spawnPos.Y)
    ws.TileUnits[tileKey] = append(ws.TileUnits[tileKey], id)
}
```

4. 太空单位不需要地面空位检查，但需要生产建筑支持（`battlefield_analysis_base` 或同类军事建筑）。

#### 2.3.7 辅助函数

文件：`server/internal/model/entity.go`

```go
// IsValidUnitType 检查是否为合法单位类型
func IsValidUnitType(utype UnitType) bool {
    switch utype {
    case UnitTypeWorker, UnitTypeSoldier, UnitTypeExecutor,
         UnitTypePrototype, UnitTypePrecisionDrone,
         UnitTypeCorvette, UnitTypeDestroyer, UnitTypeCorvetteAttackDrone:
        return true
    }
    return false
}

// UnitRequiredTech 返回生产该单位所需的科技 ID，空字符串表示无需科技
func UnitRequiredTech(utype UnitType) string {
    switch utype {
    case UnitTypePrototype:
        return "prototype"
    case UnitTypePrecisionDrone:
        return "precision_drone"
    case UnitTypeCorvette:
        return "corvette"
    case UnitTypeDestroyer, UnitTypeCorvetteAttackDrone:
        return "destroyer"
    }
    return ""
}
```

#### 2.3.8 新增 API 端点

文件：`server/internal/gateway/server.go`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/fleets` | 查询当前玩家的所有太空舰队 |
| GET | `/fleets/{id}` | 查询指定舰队详情 |
| POST | `/commands` | 新增命令类型（见下表） |

新增命令类型：

| 命令 | Payload | 说明 |
|------|---------|------|
| `create_fleet` | `{ "system_id": "sys-1", "unit_ids": ["u-10", "u-11"] }` | 将太空单位编入舰队 |
| `disband_fleet` | `{ "fleet_id": "fleet-1" }` | 解散舰队 |
| `fleet_attack` | `{ "fleet_id": "fleet-1", "target_id": "enemy-1" }` | 舰队攻击目标 |
| `fleet_patrol` | `{ "fleet_id": "fleet-1", "system_id": "sys-1" }` | 舰队巡逻 |

#### 2.3.9 太空战斗结算

文件：新增 `server/internal/gamecore/space_combat_settlement.go`

结算逻辑：

1. 每 tick 遍历所有处于 `attacking` 状态的舰队
2. 舰队内每个单位按 `WeaponState` 对目标开火（复用 `combat_unit.go` 的伤害计算）
3. 太空单位之间的战斗不受地面距离限制，只要在同一 `SystemID` 内即可交战
4. 单位死亡后从舰队中移除，舰队为空时自动解散
5. 产生 `damage_applied` / `entity_destroyed` 事件

与地面战斗的区别：
- 太空单位没有 `Position`（行星坐标），以 `SystemID` 为空间范围
- 太空单位不占用行星 tile
- 太空单位不受行星护盾影响（护盾只防太空→地面攻击）

#### 2.3.10 CLI 扩展

文件：`client-cli/src/commands/action.ts`

1. 扩展 `UNIT_TYPES`：

```typescript
const UNIT_TYPES = new Set([
  'worker', 'soldier',
  'prototype', 'precision_drone',
  'corvette', 'destroyer', 'corvette_attack_drone',
]);
```

2. 新增舰队命令：

```typescript
// 新增命令
export async function cmdCreateFleet(args: string[]): Promise<string>
export async function cmdDisbandFleet(args: string[]): Promise<string>
export async function cmdFleetAttack(args: string[]): Promise<string>
export async function cmdFleetPatrol(args: string[]): Promise<string>
export async function cmdFleets(args: string[]): Promise<string>  // 查询舰队列表
```

3. 更新 `command-catalog.ts` 注册新命令。

4. 更新 `help produce` 输出，列出所有可用单位类型。

#### 2.3.11 查询层扩展

文件：`server/internal/query/`

新增 `fleet_inspector.go`：

- `QueryFleets(playerID)` — 返回玩家所有舰队
- `QueryFleet(playerID, fleetID)` — 返回舰队详情（含成员单位属性）
- `QuerySpaceUnits(playerID)` — 返回玩家所有太空单位

在 `summary` 查询中增加 `space_units_count` 和 `fleets_count` 字段。

### 2.4 存档兼容

- `WorldState` 新增的 `SpaceFleets` 和 `SpaceUnits` 字段使用 `omitempty`，旧存档加载时为 `nil`，不影响现有逻辑。
- 初始化时如果为 `nil`，在 `GameCore.Init()` 中补 `make(map[string]...)`。

### 2.5 测试计划

| 测试场景 | 验证点 |
|---------|--------|
| 未研究 `prototype` 时 `produce ... prototype` | 返回 `requires tech: prototype` |
| 研究 `prototype` 后 `produce ... prototype` | 成功生产，返回 `entity_created` |
| 生产 `corvette` 后 `create_fleet` | 舰队创建成功，`/fleets` 可查 |
| `fleet_attack` 攻击敌对势力 | 产生 `damage_applied` 事件 |
| 舰队成员全部阵亡 | 舰队自动解散 |
| `disband_fleet` | 舰队解散，单位回到 idle |
| `/catalog` 查询 | `prototype` 等科技 `hidden=false` |
| CLI `help produce` | 列出所有单位类型 |
| CLI `produce u-2 corvette` | 不再报 "unit_type 必须是 worker 或 soldier" |

---

## 实施顺序

建议按以下顺序分步实施，每步完成后可独立测试：

### 第一步：修复太阳帆 ID 冲突（独立、低风险）

1. 修改 `LaunchSolarSail` 函数签名，增加 `ws` 参数
2. ID 生成改用 `ws.NextEntityID("sail")`
3. 修改 `rules.go` 中的调用点
4. 检查 `replay.go` / `rollback.go` 是否有 ID 格式依赖
5. 新增测试

### 第二步：高阶单位类型与属性（model 层）

1. 新增 `UnitType` 常量
2. 新增 `UnitDomain` 类型和 `UnitDomainOf()`
3. 扩展 `UnitStats()` 和 `UnitCost()`
4. 新增 `IsValidUnitType()` 和 `UnitRequiredTech()`
5. 新增 `SpaceFleet` 模型
6. 扩展 `WorldState`

### 第三步：科技取消隐藏 + 生产入口扩展（gamecore 层）

1. 取消 4 项科技的 `hidden` 标记
2. 修改 `execProduce` 支持高阶单位
3. 新增太空单位存储逻辑

### 第四步：舰队系统（gamecore + gateway 层）

1. 新增舰队命令处理函数
2. 新增太空战斗结算
3. 新增 API 端点
4. 新增查询层

### 第五步：CLI 扩展

1. 扩展 `UNIT_TYPES`
2. 新增舰队命令
3. 更新 `help` 输出

### 第六步：文档同步

1. 更新 `docs/player/玩法指南.md` — 增加终局舰队线玩法说明
2. 更新 `docs/player/已知问题与回归.md` — 标记问题已解决
3. 更新 `docs/dev/客户端CLI.md` — 增加新命令文档
4. 更新 `docs/dev/服务端API.md` — 增加新端点和命令文档
5. 更新 `docs/archive/design/07-戴森球系统.md` — 更新边界说明

---

## 不在本次范围内

- 太空单位的可视化渲染（client-web）
- 跨星系舰队调动
- 舰队阵型系统
- 太空单位的弹药补给链
- 驱逐舰自动释放 `corvette_attack_drone` 的 AI 逻辑
- 太空单位与地面单位的协同作战（轨道轰炸等）

这些可作为后续迭代方向，当前只需保证"玩家能通过公开科技树 + 公开命令真实体验高阶单位生产、编队和基础太空战斗"即可。
