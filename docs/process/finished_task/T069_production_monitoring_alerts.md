# T069 产线监控与报警

## 需求细节
- 监控指标：吞吐、积压、空转与生产效率。
- 瓶颈识别：上游供给不足、下游阻塞与过载规则。
- 断电警告：电力不足导致的停工与优先级提示。
- 告警事件：生成事件流与可查询的告警列表。
- 监控采样：采样周期与性能预算约束。

## 实现记录
- 新增产线监控状态与告警模型：`server/internal/model/production_monitor.go`，在建筑实例上挂载 `ProductionMonitorState`。
- 新增告警历史与采样逻辑：`server/internal/gamecore/production_monitor.go`、`server/internal/gamecore/alert_history.go`，按采样周期轮询、限额采样、告警冷却。
- 新增告警事件 `production_alert`，并在事件流中推送；增加告警快照接口 `GET /alerts/production/snapshot`。
- 回滚流程补充告警历史裁剪，配置新增 `alert_history_limit` 与 `production_monitor` 参数。
- 文档更新：`docs/dev/服务端API.md` 增补事件类型、告警快照接口与回滚字段。

## 测试记录
- /home/firesuiry/sdk/go1.25.0/bin/go test ./... (server)
