# T091 设计方案：戴森中后期公开命令断档与剩余 DSP 建筑补齐

## 一、问题总览

本任务解决两类问题：

1. **两条公开命令被网关拦截**：`switch_active_planet` 和 `set_ray_receiver_mode` 在 `gamecore` 层已有完整执行逻辑，但 `gateway/server.go` 的 `validateCommandStructure` 缺少对应 case，导致请求在网关层即被 `unknown command type` 拒绝。
2. **4 个 DSP 建筑停留在半定义态**：`jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab` 只有类型常量和建筑定义，缺少科技解锁、运行时定义、结算逻辑和玩家入口。

---

## 二、问题 1：补齐网关命令校验

### 2.1 根因

`server/internal/gateway/server.go:798` 的 `validateCommandStructure` 函数使用 `switch cmd.Type` 做结构校验，最后的 `default` 分支返回 `unknown command type`。`CmdSwitchActivePlanet` 和 `CmdSetRayReceiverMode` 没有对应 case。

### 2.2 改动方案

在 `validateCommandStructure` 的 `default` 分支之前（约 963 行），新增两个 case：

```go
case model.CmdSwitchActivePlanet:
    if _, ok := cmd.Payload["planet_id"]; !ok {
        return fmt.Errorf("switch_active_planet requires payload.planet_id")
    }
case model.CmdSetRayReceiverMode:
    if _, ok := cmd.Payload["building_id"]; !ok {
        return fmt.Errorf("set_ray_receiver_mode requires payload.building_id")
    }
    if _, ok := cmd.Payload["mode"]; !ok {
        return fmt.Errorf("set_ray_receiver_mode requires payload.mode")
    }
```

校验逻辑与 `planet_commands.go:9-101` 中 `execSwitchActivePlanet` / `execSetRayReceiverMode` 的 payload 要求一致。

### 2.3 涉及文件

| 文件 | 改动 |
|------|------|
| `server/internal/gateway/server.go` | `validateCommandStructure` 新增 2 个 case |
| `server/internal/gateway/server_internal_test.go` | 新增测试用例 |

### 2.4 测试方案

在 `server_internal_test.go` 中新增以下测试：

**正向测试** — 加入 `TestValidateCommandStructureAllowsImplementedLifecycleCommands` 的 cases 列表：
```go
{Type: model.CmdSwitchActivePlanet, Payload: map[string]any{"planet_id": "planet-1-1"}},
{Type: model.CmdSetRayReceiverMode, Payload: map[string]any{"building_id": "b-1", "mode": "power"}},
```

**反向测试** — 新增 `TestValidateCommandStructureRejectsIncompletePlanetAndReceiverCommands`：
- `switch_active_planet` 缺少 `planet_id` → 期望错误包含 `payload.planet_id`
- `set_ray_receiver_mode` 缺少 `building_id` → 期望错误包含 `payload.building_id`
- `set_ray_receiver_mode` 缺少 `mode` → 期望错误包含 `payload.mode`

**E2E 测试** — 在 `server/internal/gamecore/e2e_test.go` 或 `t090_closure_test.go` 中补充：
- `switch_active_planet` 成功后 `summary.active_planet_id` 变化
- `set_ray_receiver_mode` 成功后 `inspect` 中模式变化
- `set_ray_receiver_mode` photon 模式在未解锁 `dirac_inversion` 时返回科技前置错误（而非 `unknown command type`）

---

## 三、问题 2：4 个 DSP 建筑收口

### 3.1 现状分析

| 建筑 | 类型常量 | 建筑定义 | Buildable | 运行时定义 | 科技解锁 | 结算逻辑 |
|------|---------|---------|-----------|-----------|---------|---------|
| `jammer_tower` | ✅ `building_defs.go:70` | ✅ 第 548 行 | ❌ false | ❌ 无 | ❌ 无科技 | ❌ 无 |
| `sr_plasma_turret` | ✅ `building_defs.go:69` | ✅ 第 541 行 | ❌ false | ❌ 无 | ❌ 无科技 | ❌ 无 |
| `planetary_shield_generator` | ✅ `building_defs.go:72` | ✅ 第 563 行 | ❌ false | ❌ 无 | ❌ 无科技 | ❌ 无 |
| `self_evolution_lab` | ✅ `building_defs.go:48` | ✅ 第 388 行 | ❌ false | ❌ 无 | ⚠️ `dark_fog_matrix` 解锁的是 `self_evolution_station`（ID 不匹配） | ❌ 无 |

