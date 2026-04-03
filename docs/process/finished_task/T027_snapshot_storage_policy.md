# T027 快照存储策略与保留窗口

## 需求细节
- 快照存储策略：间隔快照 + 增量记录（如有）的存储结构设计。
- 快照保留窗口：可配置留存周期与清理策略。
- 与命令日志的裁剪联动规则，为回放/回滚提供基础约束。
- 存储规模与性能基线：明确序列化大小与写入频率的约束。

## 前提任务
- T026 Tick 级状态快照：数据模型与序列化

## 完成情况
- 新增快照策略 `SnapshotPolicy`，支持间隔快照、保留窗口、保留数量与单条快照/增量记录的软上限告警。
- 持久化层按 `snapshots/` 与 `deltas/` 目录存储快照与增量记录，支持按保留窗口/数量清理旧快照，并在清理时联动裁剪过期增量。
- 新增 `OldestSnapshotTick` 作为命令日志裁剪边界，提供 `SnapshotStats` 汇总存储规模。
- 配置新增快照间隔、保留窗口、保留数量与大小基线，默认：`interval=100 tick`、`retention=60`（约 10 分钟 @10 tick/s）、`snapshot_max_bytes=2MB`、`delta_max_bytes=1MB`。

## 测试
- `/home/firesuiry/sdk/go1.25.0/bin/go test ./...` (workdir=server)
