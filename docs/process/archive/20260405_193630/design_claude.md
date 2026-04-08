# T103 实现方案：戴森科技树不可达建筑与空科技节点

> 基于 `docs/process/finished_task/T103_戴森科技树不可达建筑与空科技节点.md` 的设计方案。

## 1. 根因分析

### 1.1 `automatic_piler` 与 `satellite_substation` 不可达

**根因：** 科技树 `defaultTechDefinitions` 中没有任何科技节点的 `Unlocks` 直接或间接引用这两个建筑。

虽然 `techUnlockAliases` 中存在以下映射：
- `auto_stacker` → `automatic_piler`
- `stacker` → `automatic_piler`
- `energy_pylon` → `satellite_substation`

但 `defaultTechDefinitions` 中没有任何科技节点使用 `auto_stacker`、`stacker`、`energy_pylon`、`automatic_piler` 或 `satellite_substation` 作为 unlock ID。因此这两个建筑虽然在 `building_defs.go` 中标记为 `Buildable: true`，但玩家永远无法通过科技研究解锁它们。

建造校验链路：
1. `rules.go:77` 检查 `def.Buildable` → `true`（通过）
2. `rules.go:85` 调用 `CanBuildTech(player, TechUnlockBuilding, "automatic_piler")` → 遍历玩家已完成科技的 `Unlocks`，找不到匹配项 → `false`（拒绝）

结果：`/catalog` 宣称 `buildable=true`，但 authoritative 建造校验永远拒绝。

### 1.2 空科技节点

**根因：** `normalizeTechUnlocks` 在初始化时会过滤掉引用了不存在的 recipe/building/unit 的 unlock。

具体机制（`tech.go:1677-1713`）：
- `TechUnlockBuilding` 类型：如果 `defaultBuildingDefinitions` 中不存在该 building ID，则过滤
- `TechUnlockRecipe` 类型：如果 `recipeCatalog` 中不存在该 recipe ID，则过滤
- `TechUnlockUnit` 类型：如果 `runtimeSupportedUnitUnlocks()` 中不存在该 unit ID，则过滤

当前 `recipeCatalog` 只有 47 个配方，但科技树引用了大量尚未实现的配方 ID。以下科技节点的所有 unlock 在归一化后被完全清空：

| 科技节点 | 原始 Unlock | 被过滤原因 |
|---------|------------|-----------|
| `engine` | `{unit, engine}` | `runtimeSupportedUnitUnlocks` 只含 `logistics_drone`/`logistics_ship` |
| `steel_smelting` | `{recipe, steel}` | `recipeCatalog` 中无 `steel` |
| `combustible_unit` | `{recipe, combustible_unit}` | `recipeCatalog` 中无 `combustible_unit` |
| `crystal_smelting` | `{recipe, diamond}`, `{recipe, crystal}` | `recipeCatalog` 中无这两个 ID |
| `polymer_chemical` | `{recipe, organic_crystal}` | `recipeCatalog` 中无 `organic_crystal` |
| `xray_cracking` | `{recipe, xray_cracking}` | `recipeCatalog` 中无 `xray_cracking` |
| `super_magnetic` | `{recipe, super_magnetic_ring}` | `recipeCatalog` 中无 `super_magnetic_ring` |
| `reformed_refinement` | `{recipe, reformed_refinement}` | `recipeCatalog` 中无 `reformed_refinement` |
| `thruster` | `{recipe, thruster}` | `recipeCatalog` 中无 `thruster` |
| `proliferator_mk2` | `{recipe, proliferator_mk2}` | `recipeCatalog` 中无 `proliferator_mk2` |
| `proliferator_mk3` | `{recipe, proliferator_mk3}` | `recipeCatalog` 中无 `proliferator_mk3` |
| `particle_control` | `{recipe, particle_broadband}` | `recipeCatalog` 中无 `particle_broadband` |
| `high_strength_glass` | `{recipe, titanium_glass}` | `recipeCatalog` 中无 `titanium_glass` |
| `casimir_crystal` | `{recipe, casimir_crystal}` | `recipeCatalog` 中无 `casimir_crystal` |
| `titanium_ammo` | `{recipe, titanium_ammo}` | `recipeCatalog` 中无 `titanium_ammo` |
| `supersonic_missile` | `{recipe, supersonic_missile}` | `recipeCatalog` 中无 `supersonic_missile` |
| `crystal_explosive` | `{recipe, crystal_explosive}` | `recipeCatalog` 中无 `crystal_explosive` |
| `crystal_shell` | `{recipe, crystal_shell}` | `recipeCatalog` 中无 `crystal_shell` |
| `wave_interference` | `{recipe, plane_filter}` | `recipeCatalog` 中无 `plane_filter` |

