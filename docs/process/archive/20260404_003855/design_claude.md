# T088 戴森中后期玩法缺口收敛 — 详细设计方案

## 概述

本文档是 `docs/process/task/T088_dyson_mid_late_gameplay_gaps.md` 的实现设计方案，覆盖三个子任务：

- **任务 A**：补齐中后期科技树缺失配方（5 个配方 + 4 个物品定义）
- **任务 B**：打通垂直发射井的完整玩法闭环（火箭生产 → 发射 → 戴森结构增量）
- **任务 C**：调整默认地图配置，使气态行星与轨道采集器在默认游玩路线中可达

---

## 任务 A：补齐中后期科技树缺失配方

### 现状分析

科技树中以下科技的 `Unlocks` 指向了不存在的配方：

| 科技 ID | 声明解锁的配方 | 配方是否存在 | 物品是否存在 |
|---------|--------------|------------|------------|
| `high_strength_crystal` (Lv6) | `titanium_crystal` | ❌ | ❌ |
| `titanium_alloy` (Lv7) | `titanium_alloy` | ❌ | ❌ |
| `lightweight_structure` (Lv7) | `frame_material` | ❌ | ❌ |
| `quantum_chip` (Lv10) | `quantum_chip` | ❌ | ❌ |
| `vertical_launching` (Lv9) | `small_carrier_rocket` | ❌ | ✅ (仅物品常量) |

### 设计方案

#### A1. 新增物品定义

在 `server/internal/model/item.go` 中新增 4 个物品常量和 `itemCatalog` 条目：

```
物品 ID              | 名称               | 分类       | 堆叠上限 | 说明
titanium_crystal     | Titanium Crystal   | component  | 200     | 高强度晶体的中间产物
titanium_alloy       | Titanium Alloy     | material   | 200     | 钛合金，高级结构材料
frame_material       | Frame Material     | component  | 200     | 戴森球框架材料
quantum_chip         | Quantum Chip       | component  | 200     | 量子芯片，高级电子元件
```

`small_carrier_rocket` 已有物品定义（`item.go:90, 582`），无需新增。

#### A2. 新增配方定义

在 `server/internal/model/recipe.go` 的 `recipeCatalog` 中新增 5 个配方：

**配方 1：titanium_crystal**
```
ID:            titanium_crystal
输入:          titanium_ingot ×2, diamond ×1
输出:          titanium_crystal ×1
时长:          40 ticks
能耗:          60
可用建筑:      assembler_mk2, assembler_mk3, recomposing_assembler
科技解锁:      high_strength_crystal
```

说明：参考 DSP 原版，钛晶石由钛锭 + 有机晶体合成。本项目中无 `organic_crystal` 物品，用 `diamond`（已有物品，crystal_smelting 解锁）替代，保持同级科技链的材料依赖关系。

**配方 2：titanium_alloy**
```
ID:            titanium_alloy
输入:          titanium_ingot ×4, steel ×2, sulfuric_acid ×4
输出:          titanium_alloy ×2
时长:          60 ticks
能耗:          80
可用建筑:      arc_smelter, plane_smelter, negentropy_smelter
科技解锁:      titanium_alloy
```

说明：钛合金是冶炼配方，需要钛锭 + 钢材 + 硫酸。产出 2 个以体现冶炼批量特性。

**配方 3：frame_material**
```
ID:            frame_material
输入:          carbon_nanotube ×4, titanium_alloy ×1, high_purity_silicon ×1
输出:          frame_material ×1
时长:          60 ticks
能耗:          80
可用建筑:      assembler_mk2, assembler_mk3, recomposing_assembler
科技解锁:      lightweight_structure
```

说明：框架材料是戴森球核心材料，依赖碳纳米管 + 钛合金 + 高纯硅。`high_purity_silicon` 已有配方（`smelting_purification` 解锁）。

**配方 4：quantum_chip**
```
ID:            quantum_chip
输入:          processor ×2, plane_filter ×2
输出:          quantum_chip ×1
时长:          60 ticks
能耗:          100
可用建筑:      assembler_mk2, assembler_mk3, recomposing_assembler
科技解锁:      quantum_chip
```

说明：量子芯片由处理器 + 位面过滤器合成。`plane_filter` 需确认是否已有物品定义，若无则需同步新增。

