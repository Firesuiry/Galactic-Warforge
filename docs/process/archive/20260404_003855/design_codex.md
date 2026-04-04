# T088 戴森中后期玩法缺口收敛 - 详细设计方案（Codex）

## 1. 文档目标

本文针对 `docs/process/task/T088_dyson_mid_late_gameplay_gaps.md`，基于 2026-04-03 的实际代码现状给出可实施的设计方案。

本方案覆盖三个子问题：

1. 补齐中后期科技链缺失的 5 个关键配方。
2. 把 `vertical_launching_silo` 从“有 runtime 壳体但不可玩”补到“可生产火箭、可发射、可产生戴森结构收益”。
3. 让官方文档中的气态行星 / 轨道采集器路线变成真实可复现的流程。

本方案同时明确两个边界：

- 不在 T088 中顺手清洗整个科技树里所有历史遗留空 unlock。
- 不在 T088 中硬上“通用多星球长期经营 / 任意 active planet 切换”大重构。

补充说明：

- 当前 `server/` 基线是可编译、可测试的。已验证：`cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./...` 全部通过。
- 因此本文会把“现有可运行能力”和“T088 需要新增的缺口”分开写，不把所有问题混在一起。

## 2. 当前实现的真实断点

### 2.1 任务 A 的断点不只是“少几个配方”

当前代码里同时存在四层问题：

1. `server/internal/model/recipe.go` 里确实没有：
   - `titanium_crystal`
   - `titanium_alloy`
   - `frame_material`
   - `quantum_chip`
   - `small_carrier_rocket`
2. `server/internal/model/item.go` 里只有 `small_carrier_rocket`，另外 4 个物品本体也不存在。
3. `server/internal/model/tech.go` 的 `normalizeTechUnlocks()` 会过滤掉“指向不存在 recipe 的 unlock”，所以 `/catalog` 里这些科技的 `unlocks` 会直接消失，而不是保留一个坏引用。
4. `vertical_launching` 当前把 `small_carrier_rocket` 写成了 `TechUnlockBuilding`，再经 alias 归一化后变成 `TechUnlockSpecial`。这意味着即便把火箭配方补进去，不改科技定义的话，`/catalog` 里它也不会表现成 recipe unlock。

结论：

- 任务 A 必须同时改 `item.go`、`recipe.go`、`tech.go`。
- 只补 recipe，不补 item / unlock type，验收仍然会失败。

### 2.2 任务 B 的断点是一条完整链路同时断了 4 处

当前 `vertical_launching_silo` 已经有：

- `ProductionModule`
- `LaunchModule`
- `LaunchModule.RocketItemID = small_carrier_rocket`

但仍然不可玩，原因是：

1. 没有 `small_carrier_rocket` recipe。
2. `build` 的建筑实例化路径没有“默认配方”能力，只有显式 `--recipe` 才会把 `task.RecipeID` 写进建筑实例。
3. `vertical_launching_silo` 的唯一输入口当前只允许 `small_carrier_rocket`，这会导致它即使设置了火箭 recipe，也吃不到 `frame_material / quantum_chip / deuterium_fuel_rod` 这类原料。
4. 命令层只有 `launch_solar_sail`，并且 `server/internal/gamecore/rules.go` 明确拒绝非 `em_rail_ejector` 建筑。

结论：

- 任务 B 不能只加一个 `launch_rocket` 命令。
- 必须同时补建筑默认配方、IO 口约束、服务器命令枚举、网关预检、CLI / shared-client 入口，以及戴森结构收益写入点。

### 2.3 任务 C 不能靠“把 map.yaml 从 1x1 改成 2x3”单独解决

当前阻断点有三层：

1. `server/map.yaml` 仍是：
   - `galaxy.system_count = 1`
   - `system.planets_per_system = 1`
