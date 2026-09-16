# SiliconWorld 客户端 CLI

> 行星已统一为立方体球面六面网格。`surface: {topology: "cube_sphere", face_size: N}` 明示拓扑；`map_width=3N`、`map_height=2N` 为存储图集尺寸，x/y 不再具有平面邻接语义。配置仅使用 `planet.face_size`，旧平面存档拒绝加载。详见 [立方体球面网格](../guide/立方体球面网格.md)。

`client-cli` 当前除了游戏 `server` 常用查询与基础建造命令外，也已经补齐战争系统的最小玩家闭环：蓝图创建 / 改型 / 校验 / 定型、军工排产与翻修、任务群 / 战区指挥、登陆与封锁命令，以及 `contacts / supply / battle_report` 所需的运行态查询。`agent-gateway` 的最小管理入口 `agent_list`、`agent_create`、`agent_update`、`agent_message`、`agent_thread` 也继续保留，因此 Case1“创建李斯 -> 李斯创建胡景 -> 李斯委派胡景建矿场”与战争链路可以共用同一套 CLI runtime。原有行星读取链路继续使用 `summary / scene / inspect` 三段式模型，对应的收敛版物流配置现在也已经能在 `client-web` 的行星页直接操作。

公共游戏命令目录现在以 `shared-client/src/command-catalog.ts` 为单一真相：CLI、Web 和文档都从这份目录对齐命令 alias、分类和公开范围。`client-cli/src/command-catalog.ts` 只在其上补 `health / summary / save` 这类 CLI 专属命令，不再手写第二份公共命令分类。

## 启动

1. 进入目录：`cd client-cli`
2. 安装依赖：`npm install`
3. 启动 CLI：`npm run dev`

## 环境变量

- `SW_SERVER`：服务端地址，默认 `http://localhost:18080`
- `SW_AGENT_GATEWAY`：agent-gateway 地址，默认 `http://127.0.0.1:18180`
- `SW_SSE_VERBOSE=1`：主动订阅并显示所有实时 SSE 事件；默认只订阅低噪声关键事件

## 登录与事件流

- 启动后会提示选择玩家
- 默认玩家：
  - `p1 / key_player_1`
  - `p2 / key_player_2`
- 也可以输入自定义 `player_id` 与 `player_key`
- CLI 会自动连接 `GET /events/stream?event_types=...`
- 默认只主动订阅低噪声关键事件：`command_result`、`entity_created`、`entity_destroyed`、`building_state_changed`、`construction_paused`、`construction_resumed`、`research_completed`、`victory_declared`、`loot_dropped`、`rocket_launched`
- `production_alert` 改为默认不进入 CLI 实时流，避免后期空转产线持续刷屏；需要看告警时请用 `alert_snapshot`
- `SW_SSE_VERBOSE=1` 时会改为显式订阅全部事件类型；像 `production_alert`、`damage_applied`、`entity_updated` 这类高频事件默认不会进入 CLI 实时流
- `building_state_changed` 现在也可能表示“状态没变，但原因变了”；如果你看到 `prev_state == next_state`，请重点看 `prev_reason -> reason`，例如 `power_out_of_range -> under_power` 代表建筑已经接上电网，只是当前 tick 因短缺拿不到电
- `events [count]` 只显示当前 SSE 连接实际订阅到的事件
- `switch [player_id] [key]` 会切换玩家并自动重连 SSE
- REPL 现在会串行处理输入；连续粘贴多条命令时，会按输入顺序依次发送，避免 `ACCEPTED request_id` 与后续 `command_result` 乱序

## 命令总览

### 查询类

| 命令             | 参数                                                         | 说明                                                              |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `health`         | 无                                                           | 查询 `GET /health`                                                |
| `metrics`        | 无                                                           | 查询 `GET /metrics`                                               |
| `summary`        | 无                                                           | 查询 `GET /state/summary`                                         |
| `stats`          | 无                                                           | 查询 `GET /state/stats`；其中 `production_stats` 表示当前 active world 当前 tick 的真实落库 / 落站产出 |
| `briefing`       | `[alert_limit]`                                              | 查询 `GET /state/agent-briefing`：己方资源/研究/能源战斗摘要 + 舰队/任务群/战区/敌情 + 最近告警 + 可用命令目录 |
| `catalog_commands` | 无                                                         | 查询 `GET /catalog/commands`：服务端权威公共命令结构目录（必填 target/payload、可选字段、layer、constraints、JSON Schema） |
| `galaxy`         | 无                                                           | 查询 `GET /world/galaxy`                                          |
| `system`         | `[system_id]`                                                | 查询 `GET /world/systems/{system_id}`，默认 `sys-1`               |
| `system_runtime` | `[system_id]`                                                | 查询 `GET /world/systems/{system_id}/runtime`，包含舰队、contacts、封锁、登陆与战报 |
| `planet`         | `[planet_id]`                                                | 查询 `GET /world/planets/{planet_id}` 行星概要，默认 `planet-1-1` |
| `planet_runtime` | `[planet_id]`                                                | 查询 `GET /world/planets/{planet_id}/runtime`，包含 contacts、滩头、前线与地面任务群 |
| `fleet_status`   | `[fleet_id]`                                                 | 查询 `GET /world/fleets` 或 `GET /world/fleets/{fleet_id}`        |
| `blueprints`     | `[blueprint_id]`                                             | 查询 `GET /world/warfare/blueprints`，或查询某个蓝图详情          |
| `war_industry`   | 无                                                           | 查询 `GET /world/warfare/industry`，输出生产单、翻修单、部署枢纽和军需节点 |
| `task_forces`    | 无                                                           | 查询 `GET /world/warfare/task-forces`                             |
| `theaters`       | 无                                                           | 查询 `GET /world/warfare/theaters`                                |
| `scene` | `[planet_id] <x> <y> <width> <height> [--near_x X --near_y Y --radius R]` | 查询图集窗口及球面邻域补片原始 JSON，R 为 0..128 |
| `inspect`        | `<planet_id> <building\|unit\|resource\|sector> <entity_id>` | 查询 `GET /world/planets/{planet_id}/inspect` 原始 JSON           |
| `fog`            | `[planet_id] [x y width height]`                             | 通过 `/scene` 拉取局部迷雾并做 ASCII 渲染，默认窗口 `0 0 32 16`   |
| `audit`          | `[options]`                                                  | 查询 `GET /audit`                                                 |
| `event_snapshot` | `[options]`                                                  | 查询 `GET /events/snapshot`                                       |
| `alert_snapshot` | `[options]`                                                  | 查询 `GET /alerts/production/snapshot`                            |