**配方 5：small_carrier_rocket**
```
ID:            small_carrier_rocket
输入:          frame_material ×2, deuterium_fuel_rod ×2, quantum_chip ×1
输出:          small_carrier_rocket ×1
时长:          120 ticks
能耗:          200
可用建筑:      vertical_launching_silo
科技解锁:      vertical_launching
```

说明：小型运载火箭是垂直发射井的专属配方。输入材料串联了 frame_material 和 quantum_chip 两条新增产线，形成完整的中后期科技链闭环。时长较长（120 ticks）体现火箭制造的复杂度。

#### A3. 物品依赖检查

新增配方引用的已有物品/配方确认：

| 引用物品 | 来源 | 状态 |
|---------|------|------|
| `titanium_ingot` | `smelt_titanium` 配方 | ✅ 已有 |
| `diamond` | `crystal_smelting` 科技解锁 | ⚠️ 需确认 item.go 中是否存在 |
| `steel` | `steel_smelting` 科技解锁 | ⚠️ 需确认 item.go 中是否存在 |
| `sulfuric_acid` | `sulfuric_acid` 配方 | ✅ 已有 |
| `carbon_nanotube` | `carbon_nanotube` 配方 | ✅ 已有 |
| `high_purity_silicon` | `smelting_purification` 解锁 | ⚠️ 需确认 item.go 中是否存在 |
| `processor` | `processor` 配方 | ✅ 已有 |
| `plane_filter` | `wave_interference` 科技解锁 | ⚠️ 需确认 item.go 中是否存在 |
| `deuterium_fuel_rod` | `deuterium_fuel_rod` 配方 | ✅ 已有 |

实现时需先扫描 `item.go` 确认标记 ⚠️ 的物品是否已定义。若缺失，需同步补齐物品定义（但不在本任务范围内新增额外配方，仅补物品条目）。如果某个物品确实不存在，则对应配方的输入材料需要调整为已有的等价替代物。

---

## 任务 B：垂直发射井完整玩法闭环

### 现状分析

当前状态：
- `vertical_launching_silo` 建筑已定义（`building_defs.go:569`）
- `LaunchModule` 运行时结构已定义（`building_runtime.go:193`），含 `RocketItemID`、`ProductionSpeed` 等字段
- 但没有 `small_carrier_rocket` 配方 → 建筑无法生产火箭
- `launch_solar_sail` 命令明确拒绝非 EM Rail Ejector 建筑（`rules.go:1502`）
- 没有独立的火箭发射命令
- 发射结果没有接入戴森结构增量

### 设计方案

#### B1. 火箭生产闭环

垂直发射井的生产逻辑复用现有建筑生产结算框架：

1. 建筑 `vertical_launching_silo` 的 `DefaultRecipe` 设为 `small_carrier_rocket`
2. 玩家也可通过 `build x y vertical_launching_silo --recipe small_carrier_rocket` 指定配方
3. 生产结算走现有的 `production_settlement.go` 流程：
   - 从物流站/本地存储获取输入材料
   - 按 `Duration` 计时
   - 产出 `small_carrier_rocket` 存入建筑本地存储
4. 建筑存储上限：`small_carrier_rocket` 最多缓存 5 个（通过 `LaunchModule.LaunchQueueSize` 控制）

#### B2. 新增命令：launch_rocket

新增独立的火箭发射命令，不复用 `launch_solar_sail`。

**命令定义**

在 `server/internal/model/command.go` 中新增：
```go
CmdLaunchRocket CommandType = "launch_rocket"
```