补充说明：
- `defense.go:112-122` 的 `IsDefenseBuilding` 已包含 `jammer_tower` 和 `planetary_shield_generator`，但 `sr_plasma_turret` 未包含
- `defense.go:125-138` 的 `GetDefenseType` 已为 `jammer_tower` 返回 `DefenseTypeJammer`，但 `planetary_shield_generator` 和 `sr_plasma_turret` 落入 default 返回空
- `dark_fog_matrix` 科技（`tech.go:1620`）解锁 `self_evolution_station`，但建筑 ID 是 `self_evolution_lab`，虽然 `tech.go:1726` 的 alias 映射做了修正（`self_evolution_station` → `BuildingTypeSelfEvolutionLab`），但该科技本身是 `Hidden: true`，玩家无法正常研究

### 3.2 设计决策：全部真正实现

根据 `08-战斗与防御系统.md` 的设计目标，这 4 个建筑都是戴森球中后期玩法的关键组件。建议全部实现，使中后期战斗防御体系完整。

### 3.3 各建筑详细设计

#### 3.3.1 `jammer_tower`（干扰塔）

**定位**：降低范围内敌方单位效率/速度，提供控制收益。

**科技解锁**：
- 新增科技 `jammer_tower`
- 前置：`signal_tower` + `plasma_control`
- 等级：8
- 类型：`combat`
- 费用：`electromagnetic_matrix × 600, energy_matrix × 600, structure_matrix × 400`
- 解锁：`{Type: TechUnlockBuilding, ID: "jammer_tower"}`

**建筑定义改动**（`building_defs.go:548`）：
```go
{
    ID:          BuildingTypeJammerTower,
    Name:        "Jammer Tower",
    Category:    BuildingCategoryCommandSignal,
    Subcategory: BuildingSubcategoryCommandSignal,
    Footprint:   defaultFootprint,
    BuildCost:   BuildCost{Minerals: 120, Energy: 60},
    Buildable:   true,  // 改为 true
},
```

**运行时定义**（`building_runtime.go` 新增）：
```go
{
    ID: BuildingTypeJammerTower,
    Params: BuildingRuntimeParams{
        EnergyConsume: 8,
        ConnectionPoints: []ConnectionPoint{
            {ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
        },
    },
    Functions: BuildingFunctionModules{
        Combat: &CombatModule{Attack: 0, Range: 8},
        Energy: &EnergyModule{ConsumePerTick: 8},
    },
},
```

**结算逻辑**：
- 在 `settleTurrets`（`rules.go:1274`）中已有防御建筑遍历逻辑
- `jammer_tower` 的 `CombatModule.Attack = 0`，不造成直接伤害
- 新增干扰效果：在 `settleTurrets` 中，当建筑类型为 `jammer_tower` 时，对范围内敌方力量施加减速效果（降低 `Strength` 恢复速率或降低移动速度）
- 具体实现：在 `settleTurrets` 的遍历循环中，对 `jammer_tower` 类型做特殊分支：
  ```go
  if turret.Type == model.BuildingTypeJammerTower {
      // 对范围内敌方力量施加干扰：降低 strength 10%
      for i, force := range ws.EnemyForces.Forces {
          dist := manhattanDistTurret(turret.Position, force.Position)
          if dist <= combat.Range {
              reduction := force.Strength / 10
              ws.EnemyForces.Forces[i].Strength -= reduction
              if ws.EnemyForces.Forces[i].Strength < 0 {
                  ws.EnemyForces.Forces[i].Strength = 0
              }
              // 发布干扰事件
          }
      }
      continue
  }
  ```

**defense.go 改动**：
- `GetDefenseType` 已正确返回 `DefenseTypeJammer`，无需改动
- `IsDefenseBuilding` 已包含，无需改动

#### 3.3.2 `sr_plasma_turret`（超级等离子炮塔）

**定位**：`plasma_turret` 的高级版本，更高伤害和射程，对标戴森球计划的 SR 等离子炮。

