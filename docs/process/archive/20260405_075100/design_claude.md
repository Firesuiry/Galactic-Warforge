# T099 设计方案：终局高阶舰队线与人造恒星燃料态修复

> 基于 `docs/process/task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md` 的需求分析

---

## 一、问题总览

### 问题 1：`artificial_star` 无燃料时仍显示 `running`

**根因分析：**

Tick 结算顺序为：

1. `settlePowerGeneration` (core.go:593) — 计算发电量，燃料消耗逻辑正确：无 `antimatter_fuel_rod` 时 output=0
2. `finalizePowerSettlement` (core.go:598) — 汇总电力快照
3. `settleResources` (core.go:599) — 遍历所有建筑，设置运行状态

问题出在 `settleResources`（rules.go:929-976）：对每个建筑，只检查了维护费和电力可用性，通过后直接 `applyBuildingState(b, BuildingWorkRunning, "")` (rules.go:973)。**没有检查燃料型发电建筑是否实际有燃料。**

`ResolvePowerGeneration`（power.go:66）本身逻辑正确——无燃料时返回 output=0。但 `settlePowerGeneration`（power_generation.go:55）只是跳过了零产出建筑，不会修改建筑状态。

因此 `artificial_star`（以及 `thermal_power_plant`、`mini_fusion_power_plant`）在无燃料时：
- 发电量正确为 0
- 但 `inspect` 返回的 `runtime.state` 仍为 `running`

**影响范围：** 所有 `IsFuelBasedPowerSource` 类型的发电建筑（`thermal`、`fusion`、`artificial_star`）。

### 问题 2：终局高阶舰队线未对玩家开放

**现状分析：**

| 层面 | 当前状态 |
|------|----------|
| 物品定义 | `config/defs/items/combat/` 下有 `prototype.yaml`、`precision_drone.yaml`、`corvette.yaml`、`destroyer.yaml`，但都是空壳（`produced_by: []`、`base_damage: 1`） |
| 科技树 | `tech.go` 中 4 项科技均为 `Hidden: true`，解锁类型为 `TechUnlockUnit` |
| 单位系统 | `entity.go` 只定义了 `worker`/`soldier`/`executor` 三种 `UnitType`；`combat_unit.go` 定义了 `mech`/`tank`/`aircraft`/`ship` 四种 `CombatUnitType`，但两套系统未打通 |
| produce 命令 | `rules.go:657-662` 硬编码只接受 `worker`/`soldier` |
| 科技解锁处理 | `tech.go:1707` 的 `TechUnlockUnit` 分支存在，但 `tech_alignment_test.go:77-80` 明确断言这 4 项科技不应有 `TechUnlockUnit` 效果 |
| 文档 | `玩法指南.md:508` 已明确写出"这条高阶舰队线当前仍没有公开生产/部署/战斗入口" |

**结论：** 这条线从科技定义到物品到命令到战斗结算，全链路都缺失实现。不是简单的"取消隐藏"就能解决的。

---

## 二、方案选择

### 问题 1 方案：修正燃料型发电建筑的运行态

只有一种合理方案：在 `settleResources` 中增加燃料检查。

### 问题 2 方案选择

T099 要求二选一：

- **方案 A**：真正实现高阶舰队线（工作量极大）
- **方案 B**：继续隐藏，统一文档口径（工作量可控）

**推荐方案 B。** 理由：

1. 当前文档（`玩法指南.md`）已经明确标注了这条线未实现
2. 实现方案 A 需要：新增 4+ 种单位类型及属性、打通 `UnitType` 与 `CombatUnitType` 两套系统、新增生产/部署/编队/查询命令、补齐太空战斗结算、补齐事件和 SSE 推送——这是一个独立的大型功能迭代
3. 方案 B 的核心工作是确保所有文档口径一致，不再有"已全部实现"的误导性表述

---

## 三、问题 1 详细设计：`artificial_star` 燃料门禁

### 3.1 核心改动：`settleResources` 增加燃料检查

**文件：** `server/internal/gamecore/rules.go`

**位置：** `settleResources` 函数，在 `applyBuildingState(b, BuildingWorkRunning, "")` (line 973) 之前

**逻辑：**

```go
// 在电力检查通过后、设置 running 之前，增加燃料检查
if model.IsPowerGeneratorModule(b.Runtime.Functions.Energy) &&
    model.IsFuelBasedPowerSource(b.Runtime.Functions.Energy.SourceKind) {
    if !hasFuelAvailable(b) {
        if evt := applyBuildingState(b, model.BuildingWorkIdle, "no_fuel"); evt != nil {
            events = append(events, evt)
        }
        continue
    }
}
```