这些科技节点在 `defaultTechDefinitions` 中有明确的 unlock 定义，但因为对应的 recipe/unit 尚未在 `recipeCatalog` 或 `runtimeSupportedUnitUnlocks` 中实现，归一化后 `Unlocks` 变为空数组。

**注意：** 这些科技节点本身不是"错误"——它们是科技树的合法组成部分，只是对应的配方/单位尚未实现。问题在于它们以"已完成"的姿态暴露给玩家，但研究后没有任何实际收益。

## 2. 方案选择

### 2.1 `automatic_piler` 与 `satellite_substation`：采用方案 A（接回科技树）

**理由：**
- 这两个建筑的 runtime 定义（`building_runtime.go`）、建造成本（`building_catalog.go`）、电网行为（`power_grid.go`）都已完整实现
- 只缺科技树入口，补一行 unlock 即可闭合
- 方案 B（移除）需要改动更多文件且会丢失已实现的功能

**具体改动：**

#### `automatic_piler` 归属科技：`integrated_logistics`（整合物流系统，Level 7）

选择理由：
- `automatic_piler`（自动集装机）属于物流分支的高级建筑
- `integrated_logistics` 当前只解锁 `pile_sorter`，是物流分支 Level 7 的唯一科技
- DSP 原作中自动集装机也属于物流系统的中后期解锁
- 前置链路：`electromagnetism` → `electromagnetic_drive` → `improved_logistics` → `efficient_logistics` → `integrated_logistics`，路径合理

改动位置：`server/internal/model/tech.go`，`integrated_logistics` 科技节点的 `Unlocks` 数组

```go
// 当前
Unlocks: []TechUnlock{
    {Type: TechUnlockBuilding, ID: string(BuildingTypePileSorter)},
},

// 改为
Unlocks: []TechUnlock{
    {Type: TechUnlockBuilding, ID: string(BuildingTypePileSorter)},
    {Type: TechUnlockBuilding, ID: string(BuildingTypeAutomaticPiler)},
},
```

#### `satellite_substation` 归属科技：`satellite_power`（卫星配电系统，Level 8）

选择理由：
- `satellite_substation`（卫星配电站）是电网分支的高级建筑，覆盖范围大于 `wireless_power_tower`
- `satellite_power` 科技名称直接对应"卫星配电"，语义完全匹配
- `satellite_power` 当前只有 `{special, satellite_power}` 这一个 unlock，没有解锁任何建筑
- 前置链路：`solar_collection` → `solar_sail_orbit` → `ray_receiver` → `satellite_power`，属于戴森/能源分支的中后期，与卫星配电站的定位一致

改动位置：`server/internal/model/tech.go`，`satellite_power` 科技节点的 `Unlocks` 数组

```go
// 当前
Unlocks: []TechUnlock{
    {Type: TechUnlockSpecial, ID: "satellite_power"},
},

// 改为
Unlocks: []TechUnlock{
    {Type: TechUnlockSpecial, ID: "satellite_power"},
    {Type: TechUnlockBuilding, ID: string(BuildingTypeSatelliteSubstation)},
},
```

### 2.2 空科技节点：采用隐藏方案

