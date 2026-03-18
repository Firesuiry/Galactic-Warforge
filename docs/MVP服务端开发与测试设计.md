# SiliconWorld 服务端 MVP 开发与测试设计

## 1. 文档目标

本文基于《服务端架构与功能设计》定义服务端 MVP 的可交付范围、开发顺序、测试策略与验收标准，用于指导后续实现与联调。

---

## 2. 单一真相与约束

MVP 期间以下约束不可变更：

- 服务端权威模拟，客户端不可直接修改世界状态。
- 所有操作通过统一命令接口提交并在 Tick 边界结算。
- 服务端不实现 AI Agent Runtime 与模型调用链路。
- 服务启动即进入单战场运行，不提供大厅与匹配。
- 鉴权采用启动参数配置的固定玩家 key。

---

## 3. MVP 目标与范围

## 3.1 MVP 核心目标

MVP 仅验证四件事：

1. 命令驱动的权威模拟链路可稳定运行。
2. REST + SSE 的状态查询与事件推送可用。
3. Tick 机制下命令执行具备确定性与可重放性。
4. 基础建造与基础战斗形成最小玩法闭环。

## 3.2 MVP In-Scope（必须完成）

### 世界与规则

- 单战场、单星球平面地图。
- 基础资源：采集、存储、消耗。
- 基础建筑：建造、升级、拆除。
- 基础单位：生产、移动、攻击、销毁。
- 基础迷雾：按玩家可见范围裁剪查询和事件。

### 服务端模块

- Command Gateway：鉴权、字段校验、限流、幂等键校验、请求追踪。
- Command Queue：命令排队、去重、按 Tick 批处理。
- Game Core：Tick 循环、命令执行、规则结算、事件产出。
- Visibility Engine：玩家视野裁剪。
- Query Layer：世界摘要与地图详情查询。
- Persistence：命令日志、关键 Tick 快照、审计日志。

### API

- `GET /state/summary`
- `GET /world/galaxy`
- `GET /world/systems/{system_id}`
- `GET /world/planets/{planet_id}`
- `GET /world/planets/{planet_id}/fog`
- `POST /commands`
- `GET /events/stream`

### 运维与观测

- 健康检查接口。
- Tick 速率、命令处理耗时、队列积压、SSE 连接数等核心指标。
- 基础告警规则。

## 3.3 MVP Out-of-Scope（当前不做）

- 服务端 Agent Runtime、Prompt、工具编排、模型调用与密钥管理。
- 多战场、多房间、大厅与匹配。
- 完整科技树与三层宇宙地图。
- 跨恒星系物流与跃迁。
- 复杂权限策略子系统。

---

## 4. MVP 架构与数据流

## 4.1 请求执行主链路

1. 客户端使用 `Authorization: Bearer <player_key>` 请求服务端。
2. Gateway 完成鉴权、格式校验、幂等校验后写入队列。
3. Tick Loop 在边界批量拉取命令执行规则结算。
4. 产出状态增量与事件，写入日志与快照。
5. Query Layer 输出可查询状态；SSE 推送事件。
6. Visibility Engine 对不同玩家进行查询与事件裁剪。

## 4.2 Tick 参数建议

- 默认 Tick Rate：10 tick/s。
- 可配置范围：5~20 tick/s。
- 单 Tick 预算：100ms（10 tick/s 时）。
- 命令超时或校验失败返回明确错误码，不直接改状态。

---

## 5. MVP 命令与事件契约

## 5.1 命令请求模型（MVP）

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

命令约束：

- `request_id` 必填且全局唯一，用于幂等。
- `issuer_type` 仅用于审计，不改变权限判定。
- 单请求支持命令批次，执行顺序按数组顺序。
- 所有命令在 Tick 边界结算，不支持即时改写世界状态。
- 命令发出后在最近完成的 Tick 执行结算，客户端不能指定 Tick。

## 5.2 命令回执模型（MVP）

```json
{
  "request_id": "uuid",
  "accepted": true,
  "enqueue_tick": 12346,
  "results": [
    {
      "command_index": 0,
      "status": "accepted|rejected|executed|failed",
      "code": "OK|INVALID_TARGET|NOT_OWNER|OUT_OF_RANGE|INSUFFICIENT_RESOURCE",
      "message": "human readable message"
    }
  ]
}
```

## 5.3 SSE 事件模型（MVP）

```json
{
  "event_id": "evt-uuid",
  "tick": 12346,
  "event_type": "command_result|entity_created|entity_moved|damage_applied|entity_destroyed|resource_changed",
  "visibility_scope": "player_id",
  "payload": {}
}
```