**新增辅助函数：**

```go
// hasFuelAvailable 检查燃料型发电建筑是否有可用燃料
func hasFuelAvailable(b *model.Building) bool {
    module := b.Runtime.Functions.Energy
    if module == nil || len(module.FuelRules) == 0 {
        return false
    }
    if b.Storage == nil {
        return false
    }
    for _, rule := range module.FuelRules {
        if rule.ItemID == "" || rule.ConsumePerTick <= 0 {
            continue
        }
        total := countItemInStorage(b.Storage, rule.ItemID)
        if total >= rule.ConsumePerTick {
            return true
        }
    }
    return false
}

func countItemInStorage(storage *model.StorageState, itemID string) int {
    if storage == nil {
        return 0
    }
    total := 0
    for _, slot := range storage.InputBuffer {
        if slot.ItemID == itemID {
            total += slot.Quantity
        }
    }
    for _, slot := range storage.Inventory {
        if slot.ItemID == itemID {
            total += slot.Quantity
        }
    }
    for _, slot := range storage.OutputBuffer {
        if slot.ItemID == itemID {
            total += slot.Quantity
        }
    }
    return total
}
```

### 3.2 新增状态原因常量

**文件：** `server/internal/gamecore/building_lifecycle.go`

```go
const stateReasonNoFuel = "no_fuel"
```

### 3.3 状态转换语义

| 条件 | 目标状态 | reason |
|------|----------|--------|
| 燃料型发电建筑，无燃料 | `idle` | `no_fuel` |
| 燃料型发电建筑，有燃料，电力正常 | `running` | `""` |
| 燃料型发电建筑，有燃料，缺电 | `no_power` | `under_power` |

选择 `idle` 而非新增状态，原因：
- `idle` 在现有系统中已被 `settlePowerGeneration` 正确跳过（power_generation.go:43）
- `idle` 建筑在 `settleResources` 中也被跳过（rules.go:946）
- 不需要新增 `BuildingWorkState` 枚举值
- 通过 `reason = "no_fuel"` 区分普通 idle 和缺燃料 idle

### 3.4 观察面一致性

需要确保以下查询面都能正确反映状态：

| 观察面 | 当前行为 | 修复后行为 |
|--------|----------|------------|
| `inspect` → `runtime.state` | `running` | `idle` |
| `inspect` → `runtime.state_reason` | `""` | `no_fuel` |
| `scene` → building state | `running` | `idle` |
| SSE `building_state_changed` | 不触发 | 触发，payload 含 `reason: "no_fuel"` |
| `stats.energy_stats` | generation 已正确为 0 | 不变 |
| `networks.power_networks` | supply 已正确不含该建筑 | 不变 |

`inspect`、`scene`、SSE 都直接读取 `building.Runtime.State`，所以只要 `settleResources` 正确设置状态，这三个面自动一致。`stats` 和 `networks` 已经正确（因为 `settlePowerGeneration` 本身逻辑无误）。

### 3.5 燃料恢复后的状态转换

当玩家通过 `transfer` 或传送带向 `artificial_star` 装入 `antimatter_fuel_rod` 后：
- 下一个 tick 的 `settleResources` 会重新检查燃料
- `hasFuelAvailable` 返回 true
- 走到 `applyBuildingState(b, BuildingWorkRunning, "")`
- SSE 发出 `building_state_changed`，reason 为 `start`
- `settlePowerGeneration` 正常消耗燃料并产出电力

无需额外代码，现有 tick 循环自动处理。

### 3.6 影响范围

此改动同时影响所有燃料型发电建筑：
- `thermal_power_plant`（燃料：`coal`）
- `mini_fusion_power_plant`（燃料：`hydrogen_fuel_rod`）
- `artificial_star`（燃料：`antimatter_fuel_rod`）

这是正确的行为——这三种建筑在无燃料时都不应显示 `running`。

---

## 四、问题 2 详细设计：高阶舰队线文档口径统一（方案 B）

### 4.1 需要检查和更新的文档

#### 4.1.1 `docs/player/玩法指南.md`

**当前状态：** 已在 line 508 明确标注"这条高阶舰队线当前仍没有公开生产/部署/战斗入口"。

**需要确认/补充：**
- 在"5.2 玩家可下达的核心命令"表格中，`produce` 命令的说明应明确只支持 `worker`/`soldier`
- 在"阶段 F"的单位生产部分（line 369-371），已经写明只支持 `worker`/`soldier`，无需修改
- 在文档末尾的总结中，不应出现"已全部实现"的表述

