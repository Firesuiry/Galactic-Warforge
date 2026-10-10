# 客户端 CLI

`client-cli` 是交互式 REPL，覆盖服务端全部公开命令、常用查询、调试接口和 agent-gateway 管理入口。游戏命令的处理器与命令表（`GAME_COMMANDS`）在 `shared-client/src/commands/`，CLI 只在其上叠加终端专属命令（`switch`/`events`/`status`/`agent_*`/`game_*`/`clear`/`quit`）；agent-gateway 通过 `shared-client/src/command-runtime.ts` 复用同一套分发执行智能体动作，不依赖 client-cli。

- 公共命令目录的单一真相是 `shared-client/src/command-catalog.ts`（API 名 ↔ CLI 动词、权限类别、层级）；同文件的 `EXTRA_AGENT_COMMAND_CATALOG` 补 agent 可用的查询动词，CLI、网关与 Web provider 白名单共用。
- 用法与说明来自 `shared-client/src/commands/help.ts` 的 `HELP_ENTRIES`，REPL 内 `help <命令>` 可查。
- 下方“命令一览”由 `python3 scripts/gen_command_docs.py` 生成；改了命令目录或 `HELP_ENTRIES` 后重新生成。
- 坐标为立方体球面图集 x/y（`map_width=3N`、`map_height=2N`），跨面邻接以服务端为准，见 [3D与画质](../guide/3D与画质.md)。
- 玩法示例见 [玩法指南](../player/玩法指南.md)，启动方式见 [本地环境与测试](本地环境与测试.md)。

## 启动与连接

```bash
npm install            # 仓库根目录（npm workspace），首次
cd client-cli && npm run dev
```

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `SW_SERVER` | `http://localhost:18080` | 游戏服务端 |
| `SW_AGENT_GATEWAY` | `http://127.0.0.1:18180` | agent-gateway |
| `SW_SSE_VERBOSE=1` | 关 | 订阅全部 SSE 事件 |

默认值：银河 `galaxy-1`、恒星系 `sys-1`、行星 `planet-1-1`、`events` 显示 10 条。

## 登录与事件流

- 启动时检查 `/health`，再选择玩家：`p1 / key_player_1`、`p2 / key_player_2` 或自定义 ID/key。`switch [player_id] [key]` 切换玩家并重连 SSE。
- 自动连接 `GET /events/stream?event_types=...`。默认只订阅低噪声事件：`command_result`、`entity_created`、`entity_destroyed`、`building_state_changed`、`construction_paused`、`construction_resumed`、`research_completed`、`victory_declared`、`loot_dropped`、`rocket_launched`。
- `production_alert`、`damage_applied`、`entity_updated` 等高频事件默认不进实时流；告警用 `alert_snapshot`，其余用 `event_snapshot --types ...` 或 `--all`。
- `building_state_changed` 可能 `prev_state == next_state`，此时看 `prev_reason -> reason`（如 `power_out_of_range -> under_power` 表示已接网但当前缺电）。
- `events [count]` 只显示当前连接实际订阅到的事件。
- REPL 串行处理输入，粘贴多条命令会按顺序发送，`ACCEPTED request_id` 与后续 `command_result` 不会乱序。

## 输出与结果

- 游戏命令走 `POST /commands`，同步返回只表示入队（`ACCEPTED request_id`）；最终结果看 SSE `command_result` 或 `event_snapshot --types command_result`。
- 查询命令：`summary`/`stats`/`planet` 等为格式化摘要；`scene`、`inspect`、`catalog_commands` 输出原始 JSON；`fog` 用 `/scene` 渲染局部 ASCII 迷雾（默认窗口 `0 0 32 16`）。
- `stats.production_stats` 是所有已加载行星本 tick 的真实落库/落站产出；`by_item["minerals"]` 是直充矿物池的统计标签，不是物品。统计按玩家聚合所有已加载行星，焦点切换不改变总量。

## 行星路由（`--planet`）

