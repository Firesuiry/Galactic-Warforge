# T068 区域规划与占地冲突检测

## 需求细节
- 规划态数据结构：支持预占地与规划结果缓存。
- 占地规则：建筑 footprint、旋转、地形限制与禁区。
- 冲突检测：重叠、越界、已有建筑/管线/传送带冲突。
- 规划批次：同批次内的相互冲突判定与处理策略。
- 规划反馈：返回可建/不可建清单与原因码。

## 实现记录
- 新增规划态数据结构与预占地/结果缓存：`server/internal/model/planning.go`。
- 支持 footprint 与旋转占地计算，禁区/地形/越界校验，建筑/管线/传送带冲突检测。
- 支持批次策略 `first_wins` 与 `mutual_fail`，输出可建/不可建与原因码。

## 测试记录
- /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model (server)