### 玩家操作类

| 命令                          | 参数                                                                                                                                                                           | 说明                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `scan_galaxy`                 | `[galaxy_id]`                                                                                                                                                                  | 扫描银河，默认 `galaxy-1`              |
| `scan_system`                 | `<system_id>`                                                                                                                                                                  | 扫描恒星系                             |
| `scan_planet`                 | `<planet_id>`                                                                                                                                                                  | 扫描行星                               |
| `build`                       | `<x> <y> <building_type> [--z <z>] [--direction <dir>] [--recipe <recipe_id>]`                                                                                                 | 建造任意服务端可建建筑                 |
| `move`                        | `<entity_id> <x> <y> [--z <z>]`                                                                                                                                                | 移动单位                               |
| `attack`                      | `<entity_id> <target_entity_id>`                                                                                                                                               | 攻击单位或建筑                         |
| `produce`                     | `<entity_id> <unit_type>`                                                                                                                                                      | 按服务端 `/catalog.world_units` 生产公开单位 |
| `upgrade`                     | `<entity_id>`                                                                                                                                                                  | 升级建筑                               |
| `demolish`                    | `<entity_id>`                                                                                                                                                                  | 拆除建筑                               |
| `configure_splitter` | `<building_id> --inputs <方向列表> --outputs <方向列表> [--input-priority <方向>] [--output-priority <方向>] [--filters <方向:item_id列表>]` | 完整替换四向分流器端口、优先级与出口过滤；省略可选项会清除旧值 |
| `configure_logistics_station` | `<building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true\|false>] [--warp-enabled <true\|false>] [--ship-slots <n>] [--belt-ports <方向:input或output:物品ID,...\|none>]` | 配置站点参数；皮带端口提供时完整替换，none清空 |
| `configure_logistics_slot`    | `<building_id> <planetary\|interstellar> <item_id> <none\|supply\|demand\|both> <local_storage>`                                                                               | 配置物品供需；删除可用 `<building_id> <scope> <item_id> --remove` |
| `install_logistics_vehicle` | `<station_id> <logistics_drone\|logistics_vessel> <quantity> [--source <player\|station>]` | 消耗背包或站内成品安装，默认player；整批验证容量和库存 |
| `cancel_construction`         | `<task_id>`                                                                                                                                                                    | 取消施工任务                           |
| `restore_construction`        | `<task_id>`                                                                                                                                                                    | 恢复施工任务                           |
| `start_research`              | `<tech_id>`                                                                                                                                                                    | 开始研究                               |
| `cancel_research`             | `<tech_id>`                                                                                                                                                                    | 取消研究                               |
| `blueprint_create`            | `<blueprint_id> <ground\|space> [--name <name>] (--base-frame <base_frame_id> \| --base-hull <base_hull_id>)`                                                               | 创建战争蓝图草案                       |
| `blueprint_set_component`     | `<blueprint_id> <slot_id> <component_id>`                                                                                                                                      | 修改蓝图槽位组件                       |
| `blueprint_validate`          | `<blueprint_id>`                                                                                                                                                               | 校验蓝图合法性并返回结构化问题         |
| `blueprint_finalize`          | `<blueprint_id> [--target-state <state>]`                                                                                                                                      | 推进蓝图生命周期状态                   |
| `blueprint_variant`           | `<parent_blueprint_id> <blueprint_id> <allowed_slot_ids_csv> [--name <name>]`                                                                                                 | 从公开蓝图或已定型蓝图生成受控改型     |
| `queue_military_production`   | `<building_id> <deployment_hub_id> <blueprint_id> [--count <n>]`                                                                                                              | 在军工设施排产，并把成品交付到部署枢纽 |
| `refit_unit`                  | `<building_id> <unit_id> <target_blueprint_id>`                                                                                                                                | 让小队或同构舰队进入 authoritative 翻修 |
| `deploy_squad`                | `<building_id> <blueprint_id> [--count <n>] [--planet <planet_id>]`                                                                                                           | 消耗部署枢纽中的载荷并生成地面战斗小队 |
| `commission_fleet`            | `<building_id> <blueprint_id> <system_id> [--count <n>] [--fleet-id <fleet_id>]`                                                                                              | 消耗部署枢纽中的载荷并生成或补强舰队   |
| `task_force_create`           | `<task_force_id> [--name <name>] [--stance <stance>]`                                                                                                                          | 创建任务群                             |
| `task_force_assign`           | `<task_force_id> <squad\|fleet> <member_ids_csv> [--system <system_id>] [--planet <planet_id>]`                                                                              | 把小队或舰队编入任务群                 |
| `task_force_set_stance`       | `<task_force_id> <stance>`                                                                                                                                                     | 切换任务群姿态                         |
| `task_force_deploy`           | `<task_force_id> [--theater <theater_id>] [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y>] [--frontline <frontline_id>] [--ground-order <order>] [--support-mode <mode>]` | 写入任务群部署意图、前线命令和轨道支援模式 |
| `theater_create`              | `<theater_id> [--name <name>]`                                                                                                                                                 | 创建战区                               |
| `theater_define_zone`         | `<theater_id> <zone_type> [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y>] [--radius <n>]`                                                                   | 定义战区区域                           |
| `theater_set_objective`       | `<theater_id> <objective_type> [--system <system_id>] [--planet <planet_id>] [--entity <entity_id>] [--description <text>]`                                                 | 设置战区目标                           |
| `blockade_planet`             | `<task_force_id> <planet_id>`                                                                                                                                                  | 对目标行星下发轨道封锁意图             |
| `landing_start`               | `<task_force_id> <planet_id> [--operation-id <operation_id>]`                                                                                                                  | 启动登陆投送流程                       |
| `switch_active_planet`        | `<planet_id>`                                                                                                                                                                  | 切换当前 active planet                 |
| `set_ray_receiver_mode`       | `<building_id> <power\|photon\|hybrid>`                                                                                                                                        | 切换射线接收站模式                     |
| `transfer`                    | `<building_id> <item_id> <quantity>`                                                                                                                                           | 把玩家背包物品装入建筑本地存储         |
| `refuel_mecha`                | `<executor_id> <fuel_item_id> <quantity>`                                                                                                                                      | 用目录中声明 `mecha_fuel_energy` 的燃料为玩家机甲补充能源；数量必须为正整数 |
| `mine_resource` | `<executor_id> <resource_id> <quantity>` | 在 2 格内手动采集有限固体矿点；quantity 为件数 |
| `craft_item` | `<executor_id> <recipe_id> <quantity>` | 按已解锁、允许手造的配方进行个人制造；quantity 为批数 |
| `cancel_mecha_job` | `<executor_id>` | 取消个人任务，返还未完成制造批次的预留原料 |
| `launch_solar_sail`           | `<building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>]`                                                                                                         | 从电磁发射器发射已装载的太阳帆         |
| `launch_rocket`               | `<building_id> <system_id> [--layer <n>] [--count <n>]`                                                                                                                        | 从垂直发射井向戴森层发射已装载的火箭   |
| `build_dyson_node`            | `<system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]`                                                                                                        | 建戴森球节点                           |
| `build_dyson_frame`           | `<system_id> <layer_index> <node_a_id> <node_b_id>`                                                                                                                            | 建戴森球框架                           |
| `build_dyson_shell`           | `<system_id> <layer_index> <latitude_min> <latitude_max> <coverage>`                                                                                                           | 建戴森球壳面                           |
| `demolish_dyson`              | `<system_id> <node\|frame\|shell> <component_id>`                                                                                                                              | 拆戴森球结构                           |
| `raw`                         | `<json>`                                                                                                                                                                       | 直接发送完整 `/commands` 请求体        |