- `switch_active_planet <planet_id>` 只改自己的焦点行星（每玩家独立），只能切到已发现、已加载且自己有 foothold 的行星；所有已加载行星始终结算。
- 不带 `--planet` 的 `build` 落在焦点行星；`move`/`attack`/`order`/`transfer`/`produce`/`upgrade`/`demolish`/`set_recipe`/`mine_resource`/`craft_item` 等按目标实体所在行星结算。
- 跨行星存在同 ID 实体时用 `--planet <planet_id>` 消歧。

## 命令要点

命令表里放不下的语义：

- **build**：接受任意服务端 `buildable` 建筑；`--recipe` 设初始配方，`--direction` 用于传送带（含 `auto`），`--rotation 0|90|180|270`，`--approach` 让机甲先走到建造范围再开工。采集建筑必须压在对应资源点上（矿机→矿点，`water_pump`→`water`，`oil_extractor`→`crude_oil`）。`vertical_launching_silo` 默认挂 `small_carrier_rocket` 配方。以 `/catalog` 为准，例如 `satellite_substation` 需 `satellite_power`。
- **produce**：只生产 `world_produce` 地表单位（`help produce` 会读 `/catalog.world_units`）。按 `producer` 分工：兵营（工程兵/步兵/侦察车）、战车工厂（机甲/火炮/导弹车/维修车/补给车）、机场（攻击无人机）。造价是实物清单，从生产建筑自身库存扣（`transfer` 或皮带供料），缺料返回 `INSUFFICIENT_RESOURCE`；排队有时长，停电暂停。`inspect` 建筑可见 `unit_queue` 与 `rally_point`。
- **蓝图单位**：`prototype`/`precision_drone`/`corvette`/`destroyer` 等先做成载荷物品进部署枢纽（默认 `battlefield_analysis_base`，需通电 `running`），再 `deploy_squad` / `commission_fleet`；玩家定型蓝图同样可部署。
- **transfer**：对应 API `transfer_item`；默认背包→建筑，`--take` 从建筑主仓/输出缓存取回（受背包容量限制）。
- **军团**：`form_squad` 可含补给车；`squad_order ... resupply` 不带坐标，自动前往最近补给站；`dissolve_squad` 后成员保留当前指令。
- **弹药**：`inspect` 单位可见 `ammo_class`/`ammo`/`ammo_capacity`/`ammo_item`，打空后 `combat_state=no_ammunition` 停火；进入 `supply_station`（半径 10）或 `supply_truck`（半径 5）范围自动补满。防空炮吃 `ammo_missile`、火炮吃 `shell_set`，用 `transfer` 或皮带装填。
- **研究**：至少 1 个 `running` 研究站（`matrix_lab` 不设配方即研究模式），所需矩阵须已在研究站本地库存，推进时真实消耗。`summary` 的 `tech.current_research.blocked_reason` 为 `waiting_lab`/`waiting_matrix`/`low_power`，`speed_multiplier` 与 `estimated_ticks_remaining` 反映供电降速。
- **机甲**：`mine_resource` 在 2 格内采有限固体矿点（`resource_id` 是矿点 ID，不是物品 ID），每 10 tick 1 件；`craft_item` 只限 `handcraft_allowed=true` 且已解锁的配方，quantity 为批数。采矿每件耗 3 核心，手搓每批耗 `max(1, 时长/20)` 核心，缺能暂停。quantity 只接受正十进制安全整数。`refuel_mecha <executor_id> <fuel_item_id> [count]` 只接受 `items[].mecha_fuel_energy > 0` 的燃料，count 缺省 1，烧到核心满为止。靠近运行中的自有无线输电塔（6 格）或电力感应塔（4 格）自动充电。
- **分流器**：`configure_splitter` 每次完整替换端口、优先级与过滤；省略可选项即清除。方向限 `north/east/south/west`，至少一入一出、方向不重复。未过滤出口可作旁路；优先是“可用优先”。
- **分拣器**：`configure_sorter` 输入/输出方向不得重叠，`--mode allow|deny` 配 `--items`。
- **流速监测器**：`configure_traffic_monitor` 完整替换配置，绑定相邻自有 Mk.I/II/III 传送带，`none` 清绑定；任何配置都会重置统计。告警事件为 `traffic_monitor_alert`。
- **物流站**：新站无库存、无电、无端口、无运输器。`install_logistics_vehicle` 默认扣背包成品，`--source station` 扣站内同物品成品（可经皮带入站）；调大容量不会生成载具。`configure_logistics_station --belt-ports` 完整替换全部端口（`none` 清空），端口物品须先配槽。`configure_logistics_slot ... --remove` 删除槽，有库存、端口引用或在途货物时拒绝。PLS 3 槽×200，ILS 5 槽×500。曲速需起飞站配 `space_warper` 槽并装入至少 2 份曲速器。
- **配送器**：`configure_distributor` 省略布尔开关保留原值；物品为 `none` 时须同时停用仓间与机甲配送。`uninstall_logistics_bot` 只回收空载停靠的机器人。`configure_mecha_logistics` 整体替换请求（最多 8 项，`0≤min≤max≤1000` 且 `max>0`）。
- **戴森**：`launch_solar_sail` 只接受 `em_rail_ejector`，`launch_rocket` 只接受 `vertical_launching_silo`，均需本地已装载载荷；`launch_rocket` 还需目标层已有 `build_dyson_*` 结构。`set_ray_receiver_mode photon` 需 `dirac_inversion`。
- **舰队**：`fleet_attack` 只打同星系目标；`fleet_move` 要求目标星系为直达航线、舰队 `idle` 且不在跃迁中，固定 10 tick。`blockade_planet` 最终状态看 `system_runtime` 的 `planet_blockades`。
- **scene**：`scene [planet_id] <x> <y> <w> <h> [--near_x X --near_y Y --radius R]`，R ≤ 128，额外返回球面邻域补片 `surface_patches`。服务端窗口默认 160、最大 257。球面寻路没有 CLI 命令，用 `GET /world/planets/{id}/path`。

