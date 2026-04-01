# SiliconWorld 客户端 CLI

`client-cli` 现已覆盖 `docs/服务端API.md` 中公开的服务端查询接口，以及 `docs/玩家玩法指南.md` 中玩家可直接使用的 18 类核心命令。

## 启动

1. 进入目录：`cd client-cli`
2. 安装依赖：`npm install`
3. 启动 CLI：`npm run dev`

## 环境变量

- `SW_SERVER`：服务端地址，默认 `http://localhost:18080`
- `SW_SSE_VERBOSE=1`：主动订阅并显示所有实时 SSE 事件；默认只订阅低噪声关键事件

## 登录与事件流

- 启动后会提示选择玩家
- 默认玩家：
  - `p1 / key_player_1`
  - `p2 / key_player_2`
- 也可以输入自定义 `player_id` 与 `player_key`
- CLI 会自动连接 `GET /events/stream?event_types=...`
- 默认只主动订阅低噪声关键事件：`command_result`、`entity_created`、`entity_destroyed`、`building_state_changed`、`construction_paused`、`construction_resumed`、`research_completed`、`loot_dropped`
- `production_alert` 改为默认不进入 CLI 实时流，避免后期空转产线持续刷屏；需要看告警时请用 `alert_snapshot`
- `SW_SSE_VERBOSE=1` 时会改为显式订阅全部事件类型；像 `production_alert`、`damage_applied`、`entity_updated` 这类高频事件默认不会进入 CLI 实时流
- `events [count]` 只显示当前 SSE 连接实际订阅到的事件
- `switch [player_id] [key]` 会切换玩家并自动重连 SSE

## 命令总览

### 查询类

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `health` | 无 | 查询 `GET /health` |
| `metrics` | 无 | 查询 `GET /metrics` |
| `summary` | 无 | 查询 `GET /state/summary` |
| `stats` | 无 | 查询 `GET /state/stats` |
| `galaxy` | 无 | 查询 `GET /world/galaxy` |
| `system` | `[system_id]` | 查询 `GET /world/systems/{system_id}`，默认 `sys-1` |
| `planet` | `[planet_id]` | 查询 `GET /world/planets/{planet_id}`，默认 `planet-1-1` |
| `fogmap` | `[planet_id]` | 查询 `GET /world/planets/{planet_id}/fog` 原始 JSON |
| `fog` | `[planet_id]` | 行星迷雾 ASCII 渲染，`#` 为当前可见，`+` 为已探索，`.` 为未知 |
| `audit` | `[options]` | 查询 `GET /audit` |
| `event_snapshot` | `[options]` | 查询 `GET /events/snapshot` |
| `alert_snapshot` | `[options]` | 查询 `GET /alerts/production/snapshot` |

### 玩家操作类

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `scan_galaxy` | `[galaxy_id]` | 扫描银河，默认 `galaxy-1` |
| `scan_system` | `<system_id>` | 扫描恒星系 |
| `scan_planet` | `<planet_id>` | 扫描行星 |
| `build` | `<x> <y> <building_type> [--z <z>] [--direction <dir>] [--recipe <recipe_id>]` | 建造任意服务端可建建筑 |
| `move` | `<entity_id> <x> <y> [--z <z>]` | 移动单位 |
| `attack` | `<entity_id> <target_entity_id>` | 攻击单位或建筑 |
| `produce` | `<entity_id> <worker\|soldier>` | 生产单位 |
| `upgrade` | `<entity_id>` | 升级建筑 |
| `demolish` | `<entity_id>` | 拆除建筑 |
| `cancel_construction` | `<task_id>` | 取消施工任务 |
| `restore_construction` | `<task_id>` | 恢复施工任务 |
| `start_research` | `<tech_id>` | 开始研究 |
| `cancel_research` | `<tech_id>` | 取消研究 |
| `launch_solar_sail` | `<building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>]` | 从电磁发射器发射已装载的太阳帆 |
| `build_dyson_node` | `<system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]` | 建戴森球节点 |
| `build_dyson_frame` | `<system_id> <layer_index> <node_a_id> <node_b_id>` | 建戴森球框架 |
| `build_dyson_shell` | `<system_id> <layer_index> <latitude_min> <latitude_max> <coverage>` | 建戴森球壳面 |
| `demolish_dyson` | `<system_id> <node\|frame\|shell> <component_id>` | 拆戴森球结构 |
| `raw` | `<json>` | 直接发送完整 `/commands` 请求体 |

### 调试与运维类

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `replay` | `[options]` | 调用 `POST /replay` |
| `rollback` | `[options]` | 调用 `POST /rollback` |