2. `server/internal/mapgen/generate.go` 的气态行星生成是概率逻辑，不是保底逻辑；仅把行星数拉大，也只是“更可能出现”，不是“官方流程可复现”。
3. 更关键的是：当前运行态只有一个 `WorldState`，它只对应单个 `PlanetID`。
   - `scan_planet` 只做 discovery，不会切换模拟世界。
   - `query.PlanetRuntime()` 对非 active planet 直接返回 `Available=false`。
   - `build` 只作用在当前 `WorldState.PlanetID`。

这意味着：

- 即使默认地图里生成出一颗气态行星，玩家现在也没有通用入口把运行态切到那颗行星上去建 `orbital_collector`。
- 所以“只改默认 `map.yaml`”并不能满足 T088 对“官方可复现路线”的验收要求。

## 3. 方案对比与推荐

### 3.1 可选路线

**方案 A：只补 5 个 recipe + 直接扩默认 `server/map.yaml`**

- 优点：改动表面最少。
- 缺点：任务 C 实际不成立，因为仍然没有在非 active planet 上建造的入口。
- 结论：不推荐。

**方案 B：补 recipe，新增 `launch_rocket`，再做通用 active planet 切换**

- 优点：长期最完整，真正往“多星球可经营”推进。
- 缺点：会触碰 `WorldState` 单星球模型、启动恢复、查询层、保存结构，已经超出 T088 的收敛范围。
- 结论：适合作为后续独立任务，不适合作为 T088 当前解法。

**方案 C：补 recipe + 补火箭链路 + 增加“中后期官方场景”**

- 内容：
  - 任务 A 完整补齐。
  - 任务 B 完整补齐。
  - 任务 C 不改“通用 runtime 多星球切换”，而是增加一个可复现的中后期场景：
    - 可指定初始 active planet
    - 可指定玩家初始科技 / 资源 / 物品
    - 可指定场景地图中某颗行星强制为 `gas_giant`
- 优点：
  - 能在当前单 `WorldState` 架构下，把 `gas_giants` / `orbital_collector` 变成官方可复现流程。
  - 风险和改动量都明显小于通用 active planet 切换。
- 缺点：
  - 它解决的是“官方可玩路线”和“文档真实性”，不是“所有新局都能自然打到气态行星”。
- 结论：**推荐作为 T088 的正式方案。**

## 4. 总体设计原则

### 4.1 任务 A 用“现有物料闭环优先”，不引入额外高阶占位物

当前代码里像 `steel`、`diamond`、`plane_filter`、`organic_crystal` 这些名字已经在科技树里出现，但 recipe / item 本体并不完整。

如果本次还继续用这些“历史上想做但现在没做完”的物料去设计新 recipe，会把 T088 变成更大的“全科技树修复”任务。

因此本方案的原则是：

- T088 只使用当前已经真实存在的 item / recipe 作为上游输入。
- 先把戴森中后期主线卡点补通。
- 更广义的科技树清洗，另开任务。

### 4.2 任务 B 保留 `build_dyson_*` 的实验性脚手架定位

任务文档已经明确：

- 不要求把现有 `build_dyson_*` 强行改成完整材料门槛版。

因此本方案不把 `build_dyson_*` 改成“必须先发火箭才能创建组件”的重路径，而是：

- 继续把它们保留为实验性 scaffold / debug 入口。
- 新增 `launch_rocket` 走“玩家可玩闭环”。
- 火箭发射对戴森层写入真实的结构增益状态，让它至少不再只是建筑本地缓存的空转产物。

### 4.3 任务 C 只解决“官方可复现路线”，不偷渡通用星球切换架构

T088 的目标是收敛玩法缺口，不是完成多星球 runtime 重构。

因此推荐落地是：

- 新增一个中后期场景配置。
- 文档把 `orbital_collector` 的验证路径切到这个场景。
- 后续若要支持“一局从开荒星自然转到气态行星继续经营”，再单独做 active planet 架构任务。

## 5. 任务 A：中后期缺失配方补齐

### 5.1 新增物品

