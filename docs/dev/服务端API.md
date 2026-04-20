# 服务端 API 文档

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
- 第一版不做多槽位或命名存档点，自动保存与手动保存都会覆盖同一份 `save.json`。
- 第一版不持久化 RNG 状态；续档后未来随机事件不保证与不停服持续运行时完全一致。
- `save.json.runtime_state` 现在会额外持久化 `winner` / `victory_reason` / `victory_rule` / `victory_tech_id`，保证科技胜利、续档、回放、回滚后的胜利态一致。
- `save.json.snapshot.space` 现在会持久化 top-level `SpaceRuntimeState`；太阳帆 orbit 已按 `player + system` 分桶进入同一份 snapshot-backed runtime，续档、回放、回滚会保留一致的空间实体计数与轨道状态。

**普通新局默认入口**
- `config-dev.yaml + map.yaml` 现在就是一条可直接从 fresh save 起步的官方路线。
- `battlefield.victory_rule` 当前支持 `elimination`、`mission_complete`、`hybrid` 三种取值；仓库内当前提供的 `config.yaml`、`config-dev.yaml`、`config-midgame.yaml` 都显式设置为 `hybrid`，即 `mission_complete` 科研胜利与基地消灭胜同时有效。
- 默认新局里，每名玩家仍只预完成 `dyson_sphere_program`；这门 0 级科技现在会直接解锁 `matrix_lab + wind_turbine`，因此第一条真实入口是先补风机、再摆研究站。
- `config-dev.yaml` 会为每名玩家预置一份最小启动包：
  - `minerals = 240`
  - `energy = 100`
  - `inventory`: `electromagnetic_matrix x50`
- `battlefield_analysis_base` 本身不发电；如果不先补 `wind_turbine`，第一台空 `matrix_lab` 会停在无电状态。
- 这份启动包的用途不是跳过前期，而是覆盖默认新局到第一条自给电磁矩阵产线之间的前期科研真空段；研究系统仍然要求真实 `running` 研究站与真实矩阵消耗。
- 当前默认图上一组可直接复现的 starter 闭环是：`build 3 2 wind_turbine` -> `build 2 3 matrix_lab` -> `transfer <matrix_lab_id> electromagnetic_matrix 10` -> `start_research electromagnetism` -> `build 4 2 tesla_tower` -> `build 5 1 mining_machine`；完成后首台研究站仍保留，且还剩 `20 minerals`。

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
- 当前官方 midgame 场景同样**不**直接预置 `prototype` / `precision_drone` / `corvette` / `destroyer`；这些单位线现在已经是公开 API 能力，但仍要求玩家自己走 `research -> blueprint -> queue_military_production -> deploy_squad|commission_fleet` 这条最小闭环。
- `map` 配置新增 `overrides.planets.<planet_id>.kind`，可强制把某颗行星覆盖成 `gas_giant`、`rocky` 或 `ice`，不再依赖 seed 抽卡。当前 `map-midgame.yaml` 把 `planet-1-2` 强制设成 `gas_giant`，用于验证 `orbital_collector` 与戴森中后期路线。

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
- 响应字段: `tick` 当前 tick；`players` 玩家可见状态（仅自己返回完整 `PlayerState`）；`winner` 已决出胜者时存在；`victory_reason` / `victory_rule` 在已宣告胜利时返回；`active_planet_id` 当前被模拟的行星；`map_width` / `map_height` 当前行星尺寸
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
    - 当前 Web 建造前检查使用 `executor.unit_id + operate_range`，再结合对应行星视图里该执行体的 `position` 按 `ManhattanDist` 做预检；这只是客户端提示，不替代服务端执行阶段的最终校验
  - `executors`：按 `planet_id` 组织的执行体映射；字段结构与 `executor` 相同。`executor` 仍保留为当前 active planet 上下文的兼容镜像
  - `tech` 字段说明:
    - `player_id` / `completed_techs` / `current_research` / `research_queue` / `total_researched`
    - `completed_techs` 当前对外仍是 `{tech_id: level}` 的 level map；Web 研究派生层会在本地把它归一化成“已完成科技 ID 列表”，但接口本身尚未切到扁平 `string[]`
    - `current_research` / `research_queue` 元素字段：`tech_id` / `state` / `progress` / `total_cost` / `current_level` / `required_cost` / `consumed_cost` / `blocked_reason` / `enqueue_tick` / `complete_tick`
    - `progress` / `total_cost` 现在对应真实矩阵消耗进度；`required_cost` / `consumed_cost` 中的矩阵物品统一使用 canonical ID：`electromagnetic_matrix`、`energy_matrix`、`structure_matrix`、`information_matrix`、`gravity_matrix`、`universe_matrix`
    - `blocked_reason` 当前常见值为 `waiting_lab` / `waiting_matrix` / `invalid_tech`
    - 当前 `client-web` 的阶段化研究工作台主要依赖 `completed_techs`、`current_research.tech_id`、`progress`、`total_cost`、`required_cost`、`blocked_reason` 来派生“当前可研究 / 已完成 / 尚未满足前置”分组，以及“缺研究站 / 缺矩阵”提示
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
      "player_id":"p1",
      "team_id":"team-1",
      "role":"commander",
      "resources":{"minerals":200,"energy":100},
      "inventory":{"iron_ingot":20,"circuit_board":5},
      "permissions":["*"],
      "executor":{"unit_id":"u-1","build_efficiency":1,"operate_range":6,"concurrent_tasks":2,"research_boost":0},
      "is_alive":true
    },
    "p2": {"player_id":"p2","team_id":"team-2","role":"commander","is_alive":true}
  },
  "active_planet_id": "planet-1-1",
  "map_width": 32,
  "map_height": 32
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
  - `consumption` 使用 power allocation 的真实 `allocated`
  - `current_stored` 读取各储能建筑的 `energy_storage.energy`，不再复用建筑 HP
  - `shortage_ticks` 只在本 tick 任一玩家网络 `shortage=true` 时累加
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
  - 当前会公开四类 system-scoped runtime：
    - `solar_sail_orbit`
    - `dyson_sphere`
  - `active_planet_context`
  - `fleets`
  - `task_forces`
  - `theaters`
  - `active_planet_context` 只在当前 `active_planet_id` 属于该 system，且该 active world 已加载时返回；它不会跨其他行星做扫描补数
  - `active_planet_context` 只是当前 active world 上玩家自有 `em_rail_ejector` / `vertical_launching_silo` / `ray_receiver` 的聚合计数，本身不等于该 system 已经存在 `space runtime`；不过当前官方 midgame 会同时用 `scenario_bootstrap` 预置行星锚点和 system runtime 锚点，所以 fresh 启动后通常会直接看到非零计数与 `available=true`
  - `fleets` 由 `commission_fleet` 写入 top-level `SpaceRuntimeState`；当前只会返回当前玩家自己在该 `system_id` 下的舰队
  - `fleets[].units[].blueprint_id` 是 authoritative 编成来源；`unit_type` 当前仍与 `blueprint_id` 保持同值，仅作为兼容镜像保留
  - `task_forces` 由 `task_force_create|task_force_assign|task_force_set_stance|task_force_deploy` 写入同一份 `SpaceRuntimeState`；成员当前支持 `fleet` 与 `combat_squad` 两类 authoritative runtime 引用
  - `task_forces[].command_capacity` 会返回当前任务群的 authoritative 指挥容量、来源、占用和超编惩罚；当前来源至少覆盖 `command_center` / `command_ship` / `battlefield_analysis_base` / `military_ai_core`
  - `theaters` 由 `theater_create|theater_define_zone|theater_set_objective` 写入同一份 `SpaceRuntimeState`；当前按 `system_id` 归属，不做跨恒星系聚合
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
  - `active_planet_context`：包含 `planet_id` / `em_rail_ejector_count` / `vertical_launching_silo_count` / `ray_receiver_count` / `ray_receiver_modes`
  - `active_planet_context.ray_receiver_modes`：键为 `power` / `photon` / `hybrid`，值为当前 active planet 上该模式的射线接收站数量
  - `fleets`：包含 `fleet_id` / `owner_id` / `system_id` / `source_building_id` / `formation` / `state` / `units` / `target`
  - `fleets[].target`：当前仅在舰队已收到 `fleet_attack` 后存在；字段为 `planet_id` + `target_id`，其中 `target_id` 当前应对应同一恒星系目标行星 `/world/planets/{planet_id}/runtime.enemy_forces[].id`
  - `task_forces`：包含 `task_force_id` / `owner_id` / `system_id` / `theater_id` / `stance` / `status` / `members` / `deployment_target` / `behavior` / `command_capacity`
  - `task_forces[].members[]`：包含 `unit_kind` / `unit_id` / `system_id` / `planet_id`；`unit_kind` 当前只会是 `fleet` 或 `combat_squad`
  - `task_forces[].deployment_target`：包含 `layer` / `system_id` / `planet_id` / `position`
  - `task_forces[].behavior`：包含 `target_priority` / `engagement_range_multiplier` / `pursue` / `preserve_stealth` / `retreat_loss_threshold`
  - `task_forces[].command_capacity`：包含 `total` / `used` / `over` / `sources` / `penalty`
  - `task_forces[].command_capacity.sources[]`：包含 `type` / `source_id` / `label` / `capacity`
  - `task_forces[].command_capacity.penalty`：包含 `delay_ticks` / `hit_rate_multiplier` / `formation_multiplier` / `coordination_multiplier`
  - `theaters`：包含 `theater_id` / `owner_id` / `system_id` / `name` / `zones` / `objective` / `task_force_ids`
  - `theaters[].zones[]`：包含 `zone_type` / `system_id` / `planet_id` / `position`
  - `theaters[].objective`：包含 `objective_type` / `target_system_id` / `target_planet_id` / `position`
