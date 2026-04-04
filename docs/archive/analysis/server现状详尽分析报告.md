# server 现状详尽分析报告（2026-03-21）

> 2026-03-22 修复回写：
> - 断点A/B/C/D/E 已完成修复并通过 `/home/firesuiry/sdk/go1.25.0/bin/go test ./...`。
> - 本文中的 2026-03-21 统计项保留为历史快照；涉及修复结论处已追加“已修复”标注。
>
> 2026-04-03 T091 更新：
> - `switch_active_planet`、`set_ray_receiver_mode` 已补齐网关结构校验并走通公开 API。
> - `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab` 已补齐 `buildable/runtime/tech` 与玩法结算闭环。
> - `dark_fog_matrix` 已进入运行时 item catalog；`planetary_shield_generator` 的敌袭吸伤会在 `damage_applied` 事件中暴露 `shield_absorbed` / `shield_remaining`。

## 1. 报告范围与方法
- 分析范围：`server/` 目录（`cmd`、`internal` 全量模块）。
- 重点关注：玩法闭环、建筑/物品/配方/科技、命令/API 可达性、系统可运行性。
- 分析方法：
  - 静态代码审查（核心文件逐个核对）。
  - 数据清单提取（建筑/物品/配方/科技数量与ID比对）。
  - 编译测试复核：`/home/firesuiry/sdk/go1.25.0/bin/go test ./...`（在 `server/` 下执行）。

## 2. 执行摘要（先看结论）
当前 `server` 已经具备一个较完整的“多系统 Tick 驱动框架”，包括：命令队列、建造队列、资源与电力、传送带/分拣器/仓储、管道流体、物流无人机/货船、敌对势力与炮塔战斗、轨道战斗框架、事件流、审计、快照/回放/回滚。

但就“实际可玩闭环”而言，存在明显断点：
- 断点A：HTTP 命令预检仅放行 9 种命令，研究与发射等命令在网关层被拒绝。**【已修复，2026-03-22】**
- 断点B：`build` 强依赖科技解锁，但默认玩家初始化未预置科技状态，且研究命令又被网关拦截，导致开局建造能力高度受限。**【已修复，2026-03-22】**
- 断点C：科技树中的大量建筑ID/配方ID与实际定义ID不一致，研究完成后可能无法真正解锁目标内容。**【已修复，2026-03-22】**
- 断点D：配方与生产周期模型很完整，但“生产配方在游戏核心中的消费路径”未打通，更多停留在模型层与测试层。**【已修复，2026-03-22】**
- 断点E：当前 `server` 无法通过编译测试（`go test ./...` 失败），存在结构性代码冲突。**【已修复，2026-03-22】**

结论：
- “系统骨架”完成度高。
- 2026-03-22 复核后，基础“研究 -> 解锁 -> 建造 -> 生产”主循环已打通并通过测试。
- 当前仍属于“基础闭环可运行 + 深度玩法待增强”的阶段；未纳入本轮修复的项主要集中在物流站配置 API、战斗科技深度接线、轨道/舰队编队等增强能力。

## 3. 架构总览
### 3.1 启动与装配
入口为 `server/cmd/server/main.go`：
- 读取配置与地图配置。
- 生成宇宙地图。
- 初始化持久化、命令队列、事件总线、`GameCore`、HTTP Gateway。
- 启动 Tick 循环与 HTTP 服务。

### 3.2 HTTP 网关与对外能力
网关在 `server/internal/gateway/server.go`，已注册主要端点：
- 健康与指标：`GET /health`、`GET /metrics`
- 审计：`GET /audit`
- 状态查询：`GET /state/summary`、`GET /state/stats`
- 世界查询：`GET /world/galaxy`、`GET /world/systems/{system_id}`、`GET /world/planets/{planet_id}`、`GET /world/planets/{planet_id}/scene`、`GET /world/planets/{planet_id}/inspect`
- 命令：`POST /commands`
- 事件：`GET /events/stream`（SSE）、`GET /events/snapshot`
- 产线告警：`GET /alerts/production/snapshot`
- 回放与回滚：`POST /replay`、`POST /rollback`