**科技解锁**：
- 新增科技 `sr_plasma_turret`
- 前置：`plasma_turret` + `gravity_matrix`（引力矩阵科技）
- 等级：10
- 类型：`combat`
- 费用：`electromagnetic_matrix × 1200, energy_matrix × 1200, structure_matrix × 1200, information_matrix × 800, gravity_matrix × 400`
- 解锁：`{Type: TechUnlockBuilding, ID: "sr_plasma_turret"}`

**建筑定义改动**（`building_defs.go:541`）：
```go
{
    ID:          BuildingTypeSRPlasmaTurret,
    Name:        "SR Plasma Turret",
    Category:    BuildingCategoryCommandSignal,
    Subcategory: BuildingSubcategoryCommandSignal,
    Footprint:   defaultFootprint,
    BuildCost:   BuildCost{Minerals: 300, Energy: 150},
    Buildable:   true,  // 改为 true
},
```

**运行时定义**（`building_runtime.go` 新增）：
```go
{
    ID: BuildingTypeSRPlasmaTurret,
    Params: BuildingRuntimeParams{
        EnergyConsume: 20,
        ConnectionPoints: []ConnectionPoint{
            {ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
        },
    },
    Functions: BuildingFunctionModules{
        Combat: &CombatModule{Attack: 60, Range: 12},
        Energy: &EnergyModule{ConsumePerTick: 20},
    },
},
```

**结算逻辑**：
- 复用 `settleTurrets` 现有炮塔攻击逻辑，无需额外代码
- `CombatModule` 的 `Attack: 60, Range: 12` 使其成为最强单体炮塔（对比 `gauss_turret` 的 `Attack: 15, Range: 5`）

**defense.go 改动**：
- `IsDefenseBuilding` 需新增 `BuildingTypeSRPlasmaTurret`
- `GetDefenseType` 需新增 `BuildingTypeSRPlasmaTurret` → `DefenseTypeTurret`

#### 3.3.3 `planetary_shield_generator`（行星护盾发生器）

**定位**：为行星提供全局护盾，吸收来自高威胁目标的伤害，保护核心产线。

**科技解锁**：
- 新增科技 `planetary_shield`
- 前置：`energy_shield`（`tech.go:1586` 已有）+ `gravity_matrix`
- 等级：10
- 类型：`combat`
- 费用：`electromagnetic_matrix × 1500, energy_matrix × 1500, structure_matrix × 1500, information_matrix × 1000, gravity_matrix × 600`
- 解锁：`{Type: TechUnlockBuilding, ID: "planetary_shield_generator"}`

**建筑定义改动**（`building_defs.go:563`）：
```go
{
    ID:          BuildingTypePlanetaryShieldGenerator,
    Name:        "Planetary Shield Generator",
    Category:    BuildingCategoryCommandSignal,
    Subcategory: BuildingSubcategoryCommandSignal,
    Footprint:   defaultFootprint,
    BuildCost:   BuildCost{Minerals: 500, Energy: 250},
    Buildable:   true,  // 改为 true
},
```

**运行时定义**（`building_runtime.go` 新增）：

需要新增 `ShieldModule`：

```go
// ShieldModule handles planetary shield generation.
type ShieldModule struct {
    ShieldPerTick int `json:"shield_per_tick" yaml:"shield_per_tick"` // 每 tick 恢复的护盾值
    MaxShield     int `json:"max_shield" yaml:"max_shield"`           // 最大护盾容量
}
```

在 `BuildingFunctionModules` 中新增字段：
```go
Shield *ShieldModule `json:"shield,omitempty" yaml:"shield,omitempty"`
```

运行时定义：
```go
{
    ID: BuildingTypePlanetaryShieldGenerator,
    Params: BuildingRuntimeParams{
        EnergyConsume: 50,
        ConnectionPoints: []ConnectionPoint{
            {ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
        },
    },
    Functions: BuildingFunctionModules{
        Shield: &ShieldModule{ShieldPerTick: 5, MaxShield: 1000},
        Energy: &EnergyModule{ConsumePerTick: 50},
    },
},
```

**结算逻辑**：

新增 `settleShields` 函数（新文件 `server/internal/gamecore/shield_settlement.go`）：

