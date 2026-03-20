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
- 响应:
```json
{
  "tick_count": 123,
  "last_tick_dur_ms": 8,
  "commands_total": 42,
  "sse_connections": 1,
  "queue_backlog": 0
}
```

**GET /audit**
- 说明: 审计日志查询（需认证），默认只返回当前玩家数据
- 查询参数:
  - `player_id`：过滤玩家（为空则默认当前玩家）
  - `issuer_type` / `issuer_id`：过滤命令来源
  - `action`：审计动作（当前为 `command`）
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
  - `details`：命令细节（`command`、`status`、`code`、`message`、`stage`、`enqueue_tick` 等）
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
- 响应字段: `tick` 当前 tick；`players` 玩家可见状态（仅自己包含资源、权限与执行体信息）；`winner` 已决出胜者时存在；`active_planet_id` 当前被模拟的行星；`map_width` / `map_height` 当前行星尺寸
- `players` 字段补充:
  - 所有玩家均返回 `player_id` / `team_id` / `role` / `is_alive`
  - 仅自身玩家返回 `resources` / `inventory` / `permissions` / `executor`
  - `inventory` 物品库存，键为 `item_id`，值为数量
  - `executor` 字段说明:
    - `unit_id` 执行体单位 ID
    - `build_efficiency` 建造效率（数值参数）
    - `operate_range` 操作范围
    - `concurrent_tasks` 并发任务上限（建造/升级/拆除等执行体任务）
    - `research_boost` 研究辅助加成（数值参数）
