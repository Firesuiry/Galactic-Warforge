# T076 施工取消与恢复

## 需求细节
- 取消流程：施工撤销的状态流转、并发占位释放与副作用清理。
- 材料返还：按已消耗/锁定进度的返还策略与边界处理。
- 进度回滚：取消与恢复时的进度回退、数据一致性约束。
- 恢复策略：被取消或暂停任务的恢复入口与权限校验。

## 实现记录

### 命令类型
- `CmdCancelConstruction`: 取消施工任务
- `CmdRestoreConstruction`: 恢复已取消/暂停的施工任务

### 取消流程 (execCancelConstruction)
- 验证 task_id 存在且属于当前玩家
- 仅允许 pending/in_progress 状态的任务被取消
- 材料返还策略：
  - pending 任务：100% 返还（ minerals + energy + items）
  - in_progress 任务：按 (remainingTicks / totalTicks) 比例返还
- 状态流转：pending/in_progress → cancelled
- 从 Order 队列移除，保留在 Tasks map 中（供 restore 使用）
- 释放 tile reservation

### 恢复流程 (execRestoreConstruction)
- 验证 task_id 存在且属于当前玩家
- 仅允许 cancelled/paused 状态的任务被恢复
- 恢复前检查 tile 是否仍可用（未被其他建筑占用，未被其他施工任务预约）
- 状态流转：cancelled/paused → pending
- 重新 reserve tile
- 重新加入 Order 队列（队尾）

### 修改文件
- `internal/model/command.go`: 新增 CmdCancelConstruction, CmdRestoreConstruction
- `internal/model/construction.go`: 修改 Remove() 保留 cancelled 任务在 Tasks map；新增 refundConstructionRefund()
- `internal/gamecore/rules.go`: 新增 execCancelConstruction, execRestoreConstruction
- `internal/gamecore/core.go`: 新增命令分发 case

### API 示例
```json
// 取消施工
{"type": "cancel_construction", "target": {}, "payload": {"task_id": "c-1"}}

// 恢复施工
{"type": "restore_construction", "target": {}, "payload": {"task_id": "c-1"}}
```

## 状态
已完成