说明：网关有速率限制、鉴权、命令结构预检、重复请求去重、审计记录。

### 3.3 Tick 主循环（核心执行顺序）
`server/internal/gamecore/core.go` 的 `processTick()` 已组织较完整结算链：
1. 拉取命令队列并执行。
2. 建造队列推进。
3. 建筑作业推进。
4. 科研推进。
5. 发电。
6. 射线接收器。
7. 太阳帆。
8. 戴森球结构能量。
9. 资源结算。
10. 轨道采集器。
11. 传送带。
12. 分拣器。
13. 建筑IO。
14. 管道流动与管道IO。
15. 仓储。
16. 产线监控与告警。
17. 行星/星际物流调度与无人机/货船结算。
18. 炮塔自动攻击。
19. 敌对势力。
20. 战斗单位结算、轨道战斗、无人机控制预留。
21. 玩家统计、胜利判定、事件发布、快照落盘。

## 4. 命令系统与可达性分析
### 4.1 命令定义、预检、执行三层对比
- 命令枚举总数：18
- 网关预检支持：9
- 核心执行支持：14

这三层不一致，形成大量“定义了但无法从 API 走通”的命令。

更新：2026-03-22 已补齐已实现命令的网关预检放行路径；本节数字保留为 2026-03-21 历史快照。

### 4.2 关键差异
- 枚举存在但执行器未实现：**【已修复，2026-03-22】**
  - `build_dyson_node`
  - `build_dyson_frame`
  - `build_dyson_shell`
  - `demolish_dyson`
- 执行器已实现但网关预检不放行：**【已修复，2026-03-22】**
  - `start_research`
  - `cancel_research`
  - `launch_solar_sail`
  - `cancel_construction`
  - `restore_construction`

直接影响：
- 研究、太阳帆发射、施工撤销/恢复即使核心里有实现，默认 API 路径也不可达。

> 2026-03-22 修复说明：上述 API 不可达问题已消除，相关命令现已可通过网关预检与核心执行链路。

## 5. 建筑系统盘点
### 5.1 建筑定义规模
- 建筑定义总数：62
- `Buildable: true`（可通过 `build` 放置）数量：10
- 具有显式运行时模块定义（runtime definitions）数量：35

更新：2026-04-03 当前 `Buildable: true` 数量已提升至 61，显式 runtime definitions 数量已提升至 44。

### 5.2 建筑分类（定义层）
- `Transport`: 11
- `CommandSignal`: 11
- `Power`: 6
- `PowerGrid`: 6
- `Collect`: 5
- `Refining`: 5
- `Production`: 5
- `LogisticsHub`: 3
- `Storage`: 3
- `Dyson`: 3
- `Chemical`: 2
- `Research`: 2

### 5.3 当前可建造建筑（10）
`arc_smelter`、`assembling_machine_mk1`、`chemical_plant`、`gauss_turret`、`mining_machine`、`negentropy_smelter`、`orbital_collector`、`plane_smelter`、`quantum_chemical_plant`、`solar_panel`。

更新：2026-03-22 该列表已过时，当前应以 `Buildable: true` 为准（已扩展至 53 个建筑）。

### 5.4 运行时模块覆盖（35个已定义建筑）
模块覆盖统计：
- `energy`: 18
- `storage`: 9
- `production`: 7
- `sorter`: 4
- `transport`: 3
- `collect`: 2
- `launch`: 2
- `energy_storage`: 2
- `orbital`: 1
- `ray_receiver`: 1
- `combat`: 1
- `spray`: 1

结论：
- “建筑能力模型”覆盖面很大（发电/生产/采集/物流/战斗/发射/储能/喷涂等）。
- 但很多建筑仅有定义与模块，尚未进入可建造或可命令控制闭环。

## 6. 物品、资源与配方系统
### 6.1 物品体系
- 物品总数：55
- 分类统计：
  - `Material`: 18
  - `Component`: 14
  - `Ore`: 10
  - `Fuel`: 4
  - `Matrix`: 4
  - `Ammo`: 3
  - `Container`: 2
