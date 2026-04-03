# T033 传送带与分拣器

## 前提任务
- T039 传送带网络基础与流动规则
- T040 传送带连接与路由规则
- T041 分拣器规则与调度
- T042 建筑接口与缓冲回退
- T043 关键规则测试覆盖

## 需求细节
- 传送带网络：占格、方向、吞吐、堆叠、堵塞与溢出处理。
- 传送带连接：输入输出口规则、转向与合流/分流规则。
- 分拣器规则：速度、距离、过滤、优先级。
- 传送带与分拣器与建筑接口：物品流转、缓冲与回退策略。

## 交付物
- 服务端物流基础结构与运行逻辑实现。
- 单元测试或集成测试覆盖关键规则（吞吐、堆叠、堵塞、过滤、优先级）。
- 若涉及服务端 API 行为变更，更新 `docs/dev/服务端API.md`。

## 完成情况
- 传送带网络、连接与吞吐/堆叠/堵塞处理已由 `conveyor_settlement.go` 及相关模型实现，并在 tick 流程中结算。
- 分拣器速度/距离/过滤/优先级规则已由 `sorter_settlement.go` 和 `sorter.go` 覆盖，与传送带交互逻辑已接入。
- 建筑 IO 与传送带缓冲/回退策略已由 `building_io_settlement.go` 实现。
- 关键规则测试已覆盖（`conveyor_settlement_test.go`、`sorter_settlement_test.go`、`building_io_settlement_test.go`），本任务无新增 API 行为变更。

## 测试
- `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./...`