## 调试与管理选项

```bash
audit --player <id> --issuer-type <type> --issuer-id <id> --action <action> --request-id <rid> \
      --permission <permission> --granted <true|false> --from-tick <n> --to-tick <n> \
      --from-time <rfc3339> --to-time <rfc3339> --limit <n> --order <asc|desc>
event_snapshot --types <a,b,c> --all --after-id <id> --since-tick <n> --limit <n>
alert_snapshot --after-id <id> --since-tick <n> --limit <n>
save [--reason <text>]                       # 刷新 server.data_dir 下的 save.json，不建多槽位
checkpoint list                              # 列出命名存档点（任意登录玩家）
checkpoint save <name> [--note <text>] [--contract <file.json>] [--replace]
checkpoint load <name>                       # 热加载存档点
replay --from <tick> --to <tick> --step --speed <n> --verify <true|false>
rollback --to <tick>
raw <json>                                   # 直接发送完整 /commands 请求体
```

`event_snapshot` 不传 `--types` 时使用与默认 SSE 相同的低噪声集合。

### 新局热重置

```bash
game_status
game_new --seed seed-42 --difficulty off --victory sandbox \
  --players '[{"player_id":"p1","key":"k1","role":"admin"},{"player_id":"p2","key":"k2","bot":"normal"}]'
game_new --players-file ./players.json
```

- `game_new` 调 `POST /games/new`，仅 `role=admin` 可用（否则 403）。`--seed` 缺省随机；地图拓扑沿用服务端启动时的 map 配置。
- `--difficulty off|easy|normal|hard`（默认 `normal`）；`--victory elimination|mission_complete|hybrid|sandbox`（默认 `elimination`，`sandbox` 永不判胜）。
- `--players`（或 `--players-file`）必填；`player_id`/`key` 必填且唯一，`role`/`team_id`/`bot`/`bootstrap` 语义同 `config.yaml`。
- 成功后旧 key 全部失效，CLI 自动切到新局第一个 admin 并重连 SSE。
- `game_status` 调 `GET /games/current`，打印 status/seed/tick/难度/胜利模式/玩家；`finished` 时打印胜者、原因、时长与战损。