**理由：**
- 这 19 个空节点对应的配方/单位尚未实现，短期内不会补齐全部配方
- 如果为每个空节点补齐配方，涉及 item 定义、recipe 定义、建筑产线适配、平衡性调整等大量工作，远超 T103 范围
- 隐藏后不影响已实现的科技树主线和分支，玩家不会看到"研究了但没用"的节点
- 后续实现配方时，只需去掉 `Hidden: true` 即可重新暴露

**具体改动：**

在 `server/internal/model/tech.go` 的 `normalizeTechDefinitions` 函数中，对归一化后 `Unlocks` 和 `Effects` 均为空且 `MaxLevel == 0`（非可重复升级）的科技节点，自动设置 `Hidden: true`。

```go
func normalizeTechDefinitions(defs []TechDefinition) []TechDefinition {
    out := make([]TechDefinition, len(defs))
    for i := range defs {
        out[i] = defs[i]
        out[i].Unlocks = normalizeTechUnlocks(defs[i].Unlocks)
        switch out[i].ID {
        case "plane_filter_smelting":
            out[i].Unlocks = appendUniqueUnlock(out[i].Unlocks, TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypePlaneSmelter)})
        case "quantum_printing":
            out[i].Unlocks = appendUniqueUnlock(out[i].Unlocks, TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeNegentropySmelter)})
        }
        // 自动隐藏归一化后无实际产出的非可重复科技
        if len(out[i].Unlocks) == 0 && len(out[i].Effects) == 0 && out[i].MaxLevel == 0 {
            out[i].Hidden = true
        }
    }
    return out
}
```

**选择自动隐藏而非手动标记的理由：**
- 避免在 19 个科技定义上逐个添加 `Hidden: true`，减少改动量
- 当后续实现某个配方（如 `steel`）并加入 `recipeCatalog` 后，对应科技（`steel_smelting`）的 unlock 会自动通过归一化保留，不再满足"空节点"条件，自动恢复可见
- 逻辑自洽：如果一个科技研究后没有任何实际效果，就不应该暴露给玩家

**需要注意的边界情况：**
- `dyson_sphere_program`（Level 0）有 unlock，不受影响
- 所有 `TechCategoryBonus` 类型的科技都有 `Effects` 或 `MaxLevel > 0`，不受影响
- `satellite_power` 在补上 `satellite_substation` 后有 unlock，不受影响
- `dark_fog_matrix` 已经是 `Hidden: true`，不受影响

### 2.3 `/catalog` 一致性修复

当前 `/catalog` 的 `BuildingCatalogEntry.Buildable` 直接取自 `BuildingDefinition.Buildable`，不考虑科技可达性。这导致 `automatic_piler` 和 `satellite_substation` 在修复前显示 `buildable=true` 但实际不可建。

**方案 A 实施后此问题自动消解：** 两个建筑都有了科技解锁路径，`buildable=true` 的含义变为"该建筑类型支持建造（需要对应科技）"，与 authoritative 行为一致。

**额外改进：** 在 `BuildingCatalogEntry` 中补充 `UnlockTech` 字段，让前端/CLI 能展示"需要研究 XX 科技才能建造"。

当前 `BuildingDefinition` 已有 `UnlockTech []string` 字段，但 `defaultBuildingDefinitions` 中没有填充。需要在 `normalizeTechDefinitions` 完成后，反向填充每个建筑的 `UnlockTech`。

改动位置：`server/internal/model/building_catalog.go`，在 `init()` 或建筑目录初始化时，遍历所有科技定义，将 `TechUnlockBuilding` 类型的 unlock 反向写入对应建筑的 `UnlockTech`。

```go
func init() {
    // 在建筑目录初始化完成后，反向填充 UnlockTech
    for _, tech := range AllTechDefinitions() {
        if tech == nil || tech.Hidden {
            continue
        }
        for _, unlock := range tech.Unlocks {
            if unlock.Type != TechUnlockBuilding {
                continue
            }
            bt := BuildingType(unlock.ID)
            if def, ok := buildingCatalogMap[bt]; ok {
                def.UnlockTech = append(def.UnlockTech, tech.ID)
                buildingCatalogMap[bt] = def
            }
        }
    }
}
```

