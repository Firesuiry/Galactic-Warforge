# T088 戴森中后期玩法缺口收敛 - 最终实现方案

## 1. 文档目标

本文综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，基于当前代码真实约束，给出 T088 的最终实现方案。

本方案覆盖三个子任务：

1. 补齐中后期科技链缺失的 5 个关键配方。
2. 把 `vertical_launching_silo` 从“可建但不可玩”补到“可生产火箭、可发射、可产生戴森层收益”。
3. 提供一条官方可复现的气态行星 / `orbital_collector` 路线。

最终取舍如下：

- 任务 A 采用 `Codex` 方案的“最小闭环原料设计”，避免继续引用当前代码里并不存在的 `steel`、`diamond`、`plane_filter` 等历史缺项。
- 任务 B 结合两份方案，但以 `Codex` 方案为主：补默认配方、修 IO、增 `launch_rocket`、把火箭收益写入 `DysonLayer` 层级状态，而不是做当前结算链路并未消费的节点级临时字段。
- 任务 C 明确采用“中后期官方场景”路线，不直接把 `server/map.yaml` 改成多星球默认新局；原因是当前运行态仍然围绕单个 `active planet`。

## 2. 现状约束与设计原则

### 2.1 已确认的真实约束

当前代码里已经确认：

- `vertical_launching_silo` 已存在 `ProductionModule` 与 `LaunchModule`，但没有可用火箭配方。
- `vertical_launching_silo` 当前唯一输入口只允许 `small_carrier_rocket`，会直接阻断火箭生产原料进入。
- `vertical_launching` 目前把 `small_carrier_rocket` 写成 `TechUnlockBuilding`，并被 alias 归一化成 `special`，即使补 recipe 也不会自然出现在 `/catalog.techs[].unlocks` 的 recipe 解锁里。
- `GameCore.New()` 启动时直接基于 `maps.PrimaryPlanet()` 创建 `WorldState`。
- `query.PlanetRuntime()` 对非当前 `active planet` 只返回有限视图，不提供完整运行态。
- 因此，仅把默认地图从 1 星球改成多星球，并不能保证玩家真的能切到气态行星上建 `orbital_collector`。

### 2.2 最终设计原则

1. T088 只收敛当前明确的玩法断点，不顺手扩大成“全科技树清洗”或“多星球 runtime 重构”。
2. 新配方只依赖当前代码里已经存在的物品与配方。
3. `build_dyson_*` 继续保留实验性脚手架定位，不在本任务里强改成完整材料门槛系统。
4. 气态行星路线以“官方可复现”为目标，不以“普通新局自然覆盖所有中后期玩法”为目标。

## 3. 任务 A：补齐中后期缺失配方

### 3.1 需要补齐的目标

需要补齐以下链路：

- `high_strength_crystal -> titanium_crystal`
- `titanium_alloy -> titanium_alloy`
- `lightweight_structure -> frame_material`
- `quantum_chip -> quantum_chip`
- `vertical_launching -> small_carrier_rocket`

### 3.2 新增物品

在 `server/internal/model/item.go` 中新增 4 个物品：

| 物品 ID | 分类 | 建议堆叠 | 说明 |
| --- | --- | ---: | --- |
| `titanium_crystal` | `component` | 100 | 高强度晶体链中间件 |
| `titanium_alloy` | `material` | 100 | 高级结构材料 |
| `frame_material` | `component` | 100 | 戴森结构与火箭共享材料 |
| `quantum_chip` | `component` | 50 | 垂直发射关键电子件 |

`small_carrier_rocket` 继续复用现有物品定义，不重复新增。

### 3.3 新增配方

在 `server/internal/model/recipe.go` 中新增以下 5 个配方。所有上游原料都限定为当前已存在的物品与 recipe：

| Recipe ID | 输入 | 输出 | 建筑 |
| --- | --- | --- | --- |
| `titanium_crystal` | `titanium_ingot x2`, `graphene x1` | `titanium_crystal x1` | `assembling_machine_mk1/2/3` |
| `titanium_alloy` | `titanium_ingot x4`, `energetic_graphite x2`, `sulfuric_acid x2` | `titanium_alloy x2` | `arc_smelter`, `plane_smelter`, `negentropy_smelter` |
| `frame_material` | `carbon_nanotube x2`, `titanium_alloy x1`, `processor x1` | `frame_material x1` | `assembling_machine_mk1/2/3` |
| `quantum_chip` | `processor x2`, `microcrystalline_component x2`, `carbon_nanotube x1` | `quantum_chip x1` | `assembling_machine_mk1/2/3` |
| `small_carrier_rocket` | `frame_material x2`, `deuterium_fuel_rod x2`, `quantum_chip x2` | `small_carrier_rocket x1` | `vertical_launching_silo` |

