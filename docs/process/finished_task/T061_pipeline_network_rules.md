# T061 管线网络与分流合流规则

## 前提任务
- T063 管线网络拓扑建模
- T064 管线流量计算与分流合流
- T065 管线网络与流量规则测试

## 需求细节
- 定义管线网络拓扑与节点连接关系。
- 实现分流与合流规则：优先级、均分、溢出策略。
- 支持多段管线的传输损耗/衰减计算（如启用）。
- 提供可复用的流量计算接口，供运行时与测试调用。

## 实现记录
- 管线网络拓扑与节点连接关系已由 `server/internal/model/pipeline_topology.go` 提供（T063 已完成）。
- 分流/合流规则与衰减模型由 `server/internal/model/pipeline_flow.go` 实现（T064 已完成）。
- 可复用的流量计算接口为 `ResolvePipelineFlow` 与相关辅助函数，供运行时与测试调用。

## 测试记录
- /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model (server)