- 响应示例:
```json
{
  "tick": 120,
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

**GET /world/planets/{planet_id}**
- 说明: 行星详情（需认证）
- 说明补充: 未发现行星只返回 `planet_id` + `discovered=false`；非当前 active 行星的建筑、单位、资源点返回为空
- 响应字段: `planet_id` / `name` / `discovered` / `kind` / `orbit` / `moons` / `map_width` / `map_height` / `terrain` / `environment` / `tick` / `buildings` / `units` / `resources`
- `moons` 字段补充:
  - `id` / `name` / `orbit`（`distance_au`/`period_days`/`inclination_deg`）
- `resources` 资源点字段说明:
  - `id` 资源点 ID
  - `kind` 资源类型（如 `iron_ore`/`copper_ore`/`crude_oil`/`water` 等）
  - `behavior` 衰减类型（`finite`/`decay`/`renewable`）
  - `position` 坐标（`x`/`y`）
  - `remaining` 当前剩余量（`finite`/`renewable`）
  - `max_amount` 资源点上限（`finite`/`renewable`）
  - `base_yield` 初始产出上限
  - `current_yield` 当前产出上限（油井衰减）
  - `min_yield` 衰减下限
  - `regen_per_tick` 再生速度
  - `decay_per_tick` 衰减速度
  - `is_rare` 是否稀有资源
  - `cluster_id` 资源簇 ID（体现分布形态）
- `buildings` 建筑字段说明（map，key=building_id）:
  - `id` / `type` / `owner_id` / `position` / `hp` / `max_hp` / `level` / `vision_range`
  - `runtime` 运行参数
    - `state` 工作状态（`idle`/`running`/`paused`/`no_power`/`error`）
    - `params` 运行参数（`energy_consume`/`energy_generate`/`power_priority`/`capacity`/`maintenance_cost`/`footprint`/`connection_points`/`io_ports`）
    - `functions` 功能模块（`production`/`collect`/`transport`/`sorter`/`spray`/`storage`/`ray_receiver`/`energy`/`research`/`combat`）
    - `functions.spray` 喷涂模块（`throughput`/`max_level`）
    - `functions.transport` 运输模块（`throughput`/`stack_limit`）
    - `functions.sorter` 分拣模块（`speed`/`range`）
    - `functions.storage` 仓储模块（`capacity`/`slots`/`buffer`/`input_priority`/`output_priority`）
    - `functions.ray_receiver` 射线接收模块（`input_per_tick`/`receive_efficiency`/`power_output_per_tick`/`power_efficiency`/`photon_output_per_tick`/`photon_energy_cost`/`photon_efficiency`/`photon_item_id`/`mode`）
      - `mode` 输出模式：`power`/`photon`/`hybrid`（默认 `hybrid`，优先供电，溢出转光子）
  - `storage` 仓储状态（可选）
    - `capacity` 总容量
    - `slots` 可用槽位数量
    - `buffer_capacity` 缓冲容量
    - `priority` 优先级（`input`/`output`）
    - `inventory` 当前库存（map，key=item_id）
    - `input_buffer` 输入缓冲（map，key=item_id）
    - `output_buffer` 输出缓冲（map，key=item_id）
  - `conveyor` 传送带状态（可选）：`input`/`output`/`buffer`/`max_stack`/`throughput`；`buffer` 元素为 `item_id`/`quantity`/`spray`
    - `input`/`output` 支持 `north|east|south|west|auto`，`auto` 表示按连接关系自动继承方向
  - `sorter` 分拣器状态（可选）：`input_directions`/`output_directions`/`speed`/`range`/`filter`
    - `input_directions`/`output_directions` 为方向优先级数组
    - `filter` 支持 `mode`（`allow`/`deny`）与 `items`/`tags`
  - `job` 建筑作业（升级/拆除进行中，可选）
    - `type` 作业类型（`upgrade`/`demolish`）
    - `remaining_ticks` 剩余 Tick
    - `target_level` 目标等级（升级作业）
    - `refund_rate` 返还率（拆除作业）
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "name": "Planet-1-1",
  "discovered": true,
  "kind": "rocky",
  "orbit": {"distance_au":1.0,"period_days":365,"inclination_deg":1.2},
  "moons": [{"id":"planet-1-1-moon-1","name":"Moon-planet-1-1-1","orbit":{"distance_au":0.02,"period_days":30,"inclination_deg":0.1}}],
  "map_width": 32,
  "map_height": 32,
  "terrain": [["buildable","water"],["buildable","lava"]],
  "environment": {
    "wind_factor": 1.1,
    "light_factor": 0.9,
    "tidal_locked": false,
    "day_length_hours": 24
  },
  "tick": 120,
  "buildings": {},
  "units": {},
  "resources": [
    {
      "id": "planet-1-1-res-1",
      "kind": "iron_ore",
      "behavior": "finite",
      "position": {"x": 10, "y": 8},
      "remaining": 120,
      "max_amount": 120,
      "base_yield": 4,
      "current_yield": 4,
      "is_rare": false,
      "cluster_id": "planet-1-1-cluster-1"
    }
  ]
}
```