在 `server/internal/model/item.go` 中新增以下 4 个物品定义：

| 物品 ID | 分类 | 建议堆叠 | 说明 |
| --- | --- | ---: | --- |
| `titanium_crystal` | `component` | 100 | 高强度晶体链的中间件 |
| `titanium_alloy` | `material` | 100 | 戴森与星际建筑的高级结构材料 |
| `frame_material` | `component` | 100 | 戴森结构与火箭链共享材料 |
| `quantum_chip` | `component` | 50 | 垂直发射与高阶电子链的关键件 |

说明：

- `small_carrier_rocket` 继续沿用现有定义，不新增第二份常量。
- 不在 T088 中额外补 `steel` / `diamond` / `plane_filter` / `organic_crystal` 这类更大范围的历史缺项。

### 5.2 新增配方

在 `server/internal/model/recipe.go` 中新增以下 5 个 recipe。

这些配方刻意只依赖当前已存在的 item / recipe，保证 T088 自闭环：

| Recipe ID | 输入 | 输出 | 建筑 | 设计理由 |
| --- | --- | --- | --- | --- |
| `titanium_crystal` | `titanium_ingot x2`, `graphene x1` | `titanium_crystal x1` | `assembling_machine_mk1/2/3` | 用现有钛 + 化工链替代历史上缺失的 `organic_crystal` 路线 |
| `titanium_alloy` | `titanium_ingot x4`, `energetic_graphite x2`, `sulfuric_acid x2` | `titanium_alloy x2` | `arc_smelter`, `plane_smelter`, `negentropy_smelter` | 仍保留“冶炼型高级材料”的感觉，但不依赖 `steel` |
| `frame_material` | `carbon_nanotube x2`, `titanium_alloy x1`, `processor x1` | `frame_material x1` | `assembling_machine_mk1/2/3` | 直接把化工、冶炼、电子三条现有链汇合 |
| `quantum_chip` | `processor x2`, `microcrystalline_component x2`, `carbon_nanotube x1` | `quantum_chip x1` | `assembling_machine_mk1/2/3` | 不依赖 `plane_filter`，但仍保持明显的中后期复杂度 |
| `small_carrier_rocket` | `frame_material x2`, `deuterium_fuel_rod x2`, `quantum_chip x2` | `small_carrier_rocket x1` | `vertical_launching_silo` | 直接把火箭链挂到本次新增的两条新产线之上 |

建议时长与能耗：

- `titanium_crystal`: `duration=80`, `energy_cost=4`
- `titanium_alloy`: `duration=100`, `energy_cost=6`
- `frame_material`: `duration=120`, `energy_cost=6`
- `quantum_chip`: `duration=140`, `energy_cost=8`
- `small_carrier_rocket`: `duration=200`, `energy_cost=12`

### 5.3 科技定义修正

在 `server/internal/model/tech.go` 中做两类修正：

1. 保持以下 tech -> recipe 对齐关系真实存在：
   - `high_strength_crystal -> titanium_crystal`
   - `titanium_alloy -> titanium_alloy`
   - `lightweight_structure -> frame_material`
   - `quantum_chip -> quantum_chip`
2. 把 `vertical_launching` 中的：
   - `small_carrier_rocket` 从 `TechUnlockBuilding`
   - 改成 `TechUnlockRecipe`

额外清理：

- 删除或废弃 `techUnlockAliases` 中针对 `small_carrier_rocket` 的 `TechUnlockBuilding -> TechUnlockSpecial` 映射，避免未来再次把火箭 recipe 归一化成 special unlock。

### 5.4 `build --recipe` 路径的要求

任务 A 完成后，以下路径必须成立：

1. `Recipe()` 能找到 5 个新 recipe。
2. `normalizeTechUnlocks()` 不再把相关 tech unlock 过滤掉。
3. 玩家研究完成后：
   - `/catalog.techs[].unlocks` 可见
   - `/catalog.recipes[]` 可见
