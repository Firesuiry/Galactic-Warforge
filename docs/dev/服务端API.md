# 服务端 API 文档

> 行星已统一为立方体球面六面网格。`surface: {topology: "cube_sphere", face_size: N}` 明示拓扑；`map_width=3N`、`map_height=2N` 为存储图集尺寸，x/y 不再具有平面邻接语义。配置仅使用 `planet.face_size`，旧平面存档拒绝加载。详见 [立方体球面网格](../guide/立方体球面网格.md)。

本文档整理当前服务端可用的 API。示例与字段以服务端实现为准。

**基础信息**
- Base URL: `http://<host>:<port>`
- 认证方式: `Authorization: Bearer <player_key>`
- 响应格式: JSON（SSE 例外）

**错误响应格式**
```json
{
  "error": "message",
  "code": 400
}
```

---

**启动与存档目录**
- `server.data_dir` 现在表示“单局游戏工作目录”，目录结构固定为：
```text
<game_dir>/
  meta.json
  save.json
```
- 启动规则：
  - 目录不存在或为空：按本次外部 `config` 与 `map-config` 新建一局，并在开始对外服务前立即写出首个 `meta.json` 与 `save.json`。
  - 目录中同时存在合法 `meta.json` 与 `save.json`：直接继续上一局。
  - 目录里只存在其中一个文件，或目录非空但不是完整存档：服务端拒绝启动，需人工清理或重建该目录。
- 续档时，目录内部保存的 `battlefield`、`players`、`map_config` 优先于本次外部配置。
- 纯运行参数仍允许被本次外部配置覆盖，包括：`server.port`、`server.rate_limit`、`server.event_history_limit`、`server.snapshot_max_events`、`server.alert_history_limit`、`server.auto_save_interval_seconds`。
- 自动保存默认每 `60` 秒刷新一次当前目录中的 `save.json`；`server.auto_save_interval_seconds = 0` 表示关闭自动保存。
- `save.json` 以 gzip 压缩存储（文件名不变）；读取时按 gzip 魔数自动识别，旧版本写出的未压缩明文 `save.json` 可正常续档，下次保存自动转为压缩格式。
- 第一版不做多槽位或命名存档点，自动保存与手动保存都会覆盖同一份 `save.json`。
- 第一版不持久化 RNG 状态；续档后未来随机事件不保证与不停服持续运行时完全一致。
- `save.json.runtime_state` 现在会额外持久化 `winner` / `victory_reason` / `victory_rule` / `victory_tech_id`，保证科技胜利、续档、回放、回滚后的胜利态一致。
- `save.json.snapshot.space` 现在会持久化 top-level `SpaceRuntimeState`；太阳帆 orbit 已按 `player + system` 分桶进入同一份 snapshot-backed runtime，续档、回放、回滚会保留一致的空间实体计数与轨道状态。

**普通新局默认入口**
- `config-dev.yaml + map.yaml` 现在就是一条可直接从 fresh save 起步的官方路线。
- `battlefield.victory_rule` 当前支持 `elimination`、`mission_complete`、`hybrid` 三种取值；仓库内当前提供的 `config.yaml`、`config-dev.yaml`、`config-midgame.yaml` 都显式设置为 `hybrid`，即 `mission_complete` 科研胜利与基地消灭胜同时有效。
- 默认新局里，每名玩家仍只预完成 `dyson_sphere_program`；这门 0 级科技会直接解锁整套基础工业建筑：`matrix_lab`、`wind_turbine`、`mining_machine`、`arc_smelter`、`tesla_tower`、`conveyor_belt_mk1`、`sorter_mk1`、`assembling_machine_mk1`，因此默认新局从拍风机、接电塔、压矿机开始，无需先研究。
- `config-dev.yaml` 会为每名玩家预置一份最小启动包：
  - `minerals = 240`
  - `energy = 100`
  - 不再预置 `electromagnetic_matrix`；第一门 `electromagnetism`（10 个电磁矩阵）必须由产业链自产：铁矿 -> 磁铁（`smelt_magnet`）-> 磁线圈（`magnetic_coil`），铁矿 -> 铁块、铜矿 -> 铜块 -> 电路板（`circuit_board`），磁线圈 + 电路板 -> 电磁矩阵（`electromagnetic_matrix` 配方无需研究，`assembling_machine_mk1` / `matrix_lab` / `self_evolution_lab` 均可生产）。
- `battlefield_analysis_base` 本身不发电；如果不先补 `wind_turbine`，第一台空 `matrix_lab` 会停在无电状态。
- 研究系统仍然要求真实 `running` 研究站与真实矩阵消耗；`electromagnetism` 完成后解锁 `depot_mk1`，`basic_logistics_system` 解锁 `splitter` / `sorter_mk2` / `traffic_monitor`。旧的 `electromagnetic_matrix`、`improved_logistics` 两门科技已从树中移除（前者配方改为开局可用，后者的解锁下移给 `basic_logistics_system`）。
- 当前默认图上一组可直接复现的 starter 闭环是：`build 3 2 wind_turbine` -> `build 4 2 tesla_tower` -> `build 5 1 mining_machine`；矩阵产线投产后 `build 2 3 matrix_lab` -> `transfer <matrix_lab_id> electromagnetic_matrix 10` -> `start_research electromagnetism`。
- minerals 持续收入规则：采集建筑从资源点**实际挖出**的数量 × `CollectModule.MineralsKickback` 折算 minerals 直充玩家矿物池（与本地存储是否接得下无关）；当前 `mining_machine = 1.0`、`advanced_mining_machine = 0.5`，`water_pump` / `oil_extractor` 等流体采集建筑为 0（不产矿）。因此 starter 闭环里的矿机一旦开跑，每挖出 1 单位矿就 +1 minerals（满功率 8/tick）；本地 `Storage` 只缓冲物流/配方用物品，堆满时多余矿石不再入库但仍继续 kickback，矿脉会照常消耗。物品产出统计只记实际入库量；minerals 折算与物品产出共用同一份 `ProductionSettlementSnapshot` 事实源，在 `production_stats.by_item["minerals"]` 中可见。
- 出生点 starter 矿种：`seedPlayerOutposts` 会在每个最终基地 `spawnMineDistance`（默认 `operate_range-2`，config-dev 为 4）内保证存在 `iron_ore` 与 `copper_ore` 有限矿脉（缺失则注入 `Total=2000 / BaseYield=8`）。矩阵科研链（铁→磁铁/磁线圈，铜→电路板）不依赖 mapgen 运气。

**官方中后期场景**
- 服务端现在提供一套官方 midgame 场景：`config-midgame.yaml + map-midgame.yaml`
- 启动命令：
```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-midgame.yaml -map-config map-midgame.yaml
```
- `battlefield.initial_active_planet_id` 可指定新开局默认进入哪颗行星；若为空，仍使用地图主行星；续档时不覆盖存档中的 active planet。当前官方场景固定为 `planet-1-2`。
- `players[].bootstrap` 可为官方场景预置 `minerals` / `energy` / `inventory[]` / `completed_techs[]`。当前官方场景会给每名玩家预置：
  - `minerals = 5000`
  - `energy = 3000`
  - `inventory`: `frame_material x16`、`deuterium_fuel_rod x16`、`quantum_chip x16`、`solar_sail x16`、`small_carrier_rocket x4`
  - `completed_techs`: `electromagnetism`、`basic_logistics_system`、`automatic_metallurgy`、`basic_assembling_processes`、`high_strength_crystal`、`titanium_alloy`、`lightweight_structure`、`dyson_component`、`interstellar_logistics`、`interstellar_power`、`signal_tower`、`plasma_turret`、`gas_giants`、`gravity_matrix`、`planetary_shield`、`self_evolution`、`quantum_chip`、`solar_sail_orbit`、`ray_receiver`、`vertical_launching`、`integrated_logistics`、`photon_mining`、`annihilation`
- `scenario_bootstrap` 会在 authoritative runtime 初始化阶段补真实场景锚点，而不是只改文档口径。当前官方 midgame 场景会额外预置：
  - `scenario_bootstrap.planets[]`：在 `planet-1-2` 上直接落一组可运行的 `tesla_tower`、`wind_turbine`、`ray_receiver(power)`、`em_rail_ejector`、`vertical_launching_silo`
  - `scenario_bootstrap.systems[]`：在 `sys-1` 上直接补最小戴森层节点、壳面与 `solar_sail_orbit`
- `scenario_bootstrap.planets[]` 里的建筑不是 query 层伪造出来的展示数据。当前实现会先初始化目标 world，再通过与正常建造同源的 `completeConstructionTask()` 落建筑，随后才按配置回填 `state` / `ray_receiver_mode` / 建筑本地 `inventory`
- 启动阶段会至少初始化地图主行星、`battlefield.initial_active_planet_id` 与 `scenario_bootstrap.planets[].planet_id` 涉及到的 world，然后按正常 `seedPlayerOutposts()` 铺基地/执行体并执行 `applyScenarioBootstrap()`；因此官方 midgame fresh 启动后就能在 `planet-1-1` 与 `planet-1-2` 间切换，同时直接观察 `planet-1-2` 的戴森验证锚点
- 这批锚点会直接进入运行态，所以 `GET /state/summary.active_planet_id`、`GET /world/systems/{system_id}/runtime.active_planet_context`、`ray_receiver` 供能与发射建筑观察链路都会在 fresh midgame 启动后立即可验证
- 这里的 `completed_techs` 是官方验证场景的直接完成列表，不会递归自动补全自然科研前置；因此 midgame 可以只预置 `integrated_logistics`、`photon_mining`、`annihilation` 三个叶子科技，同时继续保留 `dirac_inversion` 未完成。
- 当前官方 midgame 场景故意**不**预置 `dirac_inversion` 与 `antimatter_fuel_rod`，以便继续同时验证 `set_ray_receiver_mode ... photon` 的科技门禁，以及 `artificial_star` 空燃料时的终局边界；但已经预置了 `signal_tower` / `plasma_turret` / `gravity_matrix` / `planetary_shield` / `self_evolution` / `integrated_logistics` / `photon_mining` / `annihilation`，可以直接通过通用 `build` 验证 `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab`、`advanced_mining_machine`、`pile_sorter`、`recomposing_assembler`、`artificial_star`。
- 当前官方 midgame 场景同样**不**直接预置 `prototype` / `precision_drone` / `corvette` / `destroyer`；这些单位线现在已经是公开 API 能力，但仍要求玩家自己走 `research -> queue_military_production -> /world/warfare/industry -> deploy_squad|commission_fleet` 这条最小闭环。
- `map` 配置新增 `overrides.planets.<planet_id>.kind`，可强制把某颗行星覆盖成 `gas_giant`、`rocky` 或 `ice`，不再依赖 seed 抽卡。当前 `map-midgame.yaml` 把 `planet-1-2` 强制设成 `gas_giant`，用于验证 `orbital_collector` 与戴森中后期路线。
- `map` 配置新增 `spawn_points: [{x, y}, ...]`，可显式钉住玩家在主行星的出生点；未配置时出生点自动散布且距地图边缘至少 8 格，并会就近挪到矿脉旁边。无论哪种方式，出生点周围半径 8 格都会被平整为可建地形（资源点保留）。官方 `map-midgame.yaml` / `map-war.yaml` 已显式钉住 `(3,3)` 与 `(44,44)`，与场景预置建筑群布局保持一致。

**官方战争验证场景**
- 服务端当前提供一套 authoritative 官方战争验证局：`config-war.yaml + map-war.yaml`
- 启动命令：
```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-war.yaml -map-config map-war.yaml
```
- 默认玩家仍是：
  - `p1 / key_player_1`
  - `p2 / key_player_2`
- 当前 fresh war scene 会把 `battlefield.initial_active_planet_id` 固定到 `planet-1-1`，因此 `GET /state/summary.active_planet_id` 在新局下应直接返回 `planet-1-1`
- `players[].bootstrap.completed_techs` 会直接为 `p1` / `p2` 预置：
  - `battlefield_analysis`
  - `prototype`
  - `precision_drone`
  - `corvette`
  - `destroyer`
  - 以及战争链路依赖的 `electromagnetism`、`basic_logistics_system`、`automatic_metallurgy`、`basic_assembling_processes`、`interstellar_logistics`、`integrated_logistics`、`signal_tower`、`plasma_turret`、`planetary_shield`
- `scenario_bootstrap.planets[]` 会在 `planet-1-1` 直接落地真实战争锚点，而不是只做 query 层伪造：
  - 已通电的 `battlefield_analysis_base` 部署枢纽
  - 已通电的 `recomposing_assembler`
  - 已通电的 `planetary_logistics_station`
  - 已通电的 `interstellar_logistics_station`
  - 这些物流站会预置弹药、燃料、部件等军需库存
- `GET /world/warfare/industry` 在官方战争场景下应直接能看到：
  - `deployment_hubs[]`
  - `supply_nodes[]`
  - 且 `supply_nodes[].label` 至少能出现 `Orbital Supply Port`、`Planetary Logistics Station`、`Interstellar Logistics Station`
- `/catalog.warfare.public_blueprints` 与 `GET /world/warfare/blueprints/{blueprint_id}` 会暴露当前公开战争预置蓝图：
  - `prototype`
  - `precision_drone`
  - `corvette`
  - `destroyer`
- 这套场景的目标是让 API / CLI / Web / agent-gateway 可以直接验证战争闭环，而不是要求玩家先从普通新局自然推进到军工底座
- 当前边界也要写清：
  - 官方战争场景会预置科技、军工锚点和军需节点，但**不会**预先替玩家创建舰队、任务群或战区
  - 公开太空/地面单位仍然要走 `blueprint_* -> queue_military_production -> /world/warfare/industry.ready_payloads -> deploy_squad|commission_fleet`
  - `blockade_planet` / `landing_start` 的同步 `accepted` 响应只表示命令已入队，最终状态仍要以后续 `/world/systems/{system_id}/runtime.planet_blockades[]`、`landing_operations[]` 或 `command_result` / 事件流对账

**GET /health**
- 说明: 健康检查（无需认证）
- 响应:
```json
{
  "status": "ok",
  "tick": 123
}
```

**GET /metrics**
- 说明: 运行指标（无需认证）
- 响应字段:
  - `tick_count`：累计 Tick 数
  - `last_tick_dur_ms`：最近一次 Tick 耗时（毫秒）
  - `commands_total`：累计执行命令数
  - `sse_connections`：当前 SSE 连接数
  - `queue_backlog`：当前命令队列积压数
  - `dropped_events`：EventBus 因消费者过慢而丢弃的事件累计数
  - `tick_p95_ms` / `tick_p99_ms`：最近滚动窗口 Tick 耗时分位数
- 响应:
```json
{
  "tick_count": 123,
  "last_tick_dur_ms": 8,
  "commands_total": 42,
  "sse_connections": 1,
  "queue_backlog": 0,
  "dropped_events": 3,
  "tick_p95_ms": 9.0,
  "tick_p99_ms": 12.0
}
```

**GET /audit**
- 说明: 审计日志查询（需认证），默认只返回当前玩家数据
- 查询参数:
  - `player_id`：过滤玩家（为空则默认当前玩家）
  - `issuer_type` / `issuer_id`：过滤命令来源
  - `action`：审计动作（当前包括 `command`、`victory`）
  - `request_id`：过滤请求 ID
  - `permission`：过滤命令类型（如 `build`/`move`）
  - `permission_granted`：过滤权限校验结果（`true`/`false`）
  - `from_tick` / `to_tick`：按 Tick 范围过滤
  - `from_time` / `to_time`：按时间过滤（RFC3339）
  - `limit`：返回条数上限（默认不限制）
  - `order`：排序方式（`asc`/`desc`，默认 `asc`）
- 响应字段:
  - `entries`：审计记录数组
  - `count`：返回条数
- 审计记录字段:
  - `timestamp` / `tick` / `player_id` / `role`
  - `issuer_type` / `issuer_id` / `request_id`
  - `action` / `permission` / `permission_granted` / `permissions`
  - `details`：当 `action=command` 时包含命令细节（`command`、`status`、`code`、`message`、`stage`、`enqueue_tick` 等）
  - `details`：当 `action=victory` 时包含 `winner_id` / `reason` / `victory_rule`；若由 `mission_complete` 触发，还会带 `tech_id`
- 响应示例:
```json
{
  "count": 1,
  "entries": [
    {
      "timestamp": "2026-03-19T03:40:00Z",
      "tick": 120,
      "player_id": "p1",
      "role": "commander",
      "issuer_type": "player",
      "issuer_id": "p1",
      "request_id": "req-001",
      "action": "command",
      "permission": "build",
      "permission_granted": true,
      "permissions": ["*"],
      "details": {
        "command_index": 0,
        "command": {
          "type": "build",
          "target": {"position": {"x": 10, "y": 12}},
          "payload": {"building_type": "mining_machine"}
        },
        "status": "executed",
        "code": "OK",
        "message": "construction task c-1 queued at (10,12)",
        "stage": "execute",
        "enqueue_tick": 118
      }
    }
  ]
}
```

---

**GET /state/summary**
- 说明: 世界摘要（需认证）
- 响应字段: `tick` 当前 tick；`players` 玩家可见状态（仅自己返回完整 `PlayerState`）；`winner` 已决出胜者时存在；`victory_reason` / `victory_rule` 在已宣告胜利时返回；`active_planet_id` 当前被模拟的行星；`map_width` / `map_height` 当前行星六面图集尺寸；`surface` 返回 `topology=cube_sphere` 与 `face_size`
- 胜负补充: 在仓库当前默认配置下，`victory_rule` 为 `hybrid`，因此 `winner` / `victory_reason` 可能来自 `mission_complete -> game_win`，也可能来自基地消灭胜
- 能源补充: 当 `ray_receiver` 切到 `power` / `hybrid` 且已有太阳帆或戴森结构产能时，`summary.players[pid].resources.energy` 会跟随真实 tick 同步上涨，而不是只在查询层单独造数
- 事实源补充: `GET /state/summary.players[pid].resources.energy`、`GET /state/stats.energy_stats`、`GET /world/planets/{planet_id}/networks` 当前共享同一份当 tick authoritative `PowerSettlementSnapshot`；`ray_receiver` 会先写入 `ws.PowerInputs` 与接收站结算视图，再由统一的 power finalize 阶段一次性回写最终资源与电网结果
- `players` 字段补充:
  - 所有玩家均返回 `player_id` / `team_id` / `role` / `is_alive`
  - 仅自身玩家返回完整状态，常用字段包括 `resources` / `inventory` / `permissions` / `executor` / `executors` / `tech` / `combat_tech` / `stats`
  - `inventory` 物品库存，键为 `item_id`，值为数量
  - `executor` 字段说明:
    - `unit_id` 执行体单位 ID
    - `build_efficiency` 建造效率（数值参数）
    - `operate_range` 操作范围
    - `concurrent_tasks` 并发任务上限（建造/升级/拆除等执行体任务）
    - `research_boost` 研究辅助加成（数值参数）
    - 当前 Web 建造靠近流程使用 `executor.unit_id` 请求对应行星的 `/path`，将 `operate_range` 作为 `stop_range`，按服务端返回的 `waypoints` 分段移动；不再使用图集 x/y 的曼哈顿距离预检或拆路。每段移动与最终建造仍由服务端执行阶段校验
  - `executors`：按 `planet_id` 组织的执行体映射；字段结构与 `executor` 相同。`executor` 仍保留为当前 active planet 上下文的兼容镜像
  - `tech` 字段说明:
    - `player_id` / `completed_techs` / `current_research` / `research_queue` / `total_researched`
    - `completed_techs` 当前对外仍是 `{tech_id: level}` 的 level map；Web 研究派生层会在本地把它归一化成“已完成科技 ID 列表”，但接口本身尚未切到扁平 `string[]`
    - `current_research` / `research_queue` 元素字段：`tech_id` / `state` / `progress` / `total_cost` / `current_level` / `required_cost` / `consumed_cost` / `blocked_reason` / `speed_multiplier` / `estimated_ticks_remaining` / `enqueue_tick` / `complete_tick`
    - `progress` / `total_cost` 现在对应真实矩阵消耗进度；`required_cost` / `consumed_cost` 中的矩阵物品统一使用 canonical ID：`electromagnetic_matrix`、`energy_matrix`、`structure_matrix`、`information_matrix`、`gravity_matrix`、`universe_matrix`
    - `blocked_reason` 当前常见值为 `waiting_lab` / `waiting_matrix` / `low_power` / `invalid_tech`；`low_power` 表示研究站供电不足（研究站未通电停滞，或运行中但电力配比 < 1 导致降速）
    - `speed_multiplier`：当前研究速度供电倍率（按各研究站电力配比的加权值，1 = 满速；无运行中研究站时为 0）；`estimated_ticks_remaining`：按当前有效速度预估的剩余 tick，研究停滞时为 0 并省略
    - 当前 `client-web` 的阶段化研究工作台主要依赖 `completed_techs`、`current_research.tech_id`、`progress`、`total_cost`、`required_cost`、`blocked_reason` 来派生“当前可研究 / 已完成 / 尚未满足前置”分组，以及“缺研究站 / 缺矩阵 / 供电不足”提示
  - `combat_tech` 字段说明:
    - `player_id` / `unlocked_techs` / `current_research` / `research_progress`
    - `unlocked_techs` / `current_research` 中的科技对象字段：`id` / `name` / `type` / `level` / `max_level` / `research_cost` / `effects`
  - `stats` 字段结构与 `GET /state/stats` 一致