建议时长与能耗：

- `titanium_crystal`: `duration=80`, `energy_cost=4`
- `titanium_alloy`: `duration=100`, `energy_cost=6`
- `frame_material`: `duration=120`, `energy_cost=6`
- `quantum_chip`: `duration=140`, `energy_cost=8`
- `small_carrier_rocket`: `duration=200`, `energy_cost=12`

### 3.4 科技定义修正

在 `server/internal/model/tech.go` 中做两类修正：

1. 保证以下 tech unlock 指向真实存在的 recipe：
   - `high_strength_crystal -> titanium_crystal`
   - `titanium_alloy -> titanium_alloy`
   - `lightweight_structure -> frame_material`
   - `quantum_chip -> quantum_chip`
2. 把 `vertical_launching` 中的 `small_carrier_rocket` 从 `TechUnlockBuilding` 改为 `TechUnlockRecipe`。

同时删除或废弃 `techUnlockAliases` 里针对 `small_carrier_rocket` 的 `TechUnlockBuilding -> TechUnlockSpecial` 映射，避免归一化后再次丢失 recipe unlock。

### 3.5 任务 A 验收结果

任务 A 完成后必须成立：

- `/catalog.recipes` 中能看到 5 个目标 recipe。
- 相关科技在 `/catalog.techs[].unlocks` 中不再为空。
- `build ... --recipe <recipe_id>` 能识别这些配方。

## 4. 任务 B：垂直发射井玩法闭环

### 4.1 总体取舍

最终采用“通用默认配方能力 + silo IO 修复 + 独立火箭命令 + 戴森层级收益”的方案。

不采用节点级 `target_node_id` 定向加固作为 T088 主路径，原因是当前戴森层能量结算并不真实消费节点级 `Integrity` / `EnergyOutput` 的细粒度字段；直接写层级状态更稳，也更容易被 `ray_receiver` 的现有收益链路感知。

### 4.2 建筑默认配方能力

在 `server/internal/model/building_catalog.go` / `server/internal/model/building_defs.go` 这一层新增通用字段：

```go
DefaultRecipeID string `json:"default_recipe_id,omitempty" yaml:"default_recipe_id,omitempty"`
```

配套规则：

1. `vertical_launching_silo.DefaultRecipeID = "small_carrier_rocket"`。
2. catalog 初始化时校验：
   - `DefaultRecipeID` 指向的 recipe 必须存在。
   - recipe 的 `BuildingTypes` 必须包含当前建筑。
3. 施工完成时：
   - 若玩家显式传了 `recipe_id`，优先用显式值。
   - 否则回退到 `DefaultRecipeID`。
4. `execBuild()` 中即便玩家没有显式传 `recipe_id`，如果建筑存在 `DefaultRecipeID`，仍要做一次 tech 校验，避免绕过解锁条件。
5. 在 catalog / query 层对外暴露 `default_recipe_id`，便于 CLI / Web 客户端识别默认产线。

### 4.3 修复 `vertical_launching_silo` IO 口

在 `server/internal/model/building_runtime.go` 中调整 silo 运行时定义：

- `in-0`：保留 `PortInput`，但 `AllowedItems` 置空，允许配方原料流入。
- 新增 `out-0`：`PortOutput`，`AllowedItems = [small_carrier_rocket]`，允许火箭成品输出。
- 保留 `LaunchModule.RocketItemID = small_carrier_rocket`。

不再沿用“输入口只能接收火箭成品”的旧定义，因为那只适合“外部装填火箭再发射”，不适合本任务要求的“建筑内生产火箭”。

### 4.4 新增命令：`launch_rocket`

在 `server/internal/model/command.go` 中新增：

```go
CmdLaunchRocket CommandType = "launch_rocket"
```

推荐 payload：

```json
{
  "building_id": "b-42",
  "system_id": "sys-1",
  "layer_index": 0,
  "count": 1
}
```

字段规则：

- `building_id`：必填，垂直发射井 ID。
- `system_id`：必填，目标恒星系。
- `layer_index`：可选，默认 `0`。
- `count`：可选，默认 `1`，单次上限建议 `5`。

CLI 对应新增：

