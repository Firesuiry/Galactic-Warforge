# Server 架构待优化项

## 1. processTick 持有 saveMu 全程

- 位置: `gamecore/core.go:593`
- 问题: 每个 tick 开始即锁住 `saveMu`，自动保存和手动保存会阻塞 tick 循环。快照序列化耗时较长时会导致 tick 延迟。
- 建议: 将快照序列化移到锁外，或用 copy-on-write 方式异步保存。

## 2. CommandQueue.seen 无限增长

- 位置: `queue/queue.go:15`
- 问题: `seen` map 只增不减，长时间运行后持续膨胀，存在内存泄漏风险。
- 建议: 加 TTL 或按 tick 定期清理已过期的 request_id。

## 3. model 包过于庞大

- 位置: `internal/model/` (74 个源文件)
- 问题: 建筑/单位/物流/管道/蓝图/战斗/科技/电网等所有领域模型混在同一个包中，随功能增长可维护性下降。
- 建议: 按领域拆分子包，如 `model/logistics`、`model/combat`、`model/power` 等。

## 4. gamecore 包 settlement 函数缺乏组织

- 位置: `internal/gamecore/` (50 个源文件)
- 问题: `processTick` 中串行调用 20+ 个 settlement 函数，可读性和可维护性随功能增加而下降。
- 建议: 引入 settlement phase 注册机制，将各阶段解耦为可插拔的模块。

## 5. gateway 层读取 WorldState 的并发安全隐患

- 位置: `gateway/server.go` 各 handler
- 问题: handler 调用 `s.core.World()` 获取 WorldState 指针后，由 query 层读取数据。`World()` 用 `runtimeMu.RLock` 保护了指针获取，但后续 query 层需要自己加 `ws.RLock()`。如果某些路径忘记加锁，会有数据竞争。
- 建议: 统一在 gateway 层加锁后传入，或在 query 层入口统一加锁。

## 6. EventBus 丢事件无通知

- 位置: `gamecore/core.go:74`
- 问题: 慢消费者的事件直接 drop（`select default`），没有日志或计数器，调试困难。
- 建议: 增加 dropped event 的 metrics 计数器，方便监控和排查。

## 7. 手写三角函数近似无必要

- 位置: `gamecore/core.go:1031-1045`
- 问题: 用 Taylor 展开近似 cos/sin 来避免 import math，精度有限且无性能收益。Go 的 `math.Cos`/`math.Sin` 是内联的。
- 建议: 直接使用 `math.Cos`/`math.Sin`。

## 8. 部分基础包缺少测试

- 涉及包: `config`、`mapmodel`、`mapstate`、`terrain`
- 问题: 这些包完全没有单元测试，配置解析和地图模型是基础设施，出错影响面大。
- 建议: 补充关键路径的单元测试。

---

## 完成记录

- 完成时间: 2026-04-16
- 完成状态: 已完成

### 实际落地

- `processTick` 不再持有 `saveMu`；保存流程改为只在读取 `gameDir/saveMeta/baseSnapshot` 时短暂持锁，避免 tick 被保存元数据锁整段阻塞。
- `CommandQueue` 增加基于 tick 的去重保留窗口与 `PruneSeen` 清理逻辑，并在每个 tick 自动清理过期 `request_id`。
- 将电力领域的基础类型拆出到新子包 `server/internal/model/power/`，把 `PowerSourceKind`、`FuelRule`、`EnergyModule` 以及电力校验函数从根 `model` 包中抽离，建立首个领域拆包边界。
- 新增 `server/internal/gamecore/settlement_pipeline.go`，以 settlement phase 注册管线统一组织 tick 结算，并让 `processTick`、`Replay`、`Rollback` 复用同一套阶段顺序，补齐此前重放/回滚缺失的生产、管道、星际物流、监控等阶段。
- EventBus 增加 dropped 计数，并通过 `GET /metrics` 暴露 `dropped_events` 指标；同时更新了 `docs/dev/服务端API.md`。
- `runtime_registry` 中 `sortedPlanetIDs`、`sortedWorlds`、`WorldForPlanet`、`worldMapSnapshot` 统一纳入 `runtimeMu` 保护，降低 gateway/query 侧读取世界注册表时的并发风险。
- `computeStartPositions` 改为直接使用 `math.Cos` / `math.Sin`，移除手写近似实现。
- 为 `config`、`mapmodel`、`mapstate`、`terrain` 补充关键基础测试，并补充了队列、保存锁、EventBus、重放/回滚 phase 一致性的回归测试。

### 验证

- 通过: `/home/firesuiry/sdk/go1.25.0/bin/go test ./...`（工作目录: `server/`）