补充说明：

- `transfer` 是 CLI alias，对应服务端命令 `transfer_item`
- `refuel_mecha` 只接受 `/catalog` 的 `items[].mecha_fuel_energy > 0` 燃料，CLI 不硬编码燃料 ID；对应服务端命令 `refuel_mecha`
- `mine_resource` / `craft_item` 的 quantity 必须是正十进制安全整数（可带 `+`），小数、0、负数、科学记数法、尾随字符及超过 JavaScript 安全整数范围的值在本地拒绝。三个命令均支持 `help <命令>` 和 `<命令> --help`。
- 采矿每 10 tick 得 1 件、每 tick 消耗 1 核心能量；制造按 `/catalog.recipes[].duration` 逐批推进，同样每 tick 消耗 1 核心能量，原料启动时从玩家背包预留。缺能暂停，采矿离开 2 格范围也暂停；补能或回到范围后自动继续。取消不退已消耗能量，只退未完成批次原料；当前只能运行一个个人任务。
- `/catalog.recipes[].handcraft_allowed=true` 才支持 `craft_item`，仍须满足科技。`resource_id` 应取真实矿点 ID，不能用 `iron_ore` 这类物品 ID 替代矿点 ID；`quantity` 为批数的配方可能每批产出多件。
- 电网充电自动执行，不增加 CLI 命令：靠近运行中的自有无线输电塔（6 格，最多 10/tick，塔自耗 1/tick）或电力感应塔（4 格，最多 2/tick），使用连通电网在建筑用电和蓄电后剩余的供电。缺电、超距、暂停或核心已满不会充电。
- `shared-client/src/command-catalog.ts` 中声明的公共 CLI alias 都会自动进入 agent runtime 的命令白名单

### 调试与运维类

| 命令       | 参数                | 说明                                                |
| ---------- | ------------------- | --------------------------------------------------- |
| `save`     | `[--reason <text>]` | 调用 `POST /save`，刷新当前游戏目录中的 `save.json` |
| `replay`   | `[options]`         | 调用 `POST /replay`                                 |
| `rollback` | `[options]`         | 调用 `POST /rollback`                               |

### Agent Gateway 类

| 命令            | 参数                                                                                                                                                          | 说明                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `agent_list`    | 无                                                                                                                                                            | 列出当前 agent-gateway 中的 agent profile          |
| `agent_create`  | `<name> --provider <provider_id> [--role <worker\|manager\|director>] [--can-create-agents <true\|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>] [--theater-ids <csv>] [--task-force-ids <csv>] [--military-command-ids <csv>] [--allow-blockade <true\|false>] [--allow-landing <true\|false>] [--allow-military-production <true\|false>] [--military-production-limit <n>]` | 创建一个绑定当前玩家 key 的 agent                  |
| `agent_update`  | `<agent_id> [--role <worker\|manager\|director>] [--can-create-agents <true\|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>] [--theater-ids <csv>] [--task-force-ids <csv>] [--military-command-ids <csv>] [--allow-blockade <true\|false>] [--allow-landing <true\|false>] [--allow-military-production <true\|false>] [--military-production-limit <n>]`                    | 更新 agent role / policy                           |
| `agent_message` | `<agent_id> <content>`                                                                                                                                       | 直接向单 agent thread 发送一条任务消息             |
| `agent_thread`  | `<agent_id>`                                                                                                                                                 | 查看 agent thread 中的消息、tool call、执行日志与最近一次 turn 摘要 |

补充说明：

- `--theater-ids` / `--task-force-ids` 用来把现有战区或任务群显式委派给 agent
- `--military-command-ids` 是战争命令白名单；当前常用值包括 `system_runtime`、`war_industry`、`task_forces`、`theaters`、`queue_military_production`、`task_force_set_stance`、`task_force_deploy`、`blockade_planet`、`landing_start`
- `--allow-blockade`、`--allow-landing`、`--allow-military-production` 是高风险动作开关
- `--military-production-limit` 是单次 `queue_military_production` 可排产的最大数量

一个最小军事委派例子：

```bash
agent_update agent-war-director \
  --command-categories observe,combat,management \
  --theater-ids theater-front \
  --task-force-ids tf-front \
  --military-command-ids system_runtime,task_force_set_stance,task_force_deploy \
  --allow-blockade false \
  --allow-landing false \
  --allow-military-production false \
  --military-production-limit 0

agent_message agent-war-director 接管 theater-front，并让 tf-front 在战区内维持巡逻，汇报当前局势。
```

### 工具类