### 工具类

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `switch` | `[player_id] [key]` | 切换玩家 |
| `events` | `[count]` | 显示最近事件，默认 10 |
| `status` | 无 | 显示当前玩家与服务端地址 |
| `help` | `[command]` | 查看帮助 |
| `clear` | 无 | 清屏 |
| `quit` / `exit` | 无 | 退出 |

## 重点说明

### 1. `build` 已支持玩法指南中的全部主线建筑入口

`build` 不再限制少量硬编码建筑类型，而是直接接受服务端文档中的 `building_type`。例如：

- 基地与采集：`battlefield_analysis_base`、`mining_machine`、`water_pump`、`oil_extractor`、`orbital_collector`
- 输送与分拣：`conveyor_belt_mk1`、`conveyor_belt_mk2`、`conveyor_belt_mk3`、`splitter`、`automatic_piler`、`traffic_monitor`、`spray_coater`、`sorter_mk1`、`sorter_mk2`、`sorter_mk3`
- 仓储与物流：`depot_mk1`、`depot_mk2`、`storage_tank`、`logistics_distributor`、`planetary_logistics_station`、`interstellar_logistics_station`
- 冶炼生产科研：`arc_smelter`、`assembling_machine_mk1`、`chemical_plant`、`matrix_lab`、`fractionator`、`oil_refinery` 等
- 电力与防御：`wind_turbine`、`tesla_tower`、`solar_panel`、`thermal_power_plant`、`ray_receiver`、`gauss_turret`、`missile_turret` 等
- 戴森相关：`em_rail_ejector`、`vertical_launching_silo`

资源点约束也会直接按服务端规则生效：

- `mining_machine` 必须压在矿点上
- `water_pump` 必须压在 `water` 资源点上
- `oil_extractor` 必须压在 `crude_oil` 资源点上

如果建筑支持初始配方，直接使用 `--recipe`：

```bash
build 12 8 arc_smelter --recipe smelt_iron
build 14 8 assembling_machine_mk1 --recipe gear
```

如果是传送带类建筑，可带方向：

```bash
build 10 6 conveyor_belt_mk1 --direction east
build 11 6 conveyor_belt_mk3 --direction auto
```

### 2. 玩法指南中的 18 类核心命令都已有独立 CLI 命令

已覆盖：

- `build`
- `upgrade`
- `demolish`
- `cancel_construction`
- `restore_construction`
- `start_research`
- `cancel_research`
- `produce`
- `move`
- `attack`
- `scan_galaxy`
- `scan_system`
- `scan_planet`
- `launch_solar_sail`
- `build_dyson_node`
- `build_dyson_frame`
- `build_dyson_shell`
- `demolish_dyson`

### 3. 调试查询接口也已补齐

除玩法主命令外，CLI 还支持：

- 审计日志
- 事件快照补拉
- 产线告警快照
- Tick replay
- Tick rollback

### 4. `planet` 输出会直接显示停机原因与关键运行摘要

- `State` 列会显示 `state:reason`，例如 `no_power:power_out_of_range`
- `Ops` 列会压缩显示关键模块状态，例如：
  - `collect=titanium_ore@8`
  - `recipe=gear`
  - `research=1/t`
  - `storage=titanium_ore:8`

## 常用示例

### 基础查询

```bash
summary
stats
planet
fog
galaxy
system sys-1
```

### 探索外层世界

```bash
scan_galaxy
scan_system sys-2
scan_planet planet-2-1
```

### 开局工业化

```bash
start_research electromagnetism
build 8 8 wind_turbine
build 9 8 tesla_tower
build 12 10 mining_machine
build 14 10 conveyor_belt_mk1 --direction east
build 16 10 depot_mk1
```

### 冶炼与制造

```bash
build 18 10 arc_smelter --recipe smelt_iron
build 20 10 assembling_machine_mk1 --recipe gear
build 22 10 matrix_lab
start_research basic_logistics_system
```

### 施工控制

```bash
cancel_construction c-1
restore_construction c-1
upgrade b-12
demolish b-18
```

### 单位与战斗

```bash
produce b-21 worker
produce b-21 soldier
move u-3 18 14
attack u-3 enemy-1
```

### 太阳帆与戴森球

`launch_solar_sail` 当前只接受 `em_rail_ejector`，而且要先把 `solar_sail` 装进发射器本地存储。

```bash
launch_solar_sail b-30 --count 5 --orbit-radius 1.2 --inclination 5
build_dyson_node sys-1 0 10 20 --orbit-radius 1.2
build_dyson_frame sys-1 0 node-1 node-2
build_dyson_shell sys-1 0 -15 15 0.4
demolish_dyson sys-1 shell shell-1
```

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