```bash
launch_rocket <building_id> <system_id> [--layer <n>] [--count <n>]
```

### 4.5 服务端执行规则

新增 `server/internal/gamecore/rocket_launch.go`，并在 `core.go` / `gateway/server.go` 中注册。

执行规则：

1. 建筑存在且归属当前玩家。
2. 建筑类型必须是 `vertical_launching_silo`。
3. 建筑状态必须为 `running`。
4. 建筑本地存储中的 `small_carrier_rocket >= count`。
5. `system_id + layer_index` 必须存在。
6. 目标层必须已存在至少一个实验性 scaffold：
   - `node`
   - `frame`
   - 或 `shell`
7. 扣除火箭库存，写入戴森层增益，并返回结果事件。

这里显式要求“先有 layer scaffold，再发火箭”，是为了兼容当前保留的 `build_dyson_*` 验证入口，而不在 T088 中再新增一整套玩家版戴森规划命令。

### 4.6 戴森层收益写入

在 `server/internal/model/dyson_sphere.go` 的 `DysonLayer` 上新增：

```go
RocketLaunches    int     `json:"rocket_launches,omitempty"`
ConstructionBonus float64 `json:"construction_bonus,omitempty"`
```

写入规则：

- 每成功发射 1 枚火箭：
  - `RocketLaunches += 1`
  - `ConstructionBonus = min(0.5, RocketLaunches * 0.02)`

附加效果：

- 若该层已有 shell，可把每枚火箭附带的少量进度分配到未满覆盖的 shell 上，例如 `coverage += 0.02`，上限 `1.0`。
- 若该层还没有 shell，只累计 `ConstructionBonus`，不自动生成新 shell。

结算规则调整：

1. `CalculateLayerEnergyOutput()` 先按现有节点 / 框架 / 壳层逻辑计算基础输出，再乘以 `(1 + ConstructionBonus)`。
2. `CalculateLayerStress()` 使用 `ConstructionBonus` 提升层级承载强度，例如 `BaseStrength * (1 + ConstructionBonus * 0.6)`。

这样能保证火箭发射一定会反馈到当前可见的戴森收益链条里，尤其是 `ray_receiver` 的可用能量。

### 4.7 事件与客户端协议

在 `server/internal/model/event.go` 中新增：

```go
EvtRocketLaunched EventType = "rocket_launched"
```

建议 payload：

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

需要同步更新：

- `shared-client/src/types.ts`
- `shared-client/src/api.ts`
- `shared-client/src/config.ts`
- `client-cli/src/api.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/index.ts`
- `client-cli/src/commands/util.ts`
- `client-cli/src/command-catalog.ts`

### 4.8 任务 B 最终玩家路径

补完后的玩家路径应为：

1. 研究 `vertical_launching`
2. `build x y vertical_launching_silo`
3. 建筑默认 recipe 自动挂上 `small_carrier_rocket`
4. 物流把 `frame_material`、`deuterium_fuel_rod`、`quantum_chip` 送入 silo
5. silo 产出火箭
6. `launch_rocket b-xx sys-1 --layer 0`
7. 收到 `rocket_launched` 事件
8. 戴森层输出提升，后续 `ray_receiver` 收益增加

## 5. 任务 C：气态行星与轨道采集器官方路线

### 5.1 最终取舍

任务 C 采用“中后期官方场景”方案，不直接修改 `server/map.yaml` 作为 T088 主方案。

原因：

- 当前完整运行态仍围绕单个 `active planet`。
- 即便默认地图生成出气态行星，玩家也没有通用入口把当前运行态切到那颗星球上继续建造。
- 任务文档允许“增加专门的中后期 playtest / guide 地图，并把玩法指南切到该路线”，这比假装默认新局已天然闭环更符合当前代码现实。

### 5.2 需要新增的三项能力

#### 能力 1：可配置初始 `active planet`

在 `server/internal/config/config.go` 的 `BattlefieldConfig` 中新增：

```go
InitialActivePlanetID string `yaml:"initial_active_planet_id,omitempty"`
```

启动规则：

- 新开局时，如果该字段非空，`gamecore.New()` 用该行星初始化 `WorldState`。
- 续档时仍以存档中的 active planet 为准，不覆盖旧局。

#### 能力 2：玩家 bootstrap

在 `PlayerConfig` 中新增 bootstrap 配置，用于初始化中后期场景的科技、库存与资源：