4. `build ... --recipe <id>` 可以通过 `execBuild()` 的 recipe 校验。

## 6. 任务 B：垂直发射井从壳体补到真实玩法

### 6.1 建筑实例化能力补一层通用能力：`DefaultRecipeID`

当前建筑只有“显式 `--recipe` 时才会在施工完成后带 recipe”这一个入口。

推荐在 `server/internal/model/building_defs.go` 的 `BuildingDefinition` 中新增：

```go
DefaultRecipeID string `json:"default_recipe_id,omitempty"`
```

配套规则：

1. `vertical_launching_silo.DefaultRecipeID = "small_carrier_rocket"`。
2. `server/internal/model/building_catalog.go` 在构建 catalog 时要校验：
   - `DefaultRecipeID` 指向的 recipe 必须存在
   - 该 recipe 的 `BuildingTypes` 必须包含当前建筑
3. 在建筑 catalog / query 层暴露 `default_recipe_id`，让客户端能知道默认生产什么。
4. `completeConstructionTask()` 中：
   - 如果 `task.RecipeID != ""`，优先使用玩家显式指定的 recipe。
   - 否则回退到 `BuildingDefinition.DefaultRecipeID`。
5. `execBuild()` 中，如果玩家没有显式传 `recipe_id`，但建筑存在 `DefaultRecipeID`，也必须走一次 `CanUseRecipeTech()` 校验，避免绕过 recipe 解锁规则。

这样设计的好处是：

- 不只服务于发射井。
- 未来任何“建出来默认就该开始跑某条 recipe”的建筑都能复用。

### 6.2 修复 `vertical_launching_silo` 的 IO 口定义

当前 silo runtime 的唯一输入口只允许 `small_carrier_rocket`，这会让火箭 recipe 永远吃不到原料。

推荐修改 `server/internal/model/building_runtime.go` 中的 silo IO：

- `in-0`：`PortInput`，`AllowedItems` 置空，允许通用 recipe 原料进入。
- `out-main`：`PortOutput`，`AllowedItems = [small_carrier_rocket]`，用于把成品火箭输出到传送带，或至少让 building IO 策略有合法输出口。

保留：

- `LaunchModule.RocketItemID = small_carrier_rocket`

不推荐继续沿用：

- “把唯一输入口写死成火箭成品”的模型。

因为那更像“外部装载火箭再发射”的模型，而当前任务文档明确要求的是“打通火箭生产入口”。

### 6.3 新增命令：`launch_rocket`

在 `server/internal/model/command.go` 中新增：

```go
CmdLaunchRocket CommandType = "launch_rocket"
```

命令载荷建议为：

```json
{
  "building_id": "b-42",
  "system_id": "sys-1",
  "layer_index": 0,
  "count": 1
}
```

字段说明：

- `building_id`：必填，垂直发射井建筑 ID。
- `system_id`：必填，目标恒星系。
- `layer_index`：可选，默认 `0`。
- `count`：可选，默认 `1`，建议单次上限 `5`。

CLI 入口建议：

```bash
launch_rocket <building_id> <system_id> [--layer <n>] [--count <n>]
```

### 6.4 `launch_rocket` 的服务端执行规则

推荐新增 `server/internal/gamecore/rocket_launch.go`，并在 `core.go` / `gateway/server.go` 中注册。

执行规则：

1. 建筑存在且归属当前玩家。
2. 建筑类型必须是 `vertical_launching_silo`。
3. 建筑当前必须是 `running`。
4. 建筑存储里 `small_carrier_rocket >= count`。
5. 目标 `system_id + layer_index` 必须存在。
6. 目标层至少已有一个实验性 scaffold：
   - `node`
   - `frame`
   - 或 `shell`

这里刻意要求“先有 layer scaffold，再发火箭”：

- 它和当前保留的 `build_dyson_*` 实验性入口兼容。
- 不需要在 T088 中额外引入“玩家版戴森规划命令”。