- 形态统计：
  - `Solid`: 49
  - `Liquid`: 4
  - `Gas`: 2

说明：物品层包含固/液/气与容器映射，具备流体物品建模基础。

### 6.2 地图资源与采集行为
资源节点在地图生成与结算中分三类行为：
- `finite`（有限）
- `decay`（衰减，如油井产率衰减）
- `renewable`（可再生）

资源行为已在 Tick 里结算（采掘 + 再生/衰减）。

### 6.3 配方体系
- 配方总数：34
- 已覆盖：冶炼、化工、矩阵、燃料棒、弹药、太阳帆、奇异物质等。

但核心问题：
- 配方/生产周期求解主要在 `model` 层，`gamecore` 中未形成完整“设置配方 -> 消耗输入 -> 产出输出”的统一链路。**【已修复，2026-03-22】**
- `ResolveProductionCycle` 基本仅见于测试调用，未在 `gamecore` 主结算链直接消费。**【已修复，2026-03-22】**

## 7. 科技与研究系统
### 7.1 科技规模
- 科技总数：105
- 科技类别：`Main 38`、`Branch 60`、`Bonus 7`
- 科技类型：`Main 24`、`Combat 18`、`Energy 16`、`Smelting 13`、`Chemical 11`、`Logistics 9`、`Dyson 7`、`Mecha 7`

### 7.2 解锁项规模
- 建筑解锁条目：65
- 配方解锁条目：52
- 特殊解锁条目：16
- 单位解锁条目：6

### 7.3 研究机制实现状态
已实现：
- 研究排队、推进、完成、取消。
- 前置科技检查。
- 完成后写入 `CompletedTechs` 并下发研究完成事件。

关键断点：
- API 预检不放行 `start_research/cancel_research`，导致研究在默认 HTTP 路径不可达。**【已修复，2026-03-22】**
- `build` 依赖 `CanBuildTech(...)`，但玩家初始化未默认注入科技状态，实际开局建造受阻。**【已修复，2026-03-22】**

## 8. 物流、电力、战斗、轨道与戴森模块
### 8.1 物流
已实现：
- 行星物流调度、星际物流调度。
- 无人机/货船状态机（起飞/飞行/降落/交付）。
- 物流站供需缓存、优先级、路线策略（最短路/最低成本）。

现状限制：
- 缺少对物流站配置（供需设置）的命令/API接线，实际调度更多依赖测试场景人工注入设置。
- “物流相关建筑可建造性较弱”这一结论已过时；物流站本体现已进入 `Buildable: true` 列表。**【已修复，2026-03-22】**

### 8.2 电力与管网
已实现：
- 发电结算（风/光/燃料等环境因子）。
- 电网覆盖与分配。
- 射线接收器与太阳帆能量输入叠加。
- 储能结算。
- 流体/气体管道拓扑、流动、IO耦合。

### 8.3 战斗与敌对势力
已实现：
- 炮塔自动攻击（敌方单位与敌对势力）。
- 敌对势力生成、扩散、威胁等级、周期攻击。
- 信号塔干扰、干扰塔减速场、雷达探测状态。
- 战斗单位/轨道平台模型与结算框架。
- `produce` 命令可从生产建筑产出单位，但当前仅支持 `worker` 与 `soldier` 两类基础单位。

现状限制：
- 战斗科技管理器已定义，但主流程接线不足（更多为框架与局部调用）。
- 轨道/舰队编队部分逻辑仍是预留。

### 8.4 太阳帆与戴森球
已实现：
- 太阳帆轨道状态、寿命衰减、能量输出。
- 戴森球层/节点/框架/壳面数据结构与能量聚合结算。

现状限制：
- 与 `build_dyson_* / demolish_dyson` 命令闭环未打通（命令枚举有，执行器未接入）。**【已修复，2026-03-22】**
- `launch_solar_sail` 执行器存在，但网关预检不放行。**【已修复，2026-03-22】**