| 命令            | 参数                | 说明                     |
| --------------- | ------------------- | ------------------------ |
| `switch`        | `[player_id] [key]` | 切换玩家                 |
| `events`        | `[count]`           | 显示最近事件，默认 10    |
| `status`        | 无                  | 显示当前玩家与服务端地址 |
| `help`          | `[command]`         | 查看帮助                 |
| `clear`         | 无                  | 清屏                     |
| `quit` / `exit` | 无                  | 退出                     |

## Case1 最小回归路径

假设 `agent-gateway` 已有可用 provider `provider-case1`：

```bash
agent_create 李斯 --id agent-lisi --provider provider-case1 --role director --can-create-agents true --command-categories observe,build,combat,research,management --planet-ids planet-1-1
agent_message agent-lisi 创建胡景，并赋予其建筑权限
agent_list
agent_message agent-lisi 新建一个矿场
agent_thread agent-lisi
```

预期：

- `agent_list` 中能看到新出现的 `agent-hujing`
- `agent_thread agent-lisi` 中能看到“创建胡景”“通知胡景建矿场”相关回复
- `agent_thread agent-lisi` 中还能看到 `agent.create / conversation.ensure_dm / conversation.send_message` 的真实 tool 证据，以及最近一次 turn 的状态、执行动作数、失败码或最终结果
- 实际建造命令由胡景通过 `agent-gateway -> client-cli runtime -> server /commands` 发出，而不是李斯自己直接 `build`

## 重点说明

### 1. `build` 已支持玩法指南中的全部主线建筑入口

`build` 不再限制少量硬编码建筑类型，而是直接接受服务端文档中的 `building_type`。例如：

- 基地与采集：`battlefield_analysis_base`、`mining_machine`、`advanced_mining_machine`、`water_pump`、`oil_extractor`、`orbital_collector`
- 输送与分拣：`conveyor_belt_mk1`、`conveyor_belt_mk2`、`conveyor_belt_mk3`、`splitter`、`traffic_monitor`、`spray_coater`、`sorter_mk1`、`sorter_mk2`、`sorter_mk3`、`pile_sorter`
- 仓储与物流：`depot_mk1`、`depot_mk2`、`storage_tank`、`logistics_distributor`、`planetary_logistics_station`、`interstellar_logistics_station`
- 冶炼生产科研：`arc_smelter`、`assembling_machine_mk1`、`chemical_plant`、`matrix_lab`、`recomposing_assembler`、`fractionator`、`oil_refinery` 等
- 电力与防御：`wind_turbine`、`tesla_tower`、`solar_panel`、`thermal_power_plant`、`energy_exchanger`、`ray_receiver`、`satellite_substation`、`gauss_turret`、`missile_turret` 等
- 戴森相关：`em_rail_ejector`、`vertical_launching_silo`

其中两条边界要以服务端 `/catalog` 为准：

- `satellite_substation` 当前已经重新接回科技树，但需要先完成 `satellite_power`
- `automatic_piler` 当前不在公开 `buildable=true` 建筑集里；CLI 不应再把它当成已闭合玩法入口

资源点约束也会直接按服务端规则生效：

- `mining_machine` 必须压在矿点上
- `water_pump` 必须压在 `water` 资源点上
- `oil_extractor` 必须压在 `crude_oil` 资源点上

如果建筑支持初始配方，直接使用 `--recipe`：

```bash
build 12 8 arc_smelter --recipe smelt_iron
build 14 8 assembling_machine_mk1 --recipe gear
build 18 8 recomposing_assembler --recipe antimatter_capsule
build 20 8 recomposing_assembler --recipe gravity_missile
```

终局弹药没有新增专用 CLI 子命令，继续复用通用 `build ... --recipe ...` 即可。高阶舰队线现在已经公开，但入口明确分成两段：

- `produce` 只保留给 `worker` / `soldier` 这类 `world_produce` 地表单位
- `prototype` / `precision_drone` / `corvette` / `destroyer` 先通过配方做成载荷 item，再用部署命令进入 authoritative runtime
- `help produce` 会读取服务端 `/catalog.world_units`，只展示 `production_mode=world_produce && runtime_class=world_unit` 的单位
- 新增的舰队 CLI 命令会直接对齐 `/catalog.warfare.public_blueprints[].deploy_command`

`vertical_launching_silo` 现在有服务端默认配方，建造时即使不传 `--recipe` 也会自动挂上 `small_carrier_rocket`：

```bash
build 24 12 vertical_launching_silo
```

如果是传送带类建筑，可带方向：

```bash
build 10 6 conveyor_belt_mk1 --direction east
build 11 6 conveyor_belt_mk3 --direction auto
```

### 配置四向分流器

建造 `splitter` 后，通过 `configure_splitter` 改端口；需要已解锁对应建筑科技。方向只允许 `north/east/south/west`，列表用逗号分隔，至少保留一个入口和一个出口。每个方向只能出现一次，不能同时输入/输出；未列出的方向关闭。优先方向必须属于对应入口/出口，过滤只能绑定出口。

```text
configure_splitter b-splitter --inputs west --outputs east,south --output-priority east --filters east:iron_ore,south:copper_ore
```

该例西侧输入，东侧只输出铁矿、南侧只输出铜矿，优先尝试东侧。东侧堵塞时，铁矿不能改走只允许铜矿的南口。要让南口成为通用旁路，完整重配时省略南口过滤：

```text
configure_splitter b-splitter --inputs west --outputs east,south --output-priority east --filters east:iron_ore
```

现在东侧满载、无连接或不接受当前物品时，物品可从有容量的南侧输出；未过滤口接受任意物品，所以铁矿也可以旁路。优先输入同样是可用优先，指定入口无货时其它入口仍可供货。无优先级时按持久游标轮流尝试合格端口；所有合格出口堵塞时货物留在真实缓存中。

**每条命令完整替换前五项配置**，不是补丁。`--input-priority` / `--output-priority` 省略即清除对应旧优先级；`--filters` 省略即清除全部旧过滤。要只清某一出口的过滤，重新列出其它需要保留的过滤即可。例如清除所有过滤及优先级：

```text
configure_splitter b-splitter --inputs west --outputs east,south,north
help configure_splitter
```