- 响应示例:
```json
{
  "tick": 120,
  "winner": "p1",
  "victory_reason": "game_win",
  "victory_rule": "hybrid",
  "players": {
    "p1": {
      "player_id": "p1",
      "team_id": "team-1",
      "role": "commander",
      "resources": {
        "minerals": 200,
        "energy": 100
      },
      "inventory": {
        "iron_ingot": 20,
        "circuit_board": 5
      },
      "permissions": [
        "*"
      ],
      "executor": {
        "unit_id": "u-1",
        "build_efficiency": 1,
        "operate_range": 6,
        "concurrent_tasks": 2,
        "research_boost": 0
      },
      "is_alive": true
    },
    "p2": {
      "player_id": "p2",
      "team_id": "team-2",
      "role": "commander",
      "is_alive": true
    }
  },
  "active_planet_id": "planet-1-1",
  "map_width": 96,
  "map_height": 64,
  "surface": {
    "topology": "cube_sphere",
    "face_size": 32
  }
}
```

---

**GET /state/agent-briefing**
- 说明: 代理/GUI 一站式态势快照（需认证）。把 `summary` + `stats` 能源/战斗摘要 + 可见舰队/任务群/战区/敌情 + 最近产线告警 + 当前权限下的可用命令目录压成一次查询，避免 agent 多轮试探。
- 查询参数:
  - `alert_limit`（可选，正整数）：`recent_alerts` 保留的最近条数；默认 `20`；超过 `server.alert_history_limit` 时按上限截断
- 响应字段:
  - `tick` / `active_planet_id` / `map_width` / `map_height` / `surface`
  - `winner` / `victory_reason` / `victory_rule`：已宣告胜利时返回（与 `/state/summary` 同源）
  - `self`：调用方玩家紧凑视图
    - `player_id` / `team_id` / `role` / `is_alive`
    - `resources` / `inventory`：仅自身
    - `tech`：`completed_count` / `completed_techs`（有序列表）/ `current_research` / `research_queue_len` / `total_researched`；**不**回传完整科技树
  - `energy_stats` / `combat_stats`：与 `/state/stats` 对应子对象同源
  - `recent_alerts`：按玩家过滤后的最近产线告警（结构同 `/alerts/production/snapshot.alerts`）
  - `fleets`：己方舰队紧凑卡 `fleet_id` / `system_id` / `formation` / `state` / `unit_count` / `target` / `in_transit` / `transit_to`
  - `task_forces` / `theaters`：与 `/world/warfare/task-forces`、`/world/warfare/theaters` 列表同源（权限过滤后）
  - `enemy_forces`：传感器已确认敌情（结构同行星 runtime 敌情卡）
  - `available_commands`：`string[]`，按玩家 `permissions`（含 `*`）过滤后的全部公开 `CommandType`
- 作用域补充:
  - 仅暴露调用方可见/可操作信息；敌方 inventory/tech 不会泄漏
  - 舰队/任务群/战区复用既有 query 投影，不另起事实源
- 响应示例:
```json
{
  "tick": 120,
  "active_planet_id": "planet-1-1",
  "map_width": 96,
  "map_height": 64,
  "self": {
    "player_id": "p1",
    "team_id": "team-1",
    "role": "commander",
    "is_alive": true,
    "resources": {
      "minerals": 240,
      "energy": 80
    },
    "inventory": {
      "iron_ore": 12
    },
    "tech": {
      "completed_count": 2,
      "completed_techs": [
        "dyson_sphere_program",
        "electromagnetism"
      ],
      "current_research": {
        "tech_id": "basic_logistics",
        "state": "in_progress",
        "progress": 3,
        "total_cost": 10
      },
      "research_queue_len": 1,
      "total_researched": 99
    }
  },
  "energy_stats": {
    "generation": 120,
    "consumption": 40,
    "storage": 0,
    "current_stored": 0,
    "shortage_ticks": 0
  },
  "combat_stats": {
    "units_lost": 0,
    "enemies_killed": 4,
    "threat_level": 0,
    "highest_threat": 0
  },
  "recent_alerts": [],
  "fleets": [
    {
      "fleet_id": "fleet-alpha",
      "system_id": "sys-1",
      "formation": "wedge",
      "state": "idle",
      "unit_count": 3,
      "in_transit": true,
      "transit_to": "sys-2"
    }
  ],
  "task_forces": [],
  "theaters": [],
  "enemy_forces": [],
  "available_commands": [
    "build",
    "move",
    "attack",
    "produce"
  ],
  "surface": {
    "topology": "cube_sphere",
    "face_size": 32
  }
}
```

---

**GET /state/stats**
- 说明: 当前认证玩家统计（需认证）
- 响应字段:
  - `player_id` / `tick`
  - `production_stats`：`total_output` / `by_building_type` / `by_item` / `efficiency`
  - `energy_stats`：`generation` / `consumption` / `storage` / `current_stored` / `shortage_ticks`
  - `logistics_stats`：`throughput` / `avg_distance` / `avg_travel_time` / `deliveries`
  - `combat_stats`：`units_lost` / `enemies_killed` / `threat_level` / `highest_threat`
- 生产统计口径补充:
  - `total_output` / `by_building_type` / `by_item` 现在都只统计当前 active world、当前 tick 内真实落库 / 落站的 authoritative 产出数量，不再把建筑静态 `throughput` 当作产出
  - 统计来源统一走同一份 `ProductionSettlementSnapshot`，当前覆盖：
    - 配方建筑写入 `Storage` 的主产物与副产物
    - `Collect` 建筑写入自身 `Storage` 的真实采集产出
    - `Collect` 建筑直接写入 `player.resources.minerals` 的真实采集产出
    - `orbital_collector` 写入 `logistics_station.inventory` 的真实轨采产出
  - `by_building_type` 与 `by_item` 使用同一份真实事实源；`by_item["minerals"]` 是“直充矿物池产出”的统计标签，不是可搬运物品
  - 若本 tick 没有任何真实产出，这三组字段都会回到 `0 / {} / {}`
  - `efficiency` 仍是 `ProductionMonitor` 的采样均值，和真实落库数量分开统计
- 能源统计口径补充:
  - `generation` 现在按当前 active planet 上玩家所属 power network 的真实 `supply` 聚合，已包含 `ray_receiver power/hybrid` 的实际回灌和储能放电结果
  - `consumption` 使用 power network 的真实 `demand`（建筑耗电需求；无电时仍 >0，避免 0/0 伪装供电稳定）
  - `current_stored` 读取各储能建筑的 `energy_storage.energy`，不再复用建筑 HP
  - `shortage_ticks` 在本 tick 任一玩家网络 `shortage=true`，或 `consumption > generation`（孤立耗电节点等）时累加
  - 这些字段与 `/world/planets/{planet_id}/networks.power_networks` / `power_coverage` 共同来自同一份 `PowerSettlementSnapshot`，不会再出现“中途事件里短暂加电、最终 summary/stats/networks 又回退”的分叉
- 作用域补充:
  - `production_stats` / `energy_stats` 当前都只统计 active planet 对应 world 的 authoritative 快照，不会跨所有已加载行星做总汇总
- 补充说明: 若玩家不存在或统计尚未初始化，仍会返回带 `player_id` / `tick` 的零值结构
- 响应示例:
```json
{
  "player_id": "p1",
  "tick": 120,
  "production_stats": {
    "total_output": 42,
    "by_building_type": {"arc_smelter": 20},
    "by_item": {"iron_ingot": 20, "gear": 22},
    "efficiency": 0.85
  },
  "energy_stats": {
    "generation": 180,
    "consumption": 140,
    "storage": 500,
    "current_stored": 260,
    "shortage_ticks": 0
  },
  "logistics_stats": {
    "throughput": 36,
    "avg_distance": 4.5,
    "avg_travel_time": 2.2,
    "deliveries": 18
  },
  "combat_stats": {
    "units_lost": 1,
    "enemies_killed": 6,
    "threat_level": 2,
    "highest_threat": 3
  }
}
```

---

**GET /world/galaxy**
- 说明: 星系列表（需认证）
- 响应字段: `galaxy_id` / `name` / `width` / `height`；`discovered` 是否已发现；`distance_matrix` 星系间距离矩阵（未发现系统对应行列为 `-1`，行列顺序与 `systems` 一致）；`systems` 系统列表（未发现时 name 为空）
- `systems` 字段补充:
  - `position` 星系坐标（`x`/`y`）
  - `star` 恒星参数（`type`/`mass_solar`/`radius_solar`/`luminosity_solar`/`temperature_k`）
- 响应示例:
```json
{
  "galaxy_id": "galaxy-1",
  "name": "Galaxy-1",
  "discovered": true,
  "width": 1000,
  "height": 1000,
  "distance_matrix": [
    [0, 312.4],
    [312.4, 0]
  ],
  "systems": [
    {
      "system_id":"sys-1",
      "name":"System-1",
      "discovered":true,
      "position":{"x":120.5,"y":450.2},
      "star":{"type":"G","mass_solar":1.0,"radius_solar":1.0,"luminosity_solar":1.0,"temperature_k":5800}
    },
    {"system_id":"sys-2","name":"System-2","discovered":false}
  ]
}
```

**GET /world/systems/{system_id}**
- 说明: 恒星系详情（需认证）
- 响应字段: `system_id` / `name` / `position` / `star`；`discovered`；`planets` 行星列表（未发现时为空）
- `planets` 字段补充:
  - `kind` 行星类型（`rocky`/`gas_giant`/`ice`）
  - `orbit` 轨道参数（`distance_au`/`period_days`/`inclination_deg`）
  - `moon_count` 卫星数量
- 响应示例:
```json
{
  "system_id": "sys-1",
  "name": "System-1",
  "discovered": true,
  "position": {"x":120.5,"y":450.2},
  "star": {"type":"G","mass_solar":1.0,"radius_solar":1.0,"luminosity_solar":1.0,"temperature_k":5800},
  "planets": [
    {"planet_id":"planet-1-1","name":"Planet-1-1","discovered":true,"kind":"rocky","orbit":{"distance_au":1.0,"period_days":365,"inclination_deg":1.2},"moon_count":1},
    {"planet_id":"planet-1-2","name":"","discovered":false}
  ]
}
```

**GET /world/systems/{system_id}/runtime**
- 说明: 恒星系 authoritative runtime 视图（需认证）
- 说明补充:
  - 未发现系统时仅返回 `system_id` + `discovered=false`
  - 已发现但当前玩家在该系统还没有 `space runtime` 载体时返回 `available=false`；如果当前 `active_planet_id` 正好属于该 system，仍可能同时带回 `active_planet_context`，因为它来自当前 active world 的聚合视图，而不是 `space runtime`
  - 当前会公开六类 system-scoped runtime：
    - `solar_sail_orbit`
    - `dyson_sphere`
    - `orbital_superiority`
    - `planet_blockades`
    - `landing_operations`
    - `active_planet_context`
    - `fleets`
    - `contacts`
    - `battle_reports`
  - `active_planet_context` 只在当前 `active_planet_id` 属于该 system，且该 active world 已加载时返回；它不会跨其他行星做扫描补数
  - `active_planet_context` 只是当前 active world 上玩家自有 `em_rail_ejector` / `vertical_launching_silo` / `ray_receiver` 的聚合计数，本身不等于该 system 已经存在 `space runtime`；不过当前官方 midgame 会同时用 `scenario_bootstrap` 预置行星锚点和 system runtime 锚点，所以 fresh 启动后通常会直接看到非零计数与 `available=true`
  - `fleets` 由 `commission_fleet` 写入 top-level `SpaceRuntimeState`；当前只会返回当前玩家自己在该 `system_id` 下的舰队
- 响应字段:
  - `system_id` / `discovered` / `available`
  - `solar_sail_orbit`：包含 `player_id` / `system_id` / `sails` / `total_energy`
  - `solar_sail_orbit.sails[]`：包含 `id` / `orbit_radius` / `inclination` / `launch_tick` / `lifetime_ticks` / `energy_per_tick`
  - `dyson_sphere`：包含 `player_id` / `system_id` / `layers` / `total_energy`
  - `dyson_sphere.layers[]`：包含 `layer_index` / `orbit_radius` / `energy_output` / `rocket_launches` / `construction_bonus` / `nodes` / `frames` / `shells`
  - `dyson_sphere.layers[].nodes[]`：包含 `id` / `layer_index` / `latitude` / `longitude` / `energy_output` / `integrity` / `built`
  - `dyson_sphere.layers[].frames[]`：包含 `id` / `layer_index` / `node_a_id` / `node_b_id` / `integrity` / `built`
  - `dyson_sphere.layers[].shells[]`：包含 `id` / `layer_index` / `latitude_min` / `latitude_max` / `coverage` / `energy_output` / `integrity` / `built`
  - `dyson_sphere.layers[].construction_bonus` 当前按 `min(0.5, rocket_launches * 0.02)` 结算；若该层已有壳面，`launch_rocket` 还会按顺序把第一个 `coverage < 1.0` 的壳面额外推进 `0.02` 覆盖率，并重算该壳面的 `energy_output`
  - `orbital_superiority`：系统级制轨态，字段为 `system_id` / `advantage_player_id` / `contest_intensity` / `last_reason` / `updated_tick`
  - `orbital_superiority.last_reason`：当前 authoritative 只会返回 `no_fleet_presence` / `orbit_contested` / `fleet_presence_margin`
  - `planet_blockades[]`：行星级轨道封锁态，字段为 `planet_id` / `system_id` / `owner_id` / `task_force_id` / `status` / `intensity` / `interdicted_supply` / `interdicted_transports` / `interdicted_landings` / `last_reason` / `updated_tick`
  - `planet_blockades[].status`：当前固定为 `planned` / `active` / `contested` / `broken`
  - `planet_blockades[].last_reason`：当前 authoritative 只会返回 `awaiting_orbital_superiority` / `orbital_superiority_held` / `orbit_contested` / `lost_orbital_superiority` / `task_force_unavailable` / 各类 `*_interdicted`
  - `landing_operations[]`：登陆投送流程，字段为 `id` / `owner_id` / `task_force_id` / `system_id` / `planet_id` / `stage` / `result` / `blocked_reason` / `transport_capacity` / `initial_supply` / `landing_zone_safety` / `bridgehead_id` / `started_tick` / `updated_tick` / `completed_tick`
  - `landing_operations[].stage`：当前固定为 `reconnaissance` / `landing_window_open` / `vanguard_landing` / `beachhead_established` / `failed`
  - `landing_operations[].result`：当前固定为 `pending` / `success` / `failed`
  - `landing_operations[].blocked_reason`：失败时当前只会返回 `insufficient_orbital_superiority` / `insufficient_initial_supply` / `landing_zone_unsafe` / `task_force_unavailable`
  - `landing_operations[].initial_supply`：登陆发起方任务群在流程推进时快照到的六类初始军需，字段固定为 `ammo` / `missiles` / `fuel` / `spare_parts` / `shield_cells` / `repair_drones`
  - `landing_operations[].bridgehead_id`：若登陆成功，可直接关联到 `/world/planets/{planet_id}/runtime.bridgeheads[].id`
  - `active_planet_context`：包含 `planet_id` / `em_rail_ejector_count` / `vertical_launching_silo_count` / `ray_receiver_count` / `ray_receiver_modes`
  - `active_planet_context.ray_receiver_modes`：键为 `power` / `photon` / `hybrid`，值为当前 active planet 上该模式的射线接收站数量
  - `fleets`：包含 `fleet_id` / `owner_id` / `system_id` / `source_building_id` / `formation` / `state` / `units` / `weapons` / `sustainment` / `armor` / `structure` / `subsystems` / `target` / `transit` / `last_battle_report_id`
  - `fleets[].weapons`：太空战火力画像，字段为 `direct_fire` / `missile` / `point_defense` / `electronic_warfare`
  - `fleets[].sustainment`：舰队 authoritative 补给态，包含 `current` / `capacity` / `condition` / `cohesion` / `damage_penalty` / `shield_penalty` / `mobility_penalty` / `repair_blocked` / `retreat_recommended` / `shortages` / `sources` / `last_resupply_tick` / `last_consumption_tick` / `repair`
  - `fleets[].sustainment.current` / `capacity`：六类军需库存，字段固定为 `ammo` / `missiles` / `fuel` / `spare_parts` / `shield_cells` / `repair_drones`
  - `fleets[].sustainment.sources[]`：最近一次补给来源，字段为 `source_id` / `source_type` / `label` / `planet_id` / `system_id` / `building_id` / `unit_id`
  - `fleets[].sustainment.sources[].source_type`：当前 authoritative 只会返回 `planetary_logistics_station` / `interstellar_logistics_station` / `orbital_supply_port` / `supply_ship` / `frontline_supply_drop`
  - `fleets[].sustainment.repair`：维修态，字段为 `tier` / `active` / `blocked_reason` / `hp_per_tick` / `shield_per_tick` / `remaining_damage` / `remaining_shield` / `remaining_ticks` / `completed_this_tick`
  - `fleets[].sustainment.repair.tier`：当前只会返回 `field_repair` / `frontline_repair_station` / `overhaul`
  - `fleets[].armor` / `structure`：太空战分层耐久，字段为 `level` / `max_level`
  - `fleets[].subsystems`：关键子系统状态，包含 `engine` / `fire_control` / `sensors` / `point_defense`；每个子系统都带 `integrity` / `state` / `effect`
  - `fleets[].subsystems.*.state`：当前固定为 `operational` / `degraded` / `disabled`
  - `fleets[].target`：当前仅在舰队已收到 `fleet_attack` 后存在；字段为 `planet_id` + `target_id`，其中 `target_id` 当前应对应同一恒星系目标行星 `/world/planets/{planet_id}/runtime.enemy_forces[].id`
  - `fleets[].transit`：当前仅在舰队已收到 `fleet_move` 且尚未到达时存在；字段为 `from_system_id` / `target_system_id` / `total_ticks` / `remaining_ticks`；跃迁期间 `state` 保持 `idle`、`system_id` 保持出发星系（进度 = `1 - remaining_ticks/total_ticks`），跃迁中舰队不计入任何星系的轨道优势评分，且 `fleet_assign` / `fleet_attack` / `fleet_disband` / `commission_fleet`（增援同一 `fleet_id`）都会被拒绝
  - `fleets[].last_battle_report_id`：最近一份太空战战报 ID；若舰队尚未参与 battle report 生成则为空
  - `contacts`：恒星系情报接触列表，包含 `id` / `scope_type` / `scope_id` / `contact_kind` / `entity_id` / `entity_type` / `domain` / `planet_id` / `system_id` / `level` / `classification` / `confirmed_type` / `strength_estimate` / `threat_level` / `last_updated_tick` / `signal_strength` / `lock_quality` / `jamming_penalty` / `missile_drift_risk` / `false_contact` / `sources`
  - `contacts[].level`：当前固定为 `unknown_signal` / `classified_contact` / `confirmed_type` / `fully_resolved`
  - `contacts[].sources[]`：当前至少会返回 `vision` / `active_radar` / `passive_em` / `infrared` / `signal_tower` / `recon_unit` 中实际参与本次判定的来源；`source_id`/`source_kind` 可直接追到建筑或舰队
  - 当前 system contacts 会真实受到主动/被动传感器组合、同星系 anchor 距离和目标电子战强度影响；强 ECM 目标还可能生成 `false_contact=true` 的幽灵接触
  - `battle_reports`：该 system 下最近的太空战战报（当前按最新在前保留最多 12 条），字段为 `battle_id` / `tick` / `system_id` / `planet_id` / `fleet_id` / `owner_id` / `target_id` / `target_type` / `fleet_firepower` / `enemy_firepower` / `fleet_missile_salvo` / `enemy_missile_salvo` / `fleet_damage` / `target_strength_loss` / `subsystem_hits` / `retreat_triggered` / `target_destroyed` / `lock_quality` / `jamming_penalty`
  - `battle_reports[].fleet_missile_salvo` / `enemy_missile_salvo`：字段为 `fired` / `intercepted` / `penetrated` / `drifted` / `damage`
  - `battle_reports[].fleet_damage`：字段为 `shield` / `armor` / `structure` / `subsystem`
  - `battle_reports[].subsystem_hits[]`：字段为 `subsystem` / `state` / `effect`
- 响应示例:
```json
{
  "system_id": "sys-1",
  "discovered": true,
  "available": true,
  "orbital_superiority": {
    "system_id": "sys-1",
    "advantage_player_id": "p1",
    "contest_intensity": 0.22,
    "last_reason": "fleet_presence_margin",
    "updated_tick": 128
  },
  "planet_blockades": [
    {
      "planet_id": "planet-1-1",
      "system_id": "sys-1",
      "owner_id": "p1",
      "task_force_id": "tf-front",
      "status": "active",
      "intensity": 0.78,
      "interdicted_supply": 2,
      "interdicted_transports": 1,
      "interdicted_landings": 0,
      "last_reason": "orbital_superiority_held",
      "updated_tick": 128
    }
  ],
  "landing_operations": [
    {
      "id": "landing-3",
      "owner_id": "p1",
      "task_force_id": "tf-front",
      "system_id": "sys-1",
      "planet_id": "planet-1-1",
      "stage": "beachhead_established",
      "result": "success",
      "transport_capacity": 8,
      "initial_supply": {"ammo": 4, "fuel": 3, "spare_parts": 2},
      "landing_zone_safety": 0.8,
      "bridgehead_id": "bridgehead-1",
      "started_tick": 126,
      "updated_tick": 128,
      "completed_tick": 128
    }
  ],
  "dyson_sphere": {
    "player_id": "p1",
    "system_id": "sys-1",
    "layers": [
      {
        "layer_index": 0,
        "orbit_radius": 1.2,
        "energy_output": 360,
        "rocket_launches": 2,
        "construction_bonus": 0.04,
        "nodes": [{"id": "node-1", "energy_output": 10, "built": true}],
        "frames": [],
        "shells": [{"id": "shell-1", "coverage": 0.35, "energy_output": 350, "built": true}]
      }
    ],
    "total_energy": 360
  },
  "active_planet_context": {
    "planet_id": "planet-1-1",
    "em_rail_ejector_count": 2,
    "vertical_launching_silo_count": 1,
    "ray_receiver_count": 2,
    "ray_receiver_modes": {
      "power": 1,
      "photon": 1
    }
  },
  "fleets": [
    {
      "fleet_id": "fleet-demo",
      "owner_id": "p1",
      "system_id": "sys-1",
      "source_building_id": "b-1",
      "formation": "wedge",
      "state": "idle",
      "units": [{"blueprint_id": "corvette", "count": 1}]
    }
  ]
}
```