**命令载荷**
```json
{
  "building_id": "b-42",
  "target_system_id": "sys-1",
  "target_layer": 0,
  "target_node_id": "p1-node-l0-latp1000-lonp2000"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `building_id` | string | 是 | 垂直发射井的建筑 ID |
| `target_system_id` | string | 是 | 目标恒星系 ID |
| `target_layer` | int | 否 | 目标戴森球层级，默认 0 |
| `target_node_id` | string | 否 | 目标节点 ID（若指定，火箭增强该节点；若不指定，增强整层结构） |

**执行逻辑**

在 `server/internal/gamecore/` 下新建 `rocket_launch.go`：

```
func (gc *GameCore) execLaunchRocket(w *model.World, playerID string, cmd model.Command) (model.CommandResult, []model.Event)
```

执行流程：

1. **验证建筑**：
   - 建筑存在且属于当前玩家
   - 建筑类型为 `vertical_launching_silo`
   - 建筑状态为 `BuildingWorkRunning`

2. **验证火箭库存**：
   - 建筑存储中有 `small_carrier_rocket` ≥ 1

3. **验证目标**：
   - `target_system_id` 对应的恒星系存在
   - 玩家在该恒星系有戴森球状态（至少有一个节点/框架/壳面）
   - 若指定 `target_node_id`，该节点必须存在

4. **消耗火箭**：
   - 从建筑存储中扣除 1 个 `small_carrier_rocket`

5. **应用戴森结构增量**：
   - 若指定了 `target_node_id`：增加该节点的 `Integrity` 值（+0.2，上限 1.0），并增加节点 `EnergyOutput`（+5）
   - 若未指定节点：增加目标层的整体结构强度
     - 遍历该层所有节点，每个节点 `Integrity` +0.05（上限 1.0）
     - 增加层级 `EnergyOutput`（+20）

6. **生成事件**：
   - `EvtRocketLaunched`（新事件类型）：包含 `building_id`、`target_system_id`、`target_layer`、`target_node_id`、`integrity_delta`

7. **返回结果**：
   - 成功：返回发射详情和目标结构的新状态
   - 失败：返回具体错误原因

**命令注册**

在 `server/internal/gamecore/core.go` 的命令分发 switch 中新增：
```go
case model.CmdLaunchRocket:
    res, evts = gc.execLaunchRocket(gc.world, qr.PlayerID, cmd)
```

#### B3. 新增事件类型

在 `server/internal/model/event.go` 中新增：
```go
EvtRocketLaunched EventType = "rocket_launched"
```

事件载荷：
```json
{
  "building_id": "b-42",
  "rocket_item": "small_carrier_rocket",
  "target_system_id": "sys-1",
  "target_layer": 0,
  "target_node_id": "p1-node-l0-latp1000-lonp2000",
  "integrity_delta": 0.2,
  "new_integrity": 0.8
}
```

#### B4. CLI 命令入口

在客户端 CLI 中新增 `launch_rocket` 命令：

```
launch_rocket <building_id> <target_system_id> [--layer <n>] [--node <node_id>]
```

示例：
```bash
# 向 sys-1 的第 0 层发射火箭，增强整层结构
launch_rocket b-42 sys-1

# 向 sys-1 的第 0 层指定节点发射火箭
launch_rocket b-42 sys-1 --layer 0 --node p1-node-l0-latp1000-lonp2000
```

#### B5. 自动发射模式（可选增强）

垂直发射井可配置自动发射模式：当建筑存储中有火箭时，每隔 `LaunchModule.LaunchInterval` ticks 自动发射一枚。

实现方式：在 `vertical_launching_silo` 的结算逻辑中检查：
- 建筑是否设置了自动发射目标（通过新增的 `set_launch_target` 命令配置）
- 存储中是否有火箭
- 是否到达发射间隔

此功能为可选增强，优先级低于手动发射闭环。

---

## 任务 C：默认地图支持气态行星

### 现状分析

当前 `server/map.yaml` 配置：
```yaml
system_count: 1
planets_per_system: 1
```

只有 1 个恒星系、1 颗行星。由于气态行星的生成依赖轨道距离超过雪线（`2.7 * sqrt(luminosity)`），单颗行星几乎必然是近轨道的岩石行星。

### 设计方案

#### C1. 调整默认 map.yaml

直接修改 `server/map.yaml`，扩大默认地图规模：

```yaml
galaxy:
  system_count: 2
  width: 2000
  height: 2000

system:
  planets_per_system: 3
  gas_giant_ratio: 0.5
  max_moons: 4