```go
type BootstrapItemConfig struct {
    ItemID   string `yaml:"item_id"`
    Quantity int    `yaml:"quantity"`
}

type PlayerBootstrapConfig struct {
    Minerals       int                   `yaml:"minerals"`
    Energy         int                   `yaml:"energy"`
    Inventory      []BootstrapItemConfig `yaml:"inventory,omitempty"`
    CompletedTechs []string              `yaml:"completed_techs,omitempty"`
}
```

并挂到：

```go
Bootstrap PlayerBootstrapConfig `yaml:"bootstrap"`
```

作用：

- 不需要从零研究到 `gas_giants` / `vertical_launching`。
- 不需要往仓库提交庞大的预制存档。

#### 能力 3：地图行星类型 override

在 `server/internal/mapconfig/config.go` 中新增 planet override：

```yaml
overrides:
  planets:
    planet-1-2:
      kind: gas_giant
```

对应结构：

```go
type PlanetOverride struct {
    Kind string `yaml:"kind"`
}
```

生成顺序：

1. 先按现有概率逻辑生成行星类型。
2. 再按 override 覆盖。
3. 再根据最终类型生成地形 / 资源表现。

这样官方场景就不再依赖 seed 彩票。

### 5.3 场景文件

新增：

- `server/map-midgame.yaml`
- `server/config-midgame.yaml`

推荐约束：

- 至少 1 个恒星系、3 颗行星。
- 强制将某颗行星覆盖为 `gas_giant`。
- `initial_active_planet_id` 指向这颗气态行星。
- `bootstrap.completed_techs` 至少包含：
  - `high_strength_crystal`
  - `titanium_alloy`
  - `lightweight_structure`
  - `interstellar_logistics`
  - `interstellar_power`
  - `gas_giants`
  - `quantum_chip`
  - `vertical_launching`
- `bootstrap.inventory` 预置适量：
  - `frame_material`
  - `deuterium_fuel_rod`
  - `quantum_chip`

### 5.4 文档路线调整

T088 完成后，文档应改成双路线：

1. 普通新局路线：
   - 继续描述当前默认新局主要覆盖开局到中期工业化。
2. 中后期官方场景路线：
   - 使用 `config-midgame.yaml + map-midgame.yaml`
   - 专门验证：
     - `gas_giants`
     - `orbital_collector`
     - `vertical_launching_silo`
     - `launch_rocket`