**GET /world/fleets**
- 说明: 当前玩家可见舰队列表（需认证）
- 说明补充:
  - 当前只返回当前玩家自己在 `space runtime` 中拥有的舰队
  - 返回字段与单舰详情一致，便于 CLI 直接列表示意
  - 当玩家当前没有任何舰队时，响应体固定返回空数组 `[]`，不会返回 `null`
- 响应字段:
  - `fleet_id` / `owner_id` / `system_id` / `source_building_id` / `formation` / `state` / `units` / `weapon` / `weapons` / `shield` / `sustainment` / `armor` / `structure` / `subsystems` / `target` / `last_attack_tick` / `last_battle_report`
  - `sustainment` 字段结构与 `GET /world/systems/{system_id}/runtime.fleets[].sustainment` 一致
  - `weapons` / `armor` / `structure` / `subsystems` 字段结构与 `GET /world/systems/{system_id}/runtime.fleets[]` 一致
  - `last_battle_report`：舰队最近一份太空战战报，字段结构与 `GET /world/systems/{system_id}/runtime.battle_reports[]` 一致；若还没有战报则省略

**GET /world/fleets/{fleet_id}**
- 说明: 单舰队 authoritative 详情（需认证）
- 响应字段:
  - `fleet_id` / `owner_id` / `system_id` / `source_building_id`
  - `formation` / `state`
  - `units`
  - `sustainment`
  - `target`
  - `weapon`
  - `shield`
  - `weapons`
  - `armor` / `structure`
  - `subsystems`
  - `last_attack_tick`
  - `last_battle_report`
  - `sustainment` 字段结构与 `GET /world/systems/{system_id}/runtime.fleets[].sustainment` 一致
  - `weapons` / `armor` / `structure` / `subsystems` / `last_battle_report` 字段结构与舰队列表和 `system runtime` 中对应字段一致
- 响应示例:
```json
{
  "fleet_id": "fleet-demo",
  "owner_id": "p1",
  "system_id": "sys-1",
  "source_building_id": "b-1",
  "formation": "wedge",
  "state": "idle",
  "units": [{"blueprint_id": "corvette", "count": 1}],
  "weapon": {"type": "laser", "damage": 40, "fire_rate": 10, "range": 24, "ammo_cost": 0},
  "shield": {"level": 40, "max_level": 40, "recharge_rate": 2, "recharge_delay": 10}
}
```

**GET /world/planets/{planet_id}**
- 说明: 行星概要（需认证）
- 说明补充:
  - 该接口只返回轻量摘要，不再返回整张 `terrain` / `fog` / `buildings` / `units`
  - 未发现行星返回 `planet_id`、`system_id`、`discovered=false` 与有效 `surface`；计数和图集尺寸字段为零，不返回名称/种类等发现内容
  - 服务端现在按 `{planet_id}` 直接读取对应行星 runtime，而不是借用当前 active planet 的世界状态
  - 只要目标行星 runtime 已加载，`tick` / `building_count` / `unit_count` 就来自该行星自身，并按当前玩家可见性统计
  - 若目标行星已发现但 runtime 尚未加载，`building_count` / `unit_count` 保持 `0`；`resource_count` 仍返回当前已知总资源点数
- 响应字段:
  - `planet_id` / `system_id` / `name` / `discovered` / `kind`
  - `map_width` / `map_height` / `surface`（六面拓扑与每面尺寸）
  - `tick`
  - `building_count` / `unit_count` / `resource_count`
- 响应示例（独立 N=32 小型测试星球，图集 96×64；不是默认 N=816 的地图）:
```json
{
  "planet_id": "planet-1-1",
  "system_id": "sys-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "map_width": 96,
  "map_height": 64,
  "tick": 120,
  "building_count": 84,
  "unit_count": 12,
  "resource_count": 463,
  "surface": {
    "topology": "cube_sphere",
    "face_size": 32
  }
}
```

**GET /world/planets/{planet_id}/overview**
- 说明: 行星全局总览读模型（需认证）
- 说明补充:
  - 用于整颗行星的全局缩放渲染，按固定步长对原始地图做下采样聚合
  - 该接口不返回逐 tile 级别建筑、单位、资源明细，而是返回聚合后的地形、迷雾和计数矩阵
  - 未发现行星只返回 `planet_id` / `discovered=false` / `map_width` / `map_height` / `surface` / `step` / `cells_width` / `cells_height`
  - 只要目标行星 runtime 已加载，就会返回该行星自己的当前迷雾与聚合计数，不要求它是 active planet
  - 若目标行星已发现但 runtime 尚未加载，当前会回退为静态地形骨架与空计数矩阵，不会混入别的行星运行态
  - `client-web` 行星观察页在“极小缩放看全局”场景应优先使用该接口，而不是把 `/scene` 压到亚像素渲染
- 查询参数:
  - `step`: 请求的每边下采样步长，一个 overview cell 覆盖 step×step 个原始地格。省略或非正数按 `100` 请求；服务端取不超过请求值和 face_size 的最大 face_size 约数，最小 `1`。默认 N=816 时实际 step=68；请求 16 时实际为 16，返回 153×102 格。客户端须使用响应的实际 step
- 响应字段:
  - `planet_id` / `system_id` / `name` / `discovered` / `kind` / `map_width` / `map_height` / `surface` / `tick`
  - `step`: 本次实际使用的下采样步长
  - `cells_width` / `cells_height`: 总览矩阵尺寸，等于 `3 * (face_size / step)` 与 `2 * (face_size / step)`；每个采样格完整位于一个面内
  - `terrain`: 聚合后的地形矩阵，每个 cell 取该范围内的主导地形
  - `visible` / `explored`: 聚合后的迷雾矩阵，只要该 cell 内任意 tile 可见或已探索，就记为 `true`
  - `resource_counts` / `building_counts` / `unit_counts`: 每个 cell 内资源点、可见建筑、可见单位数量
  - `building_count` / `unit_count` / `resource_count`: 当前整颗行星的可见建筑总数、可见单位总数、资源总数
- 响应示例（独立 N=32 小型测试星球，图集 96×64；不是默认 N=816 的地图）:
```json
{
  "planet_id": "planet-1-1",
  "system_id": "sys-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "map_width": 96,
  "map_height": 64,
  "tick": 4059,
  "step": 32,
  "cells_width": 3,
  "cells_height": 2,
  "terrain": [
    [
      "buildable",
      "water",
      "buildable"
    ],
    [
      "buildable",
      "lava",
      "buildable"
    ]
  ],
  "visible": [
    [
      true,
      false,
      false
    ],
    [
      false,
      true,
      false
    ]
  ],
  "explored": [
    [
      true,
      true,
      false
    ],
    [
      false,
      true,
      false
    ]
  ],
  "resource_counts": [
    [
      12,
      3,
      0
    ],
    [
      0,
      1,
      0
    ]
  ],
  "building_counts": [
    [
      2,
      0,
      0
    ],
    [
      0,
      1,
      0
    ]
  ],
  "unit_counts": [
    [
      1,
      0,
      0
    ],
    [
      0,
      0,
      0
    ]
  ],
  "building_count": 3,
  "unit_count": 1,
  "resource_count": 16,
  "surface": {
    "topology": "cube_sphere",
    "face_size": 32
  }
}
```

**GET /world/planets/{planet_id}/scene**
- 说明: 行星局部场景读模型（需认证）
- 说明补充:
  - 用于大地图视窗渲染，返回指定图集窗口内的地形、迷雾、实体；传入球面邻域参数时另返回跨面补片并合并实体
  - 未发现行星只返回 `planet_id` / `discovered=false` / `map_width` / `map_height` / `surface` / `bounds`
  - 只要目标行星 runtime 已加载，就会返回该行星窗口内的实时迷雾和实体，不要求它是 active planet
  - 若目标行星已发现但 runtime 尚未加载，当前仅返回静态 `terrain` / `environment` / `bounds`，不返回迷雾与实体明细
  - 当前服务端会对窗口做裁剪：`width` / `height` 默认 `160`，最大 `257`；超出地图边界时会自动回收至合法范围
- 查询参数:
  - `x` / `y`: 场景窗口左上角图集坐标
  - `width` / `height`: 图集窗口尺寸（默认 160，最大 257）
  - `near_x` / `near_y` / `radius`: 可选球面邻域中心及图距离半径；radius 为 0..128，非零时中心须为有效图集地格。非法中心或半径返回 400
- 响应字段:
  - `planet_id` / `system_id` / `name` / `discovered` / `kind` / `map_width` / `map_height` / `surface` / `tick`
  - `bounds`: 本次实际返回的主图集窗口范围，字段为 `x` / `y` / `width` / `height`
  - `surface_patches`: 可选跨面补片数组，每片独立返回 `bounds/terrain/visible/explored`。未探索地形为 `unknown`，补片资源仅在已探索格返回；实体合并到主响应并去重
  - `terrain`: 当前窗口内的地形切片
  - `visible` / `explored`: 当前窗口内的迷雾切片
  - `buildings` / `units` / `resources`: 当前窗口内可见实体
  - `buildings` 为 `model.Building` 直出：传送带类建筑（`conveyor_belt_*`）携带 `conveyor`（`input` / `output` / `max_stack` / `throughput`），其中 `conveyor.buffer` 为带内物品堆数组（`item_id` / `quantity`，队首 = 即将送出的一端，前端物流动画依赖该字段）；采集类建筑 `runtime.functions.collect.resource_kind` 为正在采集的资源种类（由服务端按脚下矿脉同步）
  - 四向分流器 `type=splitter` 携带 `splitter` 配置和统计，真实物品仍放在 `conveyor.buffer`；默认西侧输入、东/南/北侧输出。独立 Transport runtime 为 6 件/tick、缓存 24 件；运行时参加同一皮带结算，刚收到的物品不会在同 tick 再穿过下一节点。暂停时不收发，配置不会删除缓存物品。
  - `splitter.input_directions` / `output_directions` 是互斥且各非空的四方向数组；未列出的口关闭。`input_priority` / `output_priority` 可选且必须属于对应数组，`output_filters` 为可选的 `{输出方向: item_id}` 映射。设过滤的口只允许该物品，未设置过滤的出口可放行任意物品；过滤不改变缓存中的真实物品。
  - `splitter.input_cursor` / `output_cursor` 是对应方向数组中下一轮开始考察的零基索引，范围分别为 `[0, len(input_directions))` / `[0, len(output_directions))`。每次实际接收/输出后移到所用口下一索引；不配置优先口时按游标轮换，配置优先口时先尝试优先口、其余合格口再按游标考察。`transferred_items` 累计皮带结算中从该分流器实际送出的物品件数（仅输入不增加）；`last_transfer_tick` 是最近实际输出的 tick，尚未输出时为 0。配置成功将两个游标重置为 0，但保留累计件数、最近输出 tick 和缓存；快照深复制配置/过滤并保留统计与游标。
  - 通用生产 `production.progress_fraction` 为已完成的下一单位生产tick小数进度，范围 `[0,1)`；待完成标准工作量为 `remaining_ticks-progress_fraction`。每个游戏tick按当前真实分配电力比例推进，供电20/需求24时速度5/6，半电半速，零供电不推进、不启动新批次或释放挂起产物。小数随存档保存，切配方/完成批次清零，满仓不积攒下一批工作量；开批仍使用独立tick。此字段不是预计现实等待时间。
  - 分馏塔 `type=fractionator` 携带 `fractionation`，不使用普通 `storage` / `production`。`input_buffer` / `hydrogen_buffer` 为真实氢物品堆数组（`item_id`、`quantity`、可选 `spray: {level, remaining_uses}`）；`deuterium_buffer` 为待输出氘的件数。`buffer_capacity=24` 分别限制三种缓存，`throughput=6` 是每 tick 处理上限；`input_direction=west`、`hydrogen_direction=east`、`deuterium_direction=south` 当前固定。
  - `fractionation.state` 为 `idle|running|blocked` 或停机时的 `runtime.state`（例如 `no_power`、`paused`）；`attempts` 是累计实际分馏次数，`converted` 是累计转成氘的数量，`returned_hydrogen` 是累计失败返回氢的数量，始终满足 `attempts=converted+returned_hydrogen`。`last_process_tick` / `last_probability` / `last_spray_level` 记录最近一次实际尝试；尚未尝试时 tick/喷涂等级为 0、概率为 0.01。`rng_state` 为持久化非零 uint32 随机状态，只有实际尝试才推进；缓存、喷涂余量、统计和随机状态均随查询/快照深复制，存档恢复继续同一随机序列。
  - 喷涂机 `type=spray_coater` 携带 `spray_coater`：`input_buffer` / `output_buffer` 为保留喷涂元数据的真实货物堆数组，分别受 `buffer_capacity=24` 限制，`throughput=6`。固定 `input_direction=west`、`output_direction=east`、`reagent_direction=north`；普通 `storage` 仅存放增产剂，容量 48、3 个物品种类槽，货物不进入该存储。
  - `spray_coater.state` 为 `idle|running|blocked|no_proliferator` 或停机时的 `runtime.state`；`coated_items` / `consumed_proliferator` 分别累计实际喷涂货物数/消耗增产剂件数，`last_spray_tick` 记录最近实际喷涂。`spray_item_id` / `spray_units` / 可选 `spray_effect: {level, remaining_uses}` 保存已消耗那份增产剂的类型、尚可喷涂的单位数和对应效果；不能把 `spray_units` 当成增产剂物品数或货物剩余使用次数。上述状态也通过 inspect / 存档保留；包含分馏塔或喷涂机但缺失/损坏其专属状态的快照会被拒绝恢复。
  - 分拣器建筑携带 `sorter`：`input_directions` / `output_directions` / `speed` / `range` / `filter`。仅 `runtime.state = running` 时搬运，暂停、缺电时不搬运。当前分拣器连接同一玩家的传送带，按配置方向、范围、过滤器及目标容量搬运。
  - `sorter.last_transfer` 仅在发生实际搬运后出现：`tick` 为结算 tick，`sequence` 为该分拣器递增的搬运序号，`source_id` / `target_id` 为实际源/目标建筑 ID，`source_position` / `target_position` 为对应位置（`x` / `y` / `z`），`item_id` / `quantity` 为该次实际搬运物品及数量。同 tick 多次搬运时保留最后一次；空转或停机保留旧记录，客户端须结合 tick、sequence 和运行状态停止过期动画，不能将存在分拣器或 `running` 等同于正在搬货。该结构同时通过场景 buildings、inspect 和快照输出。
  - `resources[]` 中 `remaining=0`（或 `max_amount=0`）的资源点会携带 `depleted: true` 标记；枯竭资源点仍保留在输出中（前端可淡化显示），且不阻碍建造——任何建筑都可直接建在枯竭点上，`requires_resource_node` 的采集建筑建在枯竭点上则采不到资源
  - `building_count` / `unit_count` / `resource_count`: 当前整颗行星的可见实体总数或资源总数，便于前端补充概览信息
- 响应示例（独立 N=32 小型测试星球，图集 96×64；不是默认 N=816 的地图）:
```json
{
  "planet_id": "planet-1-1",
  "system_id": "sys-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "map_width": 96,
  "map_height": 64,
  "tick": 4059,
  "bounds": {
    "x": 0,
    "y": 0,
    "width": 2,
    "height": 2
  },
  "terrain": [
    [
      "buildable",
      "water"
    ],
    [
      "buildable",
      "lava"
    ]
  ],
  "visible": [
    [
      true,
      false
    ],
    [
      false,
      true
    ]
  ],
  "explored": [
    [
      true,
      true
    ],
    [
      false,
      true
    ]
  ],
  "buildings": {},
  "units": {},
  "resources": [],
  "building_count": 0,
  "unit_count": 0,
  "resource_count": 8416,
  "surface": {
    "topology": "cube_sphere",
    "face_size": 32
  }
}
```

**GET /world/planets/{planet_id}/inspect**
- 说明: 行星对象检视接口（需认证）
- 查询参数:
  - `entity_kind`: 必填，支持 `building` / `unit` / `resource` / `sector`
  - `entity_id` 或 `sector_id`: 至少提供一个；`sector` 场景通常传 `sector_id`
- 响应字段:
  - `planet_id` / `discovered`
  - `entity_kind` / `entity_id`
  - `title`
  - 与目标类型对应的 `building` / `unit` / `resource`
