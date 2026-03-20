# T073 施工队列与并发限制

## 需求细节
- 施工任务队列模型：任务状态、归属玩家/区域、排序与调度字段。
- 并发上限策略：同一玩家/区域的并发建造限制与超限处理。
- 调度规则：任务入队、出队、占位与失败回滚的流程。
- 施工状态流转：待施工/施工中/暂停/完成/取消的核心流转约束。

## 完成情况
- 新增施工队列与任务模型，覆盖状态流转、排序字段、区域归属与占位管理。
- 建造指令改为入队施工任务，施工调度按玩家/区域并发上限启动，完成后生成建筑并释放占位。
- 补齐施工队列快照持久化与回放逻辑，避免回滚/重放丢失队列状态。
- 更新服务端 API 文档，说明建造入队与并发调度语义。
- 新增施工队列并发与占位的测试用例。

## 测试
- `/home/firesuiry/sdk/go1.25.0/bin/go test ./...`

## 变更文件
- `server/internal/model/construction.go`
- `server/internal/model/world.go`
- `server/internal/snapshot/clone.go`
- `server/internal/snapshot/world.go`
- `server/internal/gamecore/building_jobs.go`
- `server/internal/gamecore/core.go`
- `server/internal/gamecore/construction.go`
- `server/internal/gamecore/rules.go`
- `server/internal/gamecore/replay.go`
- `server/internal/gamecore/rollback.go`
- `server/internal/gamecore/construction_queue_test.go`
- `server/internal/config/config.go`
- `server/config.yaml`
- `server/config-dev.yaml`
- `docs/服务端API.md`