查询建筑时，`splitter.input_cursor` / `output_cursor` 是方向数组中的零基轮询索引，实际收货/发货后移到所用口下一索引；`transferred_items` 只累计分流器实际送出件数，`last_transfer_tick` 记录最近发货 tick，初始为 0。重新配置重置游标，保留这两个统计及 `conveyor.buffer` 缓存；默认吞吐 6 件/tick、缓存 24 件。配置命令只修改自己的分流器，参数非法时整条拒绝，原状态不变。

### 2. 玩法指南中的 31 类核心命令都已有独立 CLI 命令

已覆盖：

- `build`
- `upgrade`
- `demolish`
- `configure_logistics_station`
- `configure_logistics_slot`
- `cancel_construction`
- `restore_construction`
- `start_research`
- `cancel_research`
- `switch_active_planet`
- `set_ray_receiver_mode`
- `transfer`
- `produce`
- `deploy_squad`
- `commission_fleet`
- `fleet_assign`
- `fleet_attack`
- `fleet_disband`
- `fleet_move`
- `move`
- `attack`
- `scan_galaxy`
- `scan_system`
- `scan_planet`
- `fleet_status`
- `system_runtime`
- `launch_solar_sail`
- `launch_rocket`
- `build_dyson_node`
- `build_dyson_frame`
- `build_dyson_shell`
- `demolish_dyson`

### 3. 高阶舰队线现在有独立 CLI 闭环

当前公开高阶单位的 CLI 路径已经固定成：

1. 通过普通产线或测试物资拿到载荷 item：
   - `prototype`
   - `precision_drone`
   - `corvette`
   - `destroyer`
2. 用 `transfer <building_id> <item_id> <quantity>` 把载荷装进部署枢纽本地存储
3. 用部署命令生成 runtime 实体：
   - `deploy_squad <building_id> <blueprint_id> [--count <n>] [--planet <planet_id>]`
   - `commission_fleet <building_id> <blueprint_id> <system_id> [--count <n>] [--fleet-id <fleet_id>]`
4. 用运行态命令和查询继续控制：
   - `fleet_assign <fleet_id> <line|vee|circle|wedge>`
   - `fleet_attack <fleet_id> <planet_id> <target_id>`
   - `fleet_disband <fleet_id>`
   - `fleet_move <fleet_id> <target_system_id>`
   - `fleet_status [fleet_id]`
   - `system_runtime [system_id]`

当前约束：

- 部署枢纽必须带电并处于 `running`
- `battlefield_analysis_base` 现在就是默认部署枢纽
- `fleet_attack` 当前只支持同一恒星系内目标
- `fleet_move` 要求目标星系与当前星系按 k 近邻航线直达、舰队 `state=idle` 且不在跃迁中；固定 10 tick 跃迁
- `fleet_status` 会显示舰队武器、护盾、编队与最近攻击 tick
- `system_runtime` 会显示该系统当前太阳帆与舰队运行态

### 4. 战争系统最小 CLI 闭环

战争链路当前推荐优先在 `config-war.yaml + map-war.yaml` 这套 authoritative 官方战争验证局里做最小闭环验证。该场景已经为 `p1` / `p2` 预置：

- `battlefield_analysis_base` 部署枢纽
- `recomposing_assembler`
- `planetary_logistics_station`
- `interstellar_logistics_station`
- `prototype` / `precision_drone` / `corvette` / `destroyer` 四条公开战争蓝图科技

在这个场景里，推荐按下面这组命令验证最小闭环：

1. 蓝图与改型：
   - `blueprints`
   - `blueprint_create <blueprint_id> <ground|space> ...`
   - `blueprint_set_component <blueprint_id> <slot_id> <component_id>`
   - `blueprint_validate <blueprint_id>`
   - `blueprint_finalize <blueprint_id>`
   - `blueprint_variant <parent_blueprint_id> <blueprint_id> <allowed_slot_ids_csv>`
2. 军工与部署：
   - `war_industry`
   - `queue_military_production <building_id> <deployment_hub_id> <blueprint_id>`
   - `refit_unit <building_id> <unit_id> <target_blueprint_id>`
   - `deploy_squad ...`
   - `commission_fleet ...`
3. 指挥与态势：
   - `task_force_create`
   - `task_force_assign`
   - `task_force_set_stance`
   - `task_force_deploy`
   - `theater_create`
   - `theater_define_zone`
   - `theater_set_objective`
4. 情报、补给与战报：
   - `planet_runtime [planet_id]`
   - `system_runtime [system_id]`
   - `fleet_status [fleet_id]`
   - `war_industry`
   - `task_forces`
5. 轨道封锁与登陆：
   - `blockade_planet <task_force_id> <planet_id>`
   - `landing_start <task_force_id> <planet_id> [--operation-id <operation_id>]`

当前实现边界：

- `deploy_squad` / `commission_fleet` 不再硬编码只接受公开蓝图 ID；玩家自定义并已定型的蓝图同样可以走部署命令。
- `task_force_deploy` 当前同时承担“部署锚点 / 前线命令 / 轨道支援模式”三类写入口，但它仍然不是完整自动航渡系统。
- `blockade_planet` / `landing_start` 的同步返回只代表请求入队，最终 authoritative 结果要看 SSE `command_result` 或 `event_snapshot --types command_result`。
- `system_runtime` 现在会输出舰队外，还会显示 `contacts`、`planet_blockades`、`landing_operations` 与 `battle_reports`；`planet_runtime` 会显示 `contacts`、`frontlines` 与 `ground_task_forces`。
- `war_industry` 现在是最直接的补给查询入口，能看到生产单、翻修单、部署枢纽和供给节点库存。
- 官方战争验证局会把军工底座和补给节点预置好，但仍不会直接生成舰队、任务群和战区；这些实体依然需要用上面的 CLI 命令真实创建。
- `/war` 页面适合做蓝图查看、部署尝试、姿态切换、战报/情报观察，但当前 `task_force_create|assign`、`theater_create|define_zone|set_objective` 与量产/翻修下单仍以 CLI 为最稳入口。

### 4.1 AI 军事委派的真实入口

当前 AI 军事委派已经落在 `agent-gateway + client-cli runtime` 上，真实使用顺序是：

1. 先用上面的战争命令建好要委派的 `task_force` / `theater`
2. 再用 `agent_update` 给目标 agent 授权具体 `--theater-ids` / `--task-force-ids`
3. 最后用 `agent_message` 下达目标，让 agent 在授权范围内执行

当前硬边界：