---

## 6. 开发阶段与交付里程碑

## 6.1 里程碑 M0：骨架可运行

交付内容：

- 服务启动配置解析（玩家与 key）。
- 基础 HTTP 服务可启动。
- `POST /commands`、`GET /state/summary`、`GET /events/stream` 路由打通。
- 空 Tick Loop 可持续运行并输出基础指标。

通过标准：

- 单客户端可完成鉴权、提交命令、收到回执与空事件。
- 10 分钟稳定运行无崩溃。

## 6.2 里程碑 M1：命令执行闭环

交付内容：

- Gateway 校验、队列去重、Tick 批处理完整打通。
- `build`、`move`、`attack` 三类命令可执行。
- 命令结果与事件可关联到 `request_id`。

通过标准：

- 命令成功与失败路径均可稳定复现。
- 同一 `request_id` 重放不产生重复状态变更。

## 6.3 里程碑 M2：最小玩法闭环

交付内容：

- 资源采集、建筑建造、单位生产、基础战斗完整闭环。
- 迷雾裁剪在查询和事件中生效。
- 关键 Tick 快照与审计日志落盘。

通过标准：

- 2 名玩家可完成一局最小对抗流程。
- 未可见目标不会在查询或 SSE 中泄露。

## 6.4 里程碑 M3：可测试可回放

交付内容：

- 回放导出与回放验证工具。
- 核心接口自动化测试、确定性测试、压测脚本。
- MVP 发布基线文档与运维手册。

通过标准：

- 同一命令流在同配置下重放结果一致。
- 达到性能与稳定性阈值后允许进入下一阶段。

---

## 7. 测试设计

## 7.1 测试分层

- 单元测试：命令校验器、资源结算器、迷雾裁剪器、伤害计算器。
- 集成测试：Gateway → Queue → Tick → Query/SSE 全链路。
- 契约测试：命令 schema、事件 schema、错误码表与鉴权行为。
- 回放测试：同输入日志重放一致性校验。
- 压力测试：并发命令、长连接 SSE、持续 Tick 稳定性。

## 7.2 核心测试用例

### 鉴权与权限

- 合法 key 可提交命令并查询可见状态。
- 非法 key 被拒绝且不入队。
- 玩家无法操作非本方实体。

### 命令与 Tick

- 命令仅在 Tick 边界生效。
- 同一 `request_id` 重复提交不重复执行。
- 校验失败命令返回失败码且状态不变。

### 迷雾与可见性

- 可见目标在查询与事件均可见。
- 不可见目标在查询与事件均不可见。
- 视野变化后返回结果正确切换。

### 回放与审计

- 命令日志与快照完整关联。
- 回放结果与线上记录一致。
- 审计日志可按 `request_id` 追踪执行链路。

## 7.3 性能与稳定性阈值（MVP）

- Tick 准时率：≥ 99%。
- 单 Tick 平均处理时长：< 70% Tick 预算。
- `POST /commands` P95：< 100ms（入队回执）。
- SSE 推送延迟 P95：< 300ms。
- 2 小时稳定性压测无崩溃、无状态损坏。

---

## 8. 验收标准（DoD）

同时满足以下条件即视为 MVP 完成：

- In-Scope 能力全部实现并通过测试。
- 三类核心命令 `build/move/attack` 在双人对抗中可用。
- 查询与事件均满足迷雾裁剪。
- 回放一致性验证通过。
- 关键性能阈值达标并完成压测报告。
- API 契约文档、错误码表、运维说明可用于交接。

---

## 9. 风险与控制策略

- 范围膨胀：所有新增需求先标注为 Post-MVP，不得打断主链路交付。
- 确定性风险：统一随机种子策略，禁用未受控并发写入。
- 迷雾泄露风险：查询与事件统一走 Visibility Engine。
- 稳定性风险：在 M0~M2 持续进行长时运行测试，提前暴露内存与队列问题。
- 契约漂移风险：Schema 变更必须同步更新契约测试与示例。

---

## 10. 推荐实施顺序（执行清单）

1. 先完成命令/事件/错误码三份契约基线。
2. 再完成 M0 主链路骨架与可观测性。
3. 再完成 M1 命令执行闭环。
4. 再完成 M2 最小玩法闭环与迷雾裁剪。
5. 最后完成 M3 回放、自动化测试与压测收口。

该顺序用于保证“先可运行、再可玩、再可测、再优化”。
