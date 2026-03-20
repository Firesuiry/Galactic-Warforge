# T014 服务端接口约束与命令驱动

## 需求细节
- 命令驱动：所有操作通过命令提交，并具备校验与鉴权入口。
- 权威结算：客户端仅提交意图，不可直接改状态。
- 事件推送：增量事件流与快照查询接口。

## 前提任务


## 完成情况
- 已补全命令结构校验（build/move/attack/produce/upgrade/demolish）
- 新增命令结果事件（command_result）并写入事件历史
- 新增事件快照接口 `/events/snapshot`，支持 `after_event_id`/`since_tick` 与 `limit`
- 增加 `issuer_type`/`issuer_id` 校验与玩家一致性校验
- 更新服务端 API 文档与配置项（事件历史与快照上限）

## 测试
- `/home/firesuiry/sdk/go1.25.0/bin/go test ./...`