## 命名存档点（checkpoint）

试玩加速：从某个存档点读档跑一段，行为符合预期就存成新存档点，下次继续。

```bash
checkpoint list
checkpoint save base-ok --note "开局 20 分钟后" --contract ./contract.json
checkpoint save bug-lost-miner --note "采矿机丢失"          # bug- 前缀：契约只记录不拦截
checkpoint save base-ok --replace                           # 覆盖同名
checkpoint load base-ok
```

- `checkpoint list` 调 `GET /checkpoints`，任意登录玩家可用；打印存档点目录、当前对局来源与每个存档点的 kind/tick/seed/parent/note 及 `stale` 标记。
- `checkpoint save` 调 `POST /checkpoints`，**仅 `role=admin`**；名字须匹配 `[a-z0-9][a-z0-9-]{0,63}`，同名默认 409，`--replace` 覆盖。
- `--contract <file.json>` 传状态契约（`{"checks":[{"kind":"tick_gte","tick":1000}]}`）：**regression 存档点契约未全过时服务端 400 拒绝创建**并返回逐条结果，**`bug-` 前缀的 bug 存档点只记录结果照存**。谓词词表见 [服务端 API](服务端API.md) 6.9。
- `checkpoint load` 调 `POST /checkpoints/{name}/load`，**仅 `role=admin`**：按存档内配置与地图拓扑重建对局并原子替换；`stale` 只警告不阻止。与 `game_new` 不同，**玩家 key 不变**，CLI 的鉴权无需切换；SSE 会被服务端断开，重新订阅即可。

## Agent 相关

`agent_list` / `agent_create` / `agent_update` / `agent_message` / `agent_thread` 调 agent-gateway（详见 [agent-gateway](agent-gateway.md)）。

`agent_create` / `agent_update` 除命令表列出的参数外，还支持战争委派参数：

- `--theater-ids` / `--task-force-ids`：显式委派战区、任务群。
- `--military-command-ids`：战争命令白名单（如 `system_runtime`、`war_industry`、`task_forces`、`theaters`、`queue_military_production`、`task_force_set_stance`、`task_force_deploy`、`blockade_planet`）。只给 `--command-categories combat` 不够，战争命令还必须命中此白名单。
- `--allow-blockade`、`--allow-military-production`：高风险动作开关；`--military-production-limit`：单次排产上限。
- 运行时用 authoritative `theaters` / `task_forces` 校验 `system_id` / `planet_id` / `task_force_id` / `theater_id`，越界直接拒绝。

```bash
agent_update agent-war-director \
  --command-categories observe,combat,management \
  --theater-ids theater-front --task-force-ids tf-front \
  --military-command-ids system_runtime,task_force_set_stance,task_force_deploy \
  --allow-blockade false --allow-military-production false --military-production-limit 0
agent_message agent-war-director 接管 theater-front，并让 tf-front 在战区内维持巡逻，汇报当前局势。
agent_thread agent-war-director
```

`shared-client` 目录中声明的公共 CLI 动词会自动进入 agent runtime 白名单。

## 命令一览

<!-- BEGIN GENERATED COMMANDS -->
<!-- 由 scripts/gen_command_docs.py 生成，勿手改；数据源 GAME_COMMANDS/COMMANDS/HELP_ENTRIES 与 shared-client 命令目录 -->

### 游戏命令（64 条，对应 `POST /commands`）

