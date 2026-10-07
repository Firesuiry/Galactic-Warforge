# 服务端 API

服务端对外 HTTP / SSE 契约。字段以 `server/internal/gateway` 与 `server/internal/query` 实现为准；改动 API 行为后须同步本文（命令一览由脚本生成，见 [命令一览](#命令一览)）。

## 1. 基础信息

- Base URL：`http://<host>:<port>`（本地默认端口见 [本地环境与测试](本地环境与测试.md)）
- 认证：`Authorization: Bearer <player_key>`；除 `/health`、`/metrics` 外全部接口需要认证。默认玩家 `p1 / key_player_1`、`p2 / key_player_2`。
- 响应：JSON（SSE 除外）。
- 错误格式：

```json
{ "error": "message", "code": 400 }
```

| HTTP | 含义 |
| --- | --- |
| 400 | 请求体/参数非法 |
| 401 | 缺少或无效的 Bearer key（热重置后旧 key 也返回 401） |
| 403 | 越权：`issuer_id` 与鉴权玩家不一致；`/save` `/rollback` `/games/new` 非 `role=admin` |
| 404 | 实体不存在或对当前玩家不可见 |
| 429 | 超过每玩家命令速率限制（`server.rate_limit`） |
| 500 | 存档写盘失败等内部错误 |

### 行星坐标

行星统一为立方体球面六面网格。各查询返回 `surface: {topology: "cube_sphere", face_size: N}`；`map_width = 3N`、`map_height = 2N` 只是存储图集尺寸，x/y 不具有平面邻接语义，距离和方向一律按球面邻接计算（可跨面）。配置只用 `planet.face_size`，旧平面存档拒绝加载。面序与坐标协议见 [3D与画质](../guide/3D与画质.md)。

## 2. 启动、存档与场景

### 游戏目录

- `server.data_dir` 是单局工作目录，固定包含 `meta.json` 与 `save.json`。
  - 目录不存在或为空：按本次 `-config` 与 `-map-config` 新建一局，对外服务前先写出首个存档。
  - 两个文件都合法：续档；存档内的 `battlefield`、`players`、`map_config` 优先于外部配置。
  - 只有其一或目录非空但不完整：拒绝启动。
- 续档时仍可被外部覆盖的纯运行参数：`server.port`、`rate_limit`、`event_history_limit`、`snapshot_max_events`、`alert_history_limit`、`auto_save_interval_seconds`。
- `server.game_data_dir`（可选）：游戏数据目录，放整套 `items/recipes/techs/buildings/units/combat/war.yaml`，非空时替换内置 `server/data/`；启动时做完整引用校验，失败即拒绝启动并列出全部错误。格式见 [数据配置文件](数据配置文件.md)。与 `data_dir`（存档）是两回事。
- 自动保存默认每 60 秒覆盖 `save.json`，`auto_save_interval_seconds = 0` 关闭；只有一个存档槽，手动保存同样覆盖。
- `save.json` 为 gzip 压缩（按魔数识别，明文旧档可读）。持久化内容包括世界快照、`space` runtime（太阳帆按 `player + system` 分桶）、`winner` / `victory_reason` / `victory_rule` / `victory_tech_id`、结算报告等；不持久化 RNG 状态，续档后随机事件不保证与不停服一致。

### 普通新局（`config-dev.yaml` + `map.yaml`）

```bash
cd server && go run ./cmd/server -config config-dev.yaml -map-config map.yaml
```

- `battlefield.victory_rule`：`elimination` / `mission_complete` / `hybrid` / `sandbox`（永不判胜）；仓库内 `config*.yaml` 默认 `hybrid`（科研胜利与消灭胜同时有效）。
- `battlefield.enemy_difficulty`：`off|easy|normal|hard`（默认 normal，off 为和平模式）。
- 每名玩家只预完成 `dyson_sphere_program`，它直接解锁 `matrix_lab`、`wind_turbine`、`mining_machine`、`arc_smelter`、`tesla_tower`、`conveyor_belt_mk1`、`sorter_mk1`、`assembling_machine_mk1`。
- 启动包：`minerals = 240`、`energy = 100`，不送矩阵。第一门 `electromagnetism`（10 电磁矩阵）须自产：铁→磁铁→磁线圈，铜→电路板，磁线圈 + 电路板→`electromagnetic_matrix`（配方无需研究，`assembling_machine_mk1` / `matrix_lab` / `self_evolution_lab` 可产）。
- `battlefield_analysis_base` 不发电，先补 `wind_turbine` 否则研究站无电。
- 出生点：每个基地 `spawnMineDistance`（默认 `operate_range-2`，config-dev 为 4）内保证有 `iron_ore` 与 `copper_ore` 有限矿脉（缺失则注入 `Total=2000 / BaseYield=8`）；出生点半径 8 格平整为可建地形。
- starter 闭环示例：`build 3 2 wind_turbine` → `build 4 2 tesla_tower` → `build 5 1 mining_machine`；矩阵投产后 `build 2 3 matrix_lab` → `transfer <lab> electromagnetic_matrix 10` → `start_research electromagnetism`。

### 遭遇战预设（`config-skirmish.yaml` + `map-skirmish.yaml`）

```bash
cd server && go run ./cmd/server -config config-skirmish.yaml -map-config map-skirmish.yaml
```

- p1 人类、p2 bot（hard）；`pace_research 6` / `pace_build 2` / `pace_output 2` / `time_limit_ticks 54000` / `threat_growth_scale 1.5`。
- `battlefield.dark_fog_calm_ticks`（任何配置可用，默认 6000）：黑雾被激怒后多久恢复中立，见 5.4。
- `battlefield.bot_first_attack_tick`（任何配置可用，默认 0 = 不限）：bot 军团首次主动进攻的最早 tick；遭遇战设 16000，之前军团只守家。
- 双方相同的开局物资包（`players[].bootstrap`）：`minerals 1200`、`energy 400`，铁块 100、齿轮 40、磁线圈 26、电路板 20、石砖 4、煤 20，够直接建风机 ×3、电感应塔 ×4、采矿机 ×4、电弧熔炉 ×2、制造台 ×1、传送带约 20 段。回归测试 `TestSkirmishPlayerKitRunsPowerMiningSmeltingBy1500`（约 3 秒一条命令，tick 1500 内供电、采矿、冶炼都已运转）与 `TestSkirmishBotOpensAndAttacksInWindow`（bot 起基地、出兵、编军团，tick 15000–25000 首次进攻玩家）。

### 官方中后期场景（`config-midgame.yaml` + `map-midgame.yaml`）

```bash
cd server && go run ./cmd/server -config config-midgame.yaml -map-config map-midgame.yaml
```

- `battlefield.initial_active_planet_id = planet-1-2`（新局默认焦点行星；续档不覆盖）。`map-midgame.yaml` 用 `overrides.planets.planet-1-2.kind = gas_giant` 强制气态行星。
- `players[].bootstrap`：`minerals 5000`、`energy 3000`、`frame_material / deuterium_fuel_rod / quantum_chip / solar_sail` 各 16、`small_carrier_rocket` 4；`completed_techs` 覆盖物流、戴森组件、射线接收、垂直发射、`signal_tower`、`plasma_turret`、`gravity_matrix`、`planetary_shield`、`self_evolution`、`integrated_logistics`、`photon_mining`、`annihilation` 等（直接完成列表，不递归补前置）。
- 故意不预置 `dirac_inversion`、`antimatter_fuel_rod` 与 `prototype` / `precision_drone` / `corvette` / `destroyer`，用于验证 `photon` 模式门禁、人造恒星空燃料边界以及完整军工闭环。
- `scenario_bootstrap.planets[]` 在 `planet-1-2` 通过与正常建造同源的 `completeConstructionTask()` 落 `tesla_tower`、`wind_turbine`、`ray_receiver(power)`、`em_rail_ejector`、`vertical_launching_silo`；`scenario_bootstrap.systems[]` 在 `sys-1` 预置最小戴森层与太阳帆轨道。启动即可在 `planet-1-1` / `planet-1-2` 间切换。

### 官方战争场景（`config-war.yaml` + `map-war.yaml`）

```bash
cd server && go run ./cmd/server -config config-war.yaml -map-config map-war.yaml
```

- 焦点行星 `planet-1-1`；`p1` / `p2` 预置 `battlefield_analysis`、`prototype`、`precision_drone`、`corvette`、`destroyer` 及其依赖科技。
- `planet-1-1` 预置已通电的 `battlefield_analysis_base`（部署枢纽）、`recomposing_assembler`、行星/星际物流站，以及双方各一座装满子弹、炮弹、导弹的 `supply_station`。
- 不预建舰队、任务群或战区；单位仍须走 `blueprint_* → queue_military_production → industry.ready_payloads → deploy_squad | commission_fleet`。
- `map` 配置的 `spawn_points: [{x, y}]` 可钉住出生点（midgame / war 钉在 `(3,3)` 与 `(44,44)`）；未配置时自动散布、距边缘至少 8 格并就近挪到矿脉旁。

## 3. 命令提交 `POST /commands`

请求：

```json
{
  "request_id": "uuid",
  "issuer_type": "player",
  "issuer_id": "p1",
  "commands": [
    {
      "type": "build",
      "target": { "layer": "planet", "planet_id": "planet-1-1", "position": { "x": 10, "y": 12 } },
      "payload": { "building_type": "mining_machine" }
    }
  ]
}
```

- `request_id`、`issuer_type`、`issuer_id`、非空 `commands` 必填；`issuer_type=player` 时 `issuer_id` 必须等于鉴权玩家（否则 403）。
- `target` 可含 `layer`（`galaxy|system|planet`）、`galaxy_id`、`system_id`、`planet_id`、`entity_id`、`entity_ids`、`position {x, y, z?}`；各命令所需字段见 [命令一览](#命令一览)，机器可读版本见 `GET /catalog/commands`。
- 权限：按玩家 `permissions`（`*` 为全部）逐条校验，无权限直接拒绝。

响应（`202`）：

```json
{
  "request_id": "uuid",
  "accepted": true,
  "enqueue_tick": 120,
  "results": [{ "command_index": 0, "status": "accepted", "code": "OK", "message": "已受理，下一 tick 执行" }]
}
```

- `accepted=true` 只表示通过网关预校验并入队到 `enqueue_tick`，**不是最终成功**。最终结果以 SSE `command_result` 为准，用 `payload.request_id + command_index` 对账；重连后可用 `GET /events/snapshot?event_types=command_result` 补账。
- 任一命令预校验失败：仍为 `202`，但 `accepted=false`，整批不入队。
- 重复 `request_id`：`200`，`accepted=false` + `DUPLICATE`，不会再次入队。
- `build` 的 `command_result(OK)` 通常只表示施工任务已创建/排队，建筑落地看 `entity_created`，停机原因看 `building_state_changed`。

### 结构化预校验 `results[].issues[]`

网关用与 `/catalog/commands` 同源的注册表（`model.ValidateCommandStructure`）做字段级校验：

- `code`：`missing_field` / `invalid_value` / `unknown_command` / `unauthorized` / `duplicate_request`
- `field`：出错路径（如 `target.position`、`payload.building_type`）
- `message` / `expected`（合法取值提示）/ `actual`（可选）

运行期失败（tick 内 `command_result`）只给 `code` / `message`。

### 结果码

`OK`、`INVALID_TARGET`、`NOT_OWNER`、`OUT_OF_RANGE`、`INSUFFICIENT_RESOURCE`、`DUPLICATE`、`VALIDATION_FAILED`、`ENTITY_NOT_FOUND`、`POSITION_OCCUPIED`、`UNAUTHORIZED`、`EXECUTOR_UNAVAILABLE`、`EXECUTOR_BUSY`、`GAME_FINISHED`。

`GAME_FINISHED`：胜利宣判后对局进入 `finished`，所有常规游戏命令在网关阶段以 `accepted=false` + 该码拒绝，已入队的存量命令执行时也以该码拒绝；管理面（`/save`、`/rollback`、`/games/*`）与查询不受限。

### 行星路由

所有已加载行星每 tick 都完整结算（建造/生产/战斗/黑雾/物流/军工），每名玩家有独立的焦点行星（`players[pid].focus_planet_id`，由 `switch_active_planet` 设置）。行星层命令按以下优先级决定在哪颗行星结算：

1. `target.planet_id` 显式指定（未加载时 `INVALID_TARGET`，message `planet runtime <id> not loaded`）；
2. 命令引用的实体（`target.entity_id(s)`、`payload.building_id`、`payload.task_id` 等）所在行星；
3. 玩家焦点行星；
4. 全局默认行星 `active_planet_id`（仅冷启动兜底）。

- `build` 无可引用实体，用 `target.planet_id` 选落点，缺省为焦点行星。
- 不同行星的实体 ID 可能撞号，此时优先命中焦点行星；指挥另一颗行星上的同号实体须显式给 `target.planet_id`（CLI 用 `--planet`）。
- 太空层/玩家级命令（`fleet_*`、`task_force_*`、`theater_*`、`blockade_planet`、`blueprint_*`、戴森系列、研究、扫描）中的 `planet_id` 是作战参数，不参与路由。
- `deploy_squad` 的 `payload.planet_id` 是落点，路由仍由 `payload.building_id` 决定。

## 4. 命令一览

<!-- BEGIN GENERATED COMMANDS -->
<!-- 由 scripts/gen_command_docs.py 生成，勿手改；数据源 GET /catalog/commands 与 shared-client 命令目录 -->

共 64 条公开命令。target 列为 `target` 必填字段；载荷列为 `payload` 字段（可选字段带 `?`）。

| 命令 | 层级 | target 必填 | payload | CLI 动词 | 说明 |
|---|---|---|---|---|---|
| `attack` | planet | — | `target_entity_id` | `attack` | Attack target entity |
| `blockade_planet` | planet | — | `task_force_id`, `planet_id` | `blockade_planet` | Issue a blockade intent against one planet |
| `blueprint_create` | planet | — | `blueprint_id`, `domain`, `name?`, `base_frame_id?`, `base_hull_id?` | `blueprint_create` | Create a draft warfare blueprint |
| `blueprint_finalize` | planet | — | `blueprint_id`, `target_state?` | `blueprint_finalize` | Advance a warfare blueprint to the next or chosen lifecycle state |
| `blueprint_set_component` | planet | — | `blueprint_id`, `slot_id`, `component_id` | `blueprint_set_component` | Set one component on a draft or validated warfare blueprint |
| `blueprint_validate` | planet | — | `blueprint_id` | `blueprint_validate` | Validate a warfare blueprint and receive structured legality issues |
| `blueprint_variant` | planet | — | `parent_blueprint_id`, `blueprint_id`, `allowed_slot_ids`, `name?` | `blueprint_variant` | Create a controlled variant from a preset or player blueprint |
| `build` | planet | `position` | `building_type`, `recipe_id?`, `direction?`, `rotation?`, `auto_approach?` | `build` | Build any server-side buildable structure |
| `build_dyson_frame` | system | — | `system_id`, `layer_index`, `node_a_id`, `node_b_id` | `build_dyson_frame` | Build a Dyson sphere frame |
| `build_dyson_node` | system | — | `system_id`, `layer_index`, `latitude`, `longitude`, `orbit_radius?` | `build_dyson_node` | Build a Dyson sphere node |
| `build_dyson_shell` | system | — | `system_id`, `layer_index`, `latitude_min`, `latitude_max`, `coverage` | `build_dyson_shell` | Build a Dyson sphere shell |
| `cancel_construction` | planet | — | `task_id` | `cancel_construction` | Cancel queued or running construction task |
| `cancel_mecha_job` | planet | `entity_id` | — | `cancel_mecha_job` | 取消机甲任务并返还未完成批次原料 |
| `cancel_research` | planet | — | `tech_id` | `cancel_research` | Cancel a technology in progress or queue |
| `commission_fleet` | system | — | `building_id`, `blueprint_id`, `count`, `system_id`, `fleet_id?` | `commission_fleet` | Consume a fleet payload from a hub and create or reinforce a fleet |
| `configure_distributor` | planet | `entity_id` | `item_id`, `mode`, `local_storage`, `player_delivery_enabled?`, `player_collection_enabled?` | `configure_distributor` | 配置仓库配送器；省略开关保留原值 |
| `configure_logistics_slot` | planet | `entity_id` | `scope`, `item_id`, `mode`, `local_storage`, `remove?` | `configure_logistics_slot` | 配置物流物品槽；remove移除无库存、无端口或在途引用的空槽 |
| `configure_logistics_station` | planet | `entity_id` | `input_priority?`, `output_priority?`, `drone_capacity?`, `interstellar?`, `belt_ports?` | `configure_logistics_station` | Configure logistics station capacity, priority and interstellar switches |
| `configure_mecha_logistics` | planet | `entity_id` | `requests` | `configure_mecha_logistics` | 替换机甲配送请求，最多 8 项，none 清空 |
| `configure_sorter` | planet | `entity_id` | `input_directions`, `output_directions`, `filter_mode?`, `filter_items?` | `configure_sorter` | 设置分拣器方向和物品过滤 |
| `configure_splitter` | planet | `entity_id` | `input_directions`, `output_directions`, `input_priority?`, `output_priority?`, `output_filters?` | `configure_splitter` | 完整替换分流器端口、优先级和物品过滤；省略可选项即清除 |
| `configure_traffic_monitor` | planet | `entity_id` | `target_belt_id`, `window_ticks`, `minimum_items_per_tick`, `alerts_enabled` | `configure_traffic_monitor` | 监测相邻皮带真实流出量；none 清绑定，配置重置采样 |
| `craft_item` | planet | `entity_id` | `recipe_id`, `quantity` | `craft_item` | 使用背包原料进行个人制造，quantity为批数（按执行体所在行星结算） |
| `demolish` | planet | `entity_id` | — | `demolish` | Demolish building（按建筑所在行星结算） |
| `demolish_dyson` | system | — | `system_id`, `component_type`, `component_id` | `demolish_dyson` | Demolish a Dyson sphere component |
| `deploy_squad` | planet | — | `member_ids?`, `name?`, `building_id?`, `blueprint_id?`, `count?`, `planet_id?` | `deploy_squad` | Consume a squad payload from a hub and create a combat squad |
| `dissolve_squad` | planet | — | `squad_id` | `dissolve_squad` | 解散军团，单位保留当前指令 |
| `fleet_assign` | system | — | `fleet_id`, `formation` | `fleet_assign` | Change a fleet formation |
| `fleet_attack` | system | — | `fleet_id`, `planet_id`, `target_id` | `fleet_attack` | Order a fleet to attack a target in the same system |
| `fleet_disband` | system | — | `fleet_id` | `fleet_disband` | Disband a fleet and remove it from runtime |
| `fleet_move` | system | — | `fleet_id`, `target_system_id` | `fleet_move` | Order a fleet to transit to a connected star system |
| `form_squad` | planet | — | `entity_ids`, `name?` | `form_squad` | 选中单位编成军团（可含补给车） |
| `install_logistics_bot` | planet | `entity_id` | `quantity`, `source?` | `install_logistics_bot` | 消耗背包或绑定仓库的机器人安装至配送器 |
| `install_logistics_vehicle` | planet | `entity_id` | `item_id`, `quantity`, `source?` | `install_logistics_vehicle` | 消耗背包或站内成品安装运输器，受站点槽位上限限制 |
| `launch_rocket` | planet | — | `building_id`, `system_id`, `layer_index?`, `count?` | `launch_rocket` | Launch loaded rockets from a Vertical Launching Silo into a Dyson layer |
| `launch_solar_sail` | planet | — | `building_id`, `count?`, `orbit_radius?`, `inclination?` | `launch_solar_sail` | Launch loaded solar sails from an EM Rail Ejector |
| `mine_resource` | planet | `entity_id` | `resource_id`, `quantity` | `mine_resource` | 手动采集固体资源到背包（按执行体所在行星结算） |
| `move` | planet | `position` | — | `move` | Move entity to position |
| `produce` | planet | `entity_id` | `unit_type` | `produce` | Produce a server-public world unit（按建筑所在行星结算） |
| `queue_military_production` | planet | — | `building_id`, `deployment_hub_id`, `blueprint_id`, `count` | `queue_military_production` | Queue military production and deliver ready payloads into a deployment hub |
| `refit_unit` | planet | — | `building_id`, `unit_id`, `target_blueprint_id` | `refit_unit` | Send a squad or fleet into authoritative refit |
| `refuel_mecha` | planet | `entity_id` | `item_id`, `count?` | `refuel_mecha` | Refuel an executor mecha: burn up to count fuel items (default 1) until the core is full |
| `restore_construction` | planet | — | `task_id` | `restore_construction` | Restore a cancelled construction task |
| `scan_galaxy` | galaxy | `galaxy_id` | — | `scan_galaxy` | Discover all systems in a galaxy |
| `scan_planet` | planet | `planet_id` | — | `scan_planet` | Discover a planet |
| `scan_system` | system | `system_id` | — | `scan_system` | Discover a system |
| `set_energy_exchanger_mode` | planet | — | `building_id`, `mode` | `set_energy_exchanger_mode` | 切换蓄电器能量枢纽模式：charge 电网盈余充蓄电池，discharge 放电回电网，standby 不转换 |
| `set_rally_point` | planet | `entity_id`, `position` | — | `set_rally_point` | 设置出厂单位集结点 |
| `set_ray_receiver_mode` | planet | — | `building_id`, `mode` | `set_ray_receiver_mode` | Switch ray receiver mode（按建筑所在行星结算） |
| `set_recipe` | planet | `entity_id` | `recipe_id?` | `set_recipe` | 原地切换生产建筑/研究站配方；省略 recipe_id 时研究站回研究模式、生产建筑转空闲，切换后进度清零、库存保留 |
| `squad_order` | planet | — | `squad_id`, `order` | `squad_order` | 军团指令；resupply 自动前往最近补给站 |
| `start_research` | planet | — | `tech_id` | `start_research` | Start researching a technology |
| `switch_active_planet` | planet | — | `planet_id` | `switch_active_planet` | 切换自己的视图焦点/默认落点行星（不影响其他玩家；所有已加载行星始终结算） |
| `task_force_assign` | system | — | `task_force_id`, `member_kind`, `member_ids` | `task_force_assign` | Assign one or more squads or fleets into a task force |
| `task_force_create` | planet | — | `task_force_id`, `name?`, `stance?` | `task_force_create` | Create a task force shell for squads and fleets |
| `task_force_deploy` | system | — | `task_force_id`, `theater_id?`, `system_id?`, `planet_id?`, `position?`, `frontline_id?`, `ground_order?`, `support_mode?` | `task_force_deploy` | Set task force deployment intent, frontline order and orbital support mode |
| `task_force_set_stance` | planet | — | `task_force_id`, `stance` | `task_force_set_stance` | Change task force doctrine and engagement posture |
| `theater_create` | planet | — | `theater_id`, `name?` | `theater_create` | Create a theater container for war zoning and objectives |
| `theater_define_zone` | system | — | `theater_id`, `zone_type`, `system_id?`, `planet_id?`, `position?`, `radius?` | `theater_define_zone` | Define or update one theater zone |
| `theater_set_objective` | system | — | `theater_id`, `objective_type`, `system_id?`, `planet_id?`, `entity_id?`, `description?` | `theater_set_objective` | Set a theater objective anchor and description |
| `transfer_item` | planet | — | `building_id`, `item_id`, `quantity`, `direction?` | `transfer` | Load items from player inventory into building local storage（按建筑所在行星结算） |
| `uninstall_logistics_bot` | planet | `entity_id` | `quantity` | `uninstall_logistics_bot` | 回收空载停靠的配送机器人至背包 |
| `unit_order` | planet | — | `order`, `target_entity_id?` | `order` | R5 部队指令：攻击移动/巡逻/守卫/坚守/跟随/撤退/停止（支持逗号分隔批量；--planet 跨行星同 ID 消歧） |
| `upgrade` | planet | `entity_id` | — | `upgrade` | Upgrade building（按建筑所在行星结算） |

**附加约束**（来自目录 `constraints`）：

- `attack`：指定攻击目标：单位追击至射程内按冷却开火，不再一次性结算。 F4 行星路由：按施令单位所在行星结算；跨行星同 ID 时用 target.planet_id 消歧。
- `blueprint_create`：exactly one of base_frame_id or base_hull_id
- `build`：F4 行星路由：target.planet_id 选择落点行星；缺省落在玩家焦点行星（switch_active_planet 设定）。
- `configure_traffic_monitor`：Full replacement; empty target_belt_id clears binding. Otherwise bind an adjacent owned Mk.I/II/III belt. Reconfiguration clears observations.
- `deploy_squad`：exactly one form: member_ids (group existing units) or building_id + blueprint_id [+ count, default 1] (spawn hub payloads as world units, then group them)
- `form_squad`：entity_ids are 1-300 living owned military units (supply trucks may join); units already in a squad are rejected
- `move`：实时移动：命令只下达路径指令，单位每 tick 按移速沿路径推进；entity_ids 支持框选批量。 F4 行星路由：按目标单位所在行星结算；跨行星同 ID 时用 target.planet_id 消歧，缺省优先玩家焦点行星。
- `refuel_mecha`：payload.count 可选，缺省 1：最多烧几块燃料，烧到核心满为止；背包不足时烧掉现有的。
- `set_energy_exchanger_mode`：mode must be one of charge|discharge|standby; target building must be an owned energy_exchanger
- `set_recipe`：recipe_id omitted or empty switches a research lab back to research mode (or idles a production building); a non-empty recipe_id must be supported by the building type and unlocked by research. Production progress resets on switch; storage contents are kept.
- `switch_active_planet`：F4：只设置该玩家的视图焦点/默认落点行星（focus_planet_id），不再修改全局活动行星；所有已加载行星始终参与结算。目标行星必须已发现、已加载且有 foothold。
- `task_force_deploy`：at least one of system_id, planet_id, position, frontline_id, ground_order is expected at runtime
- `unit_order`：R5 指令集：attack_move/patrol/retreat 需 target.position；guard/follow 需 payload.target_entity_id；stop 用 order=stop。 F4 行星路由：按施令单位所在行星结算；跨行星同 ID 时用 target.planet_id 消歧。
<!-- END GENERATED COMMANDS -->

## 5. 命令语义（表格之外的规则）

### 5.1 执行体与建造

- 执行体是玩家的星球 `Unit`（`type=executor`），同时承担建造与机甲操作。`build`/`produce`/`upgrade`/`demolish` 要求执行体在操作范围内，或目标处于己方建造中心（带 `build_radius` 的建筑，目前为 `battlefield_analysis_base`，半径 24）覆盖内。超距失败消息为 `executor out of range: <distance> > <operate_range>`。
- 并发上限按玩家跨全部行星聚合：`upgrade`/`demolish` 超限执行失败；`build` 超限进施工队列等待。区域并发建造上限 = 配置值 + `mass_construction` 等级。
- `build`：
  - `direction`（传送带、集装机；默认 `east`，`auto` 允许多向路由）、`rotation`（0/90/180/270，作用于占地、端口、分拣器与物流方向）、`recipe_id`（非空；省略时回退 `default_recipe_id`，仍校验配方解锁）、`auto_approach`（施工先排队，执行体按真实路径耗能移动到范围内后开工；不可达拒绝）。
  - `mining_machine` / `water_pump` / `oil_extractor` 必须建在对应资源点上（不校验枯竭；枯竭点任何建筑都能建）；`orbital_collector` 只能建在气态行星。
  - 垂直叠层：对已有同类研究站/生产建筑的格子再 `build` 同类建筑会叠到上层（`position.z` 递增），上限 `1 + vertical_construction` 等级；研究站叠层共享底层库存、吞吐线性叠加。拆除任一层会级联拆除其上所有层，各层分别退款并发 `entity_destroyed`。
  - `foundation` 可在水面、熔岩、阻挡地形施工，完成后改为可建地形并在实体保存原地形；拆除恢复原地形。已有建筑占用或有待建任务时拒绝拆除；同格不能重复铺。planet/scene/overview 反映改造后的运行时地形。
  - `logistics_distributor` 指向己方 `depot_mk1/mk2` 原点，服务器设 `z=1`、不占地面，一仓一个；拆除前须先回收机器人，再拆宿主仓库。
- `upgrade` / `demolish` 受建筑定义规则约束（是否允许、最大等级、耗时、返还率、是否要求停机）；`duration_ticks > 0` 时生成 `job`、建筑置 `paused`，完成时生效。
- `set_recipe`：原地切换配方，进度清零（`remaining_ticks`、`progress_fraction`、待产出）、库存保留；省略/空 `recipe_id` 时研究站回研究模式、生产建筑转空闲；校验失败原子拒绝。
- `transfer_item`：`direction` 可选 `to_building`（默认，从背包装入，容量不足部分装填、只扣实际量）或 `to_player`（从主仓/输出缓存取出，受本行星执行体背包容量限制）。地面物流站须先配物品槽，写入唯一站库 `logistics_station.inventory`；喷涂机只收增产剂；分馏塔与轨道采集器不开放装料。

### 5.2 机甲（执行体）

- `mecha` 字段：`energy` / `max_energy` / `fuel_energy` / `shield` / `max_shield` / `inventory_capacity` / `attack_energy_cost` / `move_energy_cost` / `shield_recharge_delay` / `last_hit_tick` / `job` / `logistics_requests`。
- 初始核心 100、护盾容量 0。科技：`mecha_core` +10 核心/级；`mecha_engine` 与 `drive_engine` 各 +2 移动范围/级（基础 12）；`energy_shield` +20 护盾/级；`mechanical_frame` +20 生命上限/级（基础 120，不回血）；`inventory_capacity` +60 背包/级（基础 200）；`energy_circuit` +20% 电网充电速率/级；`universe_exploration` +1 视野/级（基础 6）。研究只提高上限，不补能。
- 受击满 10 tick 后每 tick 消耗 1 核心恢复最多 2 护盾。
- 移动：每走一格真实路径耗 1 核心，能量不足整条拒绝。攻击：基础攻击 20、防御 8、射程 4，每次成功攻击耗 8 核心；目标机甲护盾先吸收（`damage_applied.shield_absorbed`）。执行体不接受 `unit_order`。
- 自动交战：有显式 `attack` 目标时只打它（不追击）；空闲时（无移动路径、无采集任务）先还击射程内的最近攻击者，再打射程内最近的敌对单位（敌方玩家单位、已对本玩家敌对的黑雾），不自动招惹中立黑雾，不写 `attack_target`，核心低于 2 发攻击耗能时不自动开火。移动、采集命令优先。
- `refuel_mecha`：`payload.item_id` 必填，`payload.count` 可选（缺省 1，最多烧几块）。仅接受 `/catalog.items[].mecha_fuel_energy > 0` 的物品（煤 25、高能石墨 50、精炼油 40、氢 30、氢燃料棒 100、氘燃料棒 250、反物质燃料棒 1000）；实际消耗 = min(count, 补满所需件数, 背包现有)，背包没有该燃料 `INSUFFICIENT_RESOURCE`；核心满或仍有 `fuel_energy` 缓存时拒绝；多余热值留在缓存，每 tick 最多补 10。
- `mine_resource`：只支持 `behavior=finite` 且 `form=solid` 的矿点，启动时须在 2 格内且余量足够；每 10 tick 采 1 件入背包，每件耗 3 核心。
- `craft_item`：配方须 `handcraft_allowed=true`（`smelt_iron`、`smelt_copper`、`smelt_stone`、`smelt_magnet`、`coal_to_graphite`、`gear`、`circuit_board`、`magnetic_coil`）、科技已解锁、输入输出均为固体；启动时一次扣留全部批次原料（不足原子失败），每批 `duration` tick（不受 `pace_output` 影响），每批耗 `max(1, duration/20)` 核心（铁块 3、齿轮 1）；不递归制造前置。
- 个人任务（`mecha.job`：`kind=mine|craft`、`remaining_ticks`、`ticks_per_batch`、`remaining_batches`、`completed_batches`、`energy_per_batch`、`state=running|no_energy|out_of_range`、`reserved_inputs`）同时只能有一个；每批开工时一次性扣 `energy_per_batch` 核心，缺能或超距暂停、恢复后继续。`cancel_mecha_job` 返还未完成批次原料，死亡也走同一退款（只退一次）。
- 电网充电（无需命令）：自有运行中的 `wireless_power_tower` 6 格内最多 10/tick（塔自耗 1/tick），`tesla_tower` 4 格内最多 2/tick；只用塔所在电网的剩余供电，优先保建筑用电；每机甲每 tick 只从一塔受电，优先无线塔。
- 机甲阵亡后等待配置的 `respawn_ticks`，在己方存活 HQ 旁重生；无 HQ 不重生。

### 5.3 世界单位、军团与生产

- `move` / `attack` / `unit_order` 的单位选择器为 `target.entity_id` 或 `target.entity_ids`（框选批量）。
- 实时移动：单位每 tick 按 `move_speed` 沿 `path` 推进，可被新命令打断；占位不重叠，被堵先侧移，堵满 20 tick 后把停着不动的单位当障碍绕路重寻路（绕不开再按原路等待），不可达返回 `OUT_OF_RANGE`；寻路预算上限 800 格。`entity_moved` 带 `path` / `arrived`。
- 攻击：追击至射程内按 `attack_cooldown_ticks` 开火；自动索敌（`aggro_range`）、还击、守位/追击受 `stance` 与 `combat_anchor` 约束；目标可为单位、建筑、黑雾，PvP 与 PvE 同一套规则（军团只是命令容器，不是攻击目标）。中立黑雾只能显式攻击，自动索敌/炮塔只打已敌对的黑雾。
- `unit_order.order`：`attack_move`（沿途索敌）、`patrol`（往返）、`retreat`（途中不还击）——需 `target.position`；`guard`、`follow`——需 `payload.target_entity_id`；`hold`（原地坚守）、`stop`（清空命令）。
- 单位战斗字段：`move_speed` / `path` / `path_index` / `move_progress` / `stance` / `order_pos` / `guard_target_id` / `combat_anchor` / `last_attacker_id` / `last_attack_tick` / `attack_cooldown_ticks` / `aggro_range` / `domain` / `min_attack_range` / `combat_state`。攻击无人机无视地形，只有导弹与防空武器能打空中单位。
- 弹药：`ammo_class`（`bullet|shell|missile`，无需弹药为空）/ `ammo` / `ammo_capacity` / `ammo_item`（同类高档弹增伤）；每次开火扣 1 发，打空 `combat_state="no_ammunition"` 停火；出生满弹，黑雾不耗弹。
- 补给：`supply_station`（建筑，`supply_radius=10`、`supply_rate=6`/tick，扣自身库存，需运行）与 `supply_truck`（单位，`supply_radius=5`、`supply_rate=3`/tick，扣自身 `cargo`，容量 180，在补给站光环内自动装货）只给光环内己方单位补弹；物流站、部署枢纽不补弹。维修车独立维修。攻击移动优先打补给站、补给车与弹药产线。
- `produce`：单位由目录 `producer` 分工——兵营（`barracks`）产工程兵/步兵/侦察车，战车工厂（`vehicle_factory`）产机甲/火炮/导弹车/维修车/补给车，机场产攻击无人机；建筑类型不符 `INVALID_TARGET`，建筑须可运行。造价是实物 `cost[]`，入队时从**生产建筑自身三个存储桶**原子扣除（皮带、分拣器或 `transfer_item` 供料），不足 `INSUFFICIENT_RESOURCE`。队列上限 20，断电暂停，出口堵塞等待空格。建筑视图带 `unit_queue[]`（`unit_type`/`remaining_ticks`/`total_ticks`）与 `rally_point`。
- `set_rally_point`：出厂单位自动寻路到集结点，发 `building_state_changed`（含 `unit_queue`、`rally_point`）。
- `form_squad`：`entity_ids` 为 1–300 个己方存活军事单位（可含补给车/维修车，不含执行体/工程兵，且不在其他军团），`name` 1–40 字符；成功 `message` 为新军团 ID 并发 `squad_deployed`。军团只是指令容器，无共享血条。
- `squad_order`：`attack|defend|retreat` 需 `target.position`，`resupply` 自动前往最近可运行补给站（无则 `INVALID_TARGET`）。服务端按射程站位（远程在后、补给/维修车殿后），`attack` 用攻击移动，其余为撤退姿态，`defend`/`resupply` 到位后坚守；无可达站位 `OUT_OF_RANGE`。`dissolve_squad` 解散军团，成员保留当前指令。

### 5.4 防御建筑与黑雾

- 炮塔每 tick 自动选取射程内敌方目标并产生 `damage_applied`，按 `Combat.fire_rate` 冷却：`missile_turret` 耗 `ammo_missile`；`implosion_cannon` 耗 `shell_set`（可装 `crystal_shell_set`）；`plasma_turret` 耗 `plasma_capsule`；`laser_turret` 只耗电；`anti_air_turret`（射程 10，只打空中，耗 `ammo_missile`）还会击落敌方飞行中的物流无人机/配送机器人（`entity_destroyed.reason="shot_down"`，含 `cargo_lost`）；`artillery_turret`（射程 15、最小射程 4，只打地面）耗 `shell_set`/`crystal_shell_set`。缺弹发 `building_state_changed(reason=no_ammunition)` 停火，重装后恢复。
- `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator` 接入电网后才 `running`。行星护盾先吸收对建筑的所有外部伤害（`damage_applied.shield_absorbed` / `shield_remaining`）。
- 黑雾：巢穴（`enemy_forces[]` 中的 hive，`strength` 即 HP，`level` 为等级）按威胁节奏孵化 `owner_id="dark_fog"` 单位，与玩家单位共用移动/交战结算。威胁值随全行星发电累积，决定巢穴等级、孵化间隔、波次规模和扩张；袭击优先级：电厂 > 矿区 > 物流线 > 炮塔 > 其他。巢穴位置由（行星, 序号）哈希确定性派生。
- 黑雾被动：默认对所有玩家中立——不派进攻波次（只补守军，不发 `enemy_wave_incoming`），黑雾单位、巢穴不攻击中立玩家，新巢只建在离玩家建筑足够远的空地，不吞建筑。玩家（含 bot）的单位、炮塔、舰队对黑雾单位或巢穴造成伤害时，黑雾对该玩家敌对到 `当前 tick + battlefield.dark_fog_calm_ticks`（默认 6000，每次再伤害都顺延），首次转敌对发 `dark_fog_provoked`。敌对期间波次只派向敌对玩家，黑雾单位、巢穴反击只打敌对玩家，玩家单位和炮塔也会自动打黑雾。到期恢复中立、发 `dark_fog_calmed`，奔袭中的黑雾撤回巢穴。bot 不主动攻击中立黑雾。
- 巢穴守军：编制 = 难度基数 + 每级增量（easy 1+1/级 上限 4，normal 2+1/级 上限 6，hard 3+2/级 上限 10），守巢半径随等级 +2/级，不外派，死亡由后续波次补足。
- 巢穴摧毁：掉落数量乘 `1+0.5×(level−1)`（向上取整，`dark_fog_matrix` 保底 level+1），威胁扣 `level×50`（下限 0），广播 `enemy_nest_destroyed`；遗址冷却期内（easy 4000 / normal 3000 / hard 2400 tick）半径（10 / 12 / 14 格）内不刷新巢。
- 隐藏科技（如 `dark_fog_matrix`）在玩家持有其成本物品前不可见、拒绝研究。

### 5.5 研究与生产规则

- `start_research`：前置满足；至少一个 `running` 且未设 `recipe_id` 的研究站（`matrix_lab` / `self_evolution_lab`）；所需矩阵须已在研究站库存中，tick 内真实消耗矩阵推进进度。`research_speed` 科技在矩阵吞吐中生效。
- 配方门控：配方声明 `tech_unlock` 或被科技 recipe 解锁引用时，必须完成对应科技才能在建筑或手工中使用；五个高级矩阵配方由同名科技门控。
- 生产周期：`ceil(增产剂调整后的时长 / max(1, throughput))`，最短 1 tick。`production.progress_fraction ∈ [0,1)` 按真实供电比例推进（供电 20/需求 24 时速度 5/6，零供电不推进、不开新批）。输出缓存不足时整批保留在 `production.pending_outputs` / `pending_byproducts`，不部分提交。
- Mk.II/III 制造台继承 Mk.I 配方（Mk.III 支持 `prototype`、`precision_drone`），吞吐 2/3、仓储 48/72、功耗 8/12。
- 精炼厂 `oil_refinery`（耗电 6）：`oil_fractionation`（2 原油 → 2 精炼油 + 1 氢）、`xray_cracking`（1 精炼油 + 2 氢 → 3 氢 + 1 高能石墨）、`reformed_refinement`（2 精炼油 + 1 氢 + 1 煤 → 3 精炼油），均 60 tick。循环配方的原料位于 `storage.inventory` / `input_buffer`，产物位于 `output_buffer`，物流不会提走原料。
- 分馏塔 `fractionator`（`deuterium_fractionation` 解锁，耗电 6，无 `recipe_id`）：西侧皮带进氢、东侧出失败氢、南侧出氘；每件氢 1% 转氘（喷涂 Mk.I/II/III 提升到 1.25%/1.5%/2%，每次尝试耗 1 次喷涂余量），失败氢须经外部皮带回流；任一输出缓存满即停；额定每 tick 最多 6 件。
- 喷涂机 `spray_coater`（`proliferator_mk1` 解锁，耗电 2）：北侧皮带或 `transfer_item` 补增产剂，西进东出。每份 Mk.I/II/III 提供 12/24/60 喷涂单位，每件货物耗 1 单位、获得 4/6/8 次效果；已喷涂货物直接通过；缺剂显示 `no_proliferator` 但货物原样通过。普通制造台的完整增产链路仍待补齐。
- 对撞机 `miniature_particle_collider`（`miniature_collider` 解锁，耗电 24，建造须指定 `recipe_id`）：`deuterium_collision`（10 氢 → 5 氘，300 tick）、`strange_matter`（2 粒子容器 + 10 氘 + 2 铁块 → 1 奇异物质，480 tick，需 `strange_matter`）、`antimatter`（2 临界光子 → 2 反物质 + 2 氢，120 tick，需 `dirac_inversion`）。
- `plasma_capsule`：1 钛合金 + 1 粒子容器 + 2 氢，60 tick，`plasma_turret` 解锁。
- minerals 收入：采集建筑**实际挖出**量 × `MineralsKickback`（`mining_machine = 1.0`、`advanced_mining_machine = 0.5`、流体采集 0）直充矿物池，与本地存储是否接得下无关；计入 `production_stats.by_item["minerals"]`。`advanced_mining_machine` 的 `coverage_radius = 2` 可多脉同采。

### 5.6 物流

- 传送带：`conveyor.buffer` 为带内物品堆（队首为即将送出端）。
- 分拣器按“抓”结算：每 tick 抓取次数 = `speed`，mk1–3 每抓剥 1 件，`pile_sorter` 整堆；`sorter_cargo_stacking` 每级 +1 每抓堆数。`configure_sorter`：方向非空、合法、不重叠，过滤 `allow|deny`，失败原子拒绝。仅 `running` 时搬运；`sorter.last_transfer`（`tick`、`sequence`、源/目标 ID 与位置、`item_id`、`quantity`）只在实际搬运后更新，客户端不能把 `running` 当成正在搬货。
- 自动集装机 `automatic_piler`（`integrated_logistics` 解锁，吞吐 2）：把散货压成 2x 堆（`sorter_cargo_integration` 后 4x），出货每吞吐单位一整堆，满仓背压。
- 分流器 `splitter`：独立 runtime 6 件/tick、缓存 24 件；默认西进、东/南/北出。`configure_splitter` **完整替换**配置：省略优先级或传 `""` 清除，省略过滤或传 `{}` 清除；方向仅 `north|east|south|west`，输入输出各非空且互斥。优先级为“可用优先”：优先口不可用时尝试其他合格口；未过滤出口也可接收过滤物品；全部堵塞时留在缓存，不丢不复制。`input_cursor` / `output_cursor` 为轮转游标，`transferred_items` / `last_transfer_tick` 为统计；重配只重置游标。
- `configure_traffic_monitor`（耗电 1）：完整替换配置，绑定球面相邻己方 Mk.I/II/III 皮带（空字符串清绑定），`window_ticks` 1..600，`minimum_items_per_tick` 0..60。`building.traffic_monitor` 含 `state`（`sampling|flowing|idle|low_flow|blocked|unconfigured|no_power|paused|target_missing|target_inactive`）、`samples[]`、`items_per_tick`、`total_items`、`alert_active` 等；告警变化时发 `traffic_monitor_alert`。
- 物流站：建造后为空库存、空电池、无端口、无运输器。行星站 3 槽 × 200、电池 1000、充电 ≤10/tick、基础耗电 1；星际站 5 槽 × 500、电池 10000、充电 ≤30/tick、基础耗电 2。唯一库存为 `logistics_station.inventory`。
  - `configure_logistics_station`：`drone_capacity` 1..10；星际站 `interstellar.enabled` / `warp_enabled` / `ship_slots`（1..5）；容量不能低于已装运输器数。`belt_ports` 省略保持、提供即完整替换（`{}` 清空），如 `{"west":{"mode":"input","item_id":"iron_ore"}}`；物品须已有槽位。
  - `configure_logistics_slot`：`scope=planetary|interstellar`，`mode=none|supply|demand|both`，`local_storage` 为供需保留/目标量；`remove:true`（同时 `mode:"none", local_storage:0`）删槽，有库存、端口引用、在途货物或取货预约时拒绝。
  - `install_logistics_vehicle`：`item_id = logistics_drone`（需 `planetary_logistics` 或 `distribution_logistics`）或 `logistics_vessel`（需 `interstellar_logistics`，仅启用的星际站）；`source=player`（默认，扣背包）或 `station`（扣站库成品）。上限无人机 10、船 5；不会免费生成运输器。配方：`logistics_drone` 2 电动机 + 2 处理器 + 5 铁块，120 tick；`logistics_vessel` 2 电动机 + 10 处理器 + 10 钛合金，300 tick。
  - 皮带口每口 ≤6 件/tick，停电停止皮带 IO 与新航次。带剩余喷涂用途的货物停在入口（站库不保存喷涂）。
  - 调度：供应站运输器送货（`delivery`），需求站空闲运输器可去供应站取货（`pickup`）；供需都扣除在途预约。起飞一次预扣往返能源：无人机 `2*max(1, 距离)`，船普通 `10*距离`、曲速 `30*距离`；开启曲速、距离 ≥ 20、站库有 2 份 `space_warper` 且电池足够时优先曲速。航次 `takeoff → in_flight → landing`，满仓部分卸货，归属站失效时进入 `stranded`（无回收命令）。
  - 科技实时推导：`logistics_carrier_capacity` +100 舱容/级（基础 200）、`logistics_carrier_engine` +1 航速/级（基础 2）、`drone_engine` +3 无人机速度/级（基础 4）。
  - 船按归属星球注册表返回，异星停靠时须查归属星球 runtime 并看 `current_planet_id`。
- 仓库配送器（`target.entity_id` 为己方配送器；机甲请求指向 executor）：
  - `configure_distributor`：单种固体物品，`mode=none|supply|demand`，`local_storage` ≤ 宿主容量；可选 `player_delivery_enabled` / `player_collection_enabled`（省略保留原值）。
  - `install_logistics_bot`：`source=player|storage`，最多 10 个，需 `distribution_logistics`；`uninstall_logistics_bot` 只回收空载停靠机器人。
  - `configure_mecha_logistics`：`requests: {"motor": {"min": 5, "max": 10}}` 整体替换，最多 8 种，`0 ≤ min ≤ max ≤ 1000`；max 钳制到机甲背包容量。
  - 配送范围 12 格（+5/级 `distribution_range`），机器人每 tick 2 格、载 10 件；配送器储能 1000、充电 ≤10/tick。机甲背包低于 min 补到 max、高于 max 回收到 max。
  - 事件：配置配送器/装卸机器人发 `entity_updated`，机甲请求发 `mecha_state_changed`，背包变化另发 `resource_changed`。

### 5.7 电力与能源

- `ray_receiver` 模式：`power` 只回灌电网（停止新光子增量，不清已有光子）、`hybrid` 先发电再转光子、`photon` 只产光子（需 `dirac_inversion`）。
- `set_energy_exchanger_mode`：`charge` 用盈余把空蓄电池充满，`discharge` 放电回电网，`standby` 不转换。
- 燃料型发电（`thermal_power_plant`、`mini_fusion_power_plant`、`artificial_star`）无可达燃料时为 `no_power/no_fuel`；`runtime.state` 反映刚结算完的 tick（最后一根燃料本 tick 用完但已发电仍显示 `running`）。
- 电网与储能充电统一记账，充入机甲/蓄电器/物流站的电量不会再计入玩家余额。

### 5.8 战争（蓝图、军工、舰队、任务群、战区）

设计背景见 [战争系统设计](战争系统设计.md)。

- 蓝图状态机：`draft → validated → prototype → field_tested → adopted → obsolete`。
  - `blueprint_create`：二选一 `base_frame_id` / `base_hull_id`；与公开蓝图或已有蓝图重名拒绝。
  - `blueprint_set_component`：只改 `draft` / `validated`；改型蓝图只能改 `allowed_variant_slots`。
  - `blueprint_validate`：返回结构化 `validation`（功率、体积、质量、刚性、热负荷、信号/隐形、维护、`hardpoint_mismatch` 等），`command_result.payload.validation.issues[]` 可直接展示。
  - `blueprint_finalize`：省略 `target_state` 走默认下一阶段；离开 `validated` 前必须校验通过。
  - `blueprint_variant`：父蓝图可为己方定型蓝图或公开蓝图，复制为新 `draft` 并记录 `parent_blueprint_id`。
- `queue_military_production`：工厂与部署枢纽都须己方、`running`；按 `components → assembly → ready` 推进，成品写入 `industry.deployment_hubs[].ready_payloads`。同蓝图连续生产有 `repeat_bonus_percent`，换蓝图有 `retool_ticks`。
- `refit_unit`：目标为同构 `fleet.id`，目标蓝图须同域同底盘/船体；单位离场翻修，完成后以同 ID 新蓝图返回。
- `deploy_squad` / `commission_fleet`：部署枢纽（公开的是 `battlefield_analysis_base`，需通电）须有足量 `ready_payloads` 且已解锁蓝图 `visible_tech_id`。
- `deploy_squad` 两种形态二选一：`member_ids`（把已有单位编成军团，同 `form_squad`）；或 `building_id` + `blueprint_id` [+ `count`，缺省 1，上限 300]（消耗地面/空中载荷，在枢纽旁空地生成 `count` 个真实世界单位并编成军团，`planet_id` 指向其他已加载行星时落在该星中心附近）。蓝图单位以平台模板（空中 `attack_drone`、带 vehicle/tracked/hover 组件 `scout`、其余 `mecha`）提供移速/视野/弹仓，HP、伤害、射程、射速、武器类别取蓝图运行时档案，护甲按域（空中 `air`，地面 `heavy`）；蓝图护盾不进入世界单位。全部校验通过后才扣载荷；`message` 为军团 ID，事件为每个单位的 `entity_created` 加一条 `squad_deployed`。`commission_fleet` 接受 `corvette` / `destroyer` 与己方 `space|orbital` 定型蓝图；传入已有 `fleet_id` 时追加蓝图栈并重算火力/护盾。
- `fleet_attack`：目标须在同一 `system_id`，`target_id` 取自目标行星 runtime 的 `enemy_forces[].id`。
- `fleet_move`：舰队须 `idle`，目标星系须与当前星系直连（按星图 k 近邻规则导出，每个星系连最近 2 个邻居）；固定 10 tick，期间 `transit` 非空、`state` 仍为 `idle`、不计入制轨评分，`fleet_assign` / `fleet_attack` / `fleet_disband` / 增援均被拒绝；到达发 `fleet_arrived`。
- 同一恒星系内敌对舰队每 tick 自动交火（集火最弱舰队，跃迁中不参战）。
- 任务群：`task_force_create`（默认 `hold`）；`task_force_assign`（`member_kind=squad|fleet`，成员从旧任务群迁移）；`task_force_set_stance`（`hold|patrol|escort|intercept|harass|siege|bombard|retreat_on_losses`，影响目标优先级、交战距离与撤退阈值）；`task_force_deploy` 至少给 `system_id` / `planet_id` / `position` / `frontline_id` / `ground_order` 之一，`ground_order=occupy|advance|hold|clear_obstacles|escort_supply`，`support_mode=none|fire_support|strike`，写入部署意图与前线命令，小队移动通过部署位置下达。
- 战区：`theater_define_zone` 的 `zone_type=primary|secondary|no_entry|rally|supply_priority`；带 `planet_id + position` 的区域会扫描敌情并发 `theater_zone_alert`（300 tick 冷却）。
- `blockade_planet`：任务群须含舰队；同步 `accepted` 只是入队，是否 `active` 取决于后续是否取得制轨优势。封锁生效时该行星的补给节点无法为敌方补给，计入 `planet_blockades[].interdicted_*`。

### 5.9 戴森与太空

- `launch_solar_sail`：可运行的 `em_rail_ejector`，本地已装 `solar_sail`；`count` 默认 1、最多 10，轨道参数须在发射器允许范围；进入发射器所在星系的 `space` runtime，每张帆独立 `entity_id`；失败分支照样扣帆但不生成轨道条目。`solar_sail_life` 每级 +300 tick 寿命（含已发射）。
- `launch_rocket`：`running` 的 `vertical_launching_silo`，本地已装 `small_carrier_rocket`；`layer_index` 默认 0、`count` 默认 1 最多 5；目标层须已有脚手架。每枚火箭 `rocket_launches += 1`，`construction_bonus = min(0.5, rocket_launches × 0.02)`，并把第一个 `coverage < 1` 的壳面推进 0.02。
- `build_dyson_node/frame/shell`：需 `dyson_component`；层不存在时自动补层，半径取 `orbit_radius` 或 `1.0 + 0.5 × layer_index`；frame 的两端节点须已存在。它们是实验性直连入口，不扣材料。
- `demolish_dyson`：`component_type=node|frame|shell`，只移除结构，退款估算写在 `entity_destroyed.payload.refunds`，不回写背包。
- `switch_active_planet`：目标须已发现、已加载、且有己方 `battlefield_analysis_base` 或 `executor`；只改调用者自己的焦点行星。

## 6. 查询接口

### 6.1 运维

**`GET /health`**（无需认证）：`{status, tick}`。

**`GET /metrics`**（无需认证）：`tick_count`、`last_tick_dur_ms`、`commands_total`、`sse_connections`、`queue_backlog`、`dropped_events`（EventBus 因消费过慢丢弃数）、`tick_p95_ms` / `tick_p99_ms`。

**`GET /audit`**：审计日志，默认只返回当前玩家。
- 参数：`player_id`、`issuer_type`、`issuer_id`、`action`（`command` / `victory`）、`request_id`、`permission`（命令类型）、`permission_granted`、`from_tick` / `to_tick`、`from_time` / `to_time`（RFC3339）、`limit`、`order`（`asc` 默认 / `desc`）。
- 响应：`{entries, count}`；记录含 `timestamp` / `tick` / `player_id` / `role` / `issuer_type` / `issuer_id` / `request_id` / `action` / `permission` / `permission_granted` / `permissions` / `details`。`action=command` 的 `details` 含 `command`、`status`、`code`、`message`、`stage`、`enqueue_tick`；`action=victory` 含 `winner_id` / `reason` / `victory_rule`（科研胜利另带 `tech_id`）。

### 6.2 玩家状态

**`GET /state/summary`**
- `tick`、`active_planet_id`（全局兜底行星）、`map_width` / `map_height` / `surface`；已宣判时 `winner` / `victory_reason` / `victory_rule`。
- `players`：所有玩家返回 `player_id` / `team_id` / `role` / `is_alive` / `dark_fog`（`{hostile: bool, hostile_until_tick: int}`，黑雾对该玩家的敌对状态，不敌对时 `hostile_until_tick=0`）；仅自己返回完整状态：`resources`、`inventory`（`item_id → 数量`）、`permissions`、`focus_planet_id`、`executor`、`executors`（按 `planet_id`）、`tech`、`combat_tech`、`stats`（同 `/state/stats`）。
- `executor`：即 `executors[active_planet_id]`（该行星没有执行体时省略），字段 `unit_id` / `build_efficiency` / `operate_range` / `concurrent_tasks` / `research_boost`。Web 用 `unit_id` 请求 `/path`，以 `operate_range` 为 `stop_range` 分段靠近。
- `tech`：`completed_techs`（`{tech_id: level}`）、`current_research`、`research_queue`、`total_researched`。研究条目字段：`tech_id` / `state` / `progress` / `total_cost` / `current_level` / `required_cost` / `consumed_cost` / `blocked_reason`（`waiting_lab` / `waiting_matrix` / `low_power` / `invalid_tech`）/ `speed_multiplier`（供电倍率，1 = 满速）/ `estimated_ticks_remaining` / `enqueue_tick` / `complete_tick`。矩阵 ID 统一为 `electromagnetic_matrix`、`energy_matrix`、`structure_matrix`、`information_matrix`、`gravity_matrix`、`universe_matrix`。
- `combat_tech`：`unlocked_techs` / `current_research` / `research_progress`。
- `resources.energy`、`/state/stats.energy_stats`、`/networks` 共用同一 tick 的 `PowerSettlementSnapshot`。

**`GET /state/stats`**：`player_id`、`tick`，以及：
- `production_stats`：`total_output` / `by_building_type` / `by_item` / `efficiency`。只统计本 tick 真实落库/落站的产出（配方产物与副产物、采集入库、矿物直充、轨道采集）；本 tick 无产出时归零；`efficiency` 是 `ProductionMonitor` 采样均值。
- `energy_stats`：`generation`（电网真实供电，含射线接收与储能放电）/ `consumption`（真实需求）/ `storage` / `current_stored`（储能建筑电量）/ `shortage_ticks`。
- `logistics_stats`：`throughput` / `avg_distance` / `avg_travel_time` / `deliveries`。
- `combat_stats`：`units_killed` / `units_lost` / `buildings_destroyed` / `buildings_lost` / `threat_level` / `highest_threat`。双边计数：受害方为玩家实体计损失，击杀方为不同归属玩家计击杀；击杀黑雾单位计 `units_killed`，摧毁黑雾巢穴计 `buildings_destroyed`（黑雾自身没有战损）；军团不单独计数（按成员单位计）。
- 生产、能源与威胁统计聚合所有已加载行星（同 tick 多行星短缺只计一次）。玩家不存在时返回零值结构。

**`GET /state/agent-briefing`**：agent/GUI 一站式态势。
- 参数：`alert_limit`（默认 20，受 `alert_history_limit` 限制）。
- 字段：`tick` / `active_planet_id` / `map_width` / `map_height` / `surface`；胜负字段；`self`（`player_id` / `team_id` / `role` / `is_alive` / `focus_planet_id` / `resources` / `inventory` / `tech{completed_count, completed_techs[], current_research, research_queue_len, total_researched}`）；`energy_stats` / `combat_stats`；`recent_alerts`；`fleets`（`fleet_id` / `system_id` / `formation` / `state` / `unit_count` / `target` / `in_transit` / `transit_to`）；`task_forces` / `theaters`；`enemy_forces`（传感器已确认敌情）；`available_commands`（按权限过滤的公开命令类型）。不泄露敌方 inventory/tech。

### 6.3 星图

**`GET /world/galaxy`**：`galaxy_id` / `name` / `width` / `height` / `discovered` / `distance_matrix`（未发现为 `-1`，顺序同 `systems`）/ `systems[]`（`position`、`star{type, mass_solar, radius_solar, luminosity_solar, temperature_k}`；未发现时 name 为空）。

**`GET /world/systems/{system_id}`**：`system_id` / `name` / `position` / `star` / `discovered` / `planets[]`（`kind`=`rocky|gas_giant|ice`、`orbit{distance_au, period_days, inclination_deg}`、`moon_count`）。

**`GET /world/systems/{system_id}/runtime`**：恒星系运行态。未发现只返回 `discovered=false`；无 `space` runtime 时 `available=false`。
- `solar_sail_orbit`：`player_id` / `system_id` / `total_energy` / `sails[]{id, orbit_radius, inclination, launch_tick, lifetime_ticks, energy_per_tick}`。
- `dyson_sphere`：`total_energy` / `layers[]{layer_index, orbit_radius, energy_output, rocket_launches, construction_bonus, nodes[], frames[], shells[]}`；节点 `latitude/longitude/energy_output/integrity/built`，框架 `node_a_id/node_b_id`，壳面 `latitude_min/latitude_max/coverage/energy_output`。
- `orbital_superiority`：`advantage_player_id` / `contest_intensity` / `last_reason`（`no_fleet_presence` / `orbit_contested` / `fleet_presence_margin`）/ `updated_tick`。
- `planet_blockades[]`：`planet_id` / `owner_id` / `task_force_id` / `status`（`planned|active|contested|broken`）/ `intensity` / `interdicted_supply` / `interdicted_transports` / `last_reason` / `updated_tick`。
- `active_planet_context`：当前焦点行星属于该系统时返回 `em_rail_ejector_count` / `vertical_launching_silo_count` / `ray_receiver_count` / `ray_receiver_modes`。
- `fleets[]`：己方舰队（字段见 `/world/fleets`）。
- `contacts[]`：情报接触，`level` = `unknown_signal|classified_contact|confirmed_type|fully_resolved`，另含 `classification` / `confirmed_type` / `strength_estimate` / `threat_level` / `signal_strength` / `lock_quality` / `jamming_penalty` / `missile_drift_risk` / `false_contact` / `sources[]`（`vision` / `active_radar` / `passive_em` / `infrared` / `signal_tower` / `recon_unit`）。强 ECM 目标可能产生 `false_contact=true`。
- `battle_reports[]`（最新在前，最多 12）：`battle_id` / `tick` / `fleet_id` / `target_id` / `fleet_firepower` / `enemy_firepower` / `fleet_missile_salvo` / `enemy_missile_salvo`（`fired/intercepted/penetrated/drifted/damage`）/ `fleet_damage`（`shield/armor/structure/subsystem`）/ `subsystem_hits[]` / `retreat_triggered` / `target_destroyed` 等。

**`GET /world/fleets`**：己方舰队数组（无则 `[]`）。**`GET /world/fleets/{fleet_id}`**：单舰队。字段：`fleet_id` / `owner_id` / `system_id` / `source_building_id` / `formation` / `state` / `units` / `weapon` / `weapons{direct_fire, missile, point_defense, electronic_warfare}` / `shield` / `armor` / `structure`（`level/max_level`）/ `subsystems`（`engine/fire_control/sensors/point_defense`，各含 `integrity`、`state=operational|degraded|disabled`、`effect`）/ `sustainment` / `target{planet_id, target_id}` / `transit{from_system_id, target_system_id, total_ticks, remaining_ticks}` / `last_attack_tick` / `last_battle_report`。

`sustainment`（舰队）：`current` / `capacity`（三类弹药 `ammo` / `shells` / `missiles`）/ `condition` / `cohesion` / `damage_penalty` / `retreat_recommended` / `shortages` / `sources[]`（`source_type = supply_station|supply_truck`）/ `last_resupply_tick` / `last_consumption_tick`。

### 6.4 行星

以下接口都按 `{planet_id}` 读取该行星自己的 runtime（不要求是焦点行星）。未发现行星只返回 `discovered=false` 与基础尺寸；已发现但 runtime 未加载时 `available=false` 或回退为静态地形。

**`GET /world/planets/{planet_id}`**：轻量摘要 `planet_id` / `system_id` / `name` / `discovered` / `kind` / `map_width` / `map_height` / `surface` / `tick` / `building_count` / `unit_count`（按可见性）/ `resource_count`。

**`GET /world/planets/{planet_id}/overview`**：全球缩略读模型。
- 参数：`step`（默认请求 100；服务端取不超过请求值的 face_size 最大约数，保证每格不跨面；N=816 时默认实际为 68）。客户端须使用响应中的实际 `step`。
- 字段：`step`、`cells_width = 3·(N/step)`、`cells_height = 2·(N/step)`、`terrain`（主导地形）、`visible` / `explored`（任一 tile 满足即 true）、`resource_counts` / `building_counts` / `unit_counts`，以及整星总数。

**`GET /world/planets/{planet_id}/scene`**：局部场景。
- 参数：`x` / `y` / `width` / `height`（图集窗口，默认 160、最大 257，越界自动裁剪）；可选 `near_x` / `near_y` / `radius`（0..128，非零时中心须为有效地格，否则 400）返回跨面补片。
- 字段：`bounds`、`terrain`、`height`（可选 0..1，未探索为 0 或不下发）、`visible` / `explored`、`buildings`、`units`、`resources`、`surface_patches[]{bounds, terrain, height, visible, explored}`（未探索地形为 `unknown`，资源只在已探索格返回；实体合并到主响应并去重），以及整星计数。
- `buildings` 为 `model.Building` 直出，按类型带子结构：`conveyor`、`splitter`、`sorter`、`production`（含 `progress_fraction`、`pending_outputs`）、`fractionation`、`spray_coater`、`traffic_monitor`、`distributor`、`unit_queue`、`rally_point`、`runtime.functions.collect{resource_kind, coverage_radius}` 等。
- `resources[]` 枯竭时带 `depleted: true`，仍保留输出。

**`GET /world/planets/{planet_id}/path?unit_id=&target_x=&target_y=&stop_range=`**：为己方单位规划已探索地表上的最短路径。`stop_range` 0..128（默认 0）；最多 512 步；非法参数或非己方单位 400。响应 `planet_id` / `surface` / `reachable` / `distance` / `path`（含起点）/ `waypoints`（不含起点，按单位 `move_range` 切分）。目标未探索或不可达时 `reachable=false, distance=-1`，不泄露未知地图；实际移动仍按权威障碍校验。

**`GET /world/planets/{planet_id}/inspect?entity_kind=&entity_id=|sector_id=`**：`entity_kind = building|unit|resource|sector`。返回 `planet_id` / `discovered` / `entity_kind` / `entity_id` / `title` 及对应 `building` / `unit` / `resource`。建筑与单位按可见性校验，不可见 404；资源在 runtime 未加载时回退静态地图。
- `runtime.state = no_power` 时 `state_reason` 为 `under_power`（已接网但分不到电）或 `power_no_connector` / `power_no_provider` / `power_out_of_range` / `power_capacity_full`；燃料型发电机为 `no_fuel`。
- 射线接收站逐 tick 电力结算不在 inspect 中暴露，用 summary / stats / networks 验证。

**`GET /world/planets/{planet_id}/runtime`**：行星运行态。
- 通用：`planet_id` / `discovered` / `available` / `active_planet_id` / `tick` / `threat_level` / `last_attack_tick`。
- `combat_squads[]`（军团，命令容器）：己方始终返回，敌方仅在视野内返回。字段 `id` / `owner_id` / `planet_id` / `name` / `member_ids`（敌方军团只含可见成员）/ `state`（`idle|engaging`）/ `position`（领队位置）/ `order`（`idle|attack|defend|retreat|resupply`）/ `target`（敌方不返回）/ `last_order_tick`。血量、弹药、武器都在成员单位上；成员全灭时军团移除并发 `entity_destroyed`（`entity_type=combat_squad`）。
- `frontlines[]`：`type=outpost`，`status=secured|contested|destroyed`，含 `control` / `fortification` / `obstacle_level` / `supply_flow`。
- `ground_task_forces[]`：`ground_order`、`status`（`staging|contesting|securing|holding|clearing|supplying|blocked`）、`progress` / `pressure`、`orbital_support_mode` / `orbital_support_available` / `orbital_support_cooldown` / `orbital_support_blocked_reason`（`no_orbital_superiority` / `planetary_defense_screen` / `frontline_not_found`）。
- `logistics_stations[]`：`building_id` / `building_type` / `position` / `state`（含唯一站库 `inventory`、`slot_capacity` / `item_capacity` / `energy` / `energy_capacity` / `charge_per_tick` / `belt_ports`）/ `drone_ids` / `ship_ids`。
- `logistics_drones[]` / `logistics_ships[]`：`station_id`（归属站）/ `target_station_id` / `capacity` / `speed` / `status` / `position` / `target_pos` / `remaining_ticks` / `cargo` / `trip_kind` / `pickup_item_id` / `pickup_quantity` / `home_pos` / `returning` / `state_reason` / `energy_cost`；船另有 `current_planet_id`、`warp_*`、`warped`、`warp_item_spent`。
- `logistics_distributors[]`（`bot_ids` / `host_available` / `inventory`）与 `logistics_bots[]`（`position` / `home_pos` / `target_pos` / `target_kind` / `trip_kind` / `cargo` / `status` / `returning` / `energy_remaining`）。
- `construction_tasks[]`：`id` / `building_type` / `position` / `rotation` / `recipe_id` / `cost` / `state` / `queue_index` / `remaining_ticks` / `total_ticks` / `priority` / `error` / `materials_deducted` 等。
- `contacts[]`（同 system contacts）、`enemy_forces[]`（至少 `confirmed_type` 的接触：`id` / `type` / `position` / `strength` / `level` / `threat_level`；`id` 是 `fleet_attack` 与自动交战使用的目标 ID；hive 遗址见 `nest_ruins[]`）、`detections[]`（由 contacts 聚合的摘要）。

**`GET /world/planets/{planet_id}/networks`**：电网与管网，整体来自同一 tick 的 `PowerSettlementSnapshot`。
- `power_networks[]`：`id` / `owner_id` / `supply` / `demand` / `allocated` / `net` / `shortage` / `node_ids`。
- `power_nodes[]`、`power_links[]`（`kind` / `distance` / 端点位置）。
- `power_coverage[]`：`building_id` / `connected` / `reason` / `provider_id` / `network_id` / `demand` / `allocated` / `ratio` / `priority`；`reason` 与 `building_state_changed.reason` 同口径。
- `pipeline_nodes[]` / `pipeline_segments[]` / `pipeline_endpoints[]`（流量、压力、容量、`fluid_id`、`allowed_items`）。

### 6.5 战争

**`GET /world/warfare/blueprints`**：己方蓝图 `blueprints[]`：`id` / `owner_id` / `name` / `source` / `state` / `domain` / `base_frame_id` / `base_hull_id` / `parent_blueprint_id` / `allowed_variant_slots` / `components` / `validation{valid, limits, usage, issues[]}` / `allowed_actions`。不含公开预置蓝图。

**`GET /world/warfare/blueprints/{blueprint_id}`**：己方蓝图详情；未命中时回退公开预置蓝图（`source=preset`、`state=adopted`）。

**`GET /world/warfare/industry`**：
- `production_orders[]`：`factory_building_id` / `deployment_hub_id` / `blueprint_id` / `count` / `completed_count` / `status` / `stage`（`components|assembly|ready`）/ `stage_remaining_ticks` / `retool_ticks` / `repeat_bonus_percent` 等。
- `refit_orders[]`：`unit_id` / `unit_kind` / `source_blueprint_id` / `target_blueprint_id` / `remaining_ticks` / `repair_tier`（`field_repair|frontline_repair_station|overhaul`）。
- `deployment_hubs[]`：`building_id` / `planet_id` / `capacity` / `ready_payloads`。
- `supply_nodes[]`：只含补给站与补给车，`source_type` / `label` / `inventory{ammo, shells, missiles}` / `updated_tick`。

**`GET /world/warfare/task-forces`**：`task_forces[]`：`id` / `name` / `theater_id` / `stance` / `deployment` / `members[]`（`kind` / `entity_id` / `count` / `state` / `supply_status` / `repair_state`）/ `command_capacity`（`total` / `used` / `over` / 各项惩罚 / `sources[]`，来源 `command_center|command_ship|battlefield_analysis_base|military_ai_core`）/ `supply_status`（成员最差值聚合）。

**`GET /world/warfare/theaters`**：`theaters[]`：`id` / `name` / `zones[]`（`zone_type` / `system_id` / `planet_id` / `position` / `radius` / `hostile_count` / `alerted`）/ `objective`（`objective_type` / `system_id` / `planet_id` / `entity_id` / `description`）。

### 6.6 目录

**`GET /catalog`**：不可变展示元数据，数据来自 `server/data/*.yaml`（或 `game_data_dir`）。
- `buildings[]`：`id` / `name` / `category` / `subcategory` / `footprint` / `build_cost` / `buildable` / `default_recipe_id` / `requires_resource_node` / `can_produce_units` / `unlock_tech`（由科技树反查）/ `combat_range`（战斗建筑）/ `power_range`（无线供电建筑）/ `icon_key` / `color`。`automatic_piler` 以外的主线建筑均 `buildable=true`。
- `items[]`：`id` / `name` / `category` / `form` / `stack_limit` / `unit_volume` / `container_id` / `is_rare` / `mecha_fuel_energy` / 弹种分档 / `icon_key` / `color`。
- `recipes[]`：`id` / `inputs` / `outputs` / `byproducts` / `duration` / `energy_cost` / `building_types` / `tech_unlock` / `handcraft_allowed`。
- `techs[]`：`id` / `name` / `name_en` / `category` / `type` / `level` / `prerequisites` / `cost` / `unlocks` / `effects` / `leads_to`（桥接科技的后继方向）/ `max_level`。只返回公开科技；unlock ID 为 canonical ID；未落地的恒星系/终局配方解锁（如 `proliferator_mk3`、`thruster`、`photon_combiner`、`space_warper`）会被裁掉。
- `world_units[]`：`id` / `name` / `domain` / `runtime_class` / `public` / `production_mode` / `producer` / 生产时长 / 物料造价 `cost[]` / 补给参数 / `query_scopes` / `commands` / 战斗数值 `armor_class` / `weapon_class` / `attack` / `attack_range` / `attack_cooldown_tick` / `move_speed` / `max_hp`。是 `produce` 与 CLI 帮助的权威单位边界。
- `damage_coefficients`：`weapon_class(gun|cannon|missile|laser) → armor_class(light|heavy|structure|air|ship) → 系数`，缺项按 1.0。
- `warfare`：`base_frames[]` / `base_hulls[]`（`budgets` 含 `signal_capacity`）、`components[]`（含 `signal_load` / `stealth_rating`）、`public_blueprints[]`（`prototype` / `precision_drone` / `corvette` / `destroyer` 等，含 `deploy_command`、`visible_tech_id` 与结算同源战斗数值）。

**`GET /catalog/commands`**：公开命令结构目录，`model` 注册表是唯一事实源（同时驱动网关预校验）。
- `version`（1）、`commands[]{type, required_target_fields, required_payload_fields, optional_payload_fields, required_layer, constraints, schema}`、`command_schema`（`oneOf` 聚合 JSON Schema）。
- GUI 表单、CLI、agent、skill 应消费此目录，不另维护字段表。

### 6.7 事件、告警与调试

**`GET /events/snapshot`**：断线补拉。
- 参数：`event_types`（必填，逗号分隔或 `all`）、`after_event_id`（推荐）、`since_tick`、`limit`（默认 200）。
- 响应：`event_types` / `since_tick` / `after_event_id` / `available_from_tick` / `next_event_id` / `has_more` / `events[]`。事件按类型独立保留，高频事件不会挤掉 `command_result`。

**`GET /alerts/production/snapshot`**：产线告警补拉。
- 参数：`after_alert_id`（推荐）、`since_tick`、`limit`（默认 `alert_history_limit`）。
- 响应：`available_from_tick` / `next_alert_id` / `has_more` / `alerts[]`（`alert_id = alert-<tick>-<building_id>-<alert_type>`、`tick`、`last_tick`、`repeat_count`、`building_id`、`building_type`、`alert_type`、`severity`、`message`、`metrics`、`details`）。
- 同一建筑同类告警只保留一条，重复发生时刷新 `severity` / `metrics` / `details` 并累加 `repeat_count`。
- `alert_type`：`throughput_drop` / `backlog` / `input_shortage` / `output_blocked` / `power_shortage`；采集建筑只产生 `output_blocked` 与 `power_shortage`。

**`POST /save`**（仅 admin）：请求 `{reason?}`；响应 `ok` / `tick` / `saved_at` / `path` / `trigger`。只覆盖当前 `save.json`，写盘失败 500。

**`POST /replay`**：基于最近快照重放命令日志做一致性校验。
- 请求：`from_tick`（0 时取 `to_tick`）、`to_tick`（0 时取当前 tick，不可超过当前）、`step`（只重放到 `from_tick`）、`speed`（ticks/s，0 不节流）、`verify`。
- 响应：`snapshot_tick` / `replay_from_tick`（= 快照 tick + 1）/ `replay_to_tick` / `applied_ticks` / `command_count` / `duration_ms` / `digest` / `drift_detected`；`verify=true` 时另有 `result_mismatch_count`、`snapshot_digest`；`notes` 可选。`digest` 含实体/资源计数、`space_entity_counter`、太阳帆计数与能量、`hash`。

**`POST /rollback`**（仅 admin）：请求 `{to_tick}`（0 为当前 tick，不可超过当前）。响应同 replay 的计数与 `digest`，另含 `trimmed_command_log` / `trimmed_event_history` / `trimmed_alert_history` / `trimmed_snapshots`。

### 6.8 对局管理

**`GET /games/current`**：任意登录玩家可调。
- `map_seed`、`enemy_difficulty`、`victory_mode`、`max_tick_rate`、`active_planet_id`、`tick`、`started_at`。
- `players[]`：`player_id` / `role` / `team_id` / `bot` / `is_alive` / `focus_planet_id`（不含 key）。
- `victory`：`{declared, winner_id?, team_id?, reason?}`；`status`：`running|finished`。
- `settlement`（仅 finished）：宣判瞬间冻结，随存档持久化。`winner_id` / `team_id?` / `reason` / `victory_rule` / `tech_id?` / `start_tick`（0）/ `declared_tick` / `duration_ticks` / `players[]`（按 `player_id` 排序，`is_alive` / `winner?` / 双边战损）。

**`POST /games/new`**（仅 admin）：热重置，丢弃当前对局开新局。

```json
{
  "map_seed": "seed-42",
  "enemy_difficulty": "off",
  "victory_mode": "sandbox",
  "players": [
    { "player_id": "p1", "key": "key_a", "role": "admin" },
    { "player_id": "p2", "key": "key_b", "team_id": "team-b", "bot": "normal",
      "bootstrap": { "minerals": 500, "inventory": [{ "item_id": "frame_material", "quantity": 6 }] } }
  ]
}
```

- `map_seed` 可选（缺省随机）；地图拓扑沿用启动时的 map 配置，未知字段 400。
- `enemy_difficulty` 默认 `normal`；`victory_mode` 默认 `elimination`。
- `players` 必填非空，`player_id` / `key` 必填且唯一；`role=admin|commander|observer`（默认 commander）；`team_id` 默认 `player_id`；`bot=easy|normal|hard`（空为人类，bot 走同一命令接口）；`bootstrap` 结构同 `config.yaml` 的 `players[].bootstrap`。
- 语义：校验通过后先写新局 `meta.json` / `save.json`（失败 500，旧局不变）再原子切换；旧 key 立即 401，旧 SSE 被断开；并发请求串行执行，后到者覆盖。进程级配置不变。
- 响应 `201`，结构同 `GET /games/current`（`tick=0`）。客户端须用新 key 重新登录、重新订阅 SSE 并全量拉取状态。

## 7. SSE `GET /events/stream`

- 参数：`event_types`（必填，逗号分隔或 `all`），只推送显式订阅的类型。
- 帧：`event: connected` + `data: {"player_id":"p1","event_types":[...]}`；之后 `event: game` + `data: <GameEvent>`。
- 心跳：每 25 秒一行注释 `: ping`；超过约 3 个周期无字节应主动重连。
- `/games/new` 成功后旧连接被服务端断开。
- 命令类客户端至少订阅 `command_result`。

GameEvent：

```json
{ "event_id": "evt-123-1", "tick": 123, "event_type": "command_result", "visibility_scope": "p1",
  "payload": { "request_id": "req-001", "command_index": 0, "command_type": "build", "status": "executed", "code": "OK", "message": "construction task c-1 queued at (10,12)" } }
```

### 事件类型

| 类型 | payload 要点 |
| --- | --- |
| `command_result` | `request_id` / `command_index` / `command_type` / `status` / `code` / `message`；蓝图命令可带 `validation` |
| `entity_created` / `entity_updated` / `entity_destroyed` | 实体 ID 与类型；`entity_destroyed` 带 `entity_kind`（`unit` / `building` / `enemy_force` / `fleet` / `combat_squad` / `logistics_drone` / `logistics_bot` / `dyson_component` / `solar_sail`）和 `entity_type`（具体类型，如 `wind_turbine`、`soldier`、`hive`），战斗摧毁带 `owner_id` / `killed_by` / `source`，可带 `reason`（如 `shot_down`、`demolish`）、`refunds` |
| `entity_moved` | `path` / `arrived` |
| `damage_applied` | `damage`（实际 HP 伤害）、`shield_absorbed` / `shield_remaining`（护盾） |
| `building_state_changed` | `building_id` / `building_type` / `prev_state` / `next_state` / `prev_reason` / `reason`；病因变化而状态不变时也发；维护故障带 `cause`；可带 `unit_queue` / `rally_point` / `splitter` |
| `resource_changed` | 资源与背包变化；同 tick 的 `energy` 为最终结算值；机甲任务带 `entity_id` / `items` / `job_kind` / `completed_batches` |
| `mecha_state_changed` | 仅拥有者；`entity_id` + 完整 `mecha` + `move_range` / `attack` / `defense` / `attack_range`；加燃料带 `fuel_item_id` / `fuel_used`；电网充电带 `charging_building_id` / `charging_network_id` / `grid_charge` |
| `tick_completed` | `tick` / `duration_ms` |
| `production_alert` | `alert`（同告警快照）。同一建筑同一类问题只在出现时发一次，持续存在时每 3000 tick 提醒一次，解除后再出现（距上次满 `alert_cooldown_ticks`）才重新发 |
| `traffic_monitor_alert` | `building_id` / `planet_id` / `target_belt_id` / `state` / `alert_active` / `items_per_tick` / `minimum_items_per_tick` / `tick` |
| `construction_paused` / `construction_resumed` | 施工任务状态 |
| `research_completed` | 科技 ID；`mission_complete` 完成时先于 `victory_declared` |
| `victory_declared` | `winner_id` / `reason` / `victory_rule` / `declared_tick`（宣判 tick），团队胜带 `team_id`，科研胜带 `tech_id` |
| `threat_level_changed` / `loot_dropped` | 威胁等级；战利品 |
| `rocket_launched` | `building_id` / `system_id` / `layer_index` / `count` / `rocket_launches` / `construction_bonus` / `layer_energy_output` |
| `squad_deployed` | `squad_id` / `squad`（伴随 `entity_created`） |
| `fleet_commissioned` / `fleet_assigned` / `fleet_attack_started` / `fleet_move_started` / `fleet_arrived` / `fleet_disbanded` | 舰队生命周期；`fleet_move_started` 带 `from_system_id` / `to_system_id` / `total_ticks` |
| `missile_salvo_fired` / `point_defense_intercept` / `battle_report_generated` | 太空战细节；战报结构同 `battle_reports[]` |
| `orbital_superiority_changed` | `system_id` / `advantage_player_id` / `contest_intensity` / `reason` |
| `theater_zone_alert` | `theater_id` / `zone_type` / `planet_id` / `position` / `radius` / `hostile_count` |
| `supply_line_disrupted` | 预留；封锁拦截计数目前只在 `planet_blockades[]` 中 |
| `dark_fog_provoked` | 全员可见；`player_id` / `until_tick`：黑雾开始对该玩家敌对 |
| `dark_fog_calmed` | 全员可见；`player_id`：黑雾对该玩家恢复中立 |
| `enemy_wave_incoming` | 全员可见；只在有敌对玩家时发；`nest_id` / `planet_id` / `from` / `count` / `guards` / `level` / `threat` / `wave_tick` / `unit_speed` / 目标信息 |
| `enemy_nest_destroyed` | 全员可见；`nest_id` / `position` / `level` / `killed_by` / `killer_owner` / `source` / `drops[]` / `threat_meter` |

## 8. 关键概念与事实源

- **焦点行星与全局默认行星**：`players[pid].focus_planet_id` 决定该玩家命令的默认落点；`active_planet_id` 只是冷启动兜底。所有已加载行星都在模拟。
- **同一事实源**：summary 的 `resources.energy`、stats 的 `energy_stats`、`/networks` 共享 `PowerSettlementSnapshot`；产出统计、矿物直充共享 `ProductionSettlementSnapshot`。不同接口之间不会出现中途值分叉。
- **异步命令**：`accepted` ≠ 成功；以 `command_result` 为准，建造再看 `entity_created` 与 `building_state_changed`。
- **可见性**：单位与敌方小队受战争迷雾约束；inspect 不可见返回 404；scene 未探索格不下发地形高度与资源。
- **持久化一致性**：存档、回放、回滚都保留 space runtime、战斗 runtime、机甲任务、配送器、分馏随机状态、结算报告；回放 `digest` 用于校验一致性。