```go
func settleShields(ws *model.WorldState) {
    for _, b := range ws.Buildings {
        if b.HP <= 0 || b.Runtime.State != model.BuildingWorkRunning {
            continue
        }
        shield := b.Runtime.Functions.Shield
        if shield == nil {
            continue
        }
        // 每 tick 恢复护盾值到 WorldState 的行星护盾池
        ws.PlanetShield += shield.ShieldPerTick
        if ws.PlanetShield > shield.MaxShield {
            ws.PlanetShield = shield.MaxShield
        }
    }
}
```

在 `WorldState` 中新增字段：
```go
PlanetShield int `json:"planet_shield"`
```

在 `settleTurrets` 的敌方攻击结算中，优先扣减 `PlanetShield`：
- 当敌方力量攻击建筑时，先从 `ws.PlanetShield` 扣减伤害
- 护盾耗尽后才扣减建筑 HP

在主循环 `core.go:602-606` 的战斗结算区域，在 `settleTurrets` 之前调用 `settleShields`：
```go
settleShields(gc.world)
allEvents = append(allEvents, settleTurrets(gc.world)...)
```

**defense.go 改动**：
- `IsDefenseBuilding` 已包含，无需改动
- `GetDefenseType` 需新增 `BuildingTypePlanetaryShieldGenerator` → 新增 `DefenseTypeShield DefenseType = "shield"`

#### 3.3.4 `self_evolution_lab`（自演化研究站）

**定位**：高级研究设施，可使用黑雾矩阵进行研究，是 `matrix_lab` 的终极升级版。

**科技解锁**：
- 修复现有 `dark_fog_matrix` 科技（`tech.go:1620`）：
  - 当前解锁 `self_evolution_station`，通过 alias（`tech.go:1726`）映射到 `self_evolution_lab`，逻辑上可行
  - 但 `Hidden: true` 意味着玩家无法正常研究
- 方案：新增一个非隐藏的前置科技 `self_evolution`：
  - 前置：`gravity_matrix`（引力矩阵科技）
  - 等级：10
  - 类型：`combat`
  - 费用：`electromagnetic_matrix × 2000, energy_matrix × 2000, structure_matrix × 2000, information_matrix × 2000, gravity_matrix × 1000`
  - 解锁：`{Type: TechUnlockBuilding, ID: "self_evolution_lab"}`
- 保留 `dark_fog_matrix` 作为隐藏科技，但不再作为 `self_evolution_lab` 的唯一解锁路径

**建筑定义改动**（`building_defs.go:388`）：
```go
{
    ID:          BuildingTypeSelfEvolutionLab,
    Name:        "Self-Evolution Lab",
    Category:    BuildingCategoryResearch,
    Subcategory: BuildingSubcategoryResearch,
    Footprint:   defaultFootprint,
    BuildCost:   BuildCost{Minerals: 400, Energy: 200},
    Buildable:   true,  // 改为 true
},
```

**运行时定义**（`building_runtime.go` 新增）：
```go
{
    ID: BuildingTypeSelfEvolutionLab,
    Params: BuildingRuntimeParams{
        EnergyConsume: 30,
        ConnectionPoints: []ConnectionPoint{
            {ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
        },
    },
    Functions: BuildingFunctionModules{
        Research: &ResearchModule{ResearchPerTick: 4},
        Energy:   &EnergyModule{ConsumePerTick: 30},
    },
},
```

**结算逻辑**：
- 复用 `settleResearch`（`research.go:12`）现有研究结算逻辑
- `settleResearch` 遍历所有建筑的 `Research` 模块，`self_evolution_lab` 的 `ResearchPerTick: 4` 是 `matrix_lab` 的 2 倍（`matrix_lab` 为 2），体现高级研究站的优势
- 无需额外代码，只需确保运行时定义中有 `Research` 模块即可

---

## 四、涉及文件汇总

### 4.1 服务端代码改动