| 动词 | 用法 | API 命令 | 权限类别 | 说明 |
|---|---|---|---|---|
| `attack` | `attack <entity_id> <target_id>` | `attack` | combat | Attack target entity |
| `blockade_planet` | `blockade_planet <task_force_id> <planet_id>` | `blockade_planet` | combat | Issue a blockade intent against one planet |
| `blueprint_create` | `blueprint_create <blueprint_id> <ground\|space> [--name <name>] (--base-frame <base_frame_id> \| --base-hull <base_hull_id>)` | `blueprint_create` | management | Create a draft warfare blueprint |
| `blueprint_finalize` | `blueprint_finalize <blueprint_id> [--target-state <state>]` | `blueprint_finalize` | management | Advance a warfare blueprint to the next or chosen lifecycle state |
| `blueprint_set_component` | `blueprint_set_component <blueprint_id> <slot_id> <component_id>` | `blueprint_set_component` | management | Set one component on a draft or validated warfare blueprint |
| `blueprint_validate` | `blueprint_validate <blueprint_id>` | `blueprint_validate` | management | Validate a warfare blueprint and receive structured legality issues |
| `blueprint_variant` | `blueprint_variant <parent_blueprint_id> <blueprint_id> <allowed_slot_ids_csv> [--name <name>]` | `blueprint_variant` | management | Create a controlled variant from a preset or player blueprint |
| `build` | `build <x> <y> <type> [--z <z>] [--direction <dir>] [--recipe <id>]` | `build` | build | Build any server-side buildable structure |
| `build_dyson_frame` | `build_dyson_frame <system_id> <layer_index> <node_a_id> <node_b_id>` | `build_dyson_frame` | build | Build a Dyson sphere frame |
| `build_dyson_node` | `build_dyson_node <system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]` | `build_dyson_node` | build | Build a Dyson sphere node |
| `build_dyson_shell` | `build_dyson_shell <system_id> <layer_index> <latitude_min> <latitude_max> <coverage>` | `build_dyson_shell` | build | Build a Dyson sphere shell |
| `cancel_construction` | `cancel_construction <task_id>` | `cancel_construction` | build | Cancel queued or running construction task |
| `cancel_mecha_job` | `cancel_mecha_job <executor_id> [--planet <planet_id>]` | `cancel_mecha_job` | management | 取消机甲任务并返还未完成批次原料 |
| `cancel_research` | `cancel_research <tech_id>` | `cancel_research` | research | Cancel a technology in progress or queue |
| `commission_fleet` | `commission_fleet <building_id> <blueprint_id> <system_id> [--count <n>] [--fleet-id <fleet_id>]` | `commission_fleet` | combat | Consume a fleet payload from a hub and create or reinforce a fleet |
| `configure_distributor` | `configure_distributor <id> <item_id\|none> <none\|supply\|demand> <local_storage> [--delivery true\|false] [--collection true\|false]` | `configure_distributor` | management | 配置仓库配送器；省略开关保留原值 |
| `configure_logistics_slot` | `configure_logistics_slot <building_id> <planetary\|interstellar> <item_id> [<none\|supply\|demand\|both> <local_storage> \| --remove]` | `configure_logistics_slot` | management | 配置物流物品槽；remove移除无库存、无端口或在途引用的空槽 |
| `configure_logistics_station` | `configure_logistics_station <building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true\|false>] [--warp-enabled <true\|false>] [--ship-slots <n>] [--belt-ports direction:input\|output:item_id,...\|none]` | `configure_logistics_station` | management | Configure logistics station capacity, priority and interstellar switches |
| `configure_mecha_logistics` | `configure_mecha_logistics <unit_id> <item:min:max,...\|none>` | `configure_mecha_logistics` | management | 替换机甲配送请求，最多 8 项，none 清空 |
| `configure_sorter` | `configure_sorter <building_id> --inputs west --outputs east [--mode allow\|deny] [--items iron_ore] [--planet <id>]` | `configure_sorter` | management | 设置分拣器方向和物品过滤 |
| `configure_splitter` | `configure_splitter <building_id> --inputs west --outputs east,south,north [--input-priority west] [--output-priority east] [--filters east:iron_ore,south:copper_ore]` | `configure_splitter` | management | 完整替换分流器端口、优先级和物品过滤；省略可选项即清除 |
| `configure_traffic_monitor` | `configure_traffic_monitor <building_id> <belt_id\|none> --window <1..600> --minimum <0..60> --alerts <on\|off>` | `configure_traffic_monitor` | management | 监测相邻皮带真实流出量；none 清绑定，配置重置采样 |
| `craft_item` | `craft_item <executor_id> <recipe_id> <quantity> [--planet <planet_id>]` | `craft_item` | management | 使用背包原料进行个人制造，quantity为批数（按执行体所在行星结算） |
| `demolish` | `demolish <entity_id> [--planet <planet_id>]` | `demolish` | build | Demolish building（按建筑所在行星结算） |
| `demolish_dyson` | `demolish_dyson <system_id> <node\|frame\|shell> <component_id>` | `demolish_dyson` | build | Demolish a Dyson sphere component |
| `deploy_squad` | `deploy_squad <building_id> <blueprint_id> [--count <n>] [--planet <planet_id>]` | `deploy_squad` | combat | Consume a squad payload from a hub and create a combat squad |
| `dissolve_squad` | `dissolve_squad <squad_id> [--planet <id>]` | `dissolve_squad` | combat | 解散军团，单位保留当前指令 |
| `fleet_assign` | `fleet_assign <fleet_id> <line\|vee\|circle\|wedge>` | `fleet_assign` | combat | Change a fleet formation |
| `fleet_attack` | `fleet_attack <fleet_id> <planet_id> <target_id>` | `fleet_attack` | combat | Order a fleet to attack a target in the same system |
| `fleet_disband` | `fleet_disband <fleet_id>` | `fleet_disband` | combat | Disband a fleet and remove it from runtime |
| `fleet_move` | `fleet_move <fleet_id> <target_system_id>` | `fleet_move` | combat | Order a fleet to transit to a connected star system |
| `form_squad` | `form_squad <entity_id...> [--name <name>] [--planet <id>]` | `form_squad` | combat | 选中单位编成军团（可含补给车） |
| `install_logistics_bot` | `install_logistics_bot <id> <quantity> [--source player\|storage]` | `install_logistics_bot` | management | 消耗背包或绑定仓库的机器人安装至配送器 |
| `install_logistics_vehicle` | `install_logistics_vehicle <station_id> <logistics_drone\|logistics_vessel> <quantity> [--source player\|station]` | `install_logistics_vehicle` | management | 消耗背包或站内成品安装运输器，受站点槽位上限限制 |
| `launch_rocket` | `launch_rocket <building_id> <system_id> [--layer <n>] [--count <n>] [--planet <planet_id>]` | `launch_rocket` | management | Launch loaded rockets from a Vertical Launching Silo into a Dyson layer |
| `launch_solar_sail` | `launch_solar_sail <building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>] [--planet <planet_id>]` | `launch_solar_sail` | management | Launch loaded solar sails from an EM Rail Ejector |
| `mine_resource` | `mine_resource <executor_id> <resource_id> <quantity> [--planet <planet_id>]` | `mine_resource` | management | 手动采集固体资源到背包（按执行体所在行星结算） |
| `move` | `move <entity_id> <x> <y> [--z <z>]` | `move` | combat | Move entity to position |
| `order` | `order <entity_id[,entity_id...]> <attack_move\|patrol\|guard\|hold\|follow\|retreat\|stop> [x y] [--target <entity_id>] [--planet <planet_id>]` | `unit_order` | combat | R5 部队指令：攻击移动/巡逻/守卫/坚守/跟随/撤退/停止（支持逗号分隔批量；--planet 跨行星同 ID 消歧） |
| `produce` | `produce <entity_id> <unit_type> [--planet <planet_id>]` | `produce` | build | Produce a server-public world unit（按建筑所在行星结算） |
| `queue_military_production` | `queue_military_production <building_id> <deployment_hub_id> <blueprint_id> [--count <n>]` | `queue_military_production` | management | Queue military production and deliver ready payloads into a deployment hub |
| `refit_unit` | `refit_unit <building_id> <unit_id> <target_blueprint_id>` | `refit_unit` | management | Send a squad or fleet into authoritative refit |
| `refuel_mecha` | `refuel_mecha <executor_id> <fuel_item_id> [count] [--planet <planet_id>]` | `refuel_mecha` | management | Refuel an executor mecha: burn up to count fuel items (default 1) until the core is full |
| `restore_construction` | `restore_construction <task_id>` | `restore_construction` | build | Restore a cancelled construction task |
| `scan_galaxy` | `scan_galaxy [galaxy_id]` | `scan_galaxy` | observe | 登记星系到星图（不改地表迷雾） |
| `scan_planet` | `scan_planet <planet_id>` | `scan_planet` | observe | 登记星球到星图（不改地表迷雾） |
| `scan_system` | `scan_system <system_id>` | `scan_system` | observe | 登记恒星系到星图（不改地表迷雾） |
| `set_energy_exchanger_mode` | `set_energy_exchanger_mode <building_id> <charge\|discharge\|standby> [--planet <planet_id>]` | `set_energy_exchanger_mode` | management | 切换蓄电器能量枢纽模式：charge 电网盈余充蓄电池，discharge 放电回电网，standby 不转换 |
| `set_rally_point` | `set_rally_point <building_id> <x> <y> [--planet <id>]` | `set_rally_point` | management | 设置出厂单位集结点 |
| `set_ray_receiver_mode` | `set_ray_receiver_mode <building_id> <power\|photon\|hybrid> [--planet <planet_id>]` | `set_ray_receiver_mode` | management | Switch ray receiver mode（按建筑所在行星结算） |
| `set_recipe` | `set_recipe <entity_id> [recipe_id] [--planet <planet_id>]` | `set_recipe` | management | 原地切换生产建筑/研究站配方；省略 recipe_id 时研究站回研究模式、生产建筑转空闲，切换后进度清零、库存保留 |
| `squad_order` | `squad_order <squad_id> <attack\|defend\|retreat\|resupply> [<x> <y>] [--planet <id>]` | `squad_order` | combat | 军团指令；resupply 自动前往最近补给站 |
| `start_research` | `start_research <tech_id>` | `start_research` | research | Start researching a technology |
| `switch_active_planet` | `switch_active_planet <planet_id>` | `switch_active_planet` | management | 切换自己的视图焦点/默认落点行星（不影响其他玩家；所有已加载行星始终结算） |
| `task_force_assign` | `task_force_assign <task_force_id> <squad\|fleet> <member_ids_csv> [--system <system_id>] [--planet <planet_id>]` | `task_force_assign` | combat | Assign one or more squads or fleets into a task force |
| `task_force_create` | `task_force_create <task_force_id> [--name <name>] [--stance <stance>]` | `task_force_create` | combat | Create a task force shell for squads and fleets |
| `task_force_deploy` | `task_force_deploy <task_force_id> [--theater <theater_id>] [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--frontline <frontline_id>] [--ground-order <order>] [--support-mode <mode>]` | `task_force_deploy` | combat | Set task force deployment intent, frontline order and orbital support mode |
| `task_force_set_stance` | `task_force_set_stance <task_force_id> <stance>` | `task_force_set_stance` | combat | Change task force doctrine and engagement posture |
| `theater_create` | `theater_create <theater_id> [--name <name>]` | `theater_create` | combat | Create a theater container for war zoning and objectives |
| `theater_define_zone` | `theater_define_zone <theater_id> <zone_type> [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--radius <n>]` | `theater_define_zone` | combat | Define or update one theater zone |
| `theater_set_objective` | `theater_set_objective <theater_id> <objective_type> [--system <system_id>] [--planet <planet_id>] [--entity <entity_id>] [--description <text>]` | `theater_set_objective` | combat | Set a theater objective anchor and description |
| `transfer` | `transfer <building_id> <item_id> <quantity> [--planet <planet_id>]` | `transfer_item` | management | Load items from player inventory into building local storage（按建筑所在行星结算） |
| `uninstall_logistics_bot` | `uninstall_logistics_bot <id> <quantity>` | `uninstall_logistics_bot` | management | 回收空载停靠的配送机器人至背包 |
| `upgrade` | `upgrade <entity_id> [--planet <planet_id>]` | `upgrade` | build | Upgrade building（按建筑所在行星结算） |