**注意：** 由于 Go 的 `init()` 执行顺序依赖文件名排序，需要确保建筑目录和科技目录都已初始化后再执行反向填充。如果存在初始化顺序问题，可以改为 lazy init 或在 `AllBuildingDefinitions()` 首次调用时执行。

## 3. 完整改动清单

### 3.1 `server/internal/model/tech.go`

| 改动 | 说明 |
|------|------|
| `integrated_logistics.Unlocks` 追加 `{building, automatic_piler}` | 闭合自动集装机的科技可达性 |
| `satellite_power.Unlocks` 追加 `{building, satellite_substation}` | 闭合卫星配电站的科技可达性 |
| `normalizeTechDefinitions` 追加空节点自动隐藏逻辑 | 隐藏 19 个无实际产出的科技节点 |

### 3.2 `server/internal/model/building_catalog.go`

| 改动 | 说明 |
|------|------|
| 新增 `UnlockTech` 反向填充逻辑 | 让 `/catalog` 返回每个建筑的解锁科技信息 |

### 3.3 `docs/player/玩法指南.md`

| 改动 | 说明 |
|------|------|
| `automatic_piler` 标注需要 `integrated_logistics` 科技 | 文档与 authoritative 一致 |
| `satellite_substation` 标注需要 `satellite_power` 科技 | 文档与 authoritative 一致 |
| 移除空科技节点相关的玩法描述（如有） | 文档与实际可见科技树一致 |

### 3.4 测试

新增测试文件：`server/internal/gamecore/tech_reachability_test.go`

```go
func TestAutomaticPilerRequiresTech(t *testing.T) {
    // 1. 新玩家（只有 dyson_sphere_program）不能建造 automatic_piler
    // 2. 完成 integrated_logistics 后可以建造
}

func TestSatelliteSubstationRequiresTech(t *testing.T) {
    // 1. 新玩家不能建造 satellite_substation
    // 2. 完成 satellite_power 后可以建造
}

func TestCatalogNoBuildableWithoutTechPath(t *testing.T) {
    // 遍历 /catalog.buildings，对每个 buildable=true 的建筑，
    // 验证至少存在一个非 hidden 科技节点解锁它
}

func TestCatalogNoEmptyVisibleTech(t *testing.T) {
    // 遍历 /catalog.techs，对每个非 hidden、非可重复升级的科技，
    // 验证 unlocks 或 effects 不为空
}
```

## 4. 不在本次范围内的问题

以下问题在本次调查中发现，但不属于 T103 范围，记录备查：

1. **`miniature_collider` ↔ `strange_matter` 循环依赖：** `miniature_collider` 的前置是 `strange_matter`，而 `strange_matter` 的前置是 `miniature_collider`，形成死锁。两个科技都不可达。
2. **`dyson_sphere_partial` 未定义：** `universe_matrix` 的前置包含 `dyson_sphere_partial`，但该科技 ID 不存在于 `defaultTechDefinitions` 中，导致 `universe_matrix` 不可达。
3. **47 个已实现配方 vs 科技树引用的配方数量差距大：** 大量科技树引用的配方尚未实现，这是空节点问题的根本原因。后续应按优先级逐步补齐配方。

## 5. 实施顺序

1. 修改 `tech.go`：补 `automatic_piler` 和 `satellite_substation` 的科技 unlock
2. 修改 `tech.go`：在 `normalizeTechDefinitions` 中追加空节点自动隐藏
3. 修改 `building_catalog.go`：反向填充 `UnlockTech`
4. 新增 `tech_reachability_test.go`：防回归测试
5. 运行 `go test ./...` 确认全部通过
6. 更新 `docs/player/玩法指南.md`
7. 提交