- 只配置 `commandCategories=combat` 不够，战争命令还必须命中 `--military-command-ids`
- `blockade_planet` / `landing_start` / `queue_military_production` 还会分别受 `--allow-blockade` / `--allow-landing` / `--allow-military-production` 控制
- 运行时会拿 authoritative `theaters` / `task_forces` 对齐 `system_id` / `planet_id` / `task_force_id` / `theater_id`，越界直接拒绝
- 当前查询仍以玩家全量可见视图返回，agent 侧硬限制主要控制“能否执行”和“能否越界下命令”

### 5. 物流与多星球最小闭环现在可直接操作

当前 CLI 提供 `造站 -> 接电充电 -> 配槽/皮带 -> 安装成品运输器 -> 真实往返配送` 的操作入口：

- 先用 `build` 建 `planetary_logistics_station` 或 `interstellar_logistics_station`
- 新站空库存、空电池、无皮带口、无运输器。安装须有 `logistics_drone` / `logistics_vessel` 成品。默认从背包安装；制造台产物可经皮带送入站点同物品的 `none` 本地槽，再用 `install_logistics_vehicle ... --source station` 从站库安装；调大容量不会生成载具。两配方需 `planetary_logistics` / `interstellar_logistics`，分别消耗2电动机+2处理器+5铁块、2电动机+10处理器+10钛合金。
- 用 `configure_logistics_station` 调整无人机容量（1..10）、优先级、星际开关/曲速/货船槽位（1..5），容量不得低于已安装数。`--belt-ports` 提供时完整替换全部端口，省略保持原配置，`none` 清空；端口物品必须先配置槽位。
- 用 `configure_logistics_slot` 配置 `none|supply|demand|both` 与保留/目标量。`none` 仍占本地槽；`--remove` 才删除，有库存、端口引用或在途货物/取货预约时拒绝。PLS为3槽每项200，ILS为5槽每项500，同物品跨scope只占一槽。
- 用 `switch_active_planet` 在“已发现 + 已加载 + 当前玩家有 foothold”的星球之间切换当前操作焦点
- 同一恒星系、已加载行星之间的星际物流货船现在可以跨行星派发；是否能形成闭环取决于两端物流站配置与该星球 runtime 是否已加载
- 如果你更习惯图形界面，同一套配置也可以在 Web 行星页完成：在“工作台 → 物流”配置站点/槽位；选中己方站点后，在“详情 → 物流站运行与接线”查看状态、安装运输器和配置皮带端口

常用流程示例（假定两端已建好且通电，背包已有成品与装料；跨星球的目标站先切到所在星球配置）：

```bash
configure_logistics_station b-20 --drone-capacity 2 --input-priority 3 --output-priority 2
configure_logistics_slot b-20 planetary iron_ore supply 20
configure_logistics_slot b-21 planetary iron_ore demand 60
configure_logistics_station b-20 --belt-ports west:input:iron_ore
configure_logistics_station b-21 --belt-ports east:output:iron_ore
install_logistics_vehicle b-20 logistics_drone 1
transfer b-20 iron_ore 100
configure_logistics_station b-30 --interstellar-enabled true --warp-enabled true --ship-slots 2
configure_logistics_slot b-30 interstellar hydrogen supply 50
configure_logistics_slot b-31 interstellar hydrogen demand 80
install_logistics_vehicle b-30 logistics_vessel 1
transfer b-30 hydrogen 100
switch_active_planet planet-1-1
```

皮带口只连接方向正确的相邻自有活动皮带，每口6件/tick。PLS基础用电1、最多充10/tick至1000；ILS基础2、最多充30/tick至10000。起飞一次扣往返能源，途中停电不坠毁。供方可主动送货，需方可派空载运输器取货；满仓时查看runtime的 `waiting_unload` / `destination_full`，清理同物品空间即可继续。`stranded` / `home_unavailable` 表示归属站失效，货物保留但尚无回收命令。

制造台成品从站库安装示例（假定北侧相邻皮带朝本站送入无人机；配置端口会替换旧端口，应同时提交需要保留的其它口）：

```bash
configure_logistics_slot b-20 planetary logistics_drone none 0
configure_logistics_station b-20 --belt-ports west:input:iron_ore,north:input:logistics_drone
install_logistics_vehicle b-20 logistics_drone 1 --source station
```

应先确认 `planet_runtime` 中站库已有成品再执行安装；安装不会从其它建筑或未到站的皮带远程取货。

清端口/删空槽示例（须先清空铁矿库存并等运输结束；此命令会拆掉本站全部皮带口）：

```bash
configure_logistics_station b-20 --belt-ports none
configure_logistics_slot b-20 planetary iron_ore --remove
```

曲速还需要在起飞站配置 `space_warper none 0` 槽并实际装入至少2份曲速器，以及足够往返电量和达到距离阈值；只开开关不保证曲速。带剩余喷涂用途的货物会停在站点入口，当前站库不能保留涂层。完整规则见[服务端API](服务端API.md)。

### 6. 科研命令现在要求真实矩阵

`start_research` 不再是旧版“抽象研究点排队”。

- 至少需要 1 个处于 `running` 的研究站
- `matrix_lab` 不设置 `recipe_id` 时会作为研究站；设置了 `recipe_id` 时则按普通生产建筑运行
- 研究开始前，所需每种矩阵都必须已经出现在研究站本地库存里
- 默认新局不再预置启动矩阵：第一门 `electromagnetism` 的 10 个电磁矩阵必须由“采矿 -> 冶炼（磁铁 / 铁块 / 铜块）-> 制造（磁线圈 / 电路板）-> 矩阵”的产线自产，再通过 `transfer` 装入研究站
- 研究推进会真实消耗研究站本地库存中的矩阵；如果缺实验室或缺矩阵，可在 `summary` 的 `tech.current_research.blocked_reason` 里看到 `waiting_lab` / `waiting_matrix`
- 研究站供电不足时 `blocked_reason` 为 `low_power`（未通电停滞或电力配比降速），同时 `tech.current_research.speed_multiplier` 给出供电速度倍率、`estimated_ticks_remaining` 给出按当前速度预估的剩余 tick

### 7. 调试查询接口也已补齐

除玩法主命令外，CLI 还支持：

- 审计日志
- 事件快照补拉
- 产线告警快照
- 手动保存当前游戏目录
- Tick replay
- Tick rollback