### 查询命令（20 条，agent 可用）

| 动词 | 用法 | 说明 |
|---|---|---|
| `health` | — | Server status and current tick |
| `metrics` | — | Runtime metrics |
| `summary` | — | Game summary (resources, players, map) |
| `stats` | — | Current player statistics |
| `briefing` | `briefing [alert_limit]` | One-shot agent briefing (self/war/fleets/alerts/commands) |
| `galaxy` | — | Galaxy list |
| `system` | `system [system_id]` | System details (default: sys-1) |
| `system_runtime` | `system_runtime [system_id]` | System runtime state including fleets, contacts, blockades and battle reports |
| `planet` | `planet [planet_id]` | Planet summary (default: planet-1-1) |
| `planet_runtime` | `planet_runtime [planet_id]` | Planet runtime state including contacts, frontlines and ground task forces |
| `blueprints` | `blueprints [blueprint_id]` | List player warfare blueprints or inspect one blueprint in detail |
| `war_industry` | — | Military production, refit, deployment hub and supply node status |
| `task_forces` | — | Player-owned task force list with supply and command capacity |
| `theaters` | — | Player-owned theater zones and objectives |
| `scene` | `scene [planet_id] <x> <y> <width> <height> [--near_x X --near_y Y --radius R]` | Cube-sphere atlas scene and seam patches |
| `inspect` | `inspect <planet_id> <building\|unit\|resource\|sector> <entity_id>` | Planet inspect raw JSON |
| `fleet_status` | `fleet_status [fleet_id]` | Fleet list or one fleet detail |
| `fog` | `fog [planet_id] [x y width height]` | ASCII fog slice via /scene (default: 0 0 32 16) |
| `save` | `save [--reason <text>]` | Trigger manual save |
| `checkpoint` | `checkpoint <list\|save <name>\|load <name>> [--note <text>] [--contract <file.json>] [--replace]` | 命名存档点：list 列出（登录即可），save 存当前对局（admin，regression 契约须全过；bug- 前缀只记录），load 热加载（admin） |