- 说明补充:
  - 建筑 / 单位 / 资源检视都会优先按 `{planet_id}` 对应的行星 runtime 解析，不再限定当前 active planet
  - 建筑 / 单位完整详情依赖目标行星 runtime 已加载；资源检视在 runtime 不可用时仍可回退到静态地图资源
  - 对建筑和单位，服务端会再次按可见性校验；不可见目标返回 `404`
  - `sector` 当前返回轻量标题信息，便于前端右侧详情栏稳定落点
  - 当建筑 `runtime.state = no_power` 时，`runtime.state_reason` 会按当前 tick 的真实覆盖/分配结果刷新；已接入电网但因 `shortage` 或分配结果为 `0` 而拿不到电时，原因统一写成 `under_power`，只有真实接线/覆盖失败时才会返回 `power_no_connector` / `power_no_provider` / `power_out_of_range` / `power_capacity_full`
  - `thermal_power_plant`、`mini_fusion_power_plant`、`artificial_star` 这三类燃料型发电建筑会额外暴露 `no_power/no_fuel`：当本 tick 在 `input_buffer + inventory` 中都找不到可达燃料时，不再显示为 `running`；装回燃料后的下一 tick 会恢复 `running`
  - 对燃料型发电建筑，`runtime.state` 表示“刚结算完的这个 tick 的真实结果”，不是下一 tick 预测值：如果最后一根燃料在当前 tick 被消耗完，但该 tick 已成功发电，那么 `inspect` / `scene` 仍会显示 `running`，同时 `GET /world/planets/{planet_id}/networks` 与 `GET /state/stats` 会继续反映这个 tick 的真实供电；只有下一 tick 没有新燃料时才回到 `no_power/no_fuel`
  - `ray_receiver` 的 `runtime.functions.ray_receiver.mode` 就是当前真实生效模式；切到 `power` 后只会停止新的 `critical_photon` 增量，不会清空建筑输出缓冲里已经存在的历史光子库存
  - 服务端内部 query 层已经维护 `ray_receiver` 的 `power` 结算视图，但当前公开 HTTP `inspect` 网关仍不会透传该子对象，也不会单独暴露 `available_dyson_energy` / `effective_input` / `power_output` / `photon_output` 这类逐 tick 电力结算字段；要验证 authoritative 回灌结果，请使用 `GET /state/summary`、`GET /state/stats` 与 `GET /world/planets/{planet_id}/networks`
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "entity_kind": "building",
  "entity_id": "assembler-1",
  "title": "assembling_machine_mk1",
  "building": {
    "id": "assembler-1",
    "type": "assembling_machine_mk1",
    "owner_id": "p1",
    "position": {"x": 100, "y": 170, "z": 0},
    "hp": 160,
    "max_hp": 160,
    "level": 2,
    "vision_range": 7
  }
}
```

**GET /world/planets/{planet_id}/runtime**
- 说明: 行星运行态只读视图（需认证）
- 说明补充:
  - 未发现行星只返回 `planet_id` + `discovered=false`
  - 已发现但目标行星 runtime 尚未加载时返回 `available=false`
  - 只要目标行星 runtime 已加载，就会返回 `available=true`，即使它不是当前 active 行星；`active_planet_id` 始终表示真正的当前操作焦点
  - `combat_squads` 与 `orbital_platforms` 现在来自持久化 `CombatRuntimeState`，会进入 save / replay / rollback
  - `combat_squads` 由 `deploy_squad` 写入；当前 payload 来源是部署枢纽的 authoritative `war_industry.deployment_hubs[].ready_payloads`，既可以是公开预置蓝图，也可以是玩家已定型蓝图
  - 当前 active 行星仍承载最完整的敌情/侦测结算；非 active 但已加载行星也可以看到该行星自己的 authoritative combat runtime
  - 行星侦察不再只有旧式“看见/没看见”；当前 runtime 会同时返回 `contacts`（完整接触对象）和 `detections`（为旧查询/渲染保留的摘要投影）
- 响应字段:
  - 通用字段：`planet_id` / `discovered` / `available` / `active_planet_id` / `tick` / `threat_level` / `last_attack_tick`
  - `combat_squads`：地面部署小队，包含 `id` / `owner_id` / `planet_id` / `source_building_id` / `blueprint_id` / `domain` / `base_frame_id` / `platform_class` / `count` / `hp` / `max_hp` / `shield` / `weapon` / `sustainment` / `state` / `target_enemy_id` / `last_attack_tick`
  - `combat_squads[].platform_class`：当前 authoritative 会按蓝图运行态归类为 `mech` / `vehicle` / `drone`
  - `combat_squads[].sustainment`：地面单位 authoritative 补给态，字段结构与 `GET /world/systems/{system_id}/runtime.fleets[].sustainment` 一致
  - `orbital_platforms`：轨道平台，包含 `id` / `owner_id` / `planet_id` / `orbit` / `hp` / `max_hp` / `weapon` / `ammo_capacity` / `ammo_count` / `last_fire_tick` / `is_active`
  - `bridgeheads`：滩头阵地运行态，包含 `id` / `operation_id` / `owner_id` / `planet_id` / `frontline_id` / `status` / `contested` / `expansion_level` / `fortification_level` / `established_tick` / `last_support_tick` / `transport_capacity`
  - `bridgeheads[].status`：当前固定为 `establishing` / `active` / `collapsed`
  - `frontlines`：行星层 authoritative 前线据点，包含 `id` / `planet_id` / `owner_id` / `type` / `bridgehead_id` / `position` / `status` / `control` / `fortification` / `obstacle_level` / `supply_flow` / `last_orbital_support_tick` / `updated_tick`
  - `frontlines[].type`：当前固定为 `bridgehead` / `outpost`
  - `frontlines[].status`：当前固定为 `secured` / `contested` / `destroyed`
  - `ground_task_forces`：行星层任务群推进运行态，包含 `task_force_id` / `owner_id` / `planet_id` / `frontline_id` / `bridgehead_id` / `ground_order` / `status` / `progress` / `pressure` / `orbital_support_mode` / `orbital_support_available` / `orbital_support_cooldown` / `orbital_support_blocked_reason` / `last_orbital_support_tick` / `updated_tick`
  - `ground_task_forces[].ground_order`：当前固定为 `occupy` / `advance` / `hold` / `clear_obstacles` / `escort_supply`
  - `ground_task_forces[].status`：当前固定为 `staging` / `contesting` / `securing` / `holding` / `clearing` / `supplying` / `blocked`
  - `ground_task_forces[].orbital_support_mode`：当前固定为 `none` / `fire_support` / `strike`
  - `ground_task_forces[].orbital_support_blocked_reason`：当前 authoritative 会返回 `no_orbital_superiority` / `planetary_defense_screen` / `frontline_not_found`
  - `logistics_stations`：物流站视图，包含 `building_id` / `building_type` / `owner_id` / `position` / `state` / `drone_ids` / `ship_ids`。`state.inventory` 是唯一站库，不另设 `building.storage`；新增 `slot_capacity` / `item_capacity` / `energy` / `energy_capacity` / `charge_per_tick` / `last_charge_tick` / `last_charge_amount` / `belt_ports`。槽位为本地与星际设置的物品并集，同一物品只占一个槽；容量按物品分别计算。
  - 运输器共同字段还包含 `trip_kind`（航次中为 `delivery|pickup`，空闲时为空字符串）、`pickup_item_id` / `pickup_quantity`（空载取货预约）、`home_pos`、`returning`、`state_reason`、`energy_cost`。无人机默认载量100/速度4，船默认载量200/速度2、曲速速度10；船另有 `current_planet_id` 表示实际所在星球。`station_id` 始终为归属站，`target_station_id` / `target_planet_id` 随去程与返航更新。
  - `logistics_drones`：物流无人机视图，包含 `id` / `owner_id` / `station_id` / `target_station_id` / `capacity` / `speed` / `status` / `position` / `target_pos` / `remaining_ticks` / `travel_ticks` / `cargo`
  - `logistics_ships`：物流货船视图，包含 `id` / `owner_id` / `station_id` / `origin_planet_id` / `target_planet_id` / `target_station_id` / `capacity` / `speed` / `warp_speed` / `warp_distance` / `energy_per_distance` / `warp_energy_multiplier` / `warp_item_id` / `warp_item_cost` / `warp_enabled` / `status` / `position` / `target_pos` / `remaining_ticks` / `travel_ticks` / `cargo` / `warped` / `energy_cost` / `warp_item_spent`
  - 当前物流船runtime列表按船的归属星球注册表返回；异星降落/等待时，目标星球查询尚不汇入其它星球归属的船，应查归属星球runtime并结合 `current_planet_id` 判断。当地3D画面暂不显示这类异星来船，库存交付仍由服务端真实结算。
  - `construction_tasks`：施工任务视图，包含 `id` / `player_id` / `region_id` / `building_type` / `position` / `rotation` / `blueprint_params` / `conveyor_direction` / `recipe_id` / `cost` / `state` / `enqueue_tick` / `start_tick` / `update_tick` / `queue_index` / `remaining_ticks` / `total_ticks` / `speed_bonus` / `priority` / `error` / `materials_deducted`
  - `contacts`：行星接触列表，字段与 system runtime 的 `contacts` 相同；当前 ground / beacon / hive 目标也会按同一套四级情报语义返回
  - `enemy_forces`：敌军视图，只包含当前至少达到 `confirmed_type` 的真实接触，字段仍为 `id` / `type` / `position` / `strength` / `target_player` / `spawn_tick` / `last_seen` / `threat_level`
  - `detections`：侦测摘要投影，包含 `player_id` / `vision_range` / `known_enemy_count` / `detected_positions`；它来自 `contacts` 聚合，不再是独立 authoritative 状态
- 用法补充:
  - `enemy_forces[].id` 也是当前 `fleet_attack` 与 combat squad 自动交战会消费的 target ID 真相来源
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "available": true,
  "active_planet_id": "planet-1-2",
  "tick": 120,
  "combat_squads": [
    {
      "id": "squad-1",
      "owner_id": "p1",
      "planet_id": "planet-1-1",
      "source_building_id": "b-1",
      "blueprint_id": "prototype",
      "count": 2,
      "hp": 160,
      "max_hp": 160,
      "state": "idle"
    }
  ],
  "logistics_stations": [
    {
      "building_id": "station-1",
      "building_type": "planetary_logistics_station",
      "owner_id": "p1",
      "position": {"x": 4, "y": 4},
      "drone_ids": ["drone-1"],
      "ship_ids": []
    }
  ],
  "logistics_drones": [
    {
      "id": "drone-1",
      "owner_id": "p1",
      "station_id": "station-1",
      "target_station_id": "station-1",
      "capacity": 100,
      "speed": 4,
      "status": "idle",
      "position": {"x": 4, "y": 4},
      "remaining_ticks": 0,
      "travel_ticks": 0,
      "cargo": {}
    }
  ],
  "construction_tasks": [
    {
      "id": "c-1",
      "player_id": "p1",
      "building_type": "arc_smelter",
      "position": {"x": 2, "y": 2},
      "cost": {"minerals": 12, "energy": 4},
      "state": "pending",
      "enqueue_tick": 118
    }
  ],
  "enemy_forces": [
    {
      "id": "enemy-force-1",
      "type": "swarm",
      "position": {"x": 10, "y": 10},
      "strength": 25,
      "target_player": "p1",
      "spawn_tick": 40
    }
  ],
  "contacts": [
    {
      "id": "enemy-force-1",
      "scope_type": "planet",
      "scope_id": "planet-1-1",
      "contact_kind": "enemy_force",
      "entity_id": "enemy-force-1",
      "entity_type": "enemy_force",
      "domain": "ground",
      "position": {"x": 10, "y": 10},
      "level": "confirmed_type",
      "classification": "ground_force",
      "confirmed_type": "swarm",
      "strength_estimate": 25,
      "last_updated_tick": 90,
      "signal_strength": 12,
      "lock_quality": 0.7,
      "sources": [
        {"source_type": "active_radar", "source_id": "radar-1", "source_kind": "building", "strength": 6}
      ]
    },
    {
      "id": "enemy-force-1-ghost",
      "scope_type": "planet",
      "scope_id": "planet-1-1",
      "contact_kind": "false_contact",
      "entity_type": "enemy_force",
      "level": "unknown_signal",
      "classification": "ghost_signature",
      "last_updated_tick": 90,
      "false_contact": true,
      "sources": [
        {"source_type": "signal_tower", "source_id": "tower-1", "source_kind": "building", "strength": 3}
      ]
    }
  ],
  "detections": [
    {
      "player_id": "p1",
      "vision_range": 12,
      "known_enemy_count": 1,
      "detected_positions": [{"x": 10, "y": 10}]
    }
  ],
  "threat_level": 2,
  "last_attack_tick": 88
}
```

**GET /world/planets/{planet_id}/networks**
- 说明: 行星网络读模型（需认证）
- 说明补充:
  - 未发现行星只返回 `planet_id` + `discovered=false`
  - 已发现但目标行星 runtime 尚未加载时返回 `available=false`
  - 只要目标行星 runtime 已加载，就会返回 `available=true`，即使它不是当前 active 行星；`active_planet_id` 始终表示真正的当前操作焦点
  - `power_networks` / `power_coverage` 整体按同一个 tick 的 authoritative `PowerSettlementSnapshot` 生成；`supply` / `allocated` / `shortage` / `reason` / `provider_id` 之间不再来自不同阶段的临时值
  - `power_networks[].supply` 与 `GET /state/stats.energy_stats.generation` 同源；当前已包含 `ray_receiver power/hybrid` 在真实 tick 中写入的供电回灌，也会保留燃料型发电建筑“最后一根燃料已在本 tick 消耗完但该 tick 仍成功发电”的供电贡献
  - `power_coverage.provider_id` 与 `power_networks` 现在共享同一份真实供电源口径；`ray_receiver`、储能放电等通过 `ws.PowerInputs` 注入的动态电源也会被识别为有效 provider，不再出现“`supply > 0` 但 `coverage` 仍说 `no_provider`”的分叉
  - 对建造工作流，`power_coverage.reason` 与 `building_state_changed.payload.reason` 共享同一套病因口径；当前前端会直接消费 `under_power` / `power_out_of_range` / `power_no_provider` / `power_capacity_full` 这些 reason 来生成“下一步做什么”的提示