#### 4.1.2 `docs/player/已知问题与回归.md`

**当前状态：** 已在 line 49-54 和 line 58-70 明确记录了此问题。

**无需修改。**

#### 4.1.3 `docs/dev/客户端CLI.md`

**需要检查：** `produce` 命令的帮助文本是否只列出 `worker`/`soldier`。如果 CLI 帮助文本中有暗示支持更多单位类型的表述，需要修正。

#### 4.1.4 `docs/dev/服务端API.md`

**需要检查：** `POST /commands` 中 `produce` 命令的文档是否只列出 `worker`/`soldier` 作为合法 `unit_type`。

#### 4.1.5 `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`

**需要检查：** 如果有"科技树已全部实现"或"终局玩法已全部覆盖"的表述，需要加注"高阶舰队线（prototype/precision_drone/corvette/destroyer）当前仍为隐藏状态，未对玩家开放"。

### 4.2 文档修改原则

1. 不删除已有的正确描述
2. 在涉及"完整性"声明的位置，统一加注高阶舰队线的排除说明
3. 措辞统一为：

> `prototype`、`precision_drone`、`corvette`、`destroyer` 这条终局高阶舰队线当前仍处于隐藏状态，玩家侧没有公开的生产、部署、编队、查询和战斗入口。当前版本的 DSP 科技树覆盖不包含这条线。

### 4.3 科技树代码保持不变

- `tech.go` 中 4 项科技保持 `Hidden: true`
- `tech_alignment_test.go` 中的断言保持不变
- `config/defs/items/combat/` 下的 4 个 YAML 文件保持不变
- `rules.go:657-662` 的 `produce` 命令验证保持不变

---

## 五、测试方案

### 5.1 `artificial_star` 燃料门禁测试

新增测试文件：`server/internal/gamecore/artificial_star_fuel_test.go`

#### 测试用例 1：无燃料时状态为 idle

```
场景：建造 artificial_star，不装填 antimatter_fuel_rod
预期：
  - building.Runtime.State == "idle"
  - building.Runtime.StateReason == "no_fuel"
  - 发电量为 0
```

#### 测试用例 2：装入燃料后状态变为 running

```
场景：向 artificial_star 的 Storage 装入 antimatter_fuel_rod
预期：
  - 下一 tick 后 building.Runtime.State == "running"
  - 发电量 > 0
  - SSE 发出 building_state_changed 事件
```

#### 测试用例 3：燃料耗尽后状态回到 idle

```
场景：装入 1 个 antimatter_fuel_rod，等待消耗完毕
预期：
  - 消耗完后 building.Runtime.State == "idle"
  - building.Runtime.StateReason == "no_fuel"
```

#### 测试用例 4：thermal_power_plant 同样适用

```
场景：建造 thermal_power_plant，不装填 coal
预期：
  - building.Runtime.State == "idle"
  - building.Runtime.StateReason == "no_fuel"
```

### 5.2 高阶舰队线隐藏状态测试

利用现有 `tech_alignment_test.go` 中的断言（line 77-82）已经覆盖：
- 4 项科技不应有 `TechUnlockUnit` 效果
- 4 项科技均为 `hidden=true`

额外补充一个测试确认 `produce` 命令拒绝非法单位类型：

```
场景：执行 produce 命令，unit_type = "corvette"
预期：返回 VALIDATION_FAILED，message 包含 "unknown unit type"
```

---

## 六、实施步骤

### 步骤 1：修复 `artificial_star` 燃料门禁

1. 在 `building_lifecycle.go` 添加 `stateReasonNoFuel` 常量
2. 在 `rules.go` 的 `settleResources` 函数中添加燃料检查逻辑和辅助函数
3. 编写并运行测试

### 步骤 2：统一文档口径

1. 逐一检查 5 份文档
2. 在需要的位置添加高阶舰队线排除说明
3. 确保无"已全部实现"的误导性表述

### 步骤 3：运行全量测试

```bash
cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./...
```

确保所有现有测试不回退。

---

## 七、不做的事情

1. **不新增 `BuildingWorkState` 枚举值** — 用 `idle` + `reason="no_fuel"` 足够
2. **不修改 `settlePowerGeneration`** — 它的逻辑已经正确
3. **不实现高阶舰队线** — 选择方案 B，保持隐藏
4. **不修改 `tech.go` 中的科技定义** — 保持 `Hidden: true`
5. **不修改 `config/defs/items/combat/` 下的物品定义** — 保持现状
6. **不修改 `produce` 命令的验证逻辑** — 已经正确拒绝非法单位类型