### 8. 行星查询已经拆成 `planet / scene / inspect / fog`

- `planet` 只显示轻量概要，适合快速确认行星规模与对象数量
- `scene` 直接返回当前视窗原始 JSON，适合调试地图裁剪与图层
- `inspect` 直接返回目标对象详情 JSON，适合定位建筑、单位、资源
- `fog` 不再请求整张迷雾，而是按窗口渲染局部迷雾 ASCII
- `stats.production_stats.total_output` / `by_building_type` / `by_item` 已改为 authoritative 真实产出口径；当前覆盖配方落库、采集落库、直充矿物池、轨采落站
- `stats.production_stats.by_item["minerals"]` 表示“直接写入玩家矿物池”的采集产出统计标签，不是可转运物品
- 空转、缺料、没配方但带生产模块的建筑，或没有真实入库 / 入站的采集建筑，不会再被算成“总产出”

## 常用示例

### 基础查询

```bash
summary
stats
briefing
planet
scene planet-1-1 96 160 32 32
inspect planet-1-1 building assembler-1
fog planet-1-1 96 160 32 16
galaxy
system sys-1
```

### 探索外层世界

```bash
scan_galaxy
scan_system sys-2
scan_planet planet-2-1
```

### 已解锁早期科技后的工业化

```bash
build 8 8 wind_turbine
build 9 8 tesla_tower
build 12 10 mining_machine
build 14 10 conveyor_belt_mk1 --direction east
build 16 10 depot_mk1
```

### 科研验证

```bash
inspect planet-1-2 building b-40
transfer b-40 electromagnetic_matrix 10
start_research electromagnetism
summary
```

### 施工控制

```bash
cancel_construction c-1
restore_construction c-1
upgrade b-12
demolish b-18
```

### 单星球物流

`configure_logistics_station` 改站点参数和端口，`configure_logistics_slot` 设置供需，`install_logistics_vehicle` 安装背包成品，或加 `--source station` 扣站内成品。以下沿用上节已通电、有成品和物料的站点；后半段为星际站示例，异星目标需切星球配置。

```bash
configure_logistics_station b-20 --drone-capacity 2 --input-priority 3 --output-priority 2
configure_logistics_slot b-20 planetary iron_ore supply 20
configure_logistics_slot b-21 planetary iron_ore demand 60
configure_logistics_station b-20 --belt-ports west:input:iron_ore
configure_logistics_station b-21 --belt-ports east:output:iron_ore
install_logistics_vehicle b-20 logistics_drone 1
transfer b-20 iron_ore 100
configure_logistics_station b-30 --interstellar-enabled true --warp-enabled true --ship-slots 2
configure_logistics_slot b-30 interstellar hydrogen supply 50
configure_logistics_slot b-31 interstellar hydrogen demand 80
install_logistics_vehicle b-30 logistics_vessel 1
transfer b-30 hydrogen 100
```

### 单位与战斗

```bash
produce b-21 worker
produce b-21 soldier
transfer b-1 prototype 2
deploy_squad b-1 prototype --count 2 --planet planet-1-2
transfer b-1 corvette 1
commission_fleet b-1 corvette sys-1 --count 1 --fleet-id fleet-demo
fleet_assign fleet-demo wedge
fleet_status fleet-demo
system_runtime sys-1
move u-3 18 14
attack u-3 enemy-1
```

注意：

- `produce` 不再接受 `corvette` / `destroyer`
- 高阶单位必须先进入部署枢纽本地存储，再走 `deploy_squad` / `commission_fleet`
- 如果部署枢纽没接电，服务端会直接返回 `deployment hub is not operational: ...`

### 太阳帆与戴森球

`launch_solar_sail` 当前只接受 `em_rail_ejector`，而 `launch_rocket` 当前只接受 `vertical_launching_silo`；两者都要求目标建筑本地已经装载好对应载荷。最直接的公开装填方式就是先用 `transfer`。

```bash
transfer b-30 solar_sail 5
transfer b-31 small_carrier_rocket 2
launch_solar_sail b-30 --count 5 --orbit-radius 1.2 --inclination 5
launch_rocket b-31 sys-1 --layer 0 --count 2
build_dyson_node sys-1 0 10 20 --orbit-radius 1.2
build_dyson_frame sys-1 0 node-1 node-2
build_dyson_shell sys-1 0 -15 15 0.4
demolish_dyson sys-1 shell shell-1
```

### 官方 Midgame 场景