- 响应示例:
```json
{
  "system_id": "sys-1",
  "discovered": true,
  "available": true,
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
      "units": [{"blueprint_id": "corvette", "unit_type": "corvette", "count": 1}]
    }
  ],
  "task_forces": [
    {
      "task_force_id": "tf-alpha",
      "owner_id": "p1",
      "system_id": "sys-1",
      "theater_id": "theater-home",
      "stance": "aggressive_pursuit",
      "status": "engaging",
      "members": [
        {"unit_kind": "fleet", "unit_id": "fleet-demo", "system_id": "sys-1"}
      ],
      "deployment_target": {
        "layer": "planet",
        "system_id": "sys-1",
        "planet_id": "planet-1-1",
        "position": {"x": 11, "y": 11}
      },
      "behavior": {
        "target_priority": "highest_threat",
        "engagement_range_multiplier": 1.25,
        "pursue": true,
        "preserve_stealth": false,
        "retreat_loss_threshold": 0
      },
      "command_capacity": {
        "total": 20,
        "used": 37,
        "over": 17,
        "sources": [
          {"type": "command_center", "source_id": "command-center:p1", "label": "Strategic Command", "capacity": 4},
          {"type": "battlefield_analysis_base", "source_id": "base-1", "label": "Battlefield Analysis Base", "capacity": 6},
          {"type": "military_ai_core", "source_id": "ai-core-1", "label": "Military AI Core", "capacity": 5},
          {"type": "command_ship", "source_id": "fleet-demo", "label": "Flag Command Ship", "capacity": 5}
        ],
        "penalty": {
          "delay_ticks": 5,
          "hit_rate_multiplier": 0.45,
          "formation_multiplier": 0.4,
          "coordination_multiplier": 0.35
        }
      }
    }
  ],
  "theaters": [
    {
      "theater_id": "theater-home",
      "owner_id": "p1",
      "system_id": "sys-1",
      "name": "Home Theater",
      "zones": [
        {"zone_type": "primary", "system_id": "sys-1", "planet_id": "planet-1-1"}
      ],
      "objective": {
        "objective_type": "secure_orbit",
        "target_system_id": "sys-1",
        "target_planet_id": "planet-1-1"
      },
      "task_force_ids": ["tf-alpha"]
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
  - `fleet_id` / `owner_id` / `system_id` / `source_building_id` / `formation` / `state` / `units` / `target` / `weapon` / `shield` / `last_attack_tick`

**GET /world/fleets/{fleet_id}**
- 说明: 单舰队 authoritative 详情（需认证）
- 响应字段:
  - `fleet_id` / `owner_id` / `system_id` / `source_building_id`
  - `formation` / `state`
  - `units`
  - `target`
  - `weapon`
  - `shield`
  - `last_attack_tick`
- 响应示例:
```json
{
  "fleet_id": "fleet-demo",
  "owner_id": "p1",
  "system_id": "sys-1",
  "source_building_id": "b-1",
  "formation": "wedge",
  "state": "idle",
  "units": [{"blueprint_id": "corvette", "unit_type": "corvette", "count": 1}],
  "weapon": {"type": "laser", "damage": 40, "fire_rate": 10, "range": 24, "ammo_cost": 0},
  "shield": {"level": 40, "max_level": 40, "recharge_rate": 2, "recharge_delay": 10}
}
```

**GET /world/task-forces**
- 说明: 当前玩家可见任务群列表（需认证）
- 说明补充:
  - 当前只返回当前玩家自己在 `space runtime` 中拥有的任务群
  - 空列表固定返回 `[]`
- 响应字段:
  - `task_force_id` / `owner_id` / `system_id` / `theater_id` / `stance` / `status` / `members` / `deployment_target` / `behavior` / `command_capacity`

**GET /world/task-forces/{task_force_id}**
- 说明: 单任务群 authoritative 详情（需认证）
- 响应字段:
  - `task_force_id` / `owner_id` / `system_id` / `theater_id`
  - `stance` / `status`
  - `members`
  - `deployment_target`
  - `behavior`
  - `command_capacity`

**GET /world/theaters**
- 说明: 当前玩家可见战区列表（需认证）
- 说明补充:
  - 当前只返回当前玩家自己在 `space runtime` 中拥有的战区
  - 空列表固定返回 `[]`
- 响应字段:
  - `theater_id` / `owner_id` / `system_id` / `name` / `zones` / `objective` / `task_force_ids`

**GET /world/theaters/{theater_id}**
- 说明: 单战区 authoritative 详情（需认证）
- 响应字段:
  - `theater_id` / `owner_id` / `system_id` / `name`
  - `zones`
  - `objective`
  - `task_force_ids`

**GET /world/planets/{planet_id}**
- 说明: 行星概要（需认证）
- 说明补充:
  - 该接口只返回轻量摘要，不再返回整张 `terrain` / `fog` / `buildings` / `units`
  - 未发现行星只保证 `planet_id` 与 `discovered=false`
  - 服务端现在按 `{planet_id}` 直接读取对应行星 runtime，而不是借用当前 active planet 的世界状态
  - 只要目标行星 runtime 已加载，`tick` / `building_count` / `unit_count` 就来自该行星自身，并按当前玩家可见性统计
  - 若目标行星已发现但 runtime 尚未加载，`building_count` / `unit_count` 保持 `0`；`resource_count` 仍返回当前已知总资源点数
- 响应字段:
  - `planet_id` / `system_id` / `name` / `discovered` / `kind`
  - `map_width` / `map_height`
  - `tick`
  - `building_count` / `unit_count` / `resource_count`
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "system_id": "sys-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "map_width": 2000,
  "map_height": 2000,
  "tick": 120,
  "building_count": 84,
  "unit_count": 12,
  "resource_count": 463
}
```