## 9. 数据一致性与可玩性断点（重点）
### 9.1 科技解锁建筑ID vs 建筑定义ID
> 2026-03-22 更新：运行时科技树已加入建筑/配方解锁规范化，对齐测试见 `server/internal/model/tech_alignment_test.go`，当前运行时已不再允许无效建筑解锁引用。

- 科技解锁建筑ID总数：64
- 建筑定义ID总数：62
- 仅科技树存在（定义不存在）：34
- 仅建筑定义存在（科技树不引用）：32

> 2026-03-22 修复说明：以上数字为 2026-03-21 静态快照；运行时已通过 `normalizeTechDefinitions` 与别名映射完成规范化，并由 `server/internal/model/tech_alignment_test.go` 验证。**【已修复，2026-03-22】**

影响：
- 研究完成后，部分“理论解锁建筑”在建筑目录中找不到对应ID。
- 部分已定义建筑无法被科技树正常解锁。
- 3 个当前可建造建筑未出现在科技解锁映射中：`assembling_machine_mk1`、`plane_smelter`、`negentropy_smelter`。

> 2026-03-22 修复说明：以上影响已不再成立。`assembling_machine_mk1`、`plane_smelter`、`negentropy_smelter` 已纳入对齐后的科技解锁映射。**【已修复，2026-03-22】**

### 9.2 科技解锁配方ID vs 配方目录ID
> 2026-03-22 更新：运行时科技树已加入配方解锁规范化，对齐测试见 `server/internal/model/tech_alignment_test.go`，当前运行时已不再允许无效配方解锁引用。

- 科技解锁配方ID总数：50
- 配方目录ID总数：34
- 交集：6（`antimatter`、`carbon_nanotube`、`plastic`、`processor`、`strange_matter`、`sulfuric_acid`）
- 仅科技树存在：44
- 仅配方目录存在：28

> 2026-03-22 修复说明：以上数字为 2026-03-21 静态快照；运行时已通过配方解锁规范化与对齐测试消除无效引用。**【已修复，2026-03-22】**

影响：
- 科研解锁与实际可用配方之间存在大面积错配。

> 2026-03-22 修复说明：上述错配已在运行时层面修复，不再阻断研究后的配方可用性。**【已修复，2026-03-22】**

### 9.3 开局闭环阻断
综合 `execBuild` + 初始化 + 网关预检可得：
- 建造需要科技解锁。
- 默认初始化未预置玩家科技状态。
- 研究命令默认 API 路径被预检拒绝。

结果：
- 正常 HTTP 游玩路径中，开局“研究 -> 解锁 -> 建造”的主循环难以成立。**【已修复，2026-03-22】**

## 10. 编译与测试现状
在 `server/` 执行：
```bash
/home/firesuiry/sdk/go1.25.0/bin/go test ./...
```
结果：**通过（2026-03-22）**。

本轮已验证的修复点：
- `build_dyson_node` / `build_dyson_frame` / `build_dyson_shell` / `demolish_dyson` 已补齐执行器与网关预检
- 网关命令预检已放行 `start_research` / `cancel_research` / `launch_solar_sail` / `cancel_construction` / `restore_construction`
- 玩家初始化已注入默认科技状态，开局可进入“研究 -> 解锁 -> 建造”主循环
- 科技树建筑/配方解锁已做规范化对齐，并新增对齐测试
- 生产建筑已接入配方状态与 Tick 结算，`ResolveProductionCycle` 已进入主流程
- `Metrics.Snapshot()` 死锁、失效 `e2e/benchmark` 测试等编译/测试阻断项已修复

结论：
- 当前 `server` 已可整体通过编译测试。

## 11. 建议的可玩性分级（按玩家体验）
- A级（框架完整）：Tick 驱动、事件流、审计、快照/回放/回滚。
- B级（基础闭环可运行）：资源采集、电力、输送、仓储、研究、解锁、建造、基础生产已形成可达链路。
- C级（深度玩法待增强）：物流站供需配置 API、高级物流调参、战斗科技深度接线、轨道/舰队编队等能力仍待完善。