### 6.5 戴森结构收益写入：采用“层级加固 / 增量建造”模型

当前 `DysonLayer` 的能量计算并没有真实使用每个组件的 `Integrity` / `EnergyOutput` 字段，直接改 node/frame/shell 的局部值，不足以保证玩家看见有效收益。

因此推荐在 `server/internal/model/dyson_sphere.go` 的 `DysonLayer` 上新增两个字段：

```go
RocketLaunches    int     `json:"rocket_launches,omitempty"`
ConstructionBonus float64 `json:"construction_bonus,omitempty"` // 0.0 ~ 0.5
```

写入规则：

- 每成功发射 1 枚火箭：
  - `RocketLaunches += 1`
  - `ConstructionBonus = min(0.5, RocketLaunches * 0.02)`

附加效果：

- 如果该层已有 `shell`，每枚火箭再给该层尚未满覆盖的 shell 分配 `+0.02` coverage，直到 shell coverage 达到 `1.0`。
- 如果该层还没有 shell，只写 `ConstructionBonus`，不强行自动生成新 shell，避免在 T088 中偷渡“自动建模壳层”的新系统。

结算规则调整：

1. `CalculateLayerEnergyOutput()`：
   - 先按现有节点 / 框架 / 壳层逻辑算出基础输出。
   - 再乘以 `(1 + ConstructionBonus)`。
2. `CalculateLayerStress()`：
   - 把 `params.BaseStrength` 替换为 `params.BaseStrength * (1 + ConstructionBonus * 0.6)`。

这样做的结果是：

- 火箭发射一定会影响戴森层状态。
- `ray_receiver` 在后续 tick 中能感知到更多可用戴森能量。
- 不需要在 T088 中重写整个组件级施工系统。

### 6.6 事件与客户端协议

在 `server/internal/model/event.go` 中新增：

```go
EvtRocketLaunched EventType = "rocket_launched"
```

事件 payload 建议包含：

```json
{
  "building_id": "b-42",
  "system_id": "sys-1",
  "layer_index": 0,
  "count": 1,
  "rocket_launches": 6,
  "construction_bonus": 0.12,
  "layer_energy_output": 336
}
```

需要同步更新的客户端层：

- `shared-client/src/types.ts`
- `shared-client/src/api.ts`
- `shared-client/src/config.ts`
- `client-cli/src/api.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/index.ts`
- `client-cli/src/commands/util.ts`
- `client-cli/src/command-catalog.ts`

建议把 `rocket_launched` 加入 shared-client / CLI 的已知事件类型，并纳入 CLI 默认低噪声事件订阅集合。

### 6.7 玩家路径

补完后，玩家路径应为：

1. 研究 `vertical_launching`
2. `build x y vertical_launching_silo`
3. 发射井默认 recipe 为 `small_carrier_rocket`
4. 物流 / 传送带把 `frame_material`、`deuterium_fuel_rod`、`quantum_chip` 送进发射井
5. 发射井产出火箭
6. 执行 `launch_rocket`
7. `rocket_launched` 事件出现，戴森层 `ConstructionBonus` / shell coverage 增长
8. `ray_receiver` 在后续 tick 中体现更高收益

## 7. 任务 C：用“中后期官方场景”解决气态行星可复现性

### 7.1 推荐方案：新增专门的中后期场景，而不是强改默认新局

由于当前运行态只有单 `WorldState`，T088 不应假装“只要默认地图变大，就自然有气态行星玩法”。

推荐做法是新增一套官方中后期场景：

- `server/config-midgame.yaml`
- `server/map-midgame.yaml`

它的目标不是替代普通新局，而是给文档、回归和 AI / CLI 试玩提供一个**真实可复现**的中后期入口。

### 7.2 场景需要三项新能力

#### 能力 1：可配置初始 active planet

在 `server/internal/config/config.go` 的 `BattlefieldConfig` 中新增：