```

关键变更：
- `system_count: 1 → 2`：两个恒星系，支持星际物流玩法
- `planets_per_system: 1 → 3`：每个恒星系 3 颗行星，确保有足够的轨道距离产生气态行星
- `gas_giant_ratio: 0.35 → 0.5`：提高气态行星概率，确保默认一局中大概率出现至少一颗气态行星
- `galaxy width/height: 1000 → 2000`：扩大星系空间以容纳更多恒星系

#### C2. 概率分析

以 `planets_per_system: 3` 和 `gas_giant_ratio: 0.5` 计算：

- 第 1 颗行星：轨道 0.3-0.6 AU，几乎必然在雪线内 → 岩石行星
- 第 2 颗行星：轨道 ≈ 0.6-1.3 AU，可能在雪线附近 → 取决于恒星光度
- 第 3 颗行星：轨道 ≈ 1.2-2.9 AU，大概率超过雪线 → 50% 概率为气态行星

两个恒星系各 3 颗行星 = 6 颗行星总计，至少出现 1 颗气态行星的概率 > 90%。

若需要 100% 保证，可考虑方案 C3。

#### C3. 备选方案：保底气态行星生成

如果概率方案不够可靠，可在 `server/internal/mapgen/generate.go` 的 `generateSystem()` 中增加保底逻辑：

```
在生成完所有行星后，检查是否存在至少一颗气态行星。
如果没有，将最外层轨道的行星强制设为 gas_giant。
```

这是一个最小改动，只需在 `generate.go` 的行星生成循环后加一个检查。

实现位置：`server/internal/mapgen/generate.go`，在 `generateSystem()` 函数末尾。

#### C4. 玩法指南更新

更新 `docs/player/玩法指南.md` 中的相关章节：

- 更新"默认地图"描述：从单星系单行星改为双星系多行星
- 补充气态行星玩法说明：如何找到气态行星、建造轨道采集器
- 补充星际物流说明：如何在多星系间运输资源

---

## 文件变更清单

### 必须修改的文件

| 文件 | 变更内容 |
|------|---------|
| `server/internal/model/item.go` | 新增 4 个物品常量 + itemCatalog 条目 |
| `server/internal/model/recipe.go` | 新增 5 个配方定义 |
| `server/internal/model/command.go` | 新增 `CmdLaunchRocket` 命令类型 |
| `server/internal/model/event.go` | 新增 `EvtRocketLaunched` 事件类型 |
| `server/internal/gamecore/core.go` | 命令分发 switch 中注册 `CmdLaunchRocket` |
| `server/internal/gamecore/rocket_launch.go` | 新建：火箭发射命令执行逻辑 |
| `server/map.yaml` | 调整默认地图配置 |
| `docs/dev/服务端API.md` | 新增 `launch_rocket` 命令文档 |
| `docs/dev/客户端CLI.md` | 新增 `launch_rocket` CLI 命令文档 |
| `docs/player/玩法指南.md` | 更新中后期玩法说明 |

### 可能需要修改的文件

| 文件 | 条件 | 变更内容 |
|------|------|---------|
| `server/internal/model/building_defs.go` | 若需设置默认配方 | `vertical_launching_silo` 的 `DefaultRecipe` 字段 |
| `server/internal/gamecore/production_settlement.go` | 若发射井生产逻辑需特殊处理 | 确认通用生产结算是否适用 |
| `server/internal/mapgen/generate.go` | 若采用方案 C3 | 增加气态行星保底逻辑 |
| `client/` 或 `client-web/` | CLI 命令注册 | 新增 `launch_rocket` 命令解析 |

---

## 实现顺序

建议按以下顺序实现，每步完成后可独立测试：

1. **任务 A**：补齐物品 + 配方（纯数据层，无逻辑变更，风险最低）
2. **任务 C**：调整 map.yaml（配置变更，可立即验证气态行星生成）
3. **任务 B**：实现火箭发射闭环（涉及新命令 + 新逻辑，复杂度最高）

---

## 验收检查项

- [ ] `go test ./...` 全部通过
- [ ] `/catalog` 接口返回 `titanium_crystal`、`titanium_alloy`、`frame_material`、`quantum_chip`、`small_carrier_rocket` 五个配方
- [ ] 研究 `high_strength_crystal` 后 `/catalog` 显示 `titanium_crystal` 配方已解锁
- [ ] 研究 `titanium_alloy` 后 `/catalog` 显示 `titanium_alloy` 配方已解锁
- [ ] 研究 `lightweight_structure` 后 `/catalog` 显示 `frame_material` 配方已解锁
- [ ] 研究 `quantum_chip` 后 `/catalog` 显示 `quantum_chip` 配方已解锁
- [ ] 研究 `vertical_launching` 后可建造 `vertical_launching_silo` 并配置 `small_carrier_rocket` 配方
- [ ] 垂直发射井能实际生产 `small_carrier_rocket`
- [ ] `launch_rocket` 命令能成功发射火箭并影响戴森结构 `Integrity` 和 `EnergyOutput`
- [ ] 默认 map.yaml 启动后，`/galaxy` 接口返回至少 2 个恒星系
- [ ] 至少一颗行星为 `gas_giant` 类型
- [ ] 在气态行星上可成功建造 `orbital_collector`
- [ ] 文档已同步更新