## 12. 关键证据文件索引
- 命令枚举：`server/internal/model/command.go`
- 网关命令预检：`server/internal/gateway/server.go` `validateCommandStructure`
- 命令执行分发：`server/internal/gamecore/core.go` `executeRequest`
- Tick 主循环：`server/internal/gamecore/core.go` `processTick`
- 建筑定义：`server/internal/model/building_defs.go`
- 建筑运行时：`server/internal/model/building_runtime.go`
- 物品定义：`server/internal/model/item.go`
- 配方目录：`server/internal/model/recipe.go`
- 科技树：`server/internal/model/tech.go`
- 研究逻辑：`server/internal/gamecore/research.go`
- 建造/升级/拆除/发射/资源：`server/internal/gamecore/rules.go`
- 建造队列：`server/internal/gamecore/construction.go`
- 物流：`server/internal/gamecore/logistics_*.go`
- 管道：`server/internal/gamecore/pipeline_*`
- 战斗/敌对势力/轨道：`server/internal/gamecore/combat_settlement.go`、`enemy_force_settlement.go`、`orbital_settlement.go`
- 快照/持久化/回放/回滚：`server/internal/snapshot/*`、`server/internal/persistence/*`、`server/internal/gamecore/replay.go`、`rollback.go`

---

## 附录A：建筑ID清单（62）
- `accumulator`
- `accumulator_full`
- `advanced_mining_machine`
- `arc_smelter`
- `artificial_star`
- `assembling_machine_mk1`
- `assembling_machine_mk2`
- `assembling_machine_mk3`
- `automatic_piler`
- `battlefield_analysis_base`
- `chemical_plant`
- `conveyor_belt_mk1`
- `conveyor_belt_mk2`
- `conveyor_belt_mk3`
- `depot_mk1`
- `depot_mk2`
- `em_rail_ejector`
- `energy_exchanger`
- `foundation`
- `fractionator`
- `gauss_turret`
- `geothermal_power_station`
- `implosion_cannon`
- `interstellar_logistics_station`
- `jammer_tower`
- `laser_turret`
- `logistics_distributor`
- `matrix_lab`
- `mini_fusion_power_plant`
- `miniature_particle_collider`
- `mining_machine`
- `missile_turret`
- `negentropy_smelter`
- `oil_extractor`
- `oil_refinery`
- `orbital_collector`
- `pile_sorter`
- `plane_smelter`
- `planetary_logistics_station`
- `planetary_shield_generator`
- `plasma_turret`
- `quantum_chemical_plant`
- `ray_receiver`
- `recomposing_assembler`
- `satellite_substation`
- `self_evolution_lab`
- `signal_tower`
- `solar_panel`
- `sorter_mk1`
- `sorter_mk2`
- `sorter_mk3`
- `splitter`
- `spray_coater`
- `sr_plasma_turret`
- `storage_tank`
- `tesla_tower`
- `thermal_power_plant`
- `traffic_monitor`
- `vertical_launching_silo`
- `water_pump`
- `wind_turbine`
- `wireless_power_tower`

## 附录B：可建造建筑（2026-03-21 历史快照，Buildable=true，当时为 10）
> 2026-03-22 更新：当前 `Buildable: true` 数量已提升至 53，本附录列表仅保留历史快照。
- `arc_smelter`
- `assembling_machine_mk1`
- `chemical_plant`
- `gauss_turret`
- `mining_machine`
- `negentropy_smelter`
- `orbital_collector`
- `plane_smelter`
- `quantum_chemical_plant`
- `solar_panel`