### 管理、调试与工具（21 条）

| 动词 | 用法 | 说明 |
|---|---|---|
| `catalog_commands` | — | Public command structure catalog (GET /catalog/commands) |
| `raw` | `raw <json>` | Send raw /commands request JSON |
| `audit` | `audit [options]` | Query audit log |
| `event_snapshot` | `event_snapshot [options]` | Query event snapshot |
| `alert_snapshot` | `alert_snapshot [options]` | Query production alert snapshot |
| `replay` | `replay [options]` | Replay tick range |
| `rollback` | `rollback [options]` | Rollback to tick |
| `help` | `help [command]` | Show help |
| `agent_list` | — | List agent-gateway agent profiles |
| `agent_create` | `agent_create <name> --provider <provider_id> [--role <worker\|manager\|director>] [--can-create-agents <true\|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]` | Create an agent-gateway agent profile bound to the current player key |
| `agent_update` | `agent_update <agent_id> [--role <worker\|manager\|director>] [--can-create-agents <true\|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]` | Patch agent-gateway agent policy or role |
| `agent_message` | `agent_message <agent_id> <content>` | Send one direct task message to an agent thread |
| `agent_thread` | `agent_thread <agent_id>` | Inspect one agent thread including messages, tool calls and logs |
| `switch` | `switch [player_id] [key]` | Switch player |
| `events` | `events [count]` | Show recent SSE events (default: 10) |
| `status` | — | Current player and connection status |
| `game_new` | — | — |
| `game_status` | — | — |
| `clear` | — | Clear screen |
| `quit` | — | Exit |
| `exit` | — | — |
<!-- END GENERATED COMMANDS -->