```go
InitialActivePlanetID string `yaml:"initial_active_planet_id,omitempty"`
```

启动规则：

- 新游戏启动时，如果该字段非空，`gamecore.New()` 不再强行使用 `maps.PrimaryPlanetID`，而是使用配置中的 `InitialActivePlanetID` 建立 `WorldState`。
- 续档时仍以 `save.json` 中的 `RuntimeState.ActivePlanetID` 为准，不覆盖旧局。

这样就可以在不做“运行中切星球”的前提下，直接把中后期场景的 active planet 设成气态行星。

#### 能力 2：玩家启动 bootstrap

在 `PlayerConfig` 中新增 bootstrap 配置：

```go
type BootstrapItemConfig struct {
    ItemID   string `yaml:"item_id"`
    Quantity int    `yaml:"quantity"`
}

type PlayerBootstrapConfig struct {
    Minerals       int                  `yaml:"minerals"`
    Energy         int                  `yaml:"energy"`
    Inventory      []BootstrapItemConfig `yaml:"inventory,omitempty"`
    CompletedTechs []string             `yaml:"completed_techs,omitempty"`
}
```

并挂到：

```go
Bootstrap PlayerBootstrapConfig `yaml:"bootstrap"`
```

启动应用点：

- `gamecore.New()` 初始化玩家状态后，覆盖默认 `minerals / energy`。
- 把 bootstrap inventory 写入玩家背包。
- 把 `CompletedTechs` 追加进 `player.Tech.CompletedTechs`。

这项能力的作用是：

- 让中后期场景不需要“从零研究到气态行星”。
- 也不需要往仓库里提交一个体积很大的预制 `save.json`。

#### 能力 3：地图中的行星类型可显式覆盖

在 `server/internal/mapconfig/config.go` 中新增可选 override：

```yaml
overrides:
  planets:
    planet-1-2:
      kind: gas_giant
```

对应结构可设计为：

```go
type PlanetOverride struct {
    Kind string `yaml:"kind"`
}

type OverridesConfig struct {
    Planets map[string]PlanetOverride `yaml:"planets"`
}
```

`mapgen.Generate()` 中应用顺序：

1. 先按现有概率逻辑生成默认 `kind`
2. 再按 `overrides.planets[planetID]` 覆盖
3. 再基于最终 `kind` 生成 terrain / resource palette

这样可以让官方场景不依赖 seed 彩票。

### 7.3 推荐的场景文件

#### `server/map-midgame.yaml`

建议：

- 至少 `1` 个恒星系
- 至少 `3` 颗行星
- 明确把 `planet-1-2` 覆盖成 `gas_giant`

示意：

```yaml
galaxy:
  system_count: 1
  width: 1000
  height: 1000

system:
  planets_per_system: 3
  gas_giant_ratio: 0.35
  max_moons: 4

planet:
  width: 2000
  height: 2000
  resource_density: 2

overrides:
  planets:
    planet-1-2:
      kind: gas_giant
```

#### `server/config-midgame.yaml`

示意：

```yaml
battlefield:
  map_seed: "t088-midgame-001"
  max_tick_rate: 30
  victory_rule: "elimination"
  construction_region_concurrent_limit: 4
  initial_active_planet_id: "planet-1-2"

players:
  - player_id: "p1"
    key: "key_player_1"
    team_id: "team-1"
    role: "commander"
    permissions: ["*"]
    executor:
      build_efficiency: 1.0
      operate_range: 6
      concurrent_tasks: 2
      research_boost: 0.0
    bootstrap:
      minerals: 5000
      energy: 5000
      completed_techs:
        - high_strength_crystal
        - titanium_alloy
        - lightweight_structure
        - interstellar_logistics
        - interstellar_power
        - gas_giants
        - quantum_chip
        - vertical_launching
      inventory:
        - item_id: frame_material
          quantity: 20
        - item_id: deuterium_fuel_rod
          quantity: 20
        - item_id: quantum_chip
          quantity: 20
```

