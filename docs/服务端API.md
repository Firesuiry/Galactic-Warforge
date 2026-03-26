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
- 响应字段:
  - `tick_count`：累计 Tick 数
  - `last_tick_dur_ms`：最近一次 Tick 耗时（毫秒）
  - `commands_total`：累计执行命令数
  - `sse_connections`：当前 SSE 连接数
  - `queue_backlog`：当前命令队列积压数
  - `tick_p95_ms` / `tick_p99_ms`：最近滚动窗口 Tick 耗时分位数
- 响应:
```json
{
  "tick_count": 123,
  "last_tick_dur_ms": 8,
  "commands_total": 42,
  "sse_connections": 1,
  "queue_backlog": 0,
  "tick_p95_ms": 9.0,
  "tick_p99_ms": 12.0
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
- 响应字段: `tick` 当前 tick；`players` 玩家可见状态（仅自己返回完整 `PlayerState`）；`winner` 已决出胜者时存在；`active_planet_id` 当前被模拟的行星；`map_width` / `map_height` 当前行星尺寸
- `players` 字段补充:
  - 所有玩家均返回 `player_id` / `team_id` / `role` / `is_alive`
  - 仅自身玩家返回完整状态，常用字段包括 `resources` / `inventory` / `permissions` / `executor` / `tech` / `combat_tech` / `stats`
  - `inventory` 物品库存，键为 `item_id`，值为数量
  - `executor` 字段说明:
    - `unit_id` 执行体单位 ID
    - `build_efficiency` 建造效率（数值参数）
    - `operate_range` 操作范围
    - `concurrent_tasks` 并发任务上限（建造/升级/拆除等执行体任务）
    - `research_boost` 研究辅助加成（数值参数）
  - `tech` 字段说明:
    - `player_id` / `completed_techs` / `current_research` / `research_queue` / `total_researched`
    - `current_research` / `research_queue` 元素字段：`tech_id` / `state` / `progress` / `total_cost` / `current_level` / `enqueue_tick` / `complete_tick`
  - `combat_tech` 字段说明:
    - `player_id` / `unlocked_techs` / `current_research` / `research_progress`
    - `unlocked_techs` / `current_research` 中的科技对象字段：`id` / `name` / `type` / `level` / `max_level` / `research_cost` / `effects`
  - `stats` 字段结构与 `GET /state/stats` 一致
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
  "map_width": 2000,
  "map_height": 2000
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

**GET /world/planets/{planet_id}**
- 说明: 行星概要（需认证）
- 说明补充:
  - 该接口只返回轻量摘要，不再返回整张 `terrain` / `fog` / `buildings` / `units`
  - 未发现行星只返回 `planet_id` + `discovered=false`
- 响应字段:
  - `planet_id` / `name` / `discovered` / `kind`
  - `map_width` / `map_height`
  - `tick`
  - `building_count` / `unit_count` / `resource_count`
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
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

**GET /world/planets/{planet_id}/scene**
- 说明: 行星场景视窗（需认证）
- 查询参数:
  - `x` / `y`: 左上角坐标，必填整数
  - `width` / `height`: 视窗大小，必填正整数
  - `detail_level`: 可选，`tile` 或 `sector`，默认 `tile`
- 规则补充:
  - `tile` 模式单次最多返回 `256x256`
  - 响应中的 `bounds` 是服务端实际裁剪后的范围
  - `tile` 模式返回裁剪后的 `terrain` / `fog` / `buildings` / `units` / `resources`
  - `sector` 模式返回 `sectors`
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "detail_level": "tile",
  "map_width": 2000,
  "map_height": 2000,
  "tick": 120,
  "bounds": {
    "min_x": 96,
    "min_y": 160,
    "max_x": 127,
    "max_y": 191
  },
  "terrain": [["buildable", "buildable"], ["water", "buildable"]],
  "fog": {
    "visible": [[true, true], [false, true]],
    "explored": [[true, true], [true, true]]
  },
  "buildings": {
    "assembler-1": {
      "id": "assembler-1",
      "type": "assembling_machine_mk1",
      "owner_id": "p1",
      "position": {"x": 100, "y": 170, "z": 0},
      "hp": 160,
      "max_hp": 160,
      "level": 2,
      "vision_range": 7,
      "runtime": {
        "state": "running",
        "params": {
          "energy_consume": 8,
          "energy_generate": 0,
          "capacity": 60,
          "maintenance_cost": {"minerals": 0, "energy": 1},
          "footprint": {"width": 2, "height": 2}
        }
      }
    }
  },
  "units": {},
  "resources": []
}
```