需要同步更新：

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`

## 6. 主要改动文件

### 6.1 必改文件

| 文件 | 变更 |
| --- | --- |
| `server/internal/model/item.go` | 新增 4 个物品 |
| `server/internal/model/recipe.go` | 新增 5 个 recipe |
| `server/internal/model/tech.go` | 修正 tech unlock 与火箭 alias |
| `server/internal/model/building_catalog.go` | 新增 / 校验 `DefaultRecipeID` |
| `server/internal/model/building_defs.go` | 给 silo 设置 `DefaultRecipeID` |
| `server/internal/model/building_runtime.go` | 修 silo IO 口 |
| `server/internal/model/command.go` | 新增 `CmdLaunchRocket` |
| `server/internal/model/event.go` | 新增 `EvtRocketLaunched` |
| `server/internal/model/dyson_sphere.go` | `DysonLayer` 增加火箭增益字段 |
| `server/internal/gamecore/construction.go` | 施工完成时挂默认 recipe |
| `server/internal/gamecore/rules.go` | `build` 默认 recipe tech 校验 |
| `server/internal/gamecore/core.go` | 命令分发新增 `launch_rocket`；启动时支持 `InitialActivePlanetID` |
| `server/internal/gamecore/rocket_launch.go` | 新建：火箭发射执行逻辑 |
| `server/internal/gamecore/dyson_sphere_settlement.go` | 让 `ConstructionBonus` 进入戴森结算 |
| `server/internal/gateway/server.go` | 网关预检新增 `launch_rocket` |
| `shared-client/src/types.ts` | 新命令 / 事件类型 |
| `shared-client/src/api.ts` | 新增 `cmdLaunchRocket()` |
| `shared-client/src/config.ts` | 事件类型列表新增 `rocket_launched` |
| `client-cli/src/commands/action.ts` | 新 CLI 命令 |
| `client-cli/src/commands/index.ts` | 注册新命令 |
| `client-cli/src/commands/util.ts` | help / usage |
| `client-cli/src/command-catalog.ts` | 命令分类 |
| `server/internal/config/config.go` | 新增 bootstrap 与 `InitialActivePlanetID` |
| `server/internal/mapconfig/config.go` | 新增 planet override 配置 |
| `server/internal/mapgen/generate.go` | 应用 planet override |
| `server/config-midgame.yaml` | 新中后期场景配置 |
| `server/map-midgame.yaml` | 新中后期场景地图 |
| `docs/dev/服务端API.md` | 补 `launch_rocket` 与场景说明 |
| `docs/dev/客户端CLI.md` | 补 `launch_rocket` |
| `docs/player/玩法指南.md` | 补中后期场景路线 |
| `docs/player/上手与验证.md` | 补中后期验证入口 |

### 6.2 明确不在 T088 中修改

| 文件 / 领域 | 原因 |
| --- | --- |
| `server/map.yaml` | 不把普通新局包装成已天然覆盖气态行星主线 |
| 通用 active planet 切换机制 | 这是更大的多星球 runtime 架构任务 |
| `build_dyson_*` 的材料门槛化 | 本任务只要求火箭链路可玩，不要求替换现有实验性入口 |
| `client-web` 新专用火箭面板 | 当前 T088 以 API、CLI、文档闭环为验收主体 |

## 7. 推荐实施顺序

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
   - 戴森层增益写入
4. 最后补任务 C：
   - `InitialActivePlanetID`
   - player bootstrap
   - map override
   - `config-midgame.yaml` / `map-midgame.yaml`
5. 最后统一更新文档：
   - `docs/dev/服务端API.md`
   - `docs/dev/客户端CLI.md`
   - `docs/player/玩法指南.md`
   - `docs/player/上手与验证.md`

## 8. 测试与验收

### 8.1 自动化测试

至少补以下测试：

1. `server/internal/model`
   - 新 item / recipe 存在性
   - `vertical_launching` 解锁的是 recipe 而不是 special
   - `normalizeTechUnlocks()` 不再丢掉 5 个目标 recipe
2. `server/internal/gamecore`
   - `vertical_launching_silo` 不带 `--recipe` 建造时自动挂 `small_carrier_rocket`
   - silo 可接收原料并完成火箭生产
   - `launch_rocket` 会扣火箭并写入 `DysonLayer.ConstructionBonus`
   - 火箭增益后 `ray_receiver` 收益上升
3. `server/internal/startup`
   - `InitialActivePlanetID` 新局生效
   - player bootstrap 的 tech / inventory / resources 生效
4. `server/internal/mapgen`
   - `overrides.planets.*.kind=gas_giant` 会真实覆盖 planet kind
5. `server/internal/gateway`
   - `launch_rocket` 预检通过
   - 缺字段时返回正确错误

基线测试命令保持为：

```bash
cd server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./...
```

### 8.2 手工验证

普通中后期闭环：

1. 启动普通配置，推进到 `vertical_launching`
2. 建 `vertical_launching_silo`
3. 确认默认 recipe 已挂 `small_carrier_rocket`
4. 投喂 `frame_material / deuterium_fuel_rod / quantum_chip`
5. 看到火箭产出
6. 执行 `launch_rocket b-xx sys-1 --layer 0`
7. SSE 出现 `rocket_launched`
8. 后续 tick 中 `ray_receiver` 收益提升

中后期官方场景：

1. 使用 `config-midgame.yaml + map-midgame.yaml` 启动
2. `summary` 确认 active planet 为配置中的气态行星
3. `system sys-1` 确认同场景存在多颗行星
4. `build 10 4 orbital_collector`
5. 建造成功，不再报 `must be built on a gas giant`

### 8.3 与 T088 验收标准的对应关系

- `/catalog` 中存在 5 个目标 recipe：由任务 A 保证。
- 相关科技 `unlocks` 不再为空：由任务 A 的 unlock 修正保证。
- `vertical_launching_silo` 能完成配方配置、火箭生产、发射、并对戴森结构产生有效影响：由任务 B 保证。
- 官方文档路线能实际覆盖 `gas_giants` 与 `orbital_collector`：由任务 C 的中后期场景保证。

## 9. 最终结论

T088 的最终推荐实现方案是：

1. 用最小新增物料闭环补齐 5 个关键 recipe。
2. 用 `DefaultRecipeID + silo IO 修复 + launch_rocket + DysonLayer.ConstructionBonus` 把垂直发射井补到真实可玩。
3. 用“中后期官方场景”而不是“强改默认新局”来解决气态行星与轨道采集器的可复现性。

这是当前代码结构下改动最小、风险最低、且最符合任务文档验收口径的方案。