说明：

- 这个场景只服务于“中后期验证”和“官方玩法指南补充路线”。
- 它不等价于普通开荒局。

### 7.4 为什么不推荐在 T088 里顺手做通用 active planet 切换

因为那会连带影响：

- `WorldState` 的单星球假设
- 保存 / 读档结构
- 查询层的 runtime availability
- 非 active planet 上建筑 / 物流 / 战斗状态如何持久化

这已经是新的架构任务，不是 T088 的“缺口收敛”任务。

### 7.5 文档路线调整

T088 完成后，文档应分两条路线写：

1. 普通新局路线：
   - 继续说明当前默认新局主要覆盖开局到中期工业化。
2. 中后期场景路线：
   - 使用 `config-midgame.yaml + map-midgame.yaml`
   - 专门用于验证：
     - `gas_giants`
     - `orbital_collector`
     - `vertical_launching_silo`
     - `launch_rocket`

这比把默认新局写成“已经支持气态行星主线”更真实。

## 8. 主要改动文件

### 8.1 必改文件

| 文件 | 变更 |
| --- | --- |
| `server/internal/model/item.go` | 新增 4 个物品 |
| `server/internal/model/recipe.go` | 新增 5 个 recipe |
| `server/internal/model/tech.go` | 修正 tech unlock，去掉火箭错误别名 |
| `server/internal/model/building_defs.go` | 给 silo 增加 `DefaultRecipeID` |
| `server/internal/model/building_catalog.go` | 校验 `DefaultRecipeID` 合法性 |
| `server/internal/model/building_runtime.go` | 修 silo IO 口 |
| `server/internal/model/command.go` | 新增 `CmdLaunchRocket` |
| `server/internal/model/event.go` | 新增 `EvtRocketLaunched` |
| `server/internal/model/dyson_sphere.go` | `DysonLayer` 增加火箭增益字段 |
| `server/internal/gamecore/construction.go` | 施工完成时挂默认 recipe |
| `server/internal/gamecore/rules.go` | `build` 默认 recipe tech 校验 |
| `server/internal/gamecore/core.go` | 命令分发新增 `launch_rocket`；新游戏 active planet 取配置值 |
| `server/internal/gamecore/rocket_launch.go` | 新建：火箭发射执行逻辑 |
| `server/internal/gamecore/dyson_sphere_settlement.go` | 让 `ConstructionBonus` 进入能量 / 应力结算 |
| `server/internal/gateway/server.go` | 网关预检新增 `launch_rocket` |
| `server/internal/query/catalog.go` | 对外暴露 `default_recipe_id` |
| `shared-client/src/types.ts` | 新命令 / 新事件类型 |
| `shared-client/src/api.ts` | 新增 `cmdLaunchRocket()` |
| `shared-client/src/config.ts` | 事件类型列表新增 `rocket_launched` |
| `client-cli/src/commands/action.ts` | 新 CLI 命令 |
| `client-cli/src/commands/index.ts` | 注册新命令 |
| `client-cli/src/commands/util.ts` | help / usage |
| `client-cli/src/command-catalog.ts` | 命令分类 |
| `server/internal/config/config.go` | bootstrap 与 `initial_active_planet_id` |
| `server/internal/mapconfig/config.go` | map override 结构与校验 |
| `server/internal/mapgen/generate.go` | 应用 planet override |
| `server/config-midgame.yaml` | 新中后期场景配置 |
| `server/map-midgame.yaml` | 新中后期场景地图 |
| `docs/dev/服务端API.md` | 文档新增 `launch_rocket` 与场景说明 |
| `docs/dev/客户端CLI.md` | CLI 文档新增 `launch_rocket` |
| `docs/player/玩法指南.md` | 增加中后期场景路线 |
| `docs/player/上手与验证.md` | 增加中后期场景启动方式 |

### 8.2 明确不在 T088 中修改