## 附录C：建筑运行时模块明细（35）
| 建筑 | 模块 |
|---|---|
| `accumulator` | `storage|energy_storage` |
| `accumulator_full` | `storage|energy_storage` |
| `arc_smelter` | `production|energy` |
| `artificial_star` | `storage|energy` |
| `assembling_machine_mk1` | `production|energy` |
| `battlefield_analysis_base` | `collect|energy` |
| `chemical_plant` | `production|energy` |
| `conveyor_belt_mk1` | `transport` |
| `conveyor_belt_mk2` | `transport` |
| `conveyor_belt_mk3` | `transport` |
| `depot_mk1` | `storage` |
| `depot_mk2` | `storage` |
| `em_rail_ejector` | `launch|energy` |
| `energy_exchanger` | `(无显式模块)` |
| `gauss_turret` | `combat|energy` |
| `mini_fusion_power_plant` | `storage|energy` |
| `mining_machine` | `collect|energy` |
| `negentropy_smelter` | `production|energy` |
| `orbital_collector` | `orbital|energy` |
| `pile_sorter` | `sorter` |
| `plane_smelter` | `production|energy` |
| `quantum_chemical_plant` | `production|energy` |
| `ray_receiver` | `storage|ray_receiver` |
| `satellite_substation` | `(无显式模块)` |
| `solar_panel` | `energy` |
| `sorter_mk1` | `sorter` |
| `sorter_mk2` | `sorter` |
| `sorter_mk3` | `sorter` |
| `spray_coater` | `spray|energy` |
| `storage_tank` | `storage` |
| `tesla_tower` | `(无显式模块)` |
| `thermal_power_plant` | `storage|energy` |
| `vertical_launching_silo` | `production|launch|energy` |
| `wind_turbine` | `energy` |
| `wireless_power_tower` | `(无显式模块)` |
## 附录D：物品ID清单（55）
- `ammo_bullet`
- `ammo_missile`
- `annihilation_constraint_sphere`
- `antimatter`
- `antimatter_fuel_rod`
- `carbon_nanotube`
- `circuit_board`
- `coal`
- `copper_ingot`
- `copper_ore`
- `critical_photon`
- `crude_oil`
- `crystal_silicon`
- `deuterium`
- `deuterium_fuel_rod`
- `energetic_graphite`
- `fire_ice`
- `fractal_silicon`
- `gas_tank`
- `gear`
- `glass`
- `graphene`
- `grating_crystal`
- `hydrogen`
- `hydrogen_fuel_rod`
- `iron_ingot`
- `iron_ore`
- `liquid_tank`
- `matrix_blue`
- `matrix_red`
- `matrix_universe`
- `matrix_yellow`
- `microcrystalline_component`
- `monopole_magnet`
- `motor`
- `particle_container`
- `photon_combiner`
- `plastic`
- `processor`
- `proliferator_mk1`
- `proliferator_mk2`
- `proliferator_mk3`
- `refined_oil`
- `silicon_ingot`
- `silicon_ore`
- `small_carrier_rocket`
- `solar_sail`
- `space_warper`
- `stone_brick`
- `stone_ore`
- `strange_matter`
- `sulfuric_acid`
- `titanium_ingot`
- `titanium_ore`
- `water`

## 附录E：配方ID清单（34）
- `ammo_bullet`
- `ammo_missile`
- `annihilation_constraint_sphere`
- `antimatter`
- `antimatter_fuel_rod`
- `carbon_nanotube`
- `circuit_board`
- `coal_to_graphite`
- `crystal_silicon_from_fractal`
- `deuterium_fuel_rod`
- `fuel_rod_recycling`
- `gear`
- `graphene_from_fire_ice`
- `graphene_from_graphite`
- `hydrogen_fuel_rod`
- `matrix_blue`
- `matrix_red`
- `matrix_universe`
- `matrix_yellow`
- `microcrystalline_component`
- `motor`
- `oil_fractionation`
- `particle_container_from_monopole`
- `photon_combiner_from_grating`
- `plastic`
- `processor`
- `smelt_copper`
- `smelt_iron`
- `smelt_silicon`
- `smelt_stone`
- `smelt_titanium`
- `solar_sail`
- `strange_matter`
- `sulfuric_acid`