**GET /world/planets/{planet_id}/fog**
- 说明: 行星迷雾（需认证）
- 说明补充: 未发现行星只返回 `planet_id` + `discovered=false`；非当前 active 行星返回全 false 的 `visible`，`explored` 为已探索缓存（无缓存则全 false）
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "map_width": 32,
  "map_height": 32,
  "visible": [[true,false],[false,true]],
  "explored": [[true,true],[false,true]]
}
```

---

**POST /commands**
- 说明: 提交命令（需认证）
- 说明补充: `issuer_type` 与 `issuer_id` 必填；当 `issuer_type=player` 时，`issuer_id` 必须与 Bearer key 对应的玩家一致；命令会进行权限校验（`permissions`），无权限则直接拒绝
- 执行体约束: `build`/`produce`/`upgrade`/`demolish` 需要执行体在操作范围内；`upgrade`/`demolish` 超过并发上限会在执行阶段失败；`build` 超过并发上限时进入施工队列等待调度
- 请求体:
```json
{
  "request_id": "uuid",
  "issuer_type": "player_or_client_agent",
  "issuer_id": "user-001",
  "commands": [
    {
      "type": "scan_galaxy|scan_system|scan_planet|build|move|attack|produce|upgrade|demolish",
      "target": {
        "layer": "galaxy|system|planet",
        "galaxy_id": "galaxy-1",
        "system_id": "sys-1",
        "planet_id": "planet-1-1",
        "entity_id": "entity-1",
        "position": {"x": 10, "y": 12}
      },
      "payload": {
        "building_type": "mining_machine|solar_panel|assembling_machine_mk1|gauss_turret|conveyor_belt_mk1|conveyor_belt_mk2|conveyor_belt_mk3|orbital_collector",
        "direction": "north|east|south|west|auto",
        "target_entity_id": "entity-2",
        "unit_type": "worker|soldier"
      }
    }
  ]
}
```
- 命令字段约束:
  - `scan_galaxy`：`target.galaxy_id` 必填；`target.layer` 可填 `galaxy`
  - `scan_system`：`target.system_id` 必填；`target.layer` 可填 `system`
  - `scan_planet`：`target.planet_id` 必填；`target.layer` 可填 `planet`
  - `build`：`target.position` + `payload.building_type` 必填；传送带可选 `payload.direction`（默认 `east`，`auto` 表示允许多方向路由）；`orbital_collector` 仅允许在气态行星建造；命令成功后进入施工队列，建造完成触发 `entity_created`
  - `move`：`target.entity_id` + `target.position` 必填
  - `attack`：`target.entity_id` + `payload.target_entity_id` 必填
  - `produce`：`target.entity_id` + `payload.unit_type` 必填
  - `upgrade` / `demolish`：`target.entity_id` 必填
- 升级/拆除规则补充:
  - 受建筑定义中的 `upgrade` / `demolish` 规则约束（允许与否、最大等级、耗时、返还率、是否要求停机）。
  - 若 `duration_ticks > 0`，命令执行会创建 `job` 并将建筑状态置为 `paused`，在作业完成 Tick 时生效：升级后恢复原工作状态，拆除后释放占格并返还资源。
- 返回: HTTP 202（接受或拒绝都返回 202，具体看 `accepted`）；`accepted=false` 时不会入队
- 结果码补充:
  - `UNAUTHORIZED` 权限不足
  - `EXECUTOR_UNAVAILABLE` 执行体不存在
  - `EXECUTOR_BUSY` 执行体并发超限（`upgrade`/`demolish`）
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
  - `after_event_id`（推荐）：从指定事件之后开始返回
  - `since_tick`：从指定 tick 及以后开始返回（当 `after_event_id` 不可用时使用）
  - `limit`：最多返回事件数（默认 200，受服务端上限限制）
- 事件类型补充:
  - `building_state_changed` 建筑状态变更事件，payload 包含 `building_id`/`building_type`/`prev_state`/`next_state`/`reason`；当故障由维护不足触发时额外包含 `cause`（`maintenance_insufficient`）。供电接入失败新增原因：`power_no_connector`/`power_no_provider`/`power_out_of_range`/`power_capacity_full`。
  - `production_alert` 产线监控告警事件，payload 包含 `alert`（告警对象：`alert_id`/`tick`/`player_id`/`building_id`/`building_type`/`alert_type`/`severity`/`message`/`metrics`/`details`）。
- 响应示例:
```json
{
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
  - `limit`：最多返回告警数（默认 200，受服务端上限限制）
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
  - `speed`: 目标重放速度（ticks/s，>0 时按该速度节流）
  - `verify`: 是否开启一致性校验（命令结果对比 + 可用快照哈希比对）
- 补充说明: 实际重放从 `snapshot_tick + 1` 开始，确保覆盖 `from_tick` 的命令。
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
    "hash": "..."
  }
}
```

---

**GET /events/stream**
- 说明: SSE 事件流（需认证）
- 事件格式: `event: connected` + `data: {"player_id":"p1"}`；`event: game` + `data: <GameEvent JSON>`
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