| 文件 / 领域 | 原因 |
| --- | --- |
| `server/map.yaml` | 推荐方案不再假装普通新局已天然覆盖气态行星主线 |
| 通用 active planet 切换命令 | 属于更大的多星球 runtime 架构任务 |
| `client-web` 新 UI 面板 | 本任务只要求 CLI / API / 文档闭环即可 |

## 9. 实施顺序

推荐顺序如下：

1. 先完成任务 A：
   - item
   - recipe
   - tech unlock 修正
2. 再完成任务 B 的底层能力：
   - `DefaultRecipeID`
   - silo IO 修复
3. 再补任务 B 的命令链：
   - `launch_rocket`
   - 事件
   - dyson layer 增益写入
4. 最后补任务 C：
   - `initial_active_planet_id`
   - player bootstrap
   - map override
   - `config-midgame.yaml` / `map-midgame.yaml`
5. 最后统一更新：
   - API 文档
   - CLI 文档
   - 玩家指南

## 10. 测试与验收

### 10.1 自动化测试

至少新增以下测试：

1. `server/internal/model`
   - 新 item / recipe 存在性测试
   - `vertical_launching` 解锁的是 recipe 而不是 special
   - `normalizeTechUnlocks()` 不再丢掉 5 个目标 recipe
2. `server/internal/gamecore`
   - 研究后 `build vertical_launching_silo` 不带 `--recipe` 时自动挂 `small_carrier_rocket`
   - silo 可接收火箭原料并完成生产
   - `launch_rocket` 会扣除火箭并写入 `DysonLayer.ConstructionBonus`
   - `ray_receiver` 在火箭增益后能拿到更高的 Dyson 能量
3. `server/internal/startup`
   - `initial_active_planet_id` 新局生效
   - player bootstrap tech / inventory / resources 生效
4. `server/internal/mapgen`
   - `overrides.planets.planet-1-2.kind=gas_giant` 会真实改变 planet kind
5. `server/internal/gateway`
   - `launch_rocket` 预检通过 / 缺字段时报错正确

最终基线仍然要求：

```bash
cd server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./...
```

### 10.2 手工验证

#### 普通中后期闭环

1. 启动普通配置，推进到 `vertical_launching`
2. 建 `vertical_launching_silo`
3. 确认默认 recipe 已挂上 `small_carrier_rocket`
4. 投喂 `frame_material / deuterium_fuel_rod / quantum_chip`
5. 看到火箭产出
6. `launch_rocket b-xx sys-1 --layer 0`
7. SSE 出现 `rocket_launched`
8. 后续 tick 中 `ray_receiver` 收益提升

#### 中后期官方场景

1. 用 `config-midgame.yaml + map-midgame.yaml` 启动
2. `summary` 确认 active planet 为配置中的气态行星
3. `system sys-1` 确认同一场景里存在多颗行星
4. `build 10 4 orbital_collector`
5. 建造成功，不再报 `must be built on a gas giant`

### 10.3 T088 最终验收对应关系

- `/catalog` 中存在 5 个目标 recipe：由任务 A 保证。
- 相关科技 `unlocks` 不再为空：由 recipe + unlock type 修正保证。
- `vertical_launching_silo` 能完成配方配置、火箭生产、发射、产生戴森收益：由任务 B 保证。
- 官方文档路线能实际覆盖 `gas_giants` / `orbital_collector`：由任务 C 的中后期场景保证。

## 11. 最终结论

T088 推荐采用“三段式收敛”：

1. 用最小新增物料闭环补齐 5 个关键 recipe。
2. 用 `DefaultRecipeID + silo IO 修复 + launch_rocket + DysonLayer.ConstructionBonus` 把垂直发射井补到真实可玩。
3. 用“中后期官方场景”而不是“强改默认新局”来解决气态行星与轨道采集器的可复现性。

这是当前代码约束下，最小、最稳、也最符合任务文档验收口径的方案。