- 响应字段:
  - 通用字段：`planet_id` / `discovered` / `available` / `active_planet_id` / `tick`
  - `power_networks`：电网聚合，包含 `id` / `owner_id` / `supply` / `demand` / `allocated` / `net` / `shortage` / `node_ids`
  - `power_nodes`：电网节点，包含 `building_id` / `owner_id` / `building_type` / `position` / `network_id` / `connectors`
  - `power_links`：电力链路，包含 `from_building_id` / `to_building_id` / `kind` / `distance` / `from_position` / `to_position`
  - `power_coverage`：建筑供电覆盖，包含 `building_id` / `owner_id` / `building_type` / `position` / `connected` / `reason` / `provider_id` / `network_id` / `demand` / `allocated` / `ratio` / `priority`
  - `pipeline_nodes`：管网节点，包含 `id` / `position` / `buffer` / `pressure` / `fluid_id`
  - `pipeline_segments`：管网边，包含 `id` / `from_node_id` / `to_node_id` / `from_position` / `to_position` / `flow_rate` / `pressure` / `capacity` / `attenuation` / `current_flow` / `buffer` / `fluid_id`
  - `pipeline_endpoints`：建筑端点，包含 `id` / `node_id` / `building_id` / `owner_id` / `port_id` / `direction` / `position` / `capacity` / `allowed_items`
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "available": true,
  "active_planet_id": "planet-1-1",
  "tick": 120,
  "power_networks": [
    {
      "id": "power-1",
      "owner_id": "p1",
      "supply": 12,
      "demand": 3,
      "allocated": 3,
      "net": 9,
      "shortage": false,
      "node_ids": ["miner-1", "tesla-1"]
    }
  ],
  "power_nodes": [
    {
      "building_id": "tesla-1",
      "owner_id": "p1",
      "building_type": "tesla_tower",
      "position": {"x": 2, "y": 2},
      "network_id": "power-1"
    }
  ],
  "power_links": [
    {
      "from_building_id": "tesla-1",
      "to_building_id": "miner-1",
      "kind": "line",
      "distance": 1,
      "from_position": {"x": 2, "y": 2},
      "to_position": {"x": 3, "y": 2}
    }
  ],
  "power_coverage": [
    {
      "building_id": "miner-1",
      "owner_id": "p1",
      "building_type": "mining_machine",
      "position": {"x": 3, "y": 2},
      "connected": true,
      "network_id": "power-1",
      "demand": 3,
      "allocated": 3,
      "ratio": 1
    }
  ],
  "pipeline_nodes": [
    {
      "id": "n-1",
      "position": {"x": 5, "y": 5},
      "buffer": 6,
      "pressure": 2,
      "fluid_id": "water"
    }
  ],
  "pipeline_segments": [
    {
      "id": "s-1",
      "from_node_id": "n-1",
      "to_node_id": "n-2",
      "from_position": {"x": 5, "y": 5},
      "to_position": {"x": 7, "y": 5},
      "flow_rate": 5,
      "pressure": 1,
      "capacity": 10,
      "current_flow": 3,
      "buffer": 2,
      "fluid_id": "water"
    }
  ],
  "pipeline_endpoints": [
    {
      "id": "pump-1:out-0",
      "node_id": "n-1",
      "building_id": "pump-1",
      "owner_id": "p1",
      "port_id": "out-0",
      "direction": "output",
      "position": {"x": 5, "y": 5},
      "capacity": 6,
      "allowed_items": ["water"]
    }
  ]
}
```

**GET /catalog**
- 说明: 客户端展示元数据总表（需认证）
- 说明补充:
  - 返回不可变 catalog，用于名称、分类、图标 key、颜色、可建造性、配方和科技展示
  - 当前统一通过单个接口返回 `buildings` / `items` / `recipes` / `techs` / `world_units` / `warfare`
- 响应字段:
  - `buildings`：建筑元数据，包含 `id` / `name` / `category` / `subcategory` / `footprint` / `build_cost` / `buildable` / `default_recipe_id` / `requires_resource_node` / `can_produce_units` / `unlock_tech` / `combat_range` / `power_range` / `icon_key` / `color`
  - `buildings[].combat_range`：可选，战斗射程（球面四邻接地格距离），仅有战斗能力的建筑（如 `gauss_turret`、`sr_plasma_turret`、`jammer_tower`）携带；与结算同源，取自该建筑 runtime 定义 `functions.combat.range`
  - `buildings[].power_range`：可选，无线供电覆盖半径（球面四邻接地格距离），仅无线供电建筑（`tesla_tower`、`wireless_power_tower`、`satellite_substation`）携带；与电网结算同源，取自该建筑 runtime 定义 `functions.power_grid.wireless_range`
  - `items`：物品元数据，包含 `id` / `name` / `category` / `form` / `stack_limit` / `unit_volume` / `container_id` / `is_rare` / `icon_key` / `color`
  - `recipes`：配方元数据，包含 `id` / `name` / `inputs` / `outputs` / `byproducts` / `duration` / `energy_cost` / `building_types` / `tech_unlock` / `icon_key` / `color`
  - `techs`：科技元数据，包含 `id` / `name` / `name_en` / `category` / `type` / `level` / `prerequisites` / `cost` / `unlocks` / `effects` / `leads_to` / `max_level` / `icon_key` / `color`
  - `world_units`：公开世界单位目录，包含 `id` / `name` / `domain` / `runtime_class` / `public` / `production_mode` / `query_scopes` / `commands` / `hidden_reason`
  - `warfare`：战争目录聚合，包含 `base_frames` / `base_hulls` / `components` / `public_blueprints`
  - `warfare.base_frames[]` / `warfare.base_hulls[]`：当前会在 `budgets` 中额外暴露 `signal_capacity`，用于蓝图校验时的信号/隐形预算
  - `warfare.components[]`：当前会额外暴露 `signal_load` / `stealth_rating`，用于蓝图校验时的签名负荷与隐蔽加成
  - `warfare.public_blueprints`：公开预置蓝图目录，包含 `id` / `name` / `domain` / `source` / `base_frame_id` / `base_hull_id` / `visible_tech_id` / `runtime_class` / `production_mode` / `producer_recipes` / `deploy_command` / `query_scopes` / `commands` / `components`
- 响应示例:
```json
{
  "buildings": [
    {
      "id": "mining_machine",
      "name": "Mining Machine",
      "category": "collect",
      "subcategory": "collect",
      "footprint": {"width": 1, "height": 1},
      "build_cost": {"minerals": 50, "energy": 20},
      "buildable": true,
      "requires_resource_node": true,
      "icon_key": "mining_machine",
      "color": "#48b589"
    },
    {
      "id": "gauss_turret",
      "name": "Gauss Turret",
      "category": "command_signal",
      "subcategory": "command_signal",
      "footprint": {"width": 1, "height": 1},
      "build_cost": {"minerals": 80, "energy": 30},
      "buildable": true,
      "unlock_tech": ["weapon_system"],
      "combat_range": 5,
      "icon_key": "gauss_turret",
      "color": "#fa5252"
    },
    {
      "id": "tesla_tower",
      "name": "Tesla Tower",
      "category": "power_grid",
      "subcategory": "power_grid",
      "footprint": {"width": 1, "height": 1},
      "build_cost": {"minerals": 20, "energy": 10},
      "buildable": true,
      "unlock_tech": ["dyson_sphere_program"],
      "power_range": 4,
      "icon_key": "tesla_tower",
      "color": "#74c0fc"
    }
  ],
  "items": [
    {
      "id": "iron_ore",
      "name": "Iron Ore",
      "category": "ore",
      "form": "solid",
      "stack_limit": 100,
      "unit_volume": 1,
      "icon_key": "iron_ore",
      "color": "#adb5bd"
    }
  ],
  "recipes": [
    {
      "id": "smelt_stone",
      "name": "Smelt Stone",
      "inputs": [{"item_id": "stone_ore", "quantity": 1}],
      "outputs": [{"item_id": "stone_brick", "quantity": 1}],
      "duration": 50,
      "energy_cost": 1,
      "building_types": ["arc_smelter", "plane_smelter", "negentropy_smelter"],
      "tech_unlock": ["automatic_metallurgy"],
      "icon_key": "smelt_stone",
      "color": "#74c0fc"
    }
  ],
  "techs": [
    {
      "id": "dyson_sphere_program",
      "name": "戴森球计划",
      "name_en": "Dyson Sphere Program",
      "category": "main",
      "type": "main",
      "level": 0,
      "unlocks": [
        {"type": "building", "id": "matrix_lab"},
        {"type": "building", "id": "wind_turbine"}
      ],
      "icon_key": "dyson_sphere_program",
      "color": "#4dabf7"
    },
    {
      "id": "electromagnetism",
      "name": "电磁学",
      "name_en": "Electromagnetism",
      "category": "main",
      "type": "main",
      "level": 1,
      "prerequisites": ["dyson_sphere_program"],
      "cost": [{"item_id": "electromagnetic_matrix", "quantity": 10}],
      "unlocks": [
        {"type": "building", "id": "tesla_tower"},
        {"type": "building", "id": "mining_machine"}
      ],
      "icon_key": "electromagnetism",
      "color": "#9775fa"
    },
    {
      "id": "particle_control",
      "name": "粒子控制",
      "name_en": "Particle Control",
      "category": "branch",
      "type": "chemical",
      "level": 8,
      "prerequisites": ["superconductor"],
      "cost": [
        {"item_id": "electromagnetic_matrix", "quantity": 800},
        {"item_id": "energy_matrix", "quantity": 800},
        {"item_id": "structure_matrix", "quantity": 200}
      ],
      "leads_to": ["information_matrix"],
      "icon_key": "particle_control",
      "color": "#fd7e14"
    }
  ],
  "world_units": [
    {
      "id": "worker",
      "name": "Worker",
      "domain": "ground",
      "runtime_class": "world_unit",
      "public": true,
      "production_mode": "world_produce",
      "query_scopes": ["planet"],
      "commands": ["move"]
    },
    {
      "id": "mecha",
      "name": "Mecha",
      "domain": "ground",
      "runtime_class": "world_unit",
      "public": true,
      "production_mode": "world_produce",
      "query_scopes": ["planet"],
      "commands": ["move", "attack"]
    }
  ],
  "warfare": {
    "base_frames": [
      {
        "id": "light_frame",
        "name": "Light Frame",
        "supported_domains": ["ground", "air"]
      }
    ],
    "base_hulls": [
      {
        "id": "corvette_hull",
        "name": "Corvette Hull",
        "supported_domains": ["orbital", "space"]
      }
    ],
    "components": [
      {
        "id": "micro_reactor",
        "name": "Micro Reactor",
        "category": "power"
      }
    ],
    "public_blueprints": [
      {
        "id": "prototype",
        "name": "Prototype",
        "domain": "ground",
        "source": "preset",
        "base_frame_id": "light_frame",
        "runtime_class": "combat_squad",
        "visible_tech_id": "prototype",
        "production_mode": "factory_recipe",
        "producer_recipes": ["prototype"],
        "deploy_command": "deploy_squad"
      },
      {
        "id": "corvette",
        "name": "Corvette",
        "domain": "space",
        "source": "preset",
        "base_hull_id": "corvette_hull",
        "runtime_class": "fleet_unit",
        "visible_tech_id": "corvette",
        "production_mode": "factory_recipe",
        "producer_recipes": ["corvette"],
        "deploy_command": "commission_fleet"
      }
    ]
  }
}
```
- 说明补充：科技定义中的 unlock ID 现在全部直接写成 canonical ID（如 `tesla_tower`、`oil_refinery`、`em_rail_ejector`），对外 `/catalog.techs[].unlocks` 即原始定义，不再做别名改写。行星内生产配方（`steel`、`glass`、`proliferator_mk1` / `proliferator_mk2`、`organic_crystal`、`particle_container` 等）已落地，对应科技解锁会进入 catalog。尚未落地的恒星系/终局配方解锁（如 `proliferator_mk3`、`thruster`、`photon_combiner`、`space_warper`）仍会在归一化时被暂时裁掉。
- 配方门控：`recipes[].tech_unlock` 与科技 `unlocks` 中的 recipe 解锁互为镜像、共同生效——只要配方声明了 `tech_unlock` 或被任一科技的 recipe 解锁引用，就必须完成对应科技才能在建造设配方 / 机甲手工中使用；五个矩阵配方（`energy_matrix` / `structure_matrix` / `information_matrix` / `gravity_matrix` / `universe_matrix`）现在也严格由同名科技门控。
- 戴森相关 catalog 补充：
  - `items` 中矩阵物品统一只暴露 canonical ID：`electromagnetic_matrix`、`energy_matrix`、`structure_matrix`、`information_matrix`、`gravity_matrix`、`universe_matrix`；旧别名 `matrix_blue` / `matrix_red` / `matrix_yellow` / `matrix_universe` 已从主 catalog 移除。
  - `items` / `recipes` 已补齐终局弹药 `antimatter_capsule` 与 `gravity_missile`，二者都通过 `recomposing_assembler` 进入真实生产闭环。
  - `buildings[].unlock_tech` 现在是 authoritative 的反查入口，由公开科技树里的 `TechUnlockBuilding` 反向派生得到；例如 `satellite_substation.unlock_tech = ["satellite_power"]`。
  - `/catalog.techs[]` 只返回当前公开科技；显式隐藏科技和经死胡同裁剪后不再公开的科技不会继续暴露给玩家。
  - `/catalog.techs[].leads_to` 用于表达桥接科技的公开后继方向；如果某个科技当前没有直接 `unlock` / `effect`，但仍然会把玩家引向后续公开收益，这里会给出下一跳。
  - `automatic_piler` 当前未公开：建筑仍保留在 catalog 中，但 `buildable = false`，不应再被当作当前版本可玩的建造入口。
  - `buildings` 中以下此前长期处于“有定义但无玩家入口”的建筑现在都已进入 `buildable=true` 主线建筑集；对应科技前置请优先读取 `buildings[].unlock_tech`：
    - `advanced_mining_machine`、`pile_sorter`、`recomposing_assembler`、`energy_exchanger`
    - `jammer_tower`、`sr_plasma_turret`、`planetary_shield_generator`、`self_evolution_lab`
    - `satellite_substation`
  - `buildings` 中 `vertical_launching_silo` 当前会暴露 `default_recipe_id = "small_carrier_rocket"`。
  - `recipes` 中当前已补齐 `titanium_crystal`、`titanium_alloy`、`frame_material`、`quantum_chip`、`small_carrier_rocket`、`information_matrix`、`gravity_matrix`、`universe_matrix`、`antimatter_capsule`、`gravity_missile`。
  - `techs` 中 `vertical_launching.unlocks` 会同时包含 `vertical_launching_silo` 与 recipe `small_carrier_rocket`；`high_strength_crystal`、`titanium_alloy`、`lightweight_structure`、`quantum_chip`、`mass_energy_storage`、`gravity_missile` 也都会对外暴露对应 recipe 解锁。
  - `techs` 中 `prototype`、`precision_drone`、`corvette`、`destroyer` 现在都是公开可研究科技；它们解锁的是载荷 recipe，不再污染 `produce` 语义。
  - 精炼厂 `oil_refinery` 现在具有真实生产、储存、电力（6/tick）与 `in-0` / `out-main` / `out-side` 端口。`oil_fractionation` 仅由精炼厂执行，2 原油 → 2 精炼油 + 1 氢；`xray_cracking` 为 1 精炼油 + 2 氢 → 3 氢 + 1 高能石墨；`reformed_refinement` 为 2 精炼油 + 1 氢 + 1 煤 → 3 精炼油。均为 60 tick，受同名科技（基础配方为 `plasma_refining`）控制，后两项科技恢复公开可研究。
  - 循环配方中同时作为输入/输出的物料：未加工原料位于 `storage.inventory` / `input_buffer`，完成的产物位于 `output_buffer`，物流输出不会提走前者。输出缓存不足时整批保留在 `production.pending_outputs` / `pending_byproducts`，无部分提交；回流原料需经输入端口或装料命令进入。
  - 分馏塔由 `deuterium_fractionation` 解锁，无 `recipe_id`，耗电 6/tick。西侧相邻同属玩家的有效皮带输入氢，东侧输出失败氢，南侧输出氘；方向按球面邻接转换，暂不支持旋转。每件氢独立以基础概率 1% 转为 1 氘，否则原件氢进入回流缓存，必须经外部皮带回到入口才能再次尝试。任一输出缓存满时停止新的输入与尝试，不推进随机状态、不扣喷涂次数；无电/暂停同样不处理。额定每 tick 最多尝试 6 件，欠压允许运行时按实际供电比例降低处理量。
  - 分馏使用真实物品喷涂余量：每次尝试消耗该件氢的 1 次 `remaining_uses`，失败仍保留剩余效果。默认 Mk.I/II/III 分别把概率提高至 1.25%/1.5%/2%，余量耗尽后恢复 1%；成功产出的氘不继承氢的喷涂。分馏塔与喷涂机均不接受管道直连，也不能把分流器当普通缓存直接接入；须使用方向匹配的相邻同属玩家皮带。
  - 喷涂机由 `proliferator_mk1` 解锁，耗电 2/tick；北侧皮带或 `transfer_item` 补增产剂，西进东出处理货物。默认每份 Mk.I/II/III 增产剂分别提供 12/24/60 个喷涂单位，每件新喷货物消耗 1 单位并获得 4/6/8 次效果；同份增产剂的未用单位保留，优先用完已装载剂量，再按 Mk.III→Mk.II→Mk.I 选择有库存的增产剂。已有有效喷涂的货物直接通过，不重复耗剂；耗尽后再次经过才重新喷涂。缺增产剂显示 `no_proliferator` 但货物仍原样通过，输出缓存满则背压停机。当前分馏闭环已读取该效果；普通制造台完整保留/消耗喷涂的端到端增产路线仍待补齐。
  - 对撞机 `miniature_particle_collider` 由 `miniature_collider` 解锁，真实电网需求为 24/tick、生产吞吐 1、库存 96、6 个物品种类槽；共享缓存 24 按输入/输出优先级 2:1 分为输入 16、输出 8。`in-0` / `out-main` / `out-side` 端口容量各 6；建造时须指定可用 `recipe_id` 才开始配方加工。下表周期为当前无额外加速的一批 tick 数，不表示秒：

    | 配方 ID | 输入 | 主产物 | 副产物 | 周期 | 配方科技门槛 |
    | --- | --- | --- | --- | --- | --- |
    | `deuterium_collision` | 10 `hydrogen` | 5 `deuterium` | 无 | 300 tick | `miniature_collider` |
    | `strange_matter` | 2 `particle_container` + 10 `deuterium` + 2 `iron_ingot` | 1 `strange_matter` | 无 | 480 tick | `strange_matter` |
    | `antimatter` | 2 `critical_photon` | 2 `antimatter` | 2 `hydrogen` | 120 tick | `dirac_inversion` |

  - `miniature_collider` 科技只解锁对撞机及 `deuterium_collision`，不再提前解锁 `antimatter`。对撞机每批开始时消费真实原料；缺电不启动也不推进已有批次；满仓时主产物和副产物原子提交失败，整批保留 `production.pending_outputs` / `pending_byproducts`，不会继续消费下一批原料。释放容量或存档恢复后只完成一次。原料可经皮带或 `transfer_item` 装入，输出需同时安排反物质与氢去向。
  - `automatic_piler` 可建造，由 `integrated_logistics` 解锁（吞吐 2，`max_stack` 4）。集装机每 tick 主动把缓存内散货压缩成 2x 货堆（研究 `sorter_cargo_integration` 后 4x）；其容量按堆位计：`max_stack` 个堆位 × 堆高，即默认 8、集装科技后 16 件。集装机出货按"每吞吐单位搬运一整堆"结算（默认 2 堆/tick = 4 件，集装科技后 8 件），同长度线路插入集装机可真实提升吞吐；下游容量不足整堆时按可用空间部分搬运，满仓则背压不动。断电/暂停时不搬运也不压缩。
  - 分拣器按"抓"结算：每 tick 抓取次数 = `speed`，普通分拣器（mk1-3）每抓从每堆剥 1 件，`pile_sorter` 每抓整堆抓起。`sorter_cargo_stacking`（1-5 级）每级 +1 每抓堆数（普通分拣器等效每抓多件，`pile_sorter` 一抓多整堆）。运输船属性由科技实时推导（每 tick 重算、不累计）：`logistics_carrier_capacity` 每级 +100 舱容（基础 200），`logistics_carrier_engine` 每级 +1 航速（基础 2）；配送器有效范围 = 基础 12 + `distribution_range` 每级 +5。
  - `world_units` 是 `produce`、CLI 帮助和 shared-client 共享的 authoritative 世界单位边界；`worker` / `soldier` / `mecha` 继续走 `world_produce`，其中 `mecha` 是星球内可移动、可攻击的重型单位。
  - `warfare.public_blueprints` 是 `deploy_squad` / `commission_fleet` / shared-client 共享的 authoritative 战争蓝图边界；`prototype` / `precision_drone` / `corvette` / `destroyer` 已从固定单位表迁移为预置公开蓝图。

---

**GET /catalog/commands**
- 说明: 公共命令结构目录（需认证）。服务端 `model` 共享注册表是唯一真相源，同时驱动 gateway 结构预校验（`ValidateCommandStructure`）与本接口导出；GUI 表单、CLI、agent prompt、skill 应消费此目录，而不是维护第二份字段表。
- 说明补充:
  - 覆盖 `model.AllCommandTypes()` 全部公开 `CommandType`（当前 46 条）
  - 与 `GET /catalog`（建筑/物品/配方/科技/战争元数据）分离；本接口只描述命令结构，不重复实体 catalog
  - `command_schema` 为聚合 JSON Schema（`oneOf` 各命令 object schema），便于外部校验器直接引用
- 响应字段:
  - `version`：目录版本号（当前 `1`）
  - `commands[]`：每条公开命令的结构描述
    - `type`：命令类型字符串（与 `POST /commands` 的 `type` 一致）
    - `required_target_fields`：`target` 上必填字段名列表（空数组表示无 target 必填）
    - `required_payload_fields`：`payload` 上必填字段名列表（空数组表示无 payload 必填）
    - `optional_payload_fields`：可选 payload 字段（文档化；结构预校验不强制）
    - `required_layer`：可选；要求 `target.layer` 必须等于该值（如 `galaxy` / `system` / `planet`）
    - `constraints`：人类可读约束说明（XOR、运行时“至少一个…”等）
    - `schema`：该命令对象的 JSON Schema 片段（`type` + `target` + `payload`）
  - `command_schema`：聚合 schema，`oneOf` 覆盖全部 `commands[].schema`
- 响应示例:
```json
{
  "version": 1,
  "commands": [
    {
      "type": "build",
      "required_target_fields": ["position"],
      "required_payload_fields": ["building_type"],
      "optional_payload_fields": ["recipe_id", "direction"],
      "schema": {
        "type": "object",
        "required": ["type", "target", "payload"],
        "properties": {
          "type": {"const": "build"},
          "target": {
            "type": "object",
            "required": ["position"],
            "properties": {
              "position": {"type": "object", "required": ["x", "y"]}
            }
          },
          "payload": {
            "type": "object",
            "required": ["building_type"],
            "properties": {
              "building_type": {"type": "string"},
              "recipe_id": {"type": "string", "minLength": 1},
              "direction": {"type": "string"}
            }
          }
        }
      }
    },
    {
      "type": "fleet_move",
      "required_target_fields": [],
      "required_payload_fields": ["fleet_id", "target_system_id"],
      "schema": {"type": "object"}
    }
  ],
  "command_schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "SiliconWorld Command",
    "description": "One public game command object (type + target + payload)",
    "oneOf": []
  }
}
```

---

**GET /world/warfare/blueprints**
- 说明: 当前玩家自有战争蓝图列表（需认证）
- 响应字段:
  - `blueprints[]`：玩家蓝图详情，包含 `id` / `owner_id` / `name` / `source` / `state` / `domain` / `base_frame_id` / `base_hull_id` / `parent_blueprint_id` / `allowed_variant_slots` / `components` / `validation` / `allowed_actions`
  - `validation`：当前按 authoritative 目录即时重算的校验结果，包含 `valid` / `limits` / `usage` / `issues`
  - `validation.issues[]`：结构化失败原因，包含 `code` / `message` / 可选 `slot_id` / `component_id` / `actual` / `limit`
- 说明补充:
  - 这里只返回当前玩家自己的蓝图对象，不混入公开预置蓝图；预置蓝图仍通过 `/catalog.warfare.public_blueprints` 暴露
  - `allowed_actions` 会直接反映状态机约束，例如 `draft` 允许 `set_component` / `validate`，`prototype` 允许 `finalize` / `variant`

**GET /world/warfare/blueprints/{blueprint_id}**
- 说明: 查询一个战争蓝图详情（需认证）
- 说明补充:
  - 若 `blueprint_id` 属于当前玩家自有蓝图，返回玩家蓝图对象
  - 若 `blueprint_id` 不在玩家自有蓝图中，但命中了公开预置蓝图（例如 `prototype` / `corvette`），则返回预置蓝图的统一详情视图
  - 预置蓝图会复用同一套校验器，当前返回为 `source = preset` 且 `state = adopted`

**GET /world/warfare/industry**
- 说明: 当前玩家的战争军工、翻修与部署枢纽状态（需认证）
- 响应字段:
  - `production_orders[]`：军工排产单，包含 `id` / `factory_building_id` / `deployment_hub_id` / `blueprint_id` / `domain` / `count` / `completed_count` / `status` / `stage` / `stage_remaining_ticks` / `stage_total_ticks` / `component_ticks` / `assembly_ticks` / `retool_ticks` / `repeat_bonus_percent`
  - `refit_orders[]`：翻修 / 改型单，包含 `id` / `building_id` / `unit_id` / `unit_kind` / `source_blueprint_id` / `target_blueprint_id` / `status` / `remaining_ticks` / `total_ticks` / `repair_tier`
  - `refit_orders[].repair_tier`：当前翻修层级，取值为 `field_repair` / `frontline_repair_station` / `overhaul`
  - `deployment_hubs[]`：部署枢纽军备库存，包含 `building_id` / `building_type` / `planet_id` / `capacity` / `ready_payloads`
  - `supply_nodes[]`：军需补给节点视图，包含 `node_id` / `source_type` / `label` / `planet_id` / `system_id` / `building_id` / `unit_id` / `inventory` / `updated_tick`
  - `supply_nodes[].inventory`：六类军需库存，字段固定为 `ammo` / `missiles` / `fuel` / `spare_parts` / `shield_cells` / `repair_drones`
  - `supply_nodes[].source_type`：当前 authoritative 只会返回 `planetary_logistics_station` / `interstellar_logistics_station` / `orbital_supply_port` / `supply_ship` / `frontline_supply_drop`
- 说明补充:
  - `production_orders[].stage` 当前 authoritative 区分为 `components -> assembly -> ready`
  - `repeat_bonus_percent` 表示同一产线连续生产同蓝图时的效率收益；`retool_ticks` 表示切换到不同蓝图时的重整时间
  - `ready_payloads` 已取代把蓝图 ID 当普通 item 塞进建筑 `storage` 的旧做法；`deploy_squad` / `commission_fleet` 只从这里消费军备产物
  - `supply_nodes` 会同时聚合玩家所属部署枢纽、行星物流站、星际物流站、物流货船与物流无人机上的军需库存，便于直接观察战区补给面

**GET /world/warfare/task-forces**
- 说明: 当前玩家的任务群编制、姿态、成员与指挥容量视图（需认证）
- 响应字段:
  - `task_forces[]`：任务群列表，包含 `id` / `name` / `theater_id` / `stance` / `deployment` / `members` / `command_capacity` / `supply_status`
  - `deployment`：当前 authoritative 部署意图，包含可选 `system_id` / `planet_id` / `position` / `frontline_id` / `ground_order` / `support_mode`
  - `members[]`：运行态成员解析结果，包含 `kind` / `entity_id` / `planet_id` / `system_id` / `blueprint_ids` / `count` / `state` / `supply_status` / `repair_state`
  - `members[].supply_status`：成员补给摘要，包含 `current` / `capacity` / `condition` / `cohesion` / `damage_penalty` / `shield_penalty` / `mobility_penalty` / `retreat_recommended` / `shortages`
  - `members[].repair_state`：成员维修态，包含 `tier` / `active` / `blocked_reason` / `hp_per_tick` / `shield_per_tick` / `remaining_damage` / `remaining_shield` / `remaining_ticks` / `completed_this_tick`
  - `command_capacity`：当前任务群指挥容量状态，包含 `total` / `used` / `over` / `delay_penalty` / `hit_penalty` / `formation_penalty` / `coordination_penalty` / `sources`
  - `supply_status`：任务群聚合补给摘要，字段结构与 `members[].supply_status` 一致；当前按成员最差 `condition`、最大惩罚和累计库存汇总
  - `sources[]`：容量来源，包含 `source_id` / `source_type` / `label` / `entity_id` / `planet_id` / `system_id` / `capacity`
- 说明补充:
  - `stance` 当前支持 `hold` / `patrol` / `escort` / `intercept` / `harass` / `siege` / `bombard` / `retreat_on_losses`
  - `command_capacity.sources[].source_type` 当前来自 `command_center` / `command_ship` / `battlefield_analysis_base` / `military_ai_core`
  - 该查询是 authoritative 组织层视图，不是静态配置快照；成员、姿态和超编惩罚会随着当前 runtime 实体状态实时变化
  - `members[].repair_state.tier` 当前只会返回 `field_repair` / `frontline_repair_station` / `overhaul`
  - `task_force_deploy` 当前既表达跨层部署意图，也表达行星层任务群的前线命令；它仍不等价于已经存在完整跨星系自动航渡系统

**GET /world/warfare/theaters**
- 说明: 当前玩家的战区、区域划分与战区目标（需认证）
- 响应字段:
  - `theaters[]`：战区列表，包含 `id` / `name` / `zones` / `objective`
  - `zones[]`：战区区域，包含 `zone_type` / `system_id` / `planet_id` / `position` / `radius`
  - `objective`：战区目标，包含 `objective_type` / `system_id` / `planet_id` / `entity_id` / `description`
- 说明补充:
  - `zone_type` 当前支持 `primary` / `secondary` / `no_entry` / `rally` / `supply_priority`
  - 战区对象是任务群部署与战区目标表达层，不会替代现有 fleet/squad runtime 身份

---

**POST /commands**
- 说明: 提交命令（需认证）
- 说明补充: `issuer_type` 与 `issuer_id` 必填；当 `issuer_type=player` 时，`issuer_id` 必须与 Bearer key 对应的玩家一致；命令会进行权限校验（`permissions`），无权限则直接拒绝
- authoritative 语义补充:
  - `request_id` 同时承担幂等键与结果回写关联键；重复 `request_id` 不会再次入队
  - HTTP `202` 与 `results[].status = accepted` 只表示“通过网关预校验并已入队到 `enqueue_tick`”，不是最终成功
  - 每条命令的最终 authoritative 成功/失败结果必须以后续 `command_result` 事件为准；客户端应使用 `payload.request_id + command_index` 进行对账
  - 对 `build` 这类异步链路，`command_result(code=OK)` 通常只表示“施工任务已创建或已排队”；真正的建筑实体落地与后续停机病因需要继续结合 `entity_created` / `building_state_changed` 判断
- 执行体约束: `build`/`produce`/`upgrade`/`demolish` 需要执行体在操作范围内；`upgrade`/`demolish` 超过并发上限会在执行阶段失败；`build` 超过并发上限时进入施工队列等待调度
- 请求体:
```json
{
  "request_id": "uuid",
  "issuer_type": "player_or_client_agent",
  "issuer_id": "user-001",
  "commands": [
    {
      "type": "scan_galaxy|scan_system|scan_planet|build|move|attack|refuel_mecha|mine_resource|craft_item|cancel_mecha_job|produce|upgrade|demolish|configure_splitter|configure_traffic_monitor|configure_logistics_station|configure_logistics_slot|install_logistics_vehicle|cancel_construction|restore_construction|start_research|cancel_research|set_recipe|transfer_item|switch_active_planet|set_ray_receiver_mode|set_energy_exchanger_mode|deploy_squad|commission_fleet|fleet_assign|fleet_attack|fleet_move|fleet_disband|task_force_create|task_force_assign|task_force_set_stance|task_force_deploy|theater_create|theater_define_zone|theater_set_objective|blockade_planet|landing_start|blueprint_create|blueprint_set_component|blueprint_validate|blueprint_finalize|blueprint_variant|queue_military_production|refit_unit|launch_solar_sail|launch_rocket|build_dyson_node|build_dyson_frame|build_dyson_shell|demolish_dyson",
      "target": {
        "layer": "galaxy|system|planet",
        "galaxy_id": "galaxy-1",
        "system_id": "sys-1",
        "planet_id": "planet-1-1",
        "entity_id": "entity-1",
        "position": {"x": 10, "y": 12}
      },
      "payload": {
        "building_type": "当前服务端 Buildable=true 的建筑 ID，例如 mining_machine|advanced_mining_machine|wind_turbine|tesla_tower|satellite_substation|solar_panel|arc_smelter|assembling_machine_mk1|recomposing_assembler|chemical_plant|pile_sorter|conveyor_belt_mk1|depot_mk1|planetary_logistics_station|energy_exchanger|orbital_collector|em_rail_ejector|vertical_launching_silo|ray_receiver|jammer_tower|sr_plasma_turret|planetary_shield_generator|self_evolution_lab",
        "direction": "north|east|south|west|auto",
        "recipe_id": "gear|smelt_iron|plastic",
        "task_id": "c-1",
        "tech_id": "electromagnetism",
        "building_id": "b-1",
        "planet_id": "planet-1-1",
        "input_priority": 1,
        "output_priority": 1,
        "drone_capacity": 10,
        "interstellar": {
          "enabled": true,
          "warp_enabled": false,
          "ship_slots": 2
        },
        "scope": "planetary|interstellar",
        "item_id": "iron_ore",
        "mode": "none|supply|demand|both",
        "local_storage": 100,
        "quantity": 10,
        "count": 1,
        "fleet_id": "fleet-1",
        "formation": "line|vee|circle|wedge",
        "task_force_id": "tf-alpha",
        "member_kind": "squad|fleet",
        "member_ids": ["squad-1", "fleet-1"],
        "stance": "hold|patrol|escort|intercept|harass|siege|bombard|retreat_on_losses",
        "theater_id": "theater-front",
        "zone_type": "primary|secondary|no_entry|rally|supply_priority",
        "objective_type": "secure_planet|deny_system|protect_hub",
        "description": "theater objective text",
        "system_id": "sys-1",
        "layer_index": 0,
        "orbit_radius": 1.0,
        "inclination": 0.0,
        "latitude": 10.0,
        "longitude": 20.0,
        "node_a_id": "node-1",
        "node_b_id": "node-2",
        "latitude_min": -15.0,
        "latitude_max": 15.0,
        "coverage": 0.4,
        "component_type": "node|frame|shell",
        "component_id": "shell-1",
        "domain": "ground|air|orbital|space",
        "base_frame_id": "light_frame|medium_frame|heavy_frame|assault_frame",
        "base_hull_id": "corvette_hull|destroyer_hull|cruiser_hull|carrier_hull|siege_hull",
        "slot_id": "power_core|mobility|armor|sensor|weapon_primary|weapon_aux|utility|reactor|drive",
        "allowed_slot_ids": ["utility"],
        "target_state": "prototype|field_tested|adopted|obsolete",
        "parent_blueprint_id": "prototype|玩家已有 blueprint_id",
        "target_entity_id": "entity-2",
        "target_id": "enemy-1",
        "unit_type": "仅 produce 使用；当前 /catalog.world_units 中 public=true 且 production_mode=world_produce 的 unit id",
        "blueprint_id": "deploy_squad / commission_fleet / queue_military_production 使用时可为公开蓝图 id 或玩家已定型蓝图 id；blueprint_* 命令使用时为玩家蓝图 id",
        "deployment_hub_id": "queue_military_production 交付目标部署枢纽 id",
        "unit_id": "refit_unit 的目标 squad_id 或 fleet_id",
        "target_blueprint_id": "refit_unit 的目标蓝图 id"
      }
    }
  ]
}
```
- 玩家机甲：星球 `Unit` 的 `type=executor` 同时承担建造和机甲操作，`mecha` 返回 `energy` / `max_energy` / `fuel_energy` / `shield` / `max_shield` / `inventory_capacity` / `attack_energy_cost` / `move_energy_cost` / `shield_recharge_delay` / `last_hit_tick`。初始核心 100，初始护盾容量 0；`mecha_core` 每级核心容量 +10，`mecha_engine` 每级移动范围 +2（基础 12），`energy_shield` 每级护盾容量 +20。其余机甲升级科技也已接入 tick 结算：`mechanical_frame` 每级生命上限 +20（基础 120，不免费回血），`drive_engine` 每级移动范围 +2 并与 `mecha_engine` 叠加进同一移动计算，`inventory_capacity` 每级背包容量 +60（基础 200，机甲物流请求的 max 会被钳制到该容量，配送结算按钳制后的 max 送货），`energy_circuit` 每级电网充电速率 +20%（无线塔基础 10/tick、感应塔 2/tick），`universe_exploration` 每级机甲视野 +1（基础 6，战争迷雾按新视野每 tick 重算）。研究提高上限但不免费补充能量或护盾。距最近受击满 10 tick 后每 tick 消耗 1 核心能量恢复最多 2 护盾，零能量时停止恢复。`research_speed` 科技效果在研究矩阵实际吞吐中生效，不重复叠加。
- `mecha_state_changed` 事件仅对拥有者发送，payload 为 `entity_id` + 完整 `mecha`，以及 `move_range` / `attack` / `defense` / `attack_range`；科技仅改变派生属性时也发送，重复同步不重复发送。燃料补充时另带 `fuel_item_id` / `fuel_used`。快照和恢复深复制机甲状态。`mecha` 可生产战斗单位与玩家 `executor` 是不同单位；手动采集、个人制造和电网充电规则见下文；飞行、跃迁、建造无人机、装备和死亡恢复仍未完成。
- `/catalog.items[].mecha_fuel_energy`：煤 25、高能石墨 50、精炼油 40、氢 30、氢燃料棒 100、氘燃料棒 250、反物质燃料棒 1000；字段不存在或为 0 的物品不可用于机甲燃料。
- `/catalog.recipes[].handcraft_allowed` 为配方是否允许个人制造的布尔值；可手造不等于科技已解锁，仍须满足该配方的科技规则。当前标记八种：`smelt_iron`、`smelt_copper`、`smelt_stone`、`smelt_magnet`、`coal_to_graphite`、`gear`、`circuit_board`、`magnetic_coil`。不满足手造资格或含非固体输入/输出的配方不能通过 `craft_item` 执行。
- `Unit.mecha.job` 存在时表示当前唯一个人任务：`kind=mine|craft`、`resource_id` 或 `recipe_id`、`remaining_ticks`、`ticks_per_batch`、`remaining_batches`、`completed_batches`、`energy_per_tick`、`state=running|no_energy|out_of_range`、`reserved_inputs`（未完成制造批次的预留原料）。任务完成/取消/死亡后移除；存档、查询和恢复深复制任务及预留原料，恢复不重复扣料。
- 采矿/制造每推进一个 tick 消耗 1 核心能量。核心不足时暂停；采矿距离超过 2 个球面地块时暂停且不扣能量，回到范围或补能后自动继续。每批完成向玩家 `inventory` 入库并发 `resource_changed`，包含 `entity_id`、`items`、`job_kind`、`completed_batches`；采矿另含 `resource_id` 和矿点 `remaining`。进度、暂停或结束同时通过 `mecha_state_changed` 返回机甲完整状态。
- 电网自动充电无需命令：存活玩家自己的存活 `executor` 在运行中的自有 `wireless_power_tower` 6 格范围内，最多补 10 核心能量/tick；无线塔自身耗电 1/tick。`tesla_tower` 范围 4 格，最多补 2/tick。范围按球面距离计算，可跨面。仅取塔所在连通电网的真实剩余供电，优先保留建筑用电与蓄电器实际充电，不使用其他独立电网发电或玩家积存 `energy` 代替；停塔、缺电、核心满、超范围或死亡时不充。
- 研究派生的资产属性每 tick 同步一次：`drone_engine` 每级使行星物流无人机速度 +3（基础 4，调度与飞行 tick 按同步后速度结算），`solar_sail_life` 每级使在轨太阳帆寿命 +300 tick（对研究完成前已发射的太阳帆同样生效，衰减结算按同步后寿命判定）。
- 同一 tick 先处理燃料/护盾及个人任务，再处理电网充电；按剩余核心缺口补充，多机甲共享单塔速率且单个机甲每 tick 只从一塔受电，优先无线塔。电网、蓄电器与玩家能源结算统一记账，充入机甲/蓄电器的电量不会再次计入玩家余额。充电事件为 `mecha_state_changed`，另带 `charging_building_id`、`charging_network_id`、`grid_charge`（本次实际补能）。这些事件字段不是持久的充电状态。

- 命令字段约束:
  - `scan_galaxy`：`target.galaxy_id` 必填；`target.layer` 可填 `galaxy`
  - `scan_system`：`target.system_id` 必填；`target.layer` 可填 `system`
  - `scan_planet`：`target.planet_id` 必填；`target.layer` 可填 `planet`
  - `build`：`target.position` + `payload.building_type` 必填；`target.position` 使用 `x` / `y` / 可选 `z`；传送带与自动集装机支持 `payload.direction`（默认 `east`，`auto` 表示允许多方向路由）；生产建筑可选 `payload.recipe_id` 用于设置初始配方，若提供必须是非空字符串；如果建筑定义存在 `default_recipe_id`，未显式传 `recipe_id` 时会自动回退到默认配方，并且仍会校验玩家是否已解锁该 recipe；`mining_machine` / `water_pump` / `oil_extractor` 必须建在对应资源点上（只校验资源点存在，不校验是否枯竭；建在枯竭点上采不到资源），枯竭（`depleted=true`）资源点不阻碍建造，任何建筑都可直接建在枯竭点上，`orbital_collector` 仅允许在气态行星建造；`matrix_lab` / `self_evolution_lab` 在未设置 `recipe_id` 时默认可直接参与 `start_research`；普通新局里 `matrix_lab` 与 `wind_turbine` / `mining_machine` / `arc_smelter` / `tesla_tower` / `conveyor_belt_mk1` / `sorter_mk1` / `assembling_machine_mk1` 均已可由初始完成科技 `dyson_sphere_program` 直接建造；`jammer_tower` / `sr_plasma_turret` / `planetary_shield_generator` 都需要接入电网后才会进入 `running`；命令成功后进入施工队列，建造完成触发 `entity_created`；执行阶段的距离校验与 `server/internal/gamecore/executor.go` 同源，当前失败文案会直接落到 `command_result.message = "executor out of range: <distance> > <operate_range>"`
  - `move`：`target.entity_id` + `target.position` 必填；玩家执行体 `executor` 每走一格真实地表路径消耗 1 核心能量，绕路按实际路径长度计费，能量不足整条命令拒绝，不改变位置。
- `attack`：`target.entity_id` + `payload.target_entity_id` 必填；`executor` 基础攻击 20、防御 8、射程 4，每次成功攻击消耗 8 核心能量。目标机甲护盾优先吸收伤害，`damage_applied.damage` 为实际 HP 伤害，`shield_absorbed` 为护盾吸收值。非法目标、超距、能量不足不扣能量。

`build` 的 `building_type=foundation` 可以在水面、熔岩或阻挡地形排队；完成施工后将地形改为可建，并在实体状态保存原地形。拆除地基恢复原地形；已有建筑占用地基时拒绝拆除，材料不足或施工回滚不会改变地形。地基实体不占用已填平的 TileBuilding 格，允许随后建厂；同位置不能重复铺设，有待建任务时也不能拆地基，正在拆除的地基上禁止排工厂，restore_construction 也遵循相同限制。foundation_terrain 原始地形进入深复制和存档恢复，保存后再拆除仍可还原。Planet/Scene/Overview 地形查询反映 ws.Grid 中地基改造后的运行时地形及拆除恢复，不再仅返回初始生成地形。

已加载行星的地面防御炮塔在每个 Tick 自动选取射程内敌方单位或敌对势力并产生 `damage_applied`：`missile_turret` 消耗 `ammo_missile`，`implosion_cannon` 消耗 `gravity_missile`，`plasma_turret` 消耗 `plasma_capsule`，`laser_turret` 使用电力。各塔按 runtime `Combat.fire_rate` 冷却；弹药不足产生 `building_state_changed`（reason=`no_ammunition`）并停火，供电不足由建筑进入 `no_power`。炮塔攻击机甲时仍先结算机甲护盾；攻击玩家单位的伤害事件同时发给射击方和受击方。弹药从 storage 的 input_buffer/inventory/output_buffer 按原子方式消费，不因仓储自动转移缓冲区而失效；重装后清除 no_ammunition 原因。Combat 返回 attack/range/fire_rate/ammo_item/ammo_consume/last_fire_tick；激光塔通过每 tick 电力消耗运行，不另设未结算的每发能耗字段。

`plasma_capsule` 已加入物品/配方目录；`plasma_turret` 科技解锁：1 钛合金 + 1 粒子容器 + 2 氢 → 1 等离子胶囊，基础 60 ticks、配方能耗 4，由 Mk.I/II/III 制造台加工。

Mk.II/III 制造台继承全部 Mk.I 配方，Mk.III 也支持 prototype，precision_drone 仍要求 Mk.III。Mk.II/III 吞吐 2/3、仓储容量 48/72、每 tick 功耗 8/12、建造成本分别 240矿120能/360矿180能。所有生产模块的 throughput 现在真实缩短周期：ceil(增产剂调整后的时长 / max(1, throughput))，最短 1 tick，输入输出数量不乘倍数；生产统计 effective_throughput 按最终时长计算，避免重复计速。
  - `refuel_mecha`：`target.entity_id` 必须为自己的 `executor`，`payload.item_id` + 正整数 `payload.quantity` 必填。从玩家库存扣除燃料，按核心缺口限制实际消耗件数；仅接受 `/catalog.items[].mecha_fuel_energy > 0` 的物品。核心已满或仍有 `fuel_energy` 缓存时拒绝。高热值燃料的多余能量留在机甲缓存，后续每 tick 最多补充 10 核心能量，不丢弃多余热值。事件返回实际 `fuel_used`。
  - `mine_resource`：`target.entity_id` 为自己的存活 `executor`；必填非空 `payload.resource_id` 和正整数 `payload.quantity`（采集件数）。只支持 `behavior=finite` 且物品 `form=solid` 的矿点，启动时须在 2 格球面距离内且矿点余量不少于请求件数。每 10 tick 采出 1 件到玩家背包，并扣矿点实际余量；不会立刻领取整批或从建筑提货。已有个人任务时拒绝新任务；矿点被耗尽时自动结束，竞采不会把余量扣成负数。
  - `craft_item`：`target.entity_id` 为自己的存活 `executor`；必填非空 `payload.recipe_id` 和正整数 `payload.quantity`（配方批数，不是产物件数）。配方须 `handcraft_allowed=true`、科技可用且全部输入/输出为固体。启动时一次从玩家背包扣留全部请求批次的输入，材料不足原子失败；每批耗时 `max(1, recipe.duration)` tick、每 tick 消耗 1 核心能量，整批产物及副产物进入背包。禁止与采矿或另一制造任务同时运行；不自动递归制造前置材料。
  - `cancel_mecha_job`：只需自己存活 `executor` 的 `target.entity_id`，无 payload。取消当前任务，将尚未完成批次的预留原料返还玩家背包（包含进行中批次）；已完成产物保留，已消耗核心能量不返还。机甲死亡路径也会执行同一退款逻辑且只退一次；无任务时返回 `INVALID_TARGET`。
  - `produce`：`target.entity_id` + `payload.unit_type` 必填；目标建筑必须处于可运行状态，停电/停机/故障时会直接拒绝；`payload.unit_type` 的 authoritative 边界以 `/catalog.world_units` 为准，当前只接受 `production_mode=world_produce && runtime_class=world_unit` 的单位，当前接受 `worker`、`soldier`、`mecha`；机甲生产成本为 180 矿物 / 80 能量。
  - `upgrade` / `demolish`：`target.entity_id` 必填
  - `configure_traffic_monitor`：`target.entity_id` 为己方流速监测器，完整替换配置：`target_belt_id`（己方球面相邻 Mk.I/II/III 皮带 ID；空字符串清绑定）、`window_ticks`（1..600 整数）、`minimum_items_per_tick`（0..60 有限数）、`alerts_enabled`（布尔值）均必填。非法配置不改变状态；成功重配清窗口和累计值。建筑耗电1/tick，监测不改变物流。`building.traffic_monitor` 包含配置、`state`、`samples[{tick,items,queued_items}]`、`sample_count`、`window_items`、`items_per_tick`、`total_items`、`last_sample_tick`、`alert_active`。统计目标皮带成功流出的实际件数，包括带间、分拣器和机器取货；同一次流出不重复计数。完整窗口前为 `sampling`，正常为 `flowing|idle`，低于阈值为 `low_flow`，完整窗口每次都有积货且零流出为 `blocked`。无绑定/停电/暂停/目标移除或停用分别为 `unconfigured|no_power|paused|target_missing|target_inactive`，清当前窗口但保留累计；恢复重新采样。关闭告警仍采样。`traffic_monitor_alert` 仅在告警变更时发给所属玩家，载荷含 `building_id`、`planet_id`、`target_belt_id`、`state`、`alert_active`、`items_per_tick`、`minimum_items_per_tick`、`tick`；解除告警同样发出。
  - `configure_splitter`：`target.entity_id` 为自己拥有且已初始化的 `splitter`。必填 `payload.input_directions` / `output_directions`（数组）；仅允许 `north|east|south|west`，每组至少一个、所有端口不重复且输入输出互斥，不接受 `auto`。可选 `input_priority` / `output_priority`（所属方向或空字符串）和 `output_filters`（输出方向到有效物品 ID 的对象）。**完整替换配置**：省略优先级或传 `""` 会清除旧优先级；省略过滤或传 `{}` 会清除全部旧过滤，删除单口过滤需提交不含该口的完整过滤对象，不能用空物品 ID 代替删除。验证失败不改变原配置、缓存、游标或统计；成功发拥有者可见的 `building_state_changed`，payload 含 `entity_id` 和完整 `splitter`。
  - 分流器优先级为“可用优先”：优先入口无货时允许其它入口供货；优先出口缺连接、满载或不允许当前物品时，尝试其它有容量且满足自身过滤条件的出口。所有合格出口均堵塞时物品留在原缓存，不丢弃、不复制，也不绕过过滤。过滤口与未过滤口同时存在时，未过滤口也能接收该过滤物品；若需要该物品优先进过滤口，应设置该出口优先级。方向按球面邻接转换，不能简单用 x/y 差替代跨面端口关系。
  - `configure_logistics_station`：`target.entity_id` 必填，目标为己方行星/星际物流站。可选 `payload.input_priority` / `output_priority` / `drone_capacity`（1..10）；星际站另可传 `interstellar.enabled` / `warp_enabled` / `ship_slots`（1..5）。容量不能降至已安装运输器数量以下，增加容量不会生成载具。可选 `belt_ports`：省略保持原值，提供则**完整替换**，`{}` 清空全部端口；例如 `{"west":{"mode":"input","item_id":"iron_ore"},"east":{"mode":"output","item_id":"iron_ore"}}`。仅四个正方向，每口模式为 `input|output`，物品须已有槽位。整条配置验证失败不改变原状态。
  - `configure_logistics_slot`：`target.entity_id` + `payload.scope` + `item_id` + `mode` + `local_storage` 必填；scope 为 `planetary|interstellar`，mode 为 `none|supply|demand|both`，仅星际站支持 interstellar。`local_storage` 必须在0..单项容量内，是供需保留/目标量；`none` 保留本地库存槽。可选布尔 `remove:true` 真正删除当前scope槽，此时仍须 `mode:"none",local_storage:0`；有库存、皮带口引用、去程/返航货物或空载取货预约时拒绝，跨星球按星球+站ID判定；其它scope同物品的空槽可保留。非法配置/删除均返回 `VALIDATION_FAILED` 且不修改状态。
  - `install_logistics_vehicle`：`target.entity_id` 为己方地面物流站；必填 `payload.item_id`（`logistics_drone|logistics_vessel`）及正整数 `quantity`，可选 `source:"player"|"station"`，省略默认player。科技门禁：`logistics_drone` 需要已研究解锁 `logistics_drone` 单位的科技（`planetary_logistics` 或 `distribution_logistics`），`logistics_vessel` 需要 `interstellar_logistics`，未研究返回 `VALIDATION_FAILED`（"research required"）且不消耗物品。player从玩家背包扣成品；station从目标站唯一 `logistics_station.inventory` 扣成品，可将制造台产物经皮带送入站内已配置的本地物品槽后安装。一次扣同数量成品并登记实体，整批容量或库存不足原子失败；库存不足返回 `INSUFFICIENT_RESOURCE`。行星/星际站最多安装10架无人机，只有启用的星际站可安装最多5艘船；轨道采集器不能安装。制造台配方 `logistics_drone`：2 motor + 2 processor + 5 iron_ingot → 1，120 tick，需 `planetary_logistics`；`logistics_vessel`：2 motor + 10 processor + 10 titanium_alloy → 1，300 tick，需 `interstellar_logistics`。两配方不支持个人手造。
  - `cancel_construction` / `restore_construction`：`payload.task_id` 必填
  - `start_research`：`payload.tech_id` 必填；前置科技必须满足；至少需要 1 个处于 `running` 且未设置 `recipe_id` 的研究站（`matrix_lab` 或 `self_evolution_lab`）；所需每种矩阵都必须已经出现在研究站本地库存里；后续 tick 会真实消耗研究站库存中的矩阵推进 `progress`；隐藏科技（如 `dark_fog_matrix`）在玩家持有其触发物品（玩家背包或研究站库存中至少 1 个各级成本物品，例如战利品 `dark_fog_matrix`）前不可见、拒绝研究，持有后即可正常入队并被研究消耗
  - `cancel_research`：`payload.tech_id` 必填
  - `set_recipe`：`target.entity_id` 为己方带生产能力的建筑；`payload.recipe_id` 可选——非空时必须是该建筑类型支持且已研究解锁的配方；省略或传空字符串时研究站（`matrix_lab` / `self_evolution_lab`）切回研究模式、普通生产建筑转为空闲。原地切换不拆重建；切换后生产进度清零（`remaining_ticks` / `progress_fraction` / 待产出清空）、建筑库存保留；校验失败原子拒绝，建筑状态不变
  - 垂直叠层：对已被同类型研究站/生产建筑占据的格子再次 `build` 同类型建筑时，会作为叠层放置在上一层（`position.z` 递增），无需重复占地；叠层上限 = 1 + `vertical_construction` 已完成级数（未研究不可叠层）；研究站叠层共享底层库存、研究吞吐按层线性叠加；区域并发建造上限 = 配置值 + `mass_construction` 已完成级数
  - `transfer_item`：`payload.building_id` + `payload.item_id` + `payload.quantity` 必填；目标必须是当前玩家拥有、且带 `storage` 的建筑或地面物流站；命令从玩家 `inventory` 扣减实际装入量。地面物流站须先配置物品槽，写入唯一 `logistics_station.inventory`；普通建筑写本地存储。容量不足允许部分装填，仅扣实际转移数量；轨道采集器不开放此装料入口。喷涂机只允许有效增产剂物品（`proliferator_mk1` / `proliferator_mk2` / `proliferator_mk3`），尝试装入氢等货物返回验证失败；货物必须走西侧传送带。分馏塔无普通 `storage`，不能直接装料，氢须走西侧传送带。
  - `switch_active_planet`：`payload.planet_id` 必填；目标行星必须已发现、其 runtime 已加载，并且当前玩家在该行星存在 foothold；当前 foothold 的实现定义为该行星上存在玩家自己的 `battlefield_analysis_base` 或 `executor`
  - `set_ray_receiver_mode`：`payload.building_id` + `payload.mode` 必填；目标必须是当前玩家拥有的 `ray_receiver`；`payload.mode` 取 `power|photon|hybrid`；`power` 只回灌电网并停止新的 `critical_photon` 增量，`hybrid` 先发电再把剩余输入转成光子，`photon` 只产光子且要求玩家已解锁 `dirac_inversion`；模式切换不会自动清空建筑里已经存在的历史光子库存
  - `set_energy_exchanger_mode`：`payload.building_id` + `payload.mode` 必填；目标必须是当前玩家拥有的 `energy_exchanger`（蓄电器能量枢纽）；`payload.mode` 取 `charge|discharge|standby`：`charge` 用电网盈余把空蓄电池（`accumulator`）转成满蓄电池（`accumulator_full`），`discharge` 把满蓄电池转回电网能量并返还空蓄电池，`standby` 不做物品转换；非法模式或目标不是蓄电器返回 `VALIDATION_FAILED`，建筑不存在返回 `ENTITY_NOT_FOUND`，非己方建筑返回 `NOT_OWNER`，且均不改变当前模式
  - `deploy_squad`：`payload.building_id` + `payload.blueprint_id` + `payload.count` 必填；可选 `payload.planet_id`；未传 `planet_id` 时默认部署到当前 active planet 对应 runtime；目标建筑必须是当前玩家拥有、带 deployment module、并且当前 tick 处于可运行状态的部署枢纽；当前公开部署枢纽就是 `battlefield_analysis_base`，自身需要接入电网后才算可运行；玩家还必须已经解锁该蓝图对应 `visible_tech_id`，并且该枢纽在 `/world/warfare/industry.deployment_hubs[].ready_payloads` 中已有足量军备产物；若传 `planet_id`，目标行星 runtime 也必须已加载
  - `commission_fleet`：`payload.building_id` + `payload.blueprint_id` + `payload.count` + `payload.system_id` 必填；可选 `payload.fleet_id`；目标建筑约束同 `deploy_squad`；当前公开可编入舰队的蓝图是 `corvette` / `destroyer`，玩家自有 `space|orbital` 已定型蓝图也可以直接编入舰队；同样要求已解锁对应科技且部署枢纽 `ready_payloads` 中已有足量军备产物；若传入一个已存在且属于当前玩家的 `fleet_id`，服务端会向该舰队追加蓝图栈并重算 `weapon` / `shield`，而不是覆盖旧栈
  - `fleet_assign`：`payload.fleet_id` + `payload.formation` 必填；`formation` 取 `line|vee|circle|wedge`
  - `fleet_attack`：`payload.fleet_id` + `payload.planet_id` + `payload.target_id` 必填；当前只支持攻击同一 `system_id` 下的目标，且 `payload.target_id` 应来自目标行星 `/world/planets/{planet_id}/runtime.enemy_forces[].id`
  - `fleet_move`：`payload.fleet_id` + `payload.target_system_id` 必填；舰队必须属于当前玩家且 `state=idle`（attacking 或已在跃迁中的舰队会被拒绝）；目标星系必须存在、不是当前星系、且与当前星系有直达航线——服务端没有独立航线表，航线图按与星图渲染一致的 k 近邻规则从星系坐标导出（每个星系连接银河内最近的 2 个邻居，任一端点名即连通）；跃迁耗时固定 10 tick（`gamecore.FleetTransitTicks`），每 tick `remaining_ticks` 减 1，归零时舰队 authoritative 地迁入目标星系并发出 `fleet_arrived`；跃迁期间 `state` 保持 `idle`、`transit` 非空即跃迁中，舰队在到达前不计入任何星系的轨道优势评分
  - `fleet_disband`：`payload.fleet_id` 必填
  - `task_force_create`：`payload.task_force_id` 必填；可选 `payload.name` / `payload.stance`；未传 `stance` 时默认为 `hold`
  - `task_force_assign`：`payload.task_force_id` + `payload.member_kind` + `payload.member_ids[]` 必填；`member_kind` 当前只支持 `squad|fleet`；服务端会校验这些 runtime 成员归属当前玩家，并把成员从旧任务群 authoritative 地迁移到新任务群
  - `task_force_set_stance`：`payload.task_force_id` + `payload.stance` 必填；`stance` 取 `hold|patrol|escort|intercept|harass|siege|bombard|retreat_on_losses`；该姿态会真实进入 runtime 结算，影响目标优先级、交战距离、追击与撤退阈值
  - `task_force_deploy`：`payload.task_force_id` 必填；至少还需提供 `payload.system_id` / `payload.planet_id` / `payload.position` / `payload.frontline_id` / `payload.ground_order` 之一；可选 `payload.theater_id` / `payload.frontline_id` / `payload.ground_order` / `payload.support_mode`；若提供 `theater_id`，目标战区必须已存在且属于当前玩家；`ground_order` 当前支持 `occupy|advance|hold|clear_obstacles|escort_supply`，`support_mode` 当前支持 `none|fire_support|strike`；当前命令写入的是 authoritative 部署意图、战区绑定和行星层前线命令，不代表已有完整自动移动系统
  - `theater_create`：`payload.theater_id` 必填；可选 `payload.name`
  - `theater_define_zone`：`payload.theater_id` + `payload.zone_type` 必填；可选 `payload.system_id` / `payload.planet_id` / `payload.position` / `payload.radius`；`zone_type` 取 `primary|secondary|no_entry|rally|supply_priority`
  - `theater_set_objective`：`payload.theater_id` + `payload.objective_type` 必填；可选 `payload.system_id` / `payload.planet_id` / `payload.entity_id` / `payload.description`
  - `blockade_planet`：`payload.task_force_id` + `payload.planet_id` 必填；任务群必须属于当前玩家、且至少包含一个舰队成员；命令只写入 authoritative 封锁意图，真正是否 `active` 取决于后续 tick 中该任务群是否仍可用、且其所属玩家是否在目标恒星系取得制轨优势；当封锁 `active` 时，当前会真实拦截该行星的 `orbital_supply_port` / `interstellar_logistics_station` / `supply_ship` / `frontline_supply_drop` 军需补给节点，并累计 `interdicted_supply` / `interdicted_transports`
  - `landing_start`：`payload.task_force_id` + `payload.planet_id` 必填；可选 `payload.operation_id`；任务群必须属于当前玩家且具备正向 `transport_capacity`；命令会创建独立的 authoritative 登陆流程，不会把 `fleet_attack` 目标改成星球来伪装“已登陆”；后续 tick 会依次推进 `reconnaissance -> landing_window_open -> vanguard_landing -> beachhead_established`，若缺制轨、初始军需不足、登陆点不安全或任务群失效，则会转为 `result=failed`
  - `blueprint_create`：`payload.blueprint_id` + `payload.domain` 必填，且必须二选一提供 `payload.base_frame_id` 或 `payload.base_hull_id`；当前只创建玩家自有蓝图草案，不会生成任何部署载荷；若 `blueprint_id` 与公开预置蓝图或当前玩家已有蓝图重名，会直接拒绝
  - `blueprint_set_component`：`payload.blueprint_id` + `payload.slot_id` + `payload.component_id` 必填；只允许编辑 `draft` / `validated` 蓝图；这里允许先装入未来会被校验器判非法的组件组合，真正的 legality 以 `blueprint_validate` 结果为准；若蓝图是受控改型，只能修改 `allowed_variant_slots` 白名单中的槽位
  - `blueprint_validate`：`payload.blueprint_id` 必填；只允许校验 `draft` / `validated` 蓝图；服务端会返回结构化 `validation`，覆盖功率、体积、质量、刚性、热负荷、信号/隐形、维护成本以及 `hardpoint_mismatch` 等原因；当校验失败时，最终 authoritative `command_result.payload.validation.issues[]` 可直接用于 CLI/Web 展示
  - `blueprint_finalize`：`payload.blueprint_id` 必填；`payload.target_state` 可选，未传时按状态机走默认下一阶段（`validated -> prototype -> field_tested -> adopted -> obsolete`）；当前只允许合法迁移；从 `validated` 进入更高阶段前，蓝图必须已经通过校验
  - `blueprint_variant`：`payload.parent_blueprint_id` + `payload.blueprint_id` + `payload.allowed_slot_ids[]` 必填；父蓝图既可以是当前玩家已定型蓝图，也可以是公开预置蓝图；服务端会复制父蓝图的底盘、域和组件形成新的 `draft` 改型，并记录 `parent_blueprint_id`；后续只能修改 `allowed_slot_ids` 指定的槽位
  - `queue_military_production`：`payload.building_id` + `payload.deployment_hub_id` + `payload.blueprint_id` + `payload.count` 必填；目标 `building_id` 必须是当前玩家拥有、带 production module 且处于 `running` 的军工设施；目标 `deployment_hub_id` 必须是当前玩家拥有、带 deployment module 且处于 `running` 的部署枢纽；服务端会按蓝图 authoritative 结构拆成 `components -> assembly -> ready` 两阶段，并把成品写入 `/world/warfare/industry.deployment_hubs[].ready_payloads`
  - `refit_unit`：`payload.building_id` + `payload.unit_id` + `payload.target_blueprint_id` 必填；目标建筑必须是当前玩家拥有、带 production module 且处于 `running` 的翻修设施；`unit_id` 当前支持 `combat_squad.id` 与 homogeneous `fleet.id`；目标蓝图必须与源单位保持同域且复用同一底盘 / 船体；下发后 runtime 单位会先离场进入翻修单，完成后以同一 `unit_id` 和新的 `blueprint_id` 返回
  - `launch_solar_sail`：`payload.building_id` 必填；目标必须是处于可运行状态的 `em_rail_ejector`，且建筑本地存储中已装载足够 `solar_sail`；可选 `payload.count` / `payload.orbit_radius` / `payload.inclination`；`payload.count` 默认 `1`、单次最多 `10`；若发射器配置了轨道半径/倾角约束，`payload.orbit_radius` / `payload.inclination` 还必须落在该建筑运行参数允许范围内；太阳帆会自动进入当前发射器所在星球对应 `system_id` 的 snapshot-backed `space` runtime，同一次批量发射会为每张帆分配独立 `entity_id`；若命中发射器自身的成功率失败分支，会照样扣除已装载太阳帆，但不会生成 orbit entry 或 `entity_created`
  - `launch_rocket`：`payload.building_id` + `payload.system_id` 必填；`payload.layer_index` 可选，默认 `0`；`payload.count` 可选，默认 `1`，单次最多 `5`；目标必须是处于 `running` 状态的 `vertical_launching_silo`，且建筑本地存储中已装载足够 `small_carrier_rocket`；目标戴森层必须已存在至少一个 `node` / `frame` / `shell` scaffold；成功后会扣除火箭并返回 `rocket_launched` 事件；当前每枚火箭都会让目标层 `rocket_launches += 1`，并按 `min(0.5, rocket_launches * 0.02)` 重算 `construction_bonus`
  - `build_dyson_node`：`payload.system_id` / `payload.layer_index` / `payload.latitude` / `payload.longitude` 必填；`payload.orbit_radius` 可选；要求玩家已解锁 `dyson_component`；若目标层不存在，服务端会先自动补层，层半径优先取 `payload.orbit_radius`，否则回退为 `1.0 + 0.5 * layer_index`
  - `build_dyson_frame`：`payload.system_id` / `payload.layer_index` / `payload.node_a_id` / `payload.node_b_id` 必填；要求玩家已解锁 `dyson_component`；若目标层不存在，服务端会按同样规则自动补层；`node_a_id` / `node_b_id` 当前必须都已经存在于目标层
  - `build_dyson_shell`：`payload.system_id` / `payload.layer_index` / `payload.latitude_min` / `payload.latitude_max` / `payload.coverage` 必填；要求玩家已解锁 `dyson_component`；若目标层不存在，服务端会按同样规则自动补层
  - `demolish_dyson`：`payload.system_id` / `payload.component_type` / `payload.component_id` 必填；`payload.component_type` 当前只接受 `node|frame|shell`
- 戴森脚手架补充说明：`build_dyson_node` / `build_dyson_frame` / `build_dyson_shell` 当前仍是实验性直连入口，主要做科技校验与结构写入，不额外扣建筑材料；真正把已生产火箭转成戴森层收益的入口是 `launch_rocket`。`demolish_dyson` 当前只移除 runtime 里的结构，并把简化退款估算写进 `entity_destroyed.payload.refunds`，不会自动把这些退款写回玩家背包或资源池。
- 戴森中后期最小请求示例：
```json
{
  "request_id": "dyson-midgame-001",
  "issuer_type": "player",
  "issuer_id": "p1",
  "commands": [
    {
      "type": "transfer_item",
      "target": {"layer": "planet", "entity_id": "b-31"},
      "payload": {
        "building_id": "b-31",
        "item_id": "small_carrier_rocket",
        "quantity": 1
      }
    },
    {
      "type": "launch_rocket",
      "target": {"layer": "system", "system_id": "sys-1"},
      "payload": {
        "building_id": "b-31",
        "system_id": "sys-1",
        "layer_index": 0,
        "count": 1
      }
    }
  ]
}
```
- 示例补充说明：
  - 如果 `vertical_launching_silo` 还没自行产出火箭，可以先用 `transfer_item` 把背包里的 `small_carrier_rocket` 装进建筑本地存储。
  - `launch_rocket` 执行前，目标层必须已经存在至少一个 `build_dyson_*` 生成的脚手架。
- 地面站建造后为空库存、空电池、无端口、无运输器。行星站建造160矿/80能：3个物品槽、每项200，电池1000、最多充10/tick、基础用电1；星际站280矿/140能：5槽、每项500，电池10000、最多充30/tick、基础用电2。充电计入真实电网分配，先保障基础耗电，再用获配剩余电量充电；满电不再请求充电，玩家全局能量不能代替站内电池。初始场景地面站库存会自动配置 `none` 槽，超过槽数或单项容量则拒绝启动。
- 站点 `running` 时，每个皮带口最多6件/tick，连接相邻自有活动普通传送带并校验流向，支持cube球面跨面方向转换；先入后出、按物品过滤、满仓/满带背压。停电停止皮带IO与新航次；在途运输不依赖后续供电。站库和载具库存暂不保存喷涂元数据，因此带剩余喷涂用途的货物停在入口皮带，不静默剥离涂层。
- 调度先尝试供应站自有运输器送货（`delivery`），需求站闲置运输器还可空载前往供应站取货（`pickup`），到达时才从真实供给库存装货，返抵需求站后卸货。供给与需求都扣除在途预约以防重复派遣；被动供给/卸货无需对端供电，但起飞归属站必须有真实电网且电池足够。轨道采集器保持独立采集库存行为，由需求站车辆取货。
- 航次起飞一次预扣往返能源：无人机为 `2*max(1,球面距离)`；船按默认参数普通航行 `10*距离`，曲速 `30*距离`。开启曲速、距离达到阈值（默认20）、归属站拥有往返共2份 `space_warper` 且电池足够时优先曲速，否则尝试普通航行；曲速物品同样从归属站库存一次扣除，须先配其物品槽。`energy_cost` / `warp_item_spent` 表示本航次往返总支出。
- 去程与返程均经历 `takeoff → in_flight → landing`，`returning=true` 标记返航，回家卸完后才 `idle`。满仓允许部分卸货，余货保留在 `waiting_unload` / `destination_full`，空间恢复后继续；目标被拆/变敌则带货返航。归属站被拆/变敌且返抵时无法卸货会进入 `stranded` / `home_unavailable`，保留运输器与货物；尚无公共命令回收滞留运输器。跨星球仅结算已加载runtime，不能据此认定完整殖民及跨星系发展链已验收。
- 升级/拆除规则补充:
  - 受建筑定义中的 `upgrade` / `demolish` 规则约束（允许与否、最大等级、耗时、返还率、是否要求停机）。
  - 若 `duration_ticks > 0`，命令执行会创建 `job` 并将建筑状态置为 `paused`，在作业完成 Tick 时生效：升级后恢复原工作状态，拆除后释放占格并返还资源。
  - 垂直叠层（`position.z > 0`）级联拆除：拆除任一叠层时，同格所有更高叠层一并拆除（立即拆除与 `job` 完成两条路径行为一致），每层按各自建筑类型/等级以同一返还率退款，并各自发出 `entity_destroyed` 事件；拆除上层不影响下层与地面占格登记。
- 返回:
  - `400`：请求体非法、缺少 `request_id` / `issuer_type` / `issuer_id`、`commands` 为空等
  - `401`：缺少或使用了无效的 Bearer key
  - `403`：当 `issuer_type=player` 且 `issuer_id` 与当前鉴权玩家不一致
  - `429`：触发每玩家命令速率限制
  - `200`：重复 `request_id`，返回 `accepted=false` + `DUPLICATE`
  - `202`：通过网关预校验后返回；若 `accepted=false`，表示至少一个命令未通过预校验且整个请求不会入队
- 结果码:
  - `OK`
  - `INVALID_TARGET`
  - `NOT_OWNER`
  - `OUT_OF_RANGE`
  - `INSUFFICIENT_RESOURCE`
  - `DUPLICATE`
  - `VALIDATION_FAILED`
  - `ENTITY_NOT_FOUND`
  - `POSITION_OCCUPIED`
  - `UNAUTHORIZED`
  - `EXECUTOR_UNAVAILABLE`
  - `EXECUTOR_BUSY`
- 响应示例:
```json
{
  "request_id": "uuid",
  "accepted": true,
  "enqueue_tick": 120,
  "results": [
    {"command_index":0,"status":"accepted","code":"OK","message":"accepted, will execute at next tick"}
  ]
}
```
- 结构化预校验错误（`results[].issues[]`）:
  - gateway 在入队前做字段级结构校验；失败时 HTTP 仍为 `202`，但 `accepted=false` 且整批不入队
  - `results[].message` 保留人类可读摘要；`results[].issues[]` 给 agent/CLI 做机器可读修复
  - issue 字段：
    - `code`：`missing_field` / `invalid_value` / `unknown_command` / `unauthorized` / `duplicate_request`
    - `field`：出错路径，如 `payload.building_type`、`target.position`、`type`
    - `message`：该 issue 的人类可读说明
    - `expected`：合法取值提示（如 `"required"`、枚举列表、约束描述）
    - `actual`：实际收到的值（可选）
  - 预校验失败示例（缺 `target.position` 的 build）:
```json
{
  "request_id": "uuid",
  "accepted": false,
  "enqueue_tick": 120,
  "results": [
    {
      "command_index": 0,
      "status": "rejected",
      "code": "VALIDATION_FAILED",
      "message": "target.position is required",
      "issues": [
        {
          "code": "missing_field",
          "field": "target.position",
          "message": "target.position is required",
          "expected": "required"
        }
      ]
    }
  ]
}
```
  - 说明：本字段目前覆盖 gateway 预校验与权限拒绝；runtime 执行失败（tick 内 `command_result`）仍以 `code`/`message` 为主，后续可再扩展

---

**GET /events/snapshot**
- 说明: 事件快照查询（需认证），用于断线补拉
- 查询参数:
  - `event_types`（必填）：显式订阅的事件类型列表，逗号分隔；传 `all` 表示全部事件类型
  - `after_event_id`（推荐）：从指定事件之后开始返回
  - `since_tick`：从指定 tick 及以后开始返回（当 `after_event_id` 不可用时使用）
  - `limit`：最多返回事件数（默认 200，受服务端上限限制）
- 响应字段:
  - `event_types`：服务端实际采用的事件类型订阅列表
  - `since_tick` / `after_event_id`：原样回显请求游标（非空时返回）
  - `available_from_tick`：服务端当前仍可回溯到的最早 Tick
  - `next_event_id`：当前页最后一条事件 ID，可作为下一次增量拉取游标
  - `has_more`：是否还有后续事件
  - `events`：当前玩家可见的事件数组
- `event_type` 当前包括:
  - `command_result`
  - `entity_created`
  - `entity_moved`
  - `damage_applied`
  - `entity_destroyed`
  - `building_state_changed`
  - `resource_changed`
  - `tick_completed`
  - `production_alert`
  - `construction_paused`
  - `construction_resumed`
  - `research_completed`
  - `victory_declared`
  - `threat_level_changed`
  - `loot_dropped`
  - `entity_updated`
  - `rocket_launched`
  - `squad_deployed`
  - `fleet_commissioned`
  - `fleet_assigned`
  - `fleet_attack_started`
  - `fleet_move_started`
  - `fleet_arrived`
  - `fleet_disbanded`
  - `missile_salvo_fired`
  - `point_defense_intercept`
  - `battle_report_generated`
  - `landing_started`
  - `landing_failed`
  - `orbital_superiority_changed`
  - `supply_line_disrupted`
- 事件类型补充:
  - `command_result`：这是 `/commands` 异步执行后的 authoritative 最终结果回写；`payload.request_id` 对应原始请求，`command_index` 对应批内第几条命令。即使同步响应里已经返回 `accepted`，最终仍应以这里的 `status` / `code` / `message` 为准。命令类客户端的推荐对账路径是：SSE 主订阅 `command_result`，超时或重连后再用 `GET /events/snapshot?event_types=command_result` 做补账。
    - 对 `build`，如果这里只返回 `OK + construction task ... queued`，不要把它误判成“建筑已完全落地并可运行”；后续还应继续观察同坐标的 `entity_created` 与对应 `building_state_changed`
    - 对 `build` 超范围失败，当前常见失败消息就是 `executor out of range: <distance> > <operate_range>`；客户端可以直接把这条 authoritative message 翻译成移动执行体的下一步提示
    - 对 `blueprint_validate` / `blueprint_finalize` / `blueprint_variant` 这类战争蓝图命令，若 payload 里带有 `validation`，其结构与 `/world/warfare/blueprints*` 返回的 `validation` 一致；客户端应优先消费这份 authoritative 结构化原因，而不是自己二次拼错误文案
  - `resource_changed`：电力链路现在会在同一轮 authoritative 电力结算里只提交一次最终 `energy`；后续同 tick 的矿物/产出事件若继续复用 `resource_changed`，会沿用同一个最终 `energy` 值，不再在 `10000 -> 99xx -> 98xx` 间来回跳变。
  - `damage_applied`：当伤害来源为 `enemy_force -> building` 且命中了行星护盾时，payload 额外包含 `shield_absorbed`（本次被护盾吸收的伤害）与 `shield_remaining`（当前玩家所有 `running` 的 `planetary_shield_generator` 剩余总护盾值）。
  - `building_state_changed` 建筑状态变更事件，payload 包含 `building_id` / `building_type` / `prev_state` / `next_state` / `prev_reason` / `reason`；当同一建筑“状态没变但病因变了”时也会继续发这类事件，此时会表现为 `prev_state == next_state`，但 `prev_reason != reason`。当故障由维护不足触发时额外包含 `cause`（`maintenance_insufficient`）。供电接入失败原因包括 `power_no_connector` / `power_no_provider` / `power_out_of_range` / `power_capacity_full`；若建筑已经 `connected=true` 但当前 tick 因短缺或分配结果为 `0` 而拿不到电，则统一写成 `under_power`；`thermal_power_plant` / `mini_fusion_power_plant` / `artificial_star` 这类燃料型发电建筑在 `input_buffer + inventory` 中都没有可达燃料时，则会写成 `no_fuel`。若某个 tick 已成功发电，则不会再在同一 tick 末尾反向闪回 `running -> no_power/no_fuel`。
    - 当前 Web 建造账本会把 `entity_created` 与后续 `building_state_changed` 收口到同一条结果，用于给新建建筑生成“补供电塔 / 补发电 / 扩容电网”这类下一步提示；如果你要实现同类客户端，至少需要同时订阅这两类事件
  - `production_alert` 产线监控告警事件，payload 包含 `alert`（告警对象：`alert_id`/`tick`/`player_id`/`building_id`/`building_type`/`alert_type`/`severity`/`message`/`metrics`/`details`）。同一建筑同一类型的持续告警条件每个冷却窗口最多重发一次该事件；快照侧（`GET /alerts/production/snapshot`）会把重复发生聚合为单条目的 `last_tick` / `repeat_count`。
  - `victory_declared` 胜利宣告事件，payload 包含 `winner_id` / `reason` / `victory_rule`；若是 `mission_complete` 科研获胜，还会额外携带 `tech_id = "mission_complete"`。
  - 若 `mission_complete` 在当前 tick 完成，事件顺序会先出现 `research_completed`，再出现 `victory_declared`。
  - `rocket_launched` 戴森火箭发射事件，payload 包含 `building_id` / `system_id` / `layer_index` / `count` / `rocket_launches` / `construction_bonus` / `layer_energy_output`；其中 `construction_bonus` 与 `GET /world/systems/{system_id}/runtime.dyson_sphere.layers[].construction_bonus` 共享同一份 tick 内 authoritative 结果。
  - `squad_deployed`：地面小队部署事件，payload 包含 `squad_id` / `squad`；同时还会伴随一条 `entity_created(entity_type = "combat_squad")`。
  - `fleet_commissioned`：舰队编成事件，payload 包含 `fleet_id` / `fleet`；同时还会伴随一条 `entity_created(entity_type = "fleet")`。
  - `fleet_assigned`：舰队改编队事件，payload 包含 `fleet_id` / `formation`。
  - `fleet_attack_started`：舰队开始攻击事件，payload 包含 `fleet_id` / `planet_id` / `target_id`；后续太空战细节会继续通过 `missile_salvo_fired` / `point_defense_intercept` / `battle_report_generated` 与常规 `damage_applied` / `entity_destroyed` 体现。
  - `fleet_move_started`：舰队跃迁开始事件，payload 包含 `fleet_id` / `from_system_id` / `to_system_id` / `total_ticks`。
  - `fleet_arrived`：舰队跃迁到达事件，payload 包含 `fleet_id` / `system_id`（抵达星系）/ `from_system_id`。
  - `fleet_disbanded`：舰队解散事件，payload 包含 `fleet_id`。
  - `missile_salvo_fired`：导弹齐射事件，payload 至少包含 `fleet_id` / `target_id` / `target_type` / `launched` / `intercepted` / `drifted` / `lock_quality` / `jamming_penalty`；若来源是敌对势力还会额外写 `source = "enemy_force"`
  - `point_defense_intercept`：点防拦截事件，payload 至少包含 `fleet_id` / `target_id` / `target_type` / `intercepted` / `remaining`
  - `battle_report_generated`：太空战战报生成事件，payload 包含 `battle_id` / `fleet_id` / `report`；`report` 结构与 `GET /world/systems/{system_id}/runtime.battle_reports[]` 一致
  - `landing_started`：登陆投送启动事件，payload 包含 `operation_id` / `planet_id` / `task_force_id`
  - `landing_failed`：登陆投送失败事件，payload 包含 `operation_id` / `planet_id` / `blocked_reason`
  - `orbital_superiority_changed`：恒星系制轨态变化事件，payload 包含 `system_id` / `advantage_player_id` / `contest_intensity` / `reason`
  - `supply_line_disrupted`：当前仍作为封锁拦截预留事件类型；本轮实现的 authoritative 拦截计数先体现在 `planet_blockades[].interdicted_*` 中，后续若事件化会沿用该名字
- 响应示例:
```json
{
  "event_types": ["command_result"],
  "available_from_tick": 100,
  "since_tick": 120,
  "next_event_id": "evt-123-5",
  "has_more": false,
  "events": [
    {
      "event_id": "evt-123-1",
      "tick": 123,
      "event_type": "command_result",
      "visibility_scope": "p1",
      "payload": {
        "request_id": "req-001",
        "command_index": 0,
        "command_type": "build",
        "status": "executed",
        "code": "OK",
        "message": "construction task c-1 queued at (10,12)"
      }
    }
  ]
}
```

---

**GET /alerts/production/snapshot**
- 说明: 产线监控告警快照查询（需认证），用于断线补拉告警列表
- 查询参数:
  - `after_alert_id`（推荐）：从指定告警之后开始返回
  - `since_tick`：从指定 tick 及以后开始返回（当 `after_alert_id` 不可用时使用）
  - `limit`：最多返回告警数（默认取服务端 `alert_history_limit` 配置；本仓库默认配置应用后为 1000）
- 响应字段:
  - `since_tick` / `after_alert_id`：原样回显请求游标（非空时返回）
  - `available_from_tick`：服务端当前仍可回溯到的最早 Tick
  - `next_alert_id`：当前页最后一条告警 ID，可作为下一次增量拉取游标
  - `has_more`：是否还有后续告警
  - `alerts`：当前认证玩家的告警数组
- 告警聚合语义:
  - 同一 `building_id` + `alert_type` 在快照中只保留一个条目，持续存在的告警条件不会刷出新条目
  - `tick`：首次发生 tick（条目身份不变）；`last_tick`：最近一次重复发生 tick（仅在有重复时返回）；`repeat_count`：首次之后被聚合的重复次数
  - 重复发生时 `severity` / `metrics` / `details` 刷新为最新采样值，`alert_id` 与列表位置保持不变，游标分页不受影响
  - `alert_id` 格式为 `alert-<tick>-<building_id>-<alert_type>`
  - 重复发生仍会按冷却窗口（`alert_cooldown_ticks`）发出 `production_alert` 事件，快照侧始终聚合
- 监控覆盖范围:
  - 有配方的生产建筑（`functions.production`）：全部 5 类告警
  - 采集建筑（`functions.collect`：`mining_machine` / `advanced_mining_machine` / `water_pump` / `oil_extractor`）：只产生 `output_blocked`（本地仓储与输出缓冲全部堵满、采集停产）与 `power_shortage`，不产生 `backlog` / `input_shortage` / `throughput_drop`
- `alert_type` 当前包括:
  - `throughput_drop`
  - `backlog`
  - `input_shortage`
  - `output_blocked`
  - `power_shortage`
- 响应示例:
```json
{
  "available_from_tick": 100,
  "since_tick": 120,
  "next_alert_id": "alert-123-b-1-backlog",
  "has_more": false,
  "alerts": [
    {
      "alert_id": "alert-123-b-1-backlog",
      "tick": 123,
      "last_tick": 163,
      "repeat_count": 2,
      "player_id": "p1",
      "building_id": "b-1",
      "building_type": "arc_smelter",
      "alert_type": "backlog",
      "severity": "warning",
      "message": "building b-1 backlog rising",
      "metrics": {
        "throughput": 2,
        "backlog": 3,
        "idle_ratio": 0.1,
        "efficiency": 0.5,
        "input_shortage": false,
        "output_blocked": false,
        "power_state": "running"
      },
      "details": {"backlog_ratio": 1.5}
    }
  ]
}
```

---

**POST /save**
- 说明: 手动触发一次存档写入（需认证），把当前世界状态刷新到 `server.data_dir/save.json`。
- 请求体:
```json
{
  "reason": "manual"
}
```
- 字段说明:
  - `reason`: 可选，保存触发标签；Web 顶栏默认传 `manual`，CLI 可通过 `save --reason <text>` 自定义。
- 响应字段:
  - `ok`: 固定为 `true`
  - `tick`: 本次保存时的世界 tick
  - `saved_at`: 实际落盘时间（RFC3339）
  - `path`: 本次刷新的 `save.json` 路径
  - `trigger`: 本次保存触发标签
- 响应示例:
```json
{
  "ok": true,
  "tick": 4386,
  "saved_at": "2026-04-02T12:10:00Z",
  "path": "/tmp/sw-game/save.json",
  "trigger": "manual"
}
```
- 补充说明: 该接口不会创建历史存档点，只会覆盖当前工作目录中的 `save.json`；如果游戏目录未挂载或磁盘写入失败，会返回 `500`。

**POST /replay**
- 说明: Tick 重放控制接口（需认证），基于最近快照重放命令日志，用于一致性校验与调试。
- 请求体:
```json
{
  "from_tick": 120,
  "to_tick": 180,
  "step": false,
  "speed": 5,
  "verify": true
}
```
- 字段说明:
  - `from_tick`: 起始 tick（为 0 时默认等于 `to_tick`）
  - `to_tick`: 结束 tick（为 0 时默认取当前世界 tick）
  - `to_tick` 不可超过当前世界 tick
  - `step`: 单步模式；启用时仅重放到 `from_tick`
  - `speed`: 目标重放速度（ticks/s，允许为 0；`>0` 时按该速度节流）
  - `verify`: 是否开启一致性校验（命令结果对比 + 可用快照哈希比对）
- 补充说明: 实际重放从 `snapshot_tick + 1` 开始，确保覆盖 `from_tick` 的命令。
- 响应字段补充:
  - `result_mismatch_count`：仅在 `verify=true` 时返回
  - `snapshot_digest`：仅在 `verify=true` 且目标 tick 存在可恢复快照时返回
  - `notes`：可选说明信息，例如目标快照缺失时的提示
  - `digest` / `snapshot_digest` 现在额外包含 `space_entity_counter` / `solar_sail_count` / `solar_sail_systems` / `solar_sail_total_energy`，用于覆盖 `space` runtime 一致性
- 响应示例:
```json
{
  "from_tick": 120,
  "to_tick": 180,
  "snapshot_tick": 100,
  "replay_from_tick": 101,
  "replay_to_tick": 180,
  "applied_ticks": 80,
  "command_count": 12,
  "result_mismatch_count": 0,
  "duration_ms": 45,
  "step": false,
  "speed": 5,
  "digest": {
    "tick": 180,
    "players": 2,
    "alive_players": 2,
    "buildings": 4,
    "units": 2,
    "resources": 12,
    "total_minerals": 180,
    "total_energy": 90,
    "resource_remaining": 9800,
    "entity_counter": 8,
    "space_entity_counter": 4,
    "solar_sail_count": 2,
    "solar_sail_systems": 1,
    "solar_sail_total_energy": 20,
    "hash": "..."
  },
  "snapshot_digest": {
    "tick": 180,
    "players": 2,
    "alive_players": 2,
    "buildings": 4,
    "units": 2,
    "resources": 12,
    "total_minerals": 180,
    "total_energy": 90,
    "resource_remaining": 9800,
    "entity_counter": 8,
    "space_entity_counter": 4,
    "solar_sail_count": 2,
    "solar_sail_systems": 1,
    "solar_sail_total_energy": 20,
    "hash": "..."
  },
  "drift_detected": false
}
```

---

**POST /rollback**
- 说明: Tick 回滚控制接口（需认证），基于快照回退到指定 Tick 并重放命令日志，适用于调试与运维。
- 请求体:
```json
{
  "to_tick": 120
}
```
- 字段说明:
  - `to_tick`: 目标回滚 tick（为 0 时默认取当前世界 tick）
  - `to_tick` 不可超过当前世界 tick
- 响应字段补充:
  - `notes`：可选说明信息
  - `digest` 现在额外包含 `space_entity_counter` / `solar_sail_count` / `solar_sail_systems` / `solar_sail_total_energy`
- 响应示例:
```json
{
  "from_tick": 180,
  "to_tick": 120,
  "snapshot_tick": 100,
  "replay_from_tick": 101,
  "replay_to_tick": 120,
  "applied_ticks": 20,
  "command_count": 6,
  "duration_ms": 30,
  "trimmed_command_log": 4,
  "trimmed_event_history": 10,
  "trimmed_alert_history": 6,
  "trimmed_snapshots": 2,
  "trimmed_deltas": 0,
  "digest": {
    "tick": 120,
    "players": 2,
    "alive_players": 2,
    "buildings": 4,
    "units": 2,
    "resources": 12,
    "total_minerals": 180,
    "total_energy": 90,
    "resource_remaining": 9800,
    "entity_counter": 8,
    "space_entity_counter": 0,
    "solar_sail_count": 0,
    "solar_sail_systems": 0,
    "solar_sail_total_energy": 0,
    "hash": "..."
  }
}
```

---

**GET /events/stream**
- 说明: SSE 事件流（需认证）
- 查询参数:
  - `event_types`（必填）：显式订阅的事件类型列表，逗号分隔；传 `all` 表示全部事件类型
- 事件格式: `event: connected` + `data: {"player_id":"p1","event_types":["command_result"]}`；`event: game` + `data: <GameEvent JSON>`
- 心跳: 服务端每 25 秒发送一行 SSE 注释 `: ping` 保活连接并供客户端做存活检测；客户端应按 SSE 规范忽略注释行。若超过约 3 个心跳周期未收到任何字节，应判定连接静默死亡并主动重连
- `GameEvent.event_type` 取值与 `GET /events/snapshot` 一致；`payload` 结构随事件类型变化
- 补充说明:
  - 服务端不再默认自动推送全部事件；只有显式订阅的 `event_types` 才会进入该 SSE 连接
  - 事件历史按类型独立保留，高频事件不会再把 `command_result` 这类低频关键事件挤出窗口
  - 对命令类前端，建议至少订阅 `command_result`；`/commands` 的同步 `accepted` 只表示已受理，最终 authoritative 结果仍通过该事件流返回
  - `rocket_launched` 事件 payload 当前包含 `building_id` / `system_id` / `layer_index` / `count` / `rocket_launches` / `construction_bonus` / `layer_energy_output`
  - 高阶单位公开链路新增的 `squad_deployed` / `fleet_commissioned` / `fleet_assigned` / `fleet_attack_started` / `fleet_disbanded` 也会通过同一 SSE 通道推送，payload 结构与 `GET /events/snapshot` 一致
- GameEvent 示例:
```json
{
  "event_id": "evt-123-tick",
  "tick": 123,
  "event_type": "tick_completed",
  "visibility_scope": "all",
  "payload": {
    "tick": 123,
    "duration_ms": 8
  }
}
```

### 球面接缝场景查询

`GET /world/planets/{planet_id}/scene` 新增可选整数 `near_x`、`near_y`、`radius`。radius 为 0..128；非零时须同时提供有效图集中心坐标。原 x/y/width/height 仍裁剪图集矩形。响应增加 `surface_patches: [{bounds, terrain, visible, explored}]`；每片采用独立图集坐标，实体集合合并至主响应并去重，可见性规则同主窗口。scene、overview、planet、planet summary、state summary、agent briefing、fog 与世界快照均返回 `surface` 元数据。

### 球面路径规划

`GET /world/planets/{planet_id}/path?unit_id=U&target_x=X&target_y=Y&stop_range=R`：为自己的单位规划已探索地表上的最短可行路径。R 可选，默认 0，允许 0..128；非零时在目标球面图距离 R 内停下。非法参数/非自己的单位返回 400。最多规划 512 步；目标未探索或预算内不可达时 `reachable=false, distance=-1, path=[], waypoints=[]`，不泄漏未知地图。

响应：`planet_id`、`surface`、`reachable`、`distance`、`path`（含起点的逐格路线）、`waypoints`（不含起点，按单位 move_range 切分）。规划只使用已探索地形和可见建筑；实际移动命令仍校验当前权威障碍，局势变化时客户端重新查询。

跨面补片的未探索地形返回 `unknown`，补片资源仅在已探索格返回。scene 单窗口尺寸上限为 257（容纳半径 128 的完整中心行）。

`overview.step` 会向下选择不超过请求值的 face_size 约数，保证缩略图分箱不混合不同立方体面；客户端须使用响应的实际 step。

## 仓库配送器

以下命令使用普通 `/commands` 信封，`target.layer="planet"`，`target.entity_id` 指向己方配送器（机甲请求指向己方 executor）。必须有 management 权限。

| 命令 | payload | 行为 |
| --- | --- | --- |
| `configure_distributor` | `item_id`、`mode`（none/supply/demand）、`local_storage` 非负整数；可选布尔 `player_delivery_enabled`、`player_collection_enabled` | 配置单种固体物品；省略开关保留原值。空物品仅允许关闭、保有量0且机甲开关全关。保有量不得超过宿主总容量。 |
| `install_logistics_bot` | `quantity` 正整数、`source`（player/storage，默认player） | 消耗背包或宿主可输出库存中的真实 logistics_bot，最多安装10个。科技门禁：需已研究解锁 `logistics_bot` 配方的科技（`distribution_logistics`），未研究返回 `VALIDATION_FAILED`（"research required"）且不消耗物品。 |
| `uninstall_logistics_bot` | `quantity` 正整数 | 仅回收空载停靠机器人到玩家背包，数量不足原子失败。 |
| `configure_mecha_logistics` | `requests: {"motor":{"min":5,"max":10}}` | 整体替换，空对象清空；最多8种固体物品，0≤min≤max≤1000且max>0。 |

`build logistics_distributor` 指向己方 depot_mk1/mk2 的原点；服务器设置z=1，不占地面，一仓一个。必须先回收机器人才能拆配送器，再拆宿主仓库。

配送范围12格，机器人每tick移动2个球面邻格、载货10件；配送器储能1000、最高充电10/tick。仓间供给送货和需求方主动取货均支持；供给只输出超出保有量部分，需求补到保有量。机甲背包低于min时补到max，高于max时回收到max；只有活动星球机甲参与，且需启用配送器对应开关。机甲开关独立于仓间mode。每次飞行预付能量，保留返航预算；停电禁止新派遣，在途继续。目标满仓保货等待、失效则返航，基地失效保留stranded及货物，尚无滞留回收命令。

`GET /world/planets/{id}/runtime` 返回己方 `logistics_distributors`（building_id/owner_id/position/state/bot_ids/host_available/inventory）和 `logistics_bots`。机器人含真实position、home_pos、target_pos、target_kind、trip_kind、cargo、status、returning、energy_cost、energy_remaining等；仓库仍是唯一库存源，inventory为主仓和输入输出缓存合计。Building也带distributor，MechaState带logistics_requests；快照保存并恢复这些状态。

成功配置配送器发送所属玩家可见的 `entity_updated`，机甲请求配置发送 `mecha_state_changed`。装卸机器人发送 `entity_updated`；发生背包扣除/返还时另发送 `resource_changed`（item_id、inventory_qty）。前端据此刷新详情，库存与充电状态直接读取每tick更新的runtime。