## 附录F：科技ID清单（105）
- `annihilation`
- `artificial_star`
- `automatic_metallurgy`
- `basic_assembling_processes`
- `basic_chemical`
- `basic_logistics_system`
- `battlefield_analysis`
- `casimir_crystal`
- `combustible_unit`
- `corvette`
- `crystal_explosive`
- `crystal_shell`
- `crystal_smelting`
- `dark_fog_matrix`
- `destroyer`
- `deuterium_fractionation`
- `dirac_inversion`
- `distribution_logistics`
- `drone_engine`
- `dyson_sphere_program`
- `dyson_stress`
- `efficient_logistics`
- `electromagnetic_drive`
- `electromagnetic_matrix`
- `electromagnetism`
- `energy_matrix`
- `energy_shield`
- `energy_storage`
- `engine`
- `environment_modification`
- `fluid_storage`
- `gas_giants`
- `geothermal`
- `gravitational_wave`
- `gravity_matrix`
- `gravity_missile`
- `high_energy_laser`
- `high_strength_crystal`
- `high_strength_glass`
- `high_strength_material`
- `highspeed_assembling`
- `hydrogen_fuel`
- `implosion_cannon`
- `improved_logistics`
- `information_matrix`
- `integrated_logistics`
- `interstellar_logistics`
- `interstellar_power`
- `ionosphere`
- `lightweight_structure`
- `magnetic_levitation`
- `mass_energy_storage`
- `mecha_core`
- `mecha_engine`
- `mesoscopic_entanglement`
- `mini_fusion`
- `miniature_collider`
- `missile_turret`
- `mission_complete`
- `particle_container`
- `particle_control`
- `photon_conversion`
- `photon_mining`
- `plane_filter_smelting`
- `planetary_logistics`
- `plasma_control`
- `plasma_refining`
- `plasma_turret`
- `polymer_chemical`
- `precision_drone`
- `processor`
- `proliferator_mk1`
- `proliferator_mk2`
- `proliferator_mk3`
- `prototype`
- `quantum_chip`
- `quantum_printing`
- `ray_receiver`
- `reformed_refinement`
- `research_speed`
- `satellite_power`
- `semiconductor`
- `signal_tower`
- `smelting_purification`
- `solar_collection`
- `solar_sail_life`
- `solar_sail_orbit`
- `steel_smelting`
- `strange_matter`
- `structure_matrix`
- `super_magnetic`
- `superconductor`
- `supersonic_missile`
- `thermal_power`
- `thruster`
- `titanium_alloy`
- `titanium_ammo`
- `titanium_smelting`
- `universe_exploration`
- `universe_matrix`
- `vertical_construction`
- `vertical_launching`
- `wave_interference`
- `weapon_system`
- `xray_cracking`

## 附录G：命令可达性差异（2026-03-21 历史快照，运行时已修复）
> 2026-03-22 更新：以下差异仅保留为历史记录；相关命令现已补齐执行器与网关预检并通过测试。**【已修复，2026-03-22】**
### G.1 枚举存在但执行器未实现（4，历史快照，已修复）
- `build_dyson_frame`
- `build_dyson_node`
- `build_dyson_shell`
- `demolish_dyson`

### G.2 执行器已实现但网关预检不放行（5，历史快照，已修复）
- `cancel_construction`
- `cancel_research`
- `launch_solar_sail`
- `restore_construction`
- `start_research`

## 附录H：科技建筑ID不一致清单（2026-03-21 历史快照，运行时已修复）
> 2026-03-22 更新：以下不一致已通过科技解锁规范化与对齐测试修复，保留本附录仅用于说明历史问题。**【已修复，2026-03-22】**
### H.1 仅科技树存在（34，历史快照，已修复）
- `annihilation_reactor`
- `assembler_mk1`
- `assembler_mk2`
- `assembler_mk3`
- `auto_stacker`
- `conveyor_mk1`
- `conveyor_mk2`
- `conveyor_mk3`
- `electric_motor`
- `em_rail`
- `em_rail_launcher`
- `energy_pylon`
- `flow_monitor`
- `fluid_tank`
- `geothermal_plant`
- `high_energy_laser`
- `logistics_bot`
- `logistics_vessel`
- `mini_fusion_plant`
- `miniature_collider`
- `photon_combiner`
- `plasma_exciter`
- `power_pylon`
- `prism`
- `pump`
- `refinery`
- `self_evolution_station`
- `small_carrier_rocket`
- `solar_sail`
- `stacker`
- `star_lifter`
- `storage_mk1`
- `storage_mk2`
- `wireless_pylon`