**GET /world/planets/{planet_id}/overview**
- 说明: 行星全局总览读模型（需认证）
- 说明补充:
  - 用于整颗行星的全局缩放渲染，按固定步长对原始地图做下采样聚合
  - 该接口不返回逐 tile 级别建筑、单位、资源明细，而是返回聚合后的地形、迷雾和计数矩阵
  - 未发现行星只返回 `planet_id` / `discovered=false` / `map_width` / `map_height` / `step` / `cells_width` / `cells_height`
  - 只要目标行星 runtime 已加载，就会返回该行星自己的当前迷雾与聚合计数，不要求它是 active planet
  - 若目标行星已发现但 runtime 尚未加载，当前会回退为静态地形骨架与空计数矩阵，不会混入别的行星运行态
  - `client-web` 行星观察页在“极小缩放看全局”场景应优先使用该接口，而不是把 `/scene` 压到亚像素渲染
- 查询参数:
  - `step`: 下采样步长；表示一个 overview cell 覆盖多少个原始 tile。默认 `100`，最小 `1`，超出地图尺寸时会自动夹紧到地图最大边长
- 响应字段:
  - `planet_id` / `system_id` / `name` / `discovered` / `kind` / `map_width` / `map_height` / `tick`
  - `step`: 本次实际使用的下采样步长
  - `cells_width` / `cells_height`: 总览矩阵尺寸，等于 `ceil(map_width / step)` 与 `ceil(map_height / step)`
  - `terrain`: 聚合后的地形矩阵，每个 cell 取该范围内的主导地形
  - `visible` / `explored`: 聚合后的迷雾矩阵，只要该 cell 内任意 tile 可见或已探索，就记为 `true`
  - `resource_counts` / `building_counts` / `unit_counts`: 每个 cell 内资源点、可见建筑、可见单位数量
  - `building_count` / `unit_count` / `resource_count`: 当前整颗行星的可见建筑总数、可见单位总数、资源总数
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "system_id": "sys-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "map_width": 2000,
  "map_height": 2000,
  "tick": 4059,
  "step": 100,
  "cells_width": 20,
  "cells_height": 20,
  "terrain": [["buildable","water"],["buildable","lava"]],
  "visible": [[true,false],[false,true]],
  "explored": [[true,true],[false,true]],
  "resource_counts": [[12,3],[0,1]],
  "building_counts": [[2,0],[0,1]],
  "unit_counts": [[1,0],[0,0]],
  "building_count": 3,
  "unit_count": 1,
  "resource_count": 8416
}
```

**GET /world/planets/{planet_id}/scene**
- 说明: 行星局部场景读模型（需认证）
- 说明补充:
  - 用于大地图视窗渲染，只返回指定窗口内的地形、迷雾、建筑、单位、资源
  - 未发现行星只返回 `planet_id` / `discovered=false` / `map_width` / `map_height` / `bounds`
  - 只要目标行星 runtime 已加载，就会返回该行星窗口内的实时迷雾和实体，不要求它是 active planet
  - 若目标行星已发现但 runtime 尚未加载，当前仅返回静态 `terrain` / `environment` / `bounds`，不返回迷雾与实体明细
  - 当前服务端会对窗口做裁剪：`width` / `height` 默认 `160`，最大 `256`；超出地图边界时会自动回收至合法范围
- 查询参数:
  - `x` / `y`: 场景窗口左上角坐标
  - `width` / `height`: 场景窗口尺寸
- 响应字段:
  - `planet_id` / `system_id` / `name` / `discovered` / `kind` / `map_width` / `map_height` / `tick`
  - `bounds`: 本次实际返回的窗口范围，字段为 `x` / `y` / `width` / `height`
  - `terrain`: 当前窗口内的地形切片
  - `visible` / `explored`: 当前窗口内的迷雾切片
  - `buildings` / `units` / `resources`: 当前窗口内可见实体
  - `building_count` / `unit_count` / `resource_count`: 当前整颗行星的可见实体总数或资源总数，便于前端补充概览信息
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "system_id": "sys-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "map_width": 2000,
  "map_height": 2000,
  "tick": 4059,
  "bounds": {
    "x": 0,
    "y": 0,
    "width": 96,
    "height": 96
  },
  "terrain": [["buildable","water"],["buildable","lava"]],
  "visible": [[true,false],[false,true]],
  "explored": [[true,true],[false,true]],
  "buildings": {},
  "units": {},
  "resources": [],
  "building_count": 0,
  "unit_count": 0,
  "resource_count": 8416
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
  - `combat_squads` 由 `deploy_squad` 写入；当前 payload 来源是部署枢纽 `deployment_state.payload_inventory` 内已完成总装的蓝图军备产物，而不是建筑普通 storage 中的固定 item
  - `deployment_hubs` 会返回当前行星上玩家自有、带 deployment module 的部署枢纽 authoritative 运行态，包括军备库存、生产队列、翻修队列与连产状态
  - 当前 active 行星仍承载最完整的敌情/侦测结算；非 active 但已加载行星也可以看到该行星自己的 authoritative combat runtime
- 响应字段:
  - 通用字段：`planet_id` / `discovered` / `available` / `active_planet_id` / `tick` / `threat_level` / `last_attack_tick`
  - `combat_squads`：地面部署小队，包含 `id` / `owner_id` / `planet_id` / `source_building_id` / `blueprint_id` / `unit_type` / `count` / `hp` / `max_hp` / `shield` / `weapon` / `state` / `target_enemy_id` / `last_attack_tick`
  - `orbital_platforms`：轨道平台，包含 `id` / `owner_id` / `planet_id` / `orbit` / `hp` / `max_hp` / `weapon` / `ammo_capacity` / `ammo_count` / `last_fire_tick` / `is_active`
  - `deployment_hubs`：部署枢纽视图，包含 `building_id` / `building_type` / `owner_id` / `position` / `state` / `allowed_domains` / `payload_inventory` / `production_queue` / `refit_queue` / `line_state`
  - `deployment_hubs[].payload_inventory`：键为 `blueprint_id`，值为当前已可部署的军备产物数量
  - `deployment_hubs[].production_queue[]`：包含 `id` / `blueprint_id` / `blueprint_name` / `base_id` / `domain` / `runtime_class` / `stage` / `status` / `component_ticks_total` / `component_ticks_remaining` / `assembly_ticks_total` / `assembly_ticks_remaining` / `retool_ticks_total` / `retool_ticks_remaining` / `series_bonus_ratio` / `queued_tick` / `last_update_tick` / `component_cost` / `assembly_cost`
  - `deployment_hubs[].refit_queue[]`：包含 `id` / `unit_id` / `source_blueprint_id` / `target_blueprint_id` / `target_name` / `base_id` / `domain` / `runtime_class` / `count` / `status` / `queued_tick` / `last_update_tick` / `total_ticks` / `remaining_ticks` / `refit_cost` / `source_building_id` / `return_planet_id` / `return_system_id`
  - `deployment_hubs[].line_state`：包含 `last_blueprint_id` / `series_streak`，用于表达同蓝图连产收益
  - `logistics_stations`：物流站视图，包含 `building_id` / `building_type` / `owner_id` / `position` / `state` / `drone_ids` / `ship_ids`
  - `logistics_drones`：物流无人机视图，包含 `id` / `owner_id` / `station_id` / `target_station_id` / `capacity` / `speed` / `status` / `position` / `target_pos` / `remaining_ticks` / `travel_ticks` / `cargo`
  - `logistics_ships`：物流货船视图，包含 `id` / `owner_id` / `station_id` / `origin_planet_id` / `target_planet_id` / `target_station_id` / `capacity` / `speed` / `warp_speed` / `warp_distance` / `energy_per_distance` / `warp_energy_multiplier` / `warp_item_id` / `warp_item_cost` / `warp_enabled` / `status` / `position` / `target_pos` / `remaining_ticks` / `travel_ticks` / `cargo` / `warped` / `energy_cost` / `warp_item_spent`
  - `construction_tasks`：施工任务视图，包含 `id` / `player_id` / `region_id` / `building_type` / `position` / `rotation` / `blueprint_params` / `conveyor_direction` / `recipe_id` / `cost` / `state` / `enqueue_tick` / `start_tick` / `update_tick` / `queue_index` / `remaining_ticks` / `total_ticks` / `speed_bonus` / `priority` / `error` / `materials_deducted`
  - `enemy_forces`：敌军视图，包含 `id` / `type` / `position` / `strength` / `target_player` / `spawn_tick` / `last_seen` / `threat_level`
  - `detections`：侦测摘要，包含 `player_id` / `vision_range` / `known_enemy_count` / `detected_positions`
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
      "unit_type": "prototype",
      "count": 2,
      "hp": 160,
      "max_hp": 160,
      "state": "idle"
    }
  ],
  "deployment_hubs": [
    {
      "building_id": "b-1",
      "building_type": "battlefield_analysis_base",
      "owner_id": "p1",
      "position": {"x": 6, "y": 6},
      "state": "running",
      "allowed_domains": ["ground", "space"],
      "payload_inventory": {"prototype": 1},
      "production_queue": [
        {
          "id": "mprod-1",
          "blueprint_id": "precision_drone",
          "stage": "final_assembly",
          "status": "in_progress",
          "assembly_ticks_remaining": 12,
          "series_bonus_ratio": 0.1
        }
      ],
      "refit_queue": [
        {
          "id": "mrefit-1",
          "unit_id": "squad-1",
          "source_blueprint_id": "prototype",
          "target_blueprint_id": "precision_drone",
          "status": "queued",
          "remaining_ticks": 18
        }
      ],
      "line_state": {
        "last_blueprint_id": "precision_drone",
        "series_streak": 2
      }
    }
  ],
  "logistics_stations": [
    {
      "building_id": "station-1",
      "building_type": "planetary_logistics_station",
      "owner_id": "p1",
      "position": {"x": 4, "y": 4},
      "drone_ids": ["drone-1"],
      "ship_ids": ["ship-1"]
    }
  ],
  "logistics_drones": [
    {
      "id": "drone-1",
      "owner_id": "p1",
      "station_id": "station-1",
      "target_station_id": "station-1",
      "capacity": 25,
      "speed": 6,
      "status": "idle",
      "position": {"x": 4, "y": 4},
      "remaining_ticks": 0,
      "travel_ticks": 0,
      "cargo": {"iron_ore": 12}
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
  "detections": [
    {
      "player_id": "p1",
      "vision_range": 12,
      "known_enemy_count": 1,
      "detected_positions": [{"x": 9, "y": 10}, {"x": 10, "y": 10}]
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
  - 当前统一通过单个接口返回 `buildings` / `items` / `recipes` / `techs` / `units` / `base_frames` / `base_hulls` / `components` / `public_blueprints`
- 响应字段:
  - `buildings`：建筑元数据，包含 `id` / `name` / `category` / `subcategory` / `footprint` / `build_cost` / `buildable` / `default_recipe_id` / `requires_resource_node` / `can_produce_units` / `unlock_tech` / `icon_key` / `color`
  - `items`：物品元数据，包含 `id` / `name` / `category` / `form` / `stack_limit` / `unit_volume` / `container_id` / `is_rare` / `icon_key` / `color`
  - `recipes`：配方元数据，包含 `id` / `name` / `inputs` / `outputs` / `byproducts` / `duration` / `energy_cost` / `building_types` / `tech_unlock` / `icon_key` / `color`
  - `techs`：科技元数据，包含 `id` / `name` / `name_en` / `category` / `type` / `level` / `prerequisites` / `cost` / `unlocks` / `effects` / `leads_to` / `max_level` / `icon_key` / `color`
  - `units`：公开世界单位目录，包含 `id` / `name` / `domain` / `runtime_class` / `public` / `visible_tech_id` / `production_mode` / `producer_recipes` / `deploy_command` / `query_scopes` / `commands` / `hidden_reason`
  - `base_frames`：公开地面 / 空中底盘目录，包含 `id` / `name` / `domain` / `public` / `visible_tech_id` / `size_class` / `roles`
  - `base_hulls`：公开太空船体目录，包含 `id` / `name` / `domain` / `public` / `visible_tech_id` / `size_class` / `roles`
  - `components`：公开战争组件目录，包含 `id` / `name` / `category` / `public` / `domains` / `slot_type` / `visible_tech_id` / `tags`
  - `public_blueprints`：公开预置蓝图目录，包含 `id` / `name` / `domain` / `runtime_class` / `public` / `source` / `visible_tech_id` / `base_frame_id` / `base_hull_id` / `output_item_id` / `producer_recipes` / `deploy_command` / `query_scopes` / `commands` / `component_ids` / `summary`
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
      "id": "smelt_iron",
      "name": "Smelt Iron",
      "inputs": [{"item_id": "iron_ore", "quantity": 1}],
      "outputs": [{"item_id": "iron_ingot", "quantity": 1}],
      "duration": 60,
      "energy_cost": 1,
      "building_types": ["arc_smelter", "plane_smelter", "negentropy_smelter"],
      "tech_unlock": ["smelting"],
      "icon_key": "smelt_iron",
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
  "units": [
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
      "id": "soldier",
      "name": "Soldier",
      "domain": "ground",
      "runtime_class": "world_unit",
      "public": true,
      "production_mode": "world_produce",
      "query_scopes": ["planet"],
      "commands": ["move", "attack"]
    }
  ],
  "base_frames": [
    {
      "id": "light_frame",
      "name": "Light Frame",
      "domain": "ground",
      "public": true,
      "visible_tech_id": "prototype",
      "size_class": "light",
      "roles": ["line", "assault"]
    }
  ],
  "base_hulls": [
    {
      "id": "corvette_hull",
      "name": "Corvette Hull",
      "domain": "space",
      "public": true,
      "visible_tech_id": "corvette",
      "size_class": "escort",
      "roles": ["escort", "intercept"]
    }
  ],
  "components": [
    {
      "id": "compact_reactor",
      "name": "Compact Reactor",
      "category": "power",
      "public": true,
      "domains": ["ground", "air"],
      "slot_type": "power_core",
      "visible_tech_id": "prototype",
      "tags": ["starter", "sustained"]
    }
  ],
  "public_blueprints": [
    {
      "id": "prototype",
      "name": "Prototype Standard Pattern",
      "domain": "ground",
      "runtime_class": "combat_squad",
      "public": true,
      "source": "preset",
      "visible_tech_id": "prototype",
      "base_frame_id": "light_frame",
      "output_item_id": "prototype",
      "producer_recipes": ["prototype"],
      "deploy_command": "deploy_squad",
      "query_scopes": ["planet_runtime"],
      "commands": ["deploy_squad"],
      "component_ids": [
        "compact_reactor",
        "servo_actuator_pack",
        "composite_armor_plating",
        "battlefield_sensor_suite",
        "pulse_laser_mount",
        "command_uplink"
      ],
      "summary": "Starter frontline mech frame for direct deployment."
    },
    {
      "id": "corvette",
      "name": "Corvette Escort Pattern",
      "domain": "space",
      "runtime_class": "fleet_unit",
      "public": true,
      "source": "preset",
      "visible_tech_id": "corvette",
      "base_hull_id": "corvette_hull",
      "output_item_id": "corvette",
      "producer_recipes": ["corvette"],
      "deploy_command": "commission_fleet",
      "query_scopes": ["system_runtime", "fleet"],
      "commands": ["commission_fleet", "fleet_assign", "fleet_attack", "fleet_disband"],
      "component_ids": [
        "micro_fusion_core",
        "ion_drive_cluster",
        "deflector_shield_array",
        "deep_space_radar",
        "pulse_laser_mount",
        "repair_drone_bay"
      ],
      "summary": "Escort hull for screening and intercept duties."
    }
  ]
}
```
- 说明补充：服务端内部科技定义里的原始 unlock 仍可能写成 `power_pylon`，但对外 `/catalog.techs[].unlocks` 会统一归一化成 `tesla_tower`。
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
  - `techs` 中 `prototype`、`precision_drone`、`corvette`、`destroyer` 现在都是公开可研究科技；它们既作为 `public_blueprints[].visible_tech_id` 的门禁，也继续承接对应军备 recipe 的解锁语义，不再污染 `produce` 语义。
  - `units` 现在只保留 `worker` / `soldier` 这类 `world_produce + world_unit` 的世界单位。
  - `base_frames` / `base_hulls` / `components` / `public_blueprints` 是战争系统新的 authoritative 公开目录；`prototype` / `precision_drone` / `corvette` / `destroyer` 已迁移为 `public_blueprints`，不再继续伪装成旧式固定单位表条目。