| 文件 | 改动内容 |
|------|---------|
| `server/internal/gateway/server.go` | `validateCommandStructure` 新增 `CmdSwitchActivePlanet` 和 `CmdSetRayReceiverMode` 两个 case |
| `server/internal/gateway/server_internal_test.go` | 新增正向/反向校验测试 |
| `server/internal/model/building_defs.go` | 4 个建筑的 `Buildable` 改为 `true`，补充 `BuildCost` |
| `server/internal/model/building_runtime.go` | 新增 `ShieldModule` 结构体；`BuildingFunctionModules` 新增 `Shield` 字段；新增 4 个建筑的运行时定义；`clone()` 方法补充 `Shield` 字段复制 |
| `server/internal/model/tech.go` | 新增 `jammer_tower`、`sr_plasma_turret`、`planetary_shield`、`self_evolution` 4 个科技定义 |
| `server/internal/model/defense.go` | `IsDefenseBuilding` 新增 `sr_plasma_turret`；`GetDefenseType` 新增 `sr_plasma_turret` → `turret`、`planetary_shield_generator` → `shield`；新增 `DefenseTypeShield` |
| `server/internal/model/entity.go` | `WorldState` 新增 `PlanetShield int` 字段 |
| `server/internal/gamecore/shield_settlement.go` | 新文件，`settleShields` 函数 |
| `server/internal/gamecore/rules.go` | `settleTurrets` 中新增 `jammer_tower` 干扰逻辑分支 |
| `server/internal/gamecore/core.go` | 主循环战斗区域新增 `settleShields` 调用 |
| `server/internal/gamecore/save_state.go` | 序列化/反序列化需包含 `PlanetShield` |

### 4.2 测试文件

| 文件 | 测试内容 |
|------|---------|
| `server/internal/gateway/server_internal_test.go` | 网关校验正向/反向测试 |
| `server/internal/gamecore/shield_settlement_test.go` | 新文件，护盾结算测试 |
| `server/internal/gamecore/jammer_settlement_test.go` | 新文件，干扰塔结算测试 |
| `server/internal/gamecore/e2e_test.go` | 端到端测试：命令可达性、科技解锁后建造 |

### 4.3 文档更新

| 文件 | 更新内容 |
|------|---------|
| `docs/player/玩法指南.md` | 新增 4 个建筑的玩法说明；确认 `switch_active_planet` 和 `set_ray_receiver_mode` 为可用命令 |
| `docs/player/上手与验证.md` | 更新验证步骤，包含新建筑的建造验证 |
| `docs/dev/客户端CLI.md` | 确认两条命令的 CLI 用法说明准确 |
| `docs/dev/服务端API.md` | 确认两条命令的 API 文档准确 |
| `docs/player/已知问题与回归.md` | 移除已修复的问题条目 |

---

## 五、实施顺序

1. **网关校验修复**（问题 1）— 改动最小，立即恢复两条命令可用性
2. **`sr_plasma_turret`** — 纯炮塔，复用现有 `settleTurrets` 逻辑，零新结算代码
3. **`jammer_tower`** — 需在 `settleTurrets` 中新增干扰分支
4. **`self_evolution_lab`** — 纯研究站，复用现有 `settleResearch` 逻辑
5. **`planetary_shield_generator`** — 需新增 `ShieldModule`、`settleShields`、`WorldState.PlanetShield`，改动面最大
6. **科技树补齐** — 4 个新科技定义
7. **测试** — 单元测试 + E2E 测试
8. **文档同步** — 更新所有玩家侧和开发侧文档

---

## 六、验收标准对照

| 验收项 | 对应设计 |
|--------|---------|
| `switch_active_planet` 返回 OK | §2.2 网关新增 case |
| `set_ray_receiver_mode` 返回 OK | §2.2 网关新增 case |
| photon 模式未解锁时返回科技前置错误 | `planet_commands.go:90` 已有逻辑，网关放行后自动生效 |
| 4 个建筑可通过科技解锁后建造 | §3.3 各建筑科技 + Buildable=true |
| 已有链路不回退 | 本方案不修改任何已有结算逻辑，仅新增 |

---

## 七、风险与注意事项

1. **`PlanetShield` 持久化**：新增的 `WorldState.PlanetShield` 字段需要在 `save_state.go` 的序列化/反序列化中正确处理，否则重启后护盾值丢失。
2. **`ShieldModule` 的 `clone()` 方法**：`BuildingFunctionModules.clone()` 需要补充 `Shield` 字段的深拷贝，否则并发结算可能出现数据竞争。
3. **科技前置链完整性**：新增的 4 个科技需要确保前置科技（如 `signal_tower`、`plasma_turret`、`energy_shield`、`gravity_matrix`）在科技树中已存在且可达。
4. **`dark_fog_matrix` 的 alias 映射**：`tech.go:1726` 已有 `self_evolution_station` → `self_evolution_lab` 的映射，新增 `self_evolution` 科技后，两条路径都能解锁该建筑，不冲突。