### H.2 仅建筑定义存在（32，历史快照，已修复）
- `accumulator_full`
- `advanced_mining_machine`
- `assembling_machine_mk1`
- `assembling_machine_mk2`
- `assembling_machine_mk3`
- `automatic_piler`
- `conveyor_belt_mk1`
- `conveyor_belt_mk2`
- `conveyor_belt_mk3`
- `depot_mk1`
- `depot_mk2`
- `em_rail_ejector`
- `energy_exchanger`
- `geothermal_power_station`
- `jammer_tower`
- `laser_turret`
- `mini_fusion_power_plant`
- `miniature_particle_collider`
- `negentropy_smelter`
- `oil_refinery`
- `pile_sorter`
- `plane_smelter`
- `planetary_shield_generator`
- `recomposing_assembler`
- `satellite_substation`
- `self_evolution_lab`
- `sr_plasma_turret`
- `storage_tank`
- `tesla_tower`
- `traffic_monitor`
- `water_pump`
- `wireless_power_tower`

> 2026-04-03 补充：`jammer_tower`、`planetary_shield_generator`、`self_evolution_lab`、`sr_plasma_turret` 已不再属于“仅建筑定义存在”类别；当前运行时已经具备 buildable、科技入口与结算闭环。

## 附录I：科技配方ID不一致清单（2026-03-21 历史快照，运行时已修复）
> 2026-03-22 更新：以下清单对应修复前的静态比对结果；当前运行时已通过配方解锁规范化与对齐测试消除无效引用。**【已修复，2026-03-22】**
### I.1 科技与配方目录交集（6，历史快照）
- `antimatter`
- `carbon_nanotube`
- `plastic`
- `processor`
- `strange_matter`
- `sulfuric_acid`

### I.2 仅科技树存在（44，历史快照，已修复）
- `antimatter_capsule`
- `antimatter_fuel`
- `casimir_crystal`
- `combustible_unit`
- `crystal`
- `crystal_explosive`
- `crystal_shell`
- `deuterium`
- `deuterium_fuel`
- `diamond`
- `frame_material`
- `glass`
- `graphene`
- `graphite`
- `gravitational_lens`
- `gravity_missile`
- `high_purity_silicon`
- `hydrogen_fuel`
- `magnum_ammo`
- `microcrystalline`
- `missile`
- `organic_crystal`
- `particle_broadband`
- `particle_container`
- `plane_filter`
- `proliferator_mk1`
- `proliferator_mk2`
- `proliferator_mk3`
- `quantum_chip`
- `refined_oil`
- `reformed_refinement`
- `shell_set`
- `silicon_ore`
- `space_warper`
- `steel`
- `super_magnetic_ring`
- `supersonic_missile`
- `thruster`
- `titanium`
- `titanium_alloy`
- `titanium_ammo`
- `titanium_crystal`
- `titanium_glass`
- `xray_cracking`

### I.3 仅配方目录存在（28，历史快照，已修复）
- `ammo_bullet`
- `ammo_missile`
- `annihilation_constraint_sphere`
- `antimatter_fuel_rod`
- `circuit_board`
- `coal_to_graphite`
- `crystal_silicon_from_fractal`
- `deuterium_fuel_rod`
- `fuel_rod_recycling`
- `gear`
- `graphene_from_fire_ice`
- `graphene_from_graphite`
- `hydrogen_fuel_rod`
- `matrix_blue`
- `matrix_red`
- `matrix_universe`
- `matrix_yellow`
- `microcrystalline_component`
- `motor`
- `oil_fractionation`
- `particle_container_from_monopole`
- `photon_combiner_from_grating`
- `smelt_copper`
- `smelt_iron`
- `smelt_silicon`
- `smelt_stone`
- `smelt_titanium`
- `solar_sail`