---

**GET /war/blueprints**
- 说明: 返回当前认证玩家名下的战争蓝图列表（需认证）
- 响应字段:
  - `player_id`
  - `blueprints`：玩家私有蓝图数组；每个元素包含 `id` / `name` / `owner_id` / `source` / `parent_blueprint_id` / `parent_source` / `domain` / `runtime_class` / `visible_tech_id` / `base_frame_id` / `base_hull_id` / `status` / `slot_assignments` / `modifiable_slots` / `last_validation`
- 说明补充:
  - 这里只返回玩家私有蓝图，不混入 `/catalog.public_blueprints`
  - `slot_assignments` 是 authoritative 槽位装配结果，键当前固定为 `power` / `mobility|engine` / `defense` / `sensor` / `primary_weapon` / `utility`
  - `last_validation` 包含最近一次校验快照：`valid` / `usage` / `issues`
- 响应示例:
```json
{
  "player_id": "p1",
  "blueprints": [
    {
      "id": "bp-prototype-1",
      "name": "Prototype Mk1",
      "owner_id": "p1",
      "source": "player",
      "domain": "ground",
      "runtime_class": "combat_squad",
      "visible_tech_id": "prototype",
      "base_frame_id": "light_frame",
      "status": "adopted",
      "slot_assignments": {
        "power": "compact_reactor",
        "mobility": "servo_actuator_pack",
        "defense": "composite_armor_plating",
        "sensor": "battlefield_sensor_suite",
        "primary_weapon": "pulse_laser_mount",
        "utility": "command_uplink"
      },
      "last_validation": {
        "valid": true,
        "usage": {
          "power_supply": 90,
          "power_demand": 58,
          "volume": 72,
          "mass": 65,
          "rigidity": 59,
          "heat_generation": 55,
          "heat_dissipation": 66,
          "signal_signature": 55,
          "stealth": 4,
          "signal_exposure": 51,
          "maintenance": 58
        }
      }
    }
  ]
}
```