**GET /world/planets/{planet_id}/inspect**
- 说明: 行星对象详情检视（需认证）
- 查询参数:
  - `entity_kind`: 必填，`building` / `unit` / `resource` / `sector`
  - `entity_id` 或 `sector_id`: 二选一
- 响应字段:
  - `planet_id` / `discovered`
  - `entity_kind` / `entity_id`
  - `title`
  - 与目标类型对应的 `building` / `unit` / `resource`
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
    "vision_range": 7,
    "runtime": {
      "state": "paused",
      "state_reason": "power_low",
      "params": {
        "energy_consume": 8,
        "energy_generate": 0,
        "capacity": 60,
        "maintenance_cost": {"minerals": 0, "energy": 1},
        "footprint": {"width": 2, "height": 2}
      }
    }
  }
}
```

**GET /world/planets/{planet_id}/runtime**
- 说明: 行星运行态只读视图（需认证）
- 说明补充:
  - 未发现行星只返回 `planet_id` + `discovered=false`
  - 非当前 active 行星返回 `available=false`，并附带 `active_planet_id` / `tick`，前端可据此稳定降级显示
  - 当前 active 行星返回物流、施工、敌情、侦测等动态读模型
- 响应字段:
  - 通用字段：`planet_id` / `discovered` / `available` / `active_planet_id` / `tick` / `threat_level` / `last_attack_tick`
  - `logistics_stations`：物流站视图，包含 `building_id` / `building_type` / `owner_id` / `position` / `state` / `drone_ids` / `ship_ids`
  - `logistics_drones`：物流无人机视图，包含 `id` / `owner_id` / `station_id` / `target_station_id` / `capacity` / `speed` / `status` / `position` / `target_pos` / `remaining_ticks` / `travel_ticks` / `cargo`
  - `logistics_ships`：物流货船视图，包含 `id` / `owner_id` / `station_id` / `target_station_id` / `capacity` / `speed` / `warp_speed` / `warp_distance` / `energy_per_distance` / `warp_energy_multiplier` / `warp_item_id` / `warp_item_cost` / `warp_enabled` / `status` / `position` / `target_pos` / `remaining_ticks` / `travel_ticks` / `cargo` / `warped` / `energy_cost` / `warp_item_spent`
  - `construction_tasks`：施工任务视图，包含 `id` / `player_id` / `region_id` / `building_type` / `position` / `rotation` / `blueprint_params` / `conveyor_direction` / `recipe_id` / `cost` / `state` / `enqueue_tick` / `start_tick` / `update_tick` / `queue_index` / `remaining_ticks` / `total_ticks` / `speed_bonus` / `priority` / `error` / `materials_deducted`
  - `enemy_forces`：敌军视图，包含 `id` / `type` / `position` / `strength` / `target_player` / `spawn_tick` / `last_seen` / `threat_level`
  - `detections`：侦测摘要，包含 `player_id` / `vision_range` / `known_enemy_count` / `detected_positions`
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "available": true,
  "active_planet_id": "planet-1-1",
  "tick": 120,
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
  - 非当前 active 行星返回 `available=false`，当前 active 行星返回电网/管网拓扑与分配结果
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
  - 当前统一通过单个接口返回 `buildings` / `items` / `recipes` / `techs`
- 响应字段:
  - `buildings`：建筑元数据，包含 `id` / `name` / `category` / `subcategory` / `footprint` / `build_cost` / `buildable` / `requires_resource_node` / `can_produce_units` / `unlock_tech` / `icon_key` / `color`
  - `items`：物品元数据，包含 `id` / `name` / `category` / `form` / `stack_limit` / `unit_volume` / `container_id` / `is_rare` / `icon_key` / `color`
  - `recipes`：配方元数据，包含 `id` / `name` / `inputs` / `outputs` / `byproducts` / `duration` / `energy_cost` / `building_types` / `tech_unlock` / `icon_key` / `color`
  - `techs`：科技元数据，包含 `id` / `name` / `name_en` / `category` / `type` / `level` / `prerequisites` / `cost` / `unlocks` / `effects` / `max_level` / `hidden` / `icon_key` / `color`
- 响应示例:
```json
{
  "buildings": [
    {
      "id": "mining_machine",
      "name": "采矿机",
      "category": "production",
      "subcategory": "mining",
      "footprint": {"width": 1, "height": 1},
      "build_cost": {"minerals": 12},
      "buildable": true,
      "icon_key": "mining_machine",
      "color": "#f59f00"
    }
  ],
  "items": [
    {
      "id": "iron_ore",
      "name": "铁矿",
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
      "id": "mining-iron",
      "name": "开采铁矿",
      "inputs": [],
      "outputs": [{"item_id": "iron_ore", "amount": 1}],
      "duration": 4,
      "energy_cost": 1,
      "building_types": ["mining_machine"],
      "icon_key": "mining-iron",
      "color": "#adb5bd"
    }
  ],
  "techs": [
    {
      "id": "tech-energy-1",
      "name": "基础能源学",
      "category": "energy",
      "type": "energy",
      "level": 1,
      "icon_key": "tech-energy-1",
      "color": "#ffd43b"
    }
  ]
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
      "type": "scan_galaxy|scan_system|scan_planet|build|move|attack|produce|upgrade|demolish|cancel_construction|restore_construction|start_research|cancel_research|launch_solar_sail|build_dyson_node|build_dyson_frame|build_dyson_shell|demolish_dyson",
      "target": {
        "layer": "galaxy|system|planet",
        "galaxy_id": "galaxy-1",
        "system_id": "sys-1",
        "planet_id": "planet-1-1",
        "entity_id": "entity-1",
        "position": {"x": 10, "y": 12}
      },
      "payload": {
        "building_type": "当前服务端 Buildable=true 的建筑 ID，例如 mining_machine|wind_turbine|tesla_tower|solar_panel|arc_smelter|assembling_machine_mk1|chemical_plant|conveyor_belt_mk1|depot_mk1|planetary_logistics_station|em_rail_ejector",
        "direction": "north|east|south|west|auto",
        "recipe_id": "gear|smelt_iron|plastic",
        "task_id": "c-1",
        "tech_id": "electromagnetism",
        "building_id": "b-1",
        "count": 1,
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
  - `build`：`target.position` + `payload.building_type` 必填；`target.position` 使用 `x` / `y` / 可选 `z`；仅传送带类建筑支持 `payload.direction`（默认 `east`，`auto` 表示允许多方向路由）；生产建筑可选 `payload.recipe_id` 用于设置初始配方，若提供必须是非空字符串；`orbital_collector` 仅允许在气态行星建造；命令成功后进入施工队列，建造完成触发 `entity_created`
  - `move`：`target.entity_id` + `target.position` 必填
  - `attack`：`target.entity_id` + `payload.target_entity_id` 必填
  - `produce`：`target.entity_id` + `payload.unit_type` 必填；目标建筑必须处于可运行状态，停电/停机/故障时会直接拒绝
  - `upgrade` / `demolish`：`target.entity_id` 必填
  - `cancel_construction` / `restore_construction`：`payload.task_id` 必填
  - `start_research` / `cancel_research`：`payload.tech_id` 必填
  - `launch_solar_sail`：`payload.building_id` 必填；可选 `payload.count` / `payload.orbit_radius` / `payload.inclination`
  - `build_dyson_node`：`payload.system_id` / `payload.layer_index` / `payload.latitude` / `payload.longitude` 必填；`payload.orbit_radius` 可选（缺省时自动补层）；要求玩家已解锁 `dyson_component`
  - `build_dyson_frame`：`payload.system_id` / `payload.layer_index` / `payload.node_a_id` / `payload.node_b_id` 必填；要求玩家已解锁 `dyson_component`
  - `build_dyson_shell`：`payload.system_id` / `payload.layer_index` / `payload.latitude_min` / `payload.latitude_max` / `payload.coverage` 必填；要求玩家已解锁 `dyson_component`
  - `demolish_dyson`：`payload.system_id` / `payload.component_type` / `payload.component_id` 必填
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
  - `threat_level_changed`
  - `loot_dropped`
  - `entity_updated`
- 事件类型补充:
  - `building_state_changed` 建筑状态变更事件，payload 包含 `building_id`/`building_type`/`prev_state`/`next_state`/`reason`；当故障由维护不足触发时额外包含 `cause`（`maintenance_insufficient`）。供电接入失败新增原因：`power_no_connector`/`power_no_provider`/`power_out_of_range`/`power_capacity_full`。
  - `production_alert` 产线监控告警事件，payload 包含 `alert`（告警对象：`alert_id`/`tick`/`player_id`/`building_id`/`building_type`/`alert_type`/`severity`/`message`/`metrics`/`details`）。
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
- 响应字段补充:
  - `notes`：可选说明信息
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
- 查询参数:
  - `event_types`（必填）：显式订阅的事件类型列表，逗号分隔；传 `all` 表示全部事件类型
- 事件格式: `event: connected` + `data: {"player_id":"p1","event_types":["command_result"]}`；`event: game` + `data: <GameEvent JSON>`
- `GameEvent.event_type` 取值与 `GET /events/snapshot` 一致；`payload` 结构随事件类型变化
- 补充说明:
  - 服务端不再默认自动推送全部事件；只有显式订阅的 `event_types` 才会进入该 SSE 连接
  - 事件历史按类型独立保留，高频事件不会再把 `command_result` 这类低频关键事件挤出窗口
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
