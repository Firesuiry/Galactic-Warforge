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

---

**GET /state/summary**
- 说明: 世界摘要（需认证）
- 响应字段: `tick` 当前 tick；`players` 玩家可见状态（仅自己含资源）；`winner` 已决出胜者时存在；`active_planet_id` 当前被模拟的行星；`map_width` / `map_height` 当前行星尺寸
- 响应示例:
```json
{
  "tick": 120,
  "players": {
    "p1": {"player_id":"p1","resources":{"minerals":200,"energy":100},"is_alive":true},
    "p2": {"player_id":"p2","is_alive":true}
  },
  "active_planet_id": "planet-1-1",
  "map_width": 32,
  "map_height": 32
}
```

---

**GET /world/galaxy**
- 说明: 星系列表（需认证）
- 响应字段: `galaxy_id` / `name`；`discovered` 是否已发现；`systems` 系统列表（未发现时 name 为空）
- 响应示例:
```json
{
  "galaxy_id": "galaxy-1",
  "name": "Galaxy-1",
  "discovered": true,
  "systems": [
    {"system_id":"sys-1","name":"System-1","discovered":true},
    {"system_id":"sys-2","name":"System-2","discovered":false}
  ]
}
```

**GET /world/systems/{system_id}**
- 说明: 恒星系详情（需认证）
- 响应字段: `system_id` / `name`；`discovered`；`planets` 行星列表（未发现时为空）
- 响应示例:
```json
{
  "system_id": "sys-1",
  "name": "System-1",
  "discovered": true,
  "planets": [
    {"planet_id":"planet-1-1","name":"Planet-1-1","discovered":true},
    {"planet_id":"planet-1-2","name":"","discovered":false}
  ]
}
```

**GET /world/planets/{planet_id}**
- 说明: 行星详情（需认证）
- 说明补充: 未发现行星只返回 `planet_id` + `discovered=false`；非当前 active 行星的建筑与单位返回为空
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "name": "Planet-1-1",
  "discovered": true,
  "map_width": 32,
  "map_height": 32,
  "tick": 120,
  "buildings": {},
  "units": {}
}
```

**GET /world/planets/{planet_id}/fog**
- 说明: 行星迷雾（需认证）
- 说明补充: 未发现行星只返回 `planet_id` + `discovered=false`；非当前 active 行星返回全 false 的 fog
- 响应示例:
```json
{
  "planet_id": "planet-1-1",
  "discovered": true,
  "map_width": 32,
  "map_height": 32,
  "visible": [[true,false],[false,true]]
}
```

---

**POST /commands**
- 说明: 提交命令（需认证）
- 请求体:
```json
{
  "request_id": "uuid",
  "issuer_type": "player_or_client_agent",
  "issuer_id": "user-001",
  "commands": [
    {
      "type": "scan_galaxy|scan_system|scan_planet",
      "target": {
        "layer": "galaxy|system|planet",
        "galaxy_id": "galaxy-1",
        "system_id": "sys-1",
        "planet_id": "planet-1-1"
      },
      "payload": {}
    }
  ]
}
```
- 返回: HTTP 202（接受或拒绝都返回 202，具体看 `accepted`）；`accepted=false` 时不会入队
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