**GET /war/blueprints/{blueprint_id}**
- 说明: 返回当前认证玩家名下单个战争蓝图详情（需认证）
- 返回:
  - `200`：找到目标蓝图
  - `404`：目标蓝图不存在或不属于当前玩家
- 说明补充:
  - 当前公开预置蓝图仍通过 `/catalog.public_blueprints` 查询；这里只返回玩家私有蓝图
  - `last_validation.issues[].code` 当前至少可能出现：
    - `required_slot_missing`
    - `component_domain_mismatch`
    - `hardpoint_mismatch`
    - `power_budget_exceeded`
    - `volume_budget_exceeded`
    - `mass_budget_exceeded`
    - `rigidity_budget_exceeded`
    - `heat_dissipation_insufficient`
    - `signal_signature_exceeded`
    - `maintenance_budget_exceeded`

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
      "type": "scan_galaxy|scan_system|scan_planet|build|move|attack|produce|upgrade|demolish|configure_logistics_station|configure_logistics_slot|cancel_construction|restore_construction|start_research|cancel_research|transfer_item|switch_active_planet|set_ray_receiver_mode|deploy_squad|commission_fleet|fleet_assign|fleet_attack|fleet_disband|task_force_create|task_force_assign|task_force_set_stance|task_force_deploy|theater_create|theater_define_zone|theater_set_objective|blueprint_create|blueprint_set_component|blueprint_validate|blueprint_finalize|blueprint_variant|blueprint_set_status|queue_military_production|refit_unit|launch_solar_sail|launch_rocket|build_dyson_node|build_dyson_frame|build_dyson_shell|demolish_dyson",
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
        "theater_id": "theater-home",
        "zone_type": "primary|secondary|exclusion|assembly|supply_priority",
        "stance": "hold|patrol|escort|intercept|harass|siege|bombard|retreat_on_losses|preserve_stealth|aggressive_pursuit",
        "objective_type": "secure_orbit|defend|patrol_route",
        "blueprint_id": "bp-prototype-1",
        "parent_blueprint_id": "prototype",
        "base_frame_id": "light_frame",
        "base_hull_id": "corvette_hull",
        "slot_id": "primary_weapon",
        "status": "draft|validated|prototype|field_tested|adopted|obsolete",
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
        "target_entity_id": "entity-2",
        "target_id": "enemy-1",
        "unit_type": "仅供 produce 使用的公开世界单位 id",
        "blueprint_id": "deploy/commission/queue_military_production 时使用的 blueprint_id"
      }
    }
  ]
}
```
- 命令字段约束:
  - `scan_galaxy`：`target.galaxy_id` 必填；`target.layer` 可填 `galaxy`
  - `scan_system`：`target.system_id` 必填；`target.layer` 可填 `system`
  - `scan_planet`：`target.planet_id` 必填；`target.layer` 可填 `planet`
  - `build`：`target.position` + `payload.building_type` 必填；`target.position` 使用 `x` / `y` / 可选 `z`；仅传送带类建筑支持 `payload.direction`（默认 `east`，`auto` 表示允许多方向路由）；生产建筑可选 `payload.recipe_id` 用于设置初始配方，若提供必须是非空字符串；如果建筑定义存在 `default_recipe_id`，未显式传 `recipe_id` 时会自动回退到默认配方，并且仍会校验玩家是否已解锁该 recipe；`mining_machine` / `water_pump` / `oil_extractor` 必须建在对应资源点上，`orbital_collector` 仅允许在气态行星建造；`matrix_lab` / `self_evolution_lab` 在未设置 `recipe_id` 时默认可直接参与 `start_research`；普通新局里第一台 `matrix_lab` 已可由初始完成科技 `dyson_sphere_program` 直接建造；`jammer_tower` / `sr_plasma_turret` / `planetary_shield_generator` 都需要接入电网后才会进入 `running`；命令成功后进入施工队列，建造完成触发 `entity_created`；执行阶段的距离校验与 `server/internal/gamecore/executor.go` 同源，当前失败文案会直接落到 `command_result.message = "executor out of range: <distance> > <operate_range>"`
  - `move`：`target.entity_id` + `target.position` 必填
  - `attack`：`target.entity_id` + `payload.target_entity_id` 必填
  - `produce`：`target.entity_id` + `payload.unit_type` 必填；目标建筑必须处于可运行状态，停电/停机/故障时会直接拒绝；`payload.unit_type` 的 authoritative 边界以 `/catalog.units` 为准，当前只接受 `production_mode=world_produce && runtime_class=world_unit` 的单位，例如 `worker`、`soldier`
  - `upgrade` / `demolish`：`target.entity_id` 必填
  - `configure_logistics_station`：`target.entity_id` 必填；目标必须是当前玩家拥有的 `planetary_logistics_station` 或 `interstellar_logistics_station`；可选 `payload.input_priority` / `payload.output_priority` / `payload.drone_capacity`；当目标是星际物流站时，还可传 `payload.interstellar.enabled` / `payload.interstellar.warp_enabled` / `payload.interstellar.ship_slots`
  - `configure_logistics_slot`：`target.entity_id` + `payload.scope` + `payload.item_id` + `payload.mode` + `payload.local_storage` 必填；`payload.scope` 取 `planetary|interstellar`；`payload.mode` 取 `none|supply|demand|both`；`interstellar` 作用域只允许星际物流站
  - `cancel_construction` / `restore_construction`：`payload.task_id` 必填
  - `start_research`：`payload.tech_id` 必填；前置科技必须满足；至少需要 1 个处于 `running` 且未设置 `recipe_id` 的研究站（`matrix_lab` 或 `self_evolution_lab`）；所需每种矩阵都必须已经出现在研究站本地库存里；后续 tick 会真实消耗研究站库存中的矩阵推进 `progress`
  - `cancel_research`：`payload.tech_id` 必填
  - `transfer_item`：`payload.building_id` + `payload.item_id` + `payload.quantity` 必填；目标必须是当前玩家拥有、且带 `storage` 的建筑；命令会从玩家 `inventory` 扣减实际装入量，并把物品装入建筑本地存储；若存储容量不足，允许部分装填并返回实际转移数量
  - `switch_active_planet`：`payload.planet_id` 必填；目标行星必须已发现、其 runtime 已加载，并且当前玩家在该行星存在 foothold；当前 foothold 的实现定义为该行星上存在玩家自己的 `battlefield_analysis_base` 或 `executor`
  - `set_ray_receiver_mode`：`payload.building_id` + `payload.mode` 必填；目标必须是当前玩家拥有的 `ray_receiver`；`payload.mode` 取 `power|photon|hybrid`；`power` 只回灌电网并停止新的 `critical_photon` 增量，`hybrid` 先发电再把剩余输入转成光子，`photon` 只产光子且要求玩家已解锁 `dirac_inversion`；模式切换不会自动清空建筑里已经存在的历史光子库存
  - `deploy_squad`：`payload.building_id` + `payload.blueprint_id` + `payload.count` 必填；可选 `payload.planet_id`；未传 `planet_id` 时默认部署到当前 active planet 对应 runtime；`payload.blueprint_id` 可传公开预置蓝图，也可传当前玩家已定型的私有蓝图；目标建筑必须是当前玩家拥有、带 deployment module 与 deployment_state、并且当前 tick 处于可运行状态的部署枢纽；当前公开部署枢纽就是 `battlefield_analysis_base`，自身需要接入电网后才算可运行；玩家还必须已经解锁该蓝图对应 `visible_tech_id`，并且枢纽 `deployment_hubs[].payload_inventory` 里已有足量同名军备产物；若传 `planet_id`，目标行星 runtime 也必须已加载
  - `commission_fleet`：`payload.building_id` + `payload.blueprint_id` + `payload.count` + `payload.system_id` 必填；可选 `payload.fleet_id`；`payload.blueprint_id` 可传公开预置蓝图，也可传当前玩家已定型的私有太空蓝图；目标建筑约束同 `deploy_squad`；当前同样要求已解锁对应科技且部署枢纽 `payload_inventory` 中已有足量军备产物；若传入一个已存在且属于当前玩家的 `fleet_id`，服务端会向该舰队追加单位并重算 `weapon` / `shield`，而不是覆盖旧栈
  - `fleet_assign`：`payload.fleet_id` + `payload.formation` 必填；`formation` 取 `line|vee|circle|wedge`
  - `fleet_attack`：`payload.fleet_id` + `payload.planet_id` + `payload.target_id` 必填；当前只支持攻击同一 `system_id` 下的目标，且 `payload.target_id` 应来自目标行星 `/world/planets/{planet_id}/runtime.enemy_forces[].id`
  - `fleet_disband`：`payload.fleet_id` 必填
  - `task_force_create`：`payload.task_force_id` + `payload.system_id` 必填；可选 `payload.name` / `payload.theater_id`；若传 `theater_id`，目标战区必须已存在且归属同一玩家同一 `system_id`
  - `task_force_assign`：`payload.task_force_id` 必填；至少传 `payload.fleet_ids[]` 或 `payload.squad_ids[]` 其中一项；当前成员引用只接受玩家自有的 `fleet` 与 `combat_squad` authoritative runtime 实体，并会把成员列表整体替换为本次 payload
  - `task_force_set_stance`：`payload.task_force_id` + `payload.stance` 必填；`stance` 取 `hold|patrol|escort|intercept|harass|siege|bombard|retreat_on_losses|preserve_stealth|aggressive_pursuit`；服务端会同步重算 `behavior` 和 `command_capacity.penalty`
  - `task_force_deploy`：`payload.task_force_id` 必填；至少传 `payload.system_id` / `payload.planet_id` / `payload.position` 之一；服务端会写入 `deployment_target`，并在目标行星存在敌对势力时给已编入的舰队 / 战斗小队自动分配目标；当前不实现跨恒星系真实航渡，只记录目标并驱动同系统 runtime 行为
  - `theater_create`：`payload.theater_id` + `payload.system_id` 必填；可选 `payload.name`
  - `theater_define_zone`：`payload.theater_id` + `payload.zone_type` 必填；可选 `payload.planet_id` / `payload.position`；`zone_type` 取 `primary|secondary|exclusion|assembly|supply_priority`
  - `theater_set_objective`：`payload.theater_id` + `payload.objective_type` 必填；可选 `payload.target_system_id` / `payload.target_planet_id` / `payload.position`
  - `blueprint_create`：`payload.blueprint_id` + `payload.name` 必填，且必须在 `payload.base_frame_id` / `payload.base_hull_id` 中二选一；目标底盘对应科技必须已解锁；玩家私有蓝图 id 不能与公开 `public_blueprints[].id` 冲突；新建蓝图初始状态固定为 `draft`
  - `blueprint_set_component`：`payload.blueprint_id` + `payload.slot_id` + `payload.component_id` 必填；只允许修改当前玩家自己的 `draft|validated` 蓝图；若此前已有 `last_validation`，本次改动会把蓝图自动打回 `draft` 并清空最近一次校验结果；若该蓝图是改型，则只能修改其 `modifiable_slots` 内的槽位
  - `blueprint_validate`：`payload.blueprint_id` 必填；只允许对当前玩家自己的 `draft|validated` 蓝图执行；校验成功时会把蓝图推进到 `validated`，失败时会保留在 `draft`；无论成功还是失败，`results[].details.validation` 和 `GET /war/blueprints/{blueprint_id}.last_validation` 都会同步写入结构化校验结果
  - `blueprint_finalize`：`payload.blueprint_id` 必填；只允许对 `validated` 且最近一次 `last_validation.valid=true` 的蓝图执行；成功后推进到 `prototype`
  - `blueprint_variant`：`payload.parent_blueprint_id` + `payload.blueprint_id` 必填；`payload.name` 可选，未传时默认使用 `blueprint_id`；父蓝图既可以是玩家私有蓝图，也可以是 `/catalog.public_blueprints[].id`；父蓝图必须处于 `prototype|field_tested|adopted`；新改型会继承父蓝图底盘和现有装配，起始状态固定为 `draft`
  - `blueprint_set_status`：`payload.blueprint_id` + `payload.status` 必填；当前只允许 `prototype -> field_tested|obsolete`、`field_tested -> adopted|obsolete`、`adopted -> obsolete`；除 `obsolete` 外，所有推进都要求该蓝图保留一份 `last_validation.valid=true` 的最近校验记录
  - `queue_military_production`：`payload.building_id` + `payload.blueprint_id` + `payload.count` 必填；目标建筑必须是当前玩家拥有、带 deployment module、并且当前 tick 可运行的部署枢纽；`payload.blueprint_id` 必须指向预置蓝图或当前玩家已定型（`prototype|field_tested|adopted`）的私有蓝图；命令会立即从枢纽 storage 与玩家 inventory 扣除组件/总装所需材料，然后把订单写入该枢纽 `deployment_hubs[].production_queue`；同蓝图连续排产会在订单上体现 `series_bonus_ratio`，切换蓝图会体现 `retool_ticks_total`
  - `refit_unit`：`payload.building_id` + `payload.unit_id` + `payload.target_blueprint_id` 必填；`payload.unit_id` 当前既可以是 `combat_squads[].id`，也可以是 `/world/fleets/{fleet_id}` 中的 `fleet_id`；目标蓝图必须与原单位共享同一底盘 / runtime class；命令会把目标 runtime 单位从场上收回，扣除翻修成本，并把翻修订单写入部署枢纽 `refit_queue`；翻修完成后单位会以目标 `blueprint_id` 重新回到原行星或恒星系 runtime
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
- 物流补充说明：`planetary_logistics_station` 完工后会自动补齐默认容量对应的无人机；`interstellar_logistics_station` 还会自动补齐默认货船
- 物流补充说明：当前已支持在同一恒星系、已加载行星之间形成最小星际物流闭环；物流货船视图会暴露 `origin_planet_id` / `target_planet_id`，后续 tick 会跨行星派发与结算
- 升级/拆除规则补充:
  - 受建筑定义中的 `upgrade` / `demolish` 规则约束（允许与否、最大等级、耗时、返还率、是否要求停机）。
  - 若 `duration_ticks > 0`，命令执行会创建 `job` 并将建筑状态置为 `paused`，在作业完成 Tick 时生效：升级后恢复原工作状态，拆除后释放占格并返还资源。
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
- 响应字段补充:
  - `results[].details`：命令的结构化附加信息；当前战争蓝图命令会在这里返回 `blueprint` 和/或 `validation`
  - `results[].details.validation.issues[].code`：可直接作为玩家可读错误码，不需要再从英文 message 里反推
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
  - `fleet_disbanded`
  - `blueprint_validated`
  - `blueprint_invalidated`
- 事件类型补充:
  - `command_result`：这是 `/commands` 异步执行后的 authoritative 最终结果回写；`payload.request_id` 对应原始请求，`command_index` 对应批内第几条命令。即使同步响应里已经返回 `accepted`，最终仍应以这里的 `status` / `code` / `message` 为准。命令类客户端的推荐对账路径是：SSE 主订阅 `command_result`，超时或重连后再用 `GET /events/snapshot?event_types=command_result` 做补账。
    - 对 `build`，如果这里只返回 `OK + construction task ... queued`，不要把它误判成“建筑已完全落地并可运行”；后续还应继续观察同坐标的 `entity_created` 与对应 `building_state_changed`
    - 对 `build` 超范围失败，当前常见失败消息就是 `executor out of range: <distance> > <operate_range>`；客户端可以直接把这条 authoritative message 翻译成移动执行体的下一步提示
  - `resource_changed`：电力链路现在会在同一轮 authoritative 电力结算里只提交一次最终 `energy`；后续同 tick 的矿物/产出事件若继续复用 `resource_changed`，会沿用同一个最终 `energy` 值，不再在 `10000 -> 99xx -> 98xx` 间来回跳变。
  - `damage_applied`：当伤害来源为 `enemy_force -> building` 且命中了行星护盾时，payload 额外包含 `shield_absorbed`（本次被护盾吸收的伤害）与 `shield_remaining`（当前玩家所有 `running` 的 `planetary_shield_generator` 剩余总护盾值）。
  - `building_state_changed` 建筑状态变更事件，payload 包含 `building_id` / `building_type` / `prev_state` / `next_state` / `prev_reason` / `reason`；当同一建筑“状态没变但病因变了”时也会继续发这类事件，此时会表现为 `prev_state == next_state`，但 `prev_reason != reason`。当故障由维护不足触发时额外包含 `cause`（`maintenance_insufficient`）。供电接入失败原因包括 `power_no_connector` / `power_no_provider` / `power_out_of_range` / `power_capacity_full`；若建筑已经 `connected=true` 但当前 tick 因短缺或分配结果为 `0` 而拿不到电，则统一写成 `under_power`；`thermal_power_plant` / `mini_fusion_power_plant` / `artificial_star` 这类燃料型发电建筑在 `input_buffer + inventory` 中都没有可达燃料时，则会写成 `no_fuel`。若某个 tick 已成功发电，则不会再在同一 tick 末尾反向闪回 `running -> no_power/no_fuel`。
    - 当前 Web 建造账本会把 `entity_created` 与后续 `building_state_changed` 收口到同一条结果，用于给新建建筑生成“补供电塔 / 补发电 / 扩容电网”这类下一步提示；如果你要实现同类客户端，至少需要同时订阅这两类事件
  - `production_alert` 产线监控告警事件，payload 包含 `alert`（告警对象：`alert_id`/`tick`/`player_id`/`building_id`/`building_type`/`alert_type`/`severity`/`message`/`metrics`/`details`）。
  - `victory_declared` 胜利宣告事件，payload 包含 `winner_id` / `reason` / `victory_rule`；若是 `mission_complete` 科研获胜，还会额外携带 `tech_id = "mission_complete"`。
  - 若 `mission_complete` 在当前 tick 完成，事件顺序会先出现 `research_completed`，再出现 `victory_declared`。
  - `rocket_launched` 戴森火箭发射事件，payload 包含 `building_id` / `system_id` / `layer_index` / `count` / `rocket_launches` / `construction_bonus` / `layer_energy_output`；其中 `construction_bonus` 与 `GET /world/systems/{system_id}/runtime.dyson_sphere.layers[].construction_bonus` 共享同一份 tick 内 authoritative 结果。
  - `squad_deployed`：地面小队部署事件，payload 包含 `squad_id` / `squad`；同时还会伴随一条 `entity_created(entity_type = "combat_squad")`。
  - `fleet_commissioned`：舰队编成事件，payload 包含 `fleet_id` / `fleet`；同时还会伴随一条 `entity_created(entity_type = "fleet")`。
  - `fleet_assigned`：舰队改编队事件，payload 包含 `fleet_id` / `formation`。
  - `fleet_attack_started`：舰队开始攻击事件，payload 包含 `fleet_id` / `planet_id` / `target_id`；实际后续伤害仍通过 `damage_applied` / `entity_destroyed` 体现。
  - `fleet_disbanded`：舰队解散事件，payload 包含 `fleet_id`。
  - `blueprint_validated`：蓝图校验成功事件，payload 包含 `blueprint_id` / `blueprint` / `validation`。
  - `blueprint_invalidated`：蓝图校验失败或已验证蓝图被再次编辑后的失效事件；payload 至少包含 `blueprint_id` / `blueprint`，若来源于显式校验失败还会带 `validation`，若来源于编辑导致失效则额外带 `reason = "component_changed"`。
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
  "next_alert_id": "alert-123-b-1",
  "has_more": false,
  "alerts": [
    {
      "alert_id": "alert-123-b-1",
      "tick": 123,
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
