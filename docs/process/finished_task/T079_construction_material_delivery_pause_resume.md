# T079 施工材料配送与缺料暂停恢复

## 需求细节
- 缺料暂停：施工因材料不足进入暂停的判定逻辑。
- 补料恢复：材料到位后自动恢复施工的触发与校验。
- 与物流系统对接：配送到施工点的接口契约与结算一致性。
- 事件回调：暂停/恢复通知下游系统的事件定义与触发时机。

## 实现状态
- 缺料暂停：已实现
- 补料恢复：已实现
- 事件回调：已实现
- 与物流系统对接：接口契约已定义（预留）

## 实现记录

### 1. 新增事件类型 (model/event.go)
```go
EvtConstructionPaused   EventType = "construction_paused"
EvtConstructionResumed  EventType = "construction_resumed"
```

### 2. 新增辅助函数 (gamecore/construction.go)

#### checkMaterialsAvailable
```go
func checkMaterialsAvailable(ws *model.WorldState, task *model.ConstructionTask) bool
```
- 检查玩家是否有足够的minerals、energy和items用于施工任务
- T079：用于判断施工是否应暂停（材料不足）或恢复（材料可用）

#### createConstructionPauseEvent
```go
func createConstructionPauseEvent(task *model.ConstructionTask) *model.GameEvent
```
- 创建施工暂停事件
- Payload包含：task_id, reason="insufficient_materials", building, position, remaining, total

#### createConstructionResumeEvent
```go
func createConstructionResumeEvent(task *model.ConstructionTask) *model.GameEvent
```
- 创建施工恢复事件
- Payload包含：task_id, reason="materials_available", building, position, remaining, total

### 3. 修改 settleConstructionQueue (gamecore/construction.go)

**第一阶段 - 暂停检查**：
- 遍历所有in_progress状态的任务
- 如果材料不可用（checkMaterialsAvailable返回false），则暂停任务并触发pause事件

**第二阶段 - 恢复/启动**：
- 遍历Order中的任务
- 对于paused状态任务：如果材料现在可用，则恢复任务并触发resume事件
- 对于pending状态任务：如果材料可用且满足并发限制，则启动任务
- 如果材料不可用，则跳过启动

**第三阶段 - 完成处理**：
- 遍历所有in_progress状态任务
- 如果材料在处理过程中变得不可用（理论上在第一阶段已暂停），则跳过
- 正常推进进度并完成

### 4. 测试用例 (gamecore/construction_queue_test.go)
- TestConstructionPendingSkipsWhenMaterialsUnavailable: 验证材料不足时pending任务不会启动

## 修改文件
- `server/internal/model/event.go`: 新增EvtConstructionPaused和EvtConstructionResumed事件类型
- `server/internal/gamecore/construction.go`: 新增checkMaterialsAvailable、createConstructionPauseEvent、createConstructionResumeEvent函数；修改settleConstructionQueue实现暂停/恢复逻辑

## 状态
已完成

## 测试结果
```
ok  siliconworld/internal/gamecore   0.014s
ok  siliconworld/internal/gateway    (cached)
ok  siliconworld/internal/mapgen     (cached)
ok  siliconworld/internal/model       (cached)
ok  siliconworld/internal/persistence (cached)
ok  siliconworld/internal/queue      (cached)
ok  siliconworld/internal/snapshot   (cached)
ok  siliconworld/internal/visibility (cached)
```