# T072 蓝图批量建造与拆除

## 需求细节
- 批量建造：基于蓝图生成建造指令序列，支持同 tick 申明。
- 批量拆除：基于选区或蓝图范围生成拆除指令序列。
- 权限与合法性校验：不合法建筑的跳过、回滚与错误汇总策略。
- 结果反馈：返回成功数量、失败原因与定位信息。

## 完成情况
- 新增蓝图批量建造/拆除指令生成逻辑，支持跳过或回滚策略与冲突处理。
- 批量建造结合规划校验与资源点校验，输出失败原因与定位信息。
- 批量拆除支持选区与蓝图范围，含权限、保护建筑与施工状态校验。
- 新增对应测试覆盖跳过/回滚与资源点校验场景。

## 测试
- `/home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model`

## 变更文件
- `server/internal/model/blueprint_batch.go`
- `server/internal/model/blueprint_batch_test.go`
- `server/internal/model/building_utils.go`
- `server/internal/model/blueprint_ops.go`