如果你要验证 `gas_giants`、`orbital_collector`、`vertical_launching_silo`、`launch_solar_sail` 和 `launch_rocket`，推荐先用服务端的官方场景启动：

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-midgame.yaml -map-config map-midgame.yaml
```

进入 CLI 后，先确认当前运行态已经落在气态行星上，再继续建造：

```bash
summary
system sys-1
switch_active_planet planet-1-1
switch_active_planet planet-1-2
build <x> <y> tesla_tower
build <x> <y> wind_turbine
build <x> <y> wind_turbine
# 继续补 wind_turbine，直到 stats.energy_stats.generation >= 84
stats
build <x> <y> orbital_collector
build <x> <y> vertical_launching_silo
build <x> <y> em_rail_ejector
build <x> <y> jammer_tower
build <x> <y> sr_plasma_turret
build <x> <y> planetary_shield_generator
build <x> <y> self_evolution_lab
build <x> <y> self_evolution_lab --recipe electromagnetic_matrix
build 8 6 recomposing_assembler
build 8 7 pile_sorter
build 10 7 advanced_mining_machine
transfer <silo_id> small_carrier_rocket 1
transfer <ejector_id> solar_sail 3
build_dyson_node sys-1 0 10 20 --orbit-radius 1.2
launch_solar_sail <ejector_id> --count 1
launch_rocket <silo_id> sys-1 --layer 0 --count 1
set_ray_receiver_mode <receiver_id> power
```

说明：

- `summary` 中应看到 `active_planet_id = planet-1-2`
- 如果已经通过 `mission_complete` 完成终局科研，`summary` 会额外返回 `winner` / `victory_reason` / `victory_rule`
- `system sys-1` 中应能看到 `planet-1-2.kind = gas_giant`
- `switch_active_planet` 只允许切到“已发现 + 已加载 + 你在该星球已有 foothold”的目标；来回切换后，后续 `build` / `inspect` / `transfer` 都会以新的 active planet 为当前操作焦点
- 当前官方 seed 下，想同时让 `orbital_collector`、`vertical_launching_silo`、`em_rail_ejector` 都进入 `running`，实测需要把 `stats.energy_stats.generation` 堆到至少 `84`；这个数字现在已经与 `/world/planets/{planet_id}/networks` 的真实网络供电口径对齐，包含 `ray_receiver power/hybrid` 的实际回灌
- 当 `ray_receiver` 切到 `power` / `hybrid` 且太阳帆或戴森结构已经产能后，`summary.players.p1.resources.energy`、`stats.energy_stats.generation` 与 `/world/planets/{planet_id}/networks.power_networks[].supply` 应同步抬升
- 用 `set_ray_receiver_mode <receiver_id> power` 验证时，应该比较切模式后的 `energy / generation / supply` 增量，并确认 `critical_photon` 不再继续增长；切换前已经存在的光子库存/缓冲不会被自动清零
- 如果还要同时验证 `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab`，需要继续补风机；推荐先让戴森链路跑通，再逐个补建并用 `inspect` 观察运行态
- `transfer` 会从当前玩家背包扣减物品，并把物品装进目标建筑本地存储
- `launch_rocket` 只有在目标层已存在 `build_dyson_*` scaffold 且 silo 本地已装载 `small_carrier_rocket` 时才会成功
- `set_ray_receiver_mode` 的 `photon` 模式要求玩家已解锁 `dirac_inversion`；官方 midgame 场景默认可先用 `power` 或 `hybrid` 验证命令链路
- 官方 midgame 现已额外预置 `signal_tower` / `plasma_turret` / `gravity_matrix` / `planetary_shield` / `self_evolution` / `integrated_logistics` / `photon_mining` / `annihilation`，因此 7 个中后期建筑都可以直接通过通用 `build` 验证；`dirac_inversion` 仍未预置

### 审计与事件补拉

```bash
audit --player p1 --permission build --order desc --limit 20
event_snapshot --since-tick 120 --limit 50
event_snapshot --types command_result,building_state_changed --since-tick 120
event_snapshot --all --since-tick 120 --limit 50
alert_snapshot --since-tick 120 --limit 50
```

### 调试控制

```bash
save
save --reason before-dyson
replay --from 120 --to 180 --speed 5 --verify true
rollback --to 120
```

### 原始命令请求

```bash
raw {"request_id":"req-1","issuer_type":"player","issuer_id":"p1","commands":[{"type":"start_research","target":{"layer":"planet"},"payload":{"tech_id":"electromagnetism"}}]}
```

## `audit` 选项

```bash
audit --player <id> --issuer-type <type> --issuer-id <id> --action <action> --request-id <rid> --permission <permission> --granted <true|false> --from-tick <n> --to-tick <n> --from-time <rfc3339> --to-time <rfc3339> --limit <n> --order <asc|desc>
```

## `event_snapshot` / `alert_snapshot` 选项

```bash
event_snapshot --types <a,b,c> --all --after-id <id> --since-tick <n> --limit <n>
alert_snapshot --after-id <id> --since-tick <n> --limit <n>
```

- `event_snapshot` 未显式传 `--types` 时，会使用与默认 SSE 相同的低噪声事件集合
- 想排查高频事件时，使用 `event_snapshot --types damage_applied,entity_updated ...` 或 `event_snapshot --all ...`

## `save` 选项

```bash
save --reason <text>
```

- `--reason` 可选，用来给这次手动保存打标签；不传时仍会正常保存。
- `save` 不会新建多槽位，只会刷新服务端当前 `server.data_dir` 下的 `save.json`。

## `replay` / `rollback` 选项

```bash
replay --from <tick> --to <tick> --step --speed <n> --verify <true|false>
rollback --to <tick>
```

## 默认值

- 默认服务端：`http://localhost:18080`
- 默认银河：`galaxy-1`
- 默认恒星系：`sys-1`
- 默认行星：`planet-1-1`
- 默认事件显示数量：`10`

### 球面接缝观察

默认普通新局 `planet.face_size=816`，图集为 2448×1632；官方 war/midgame 的 N=48，图集为 144×96。scene 的 width/height 是查询窗口尺寸，不是整颗星球尺寸；服务端省略窗口尺寸时默认 160、最大 257，并裁剪到图集边界。CLI `scene` 仍要求显式窗口参数；`fog` 自己使用 32×16 默认窗口。

`scene [planet_id] <x> <y> <width> <height> [--near_x X --near_y Y --radius R]`：以图集矩形为主窗口，额外查询球面邻域补片（R 最大 128）。例：`scene planet-1-1 0 0 32 32 --near_x 0 --near_y 16 --radius 16`。`surface_patches` 以原始 JSON 输出，现有移动/建造命令仍使用权威图集 x/y。

### 球面移动与建筑布局

`move` 等命令仍传权威图集 x/y，但距离和障碍校验使用球面邻接，不能用 `abs(dx)+abs(dy)` 拆分跨面路线。需要自动规划的调用方可使用共享 API `fetchPlanetPath`，对应 `GET /world/planets/{id}/path?unit_id=...&target_x=...&target_y=...&stop_range=...`；这不是新增 CLI `path` 指令。stop_range 为 0..128，默认 0；建造靠近时取执行体操作范围。返回 path 含起点，waypoints 不含起点并按 move_range 分段。reachable=true 且 waypoints 为空表示已经够近；未知或 512 步预算内不可达返回 reachable=false，不应继续建造。

建筑布局蓝图的矩形选区和旋转后粘贴范围必须在同一面内；跨面布局拆成多个蓝图。此限制不适用于本页 `blueprint_create/blueprint_set_component` 等战争蓝图命令。

### 流速监测器

```text
configure_traffic_monitor <building_id> <belt_id|none> --window <1..600> --minimum <0..60> --alerts <on|off>
```

完整替换配置；绑定己方球面相邻的Mk.I/II/III传送带，`none`清绑定。窗口和最低流量分别以tick、件/tick计。关闭告警仍监测，应用任何配置会重置统计。通过`inspect <planet_id> building <building_id>`查看`traffic_monitor`实时状态、窗口吞吐和累计量；`event_snapshot`可查询`traffic_monitor_alert`的触发与解除。
