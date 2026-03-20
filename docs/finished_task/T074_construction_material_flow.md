# T074 施工材料配送与扣减

## 需求细节
- 材料来源与优先级：库存/物流节点的选取顺序与可用量校验。
- 扣减规则：开工/完工扣减策略、锁定与最终扣除时机。
- 缺料暂停策略：缺料触发暂停、补料后恢复的判定与回调。
- 与物流系统对接：材料流转到施工点的接口契约与结算一致性。

## 前提任务
- T077 施工材料来源与锁定规则
- T078 施工材料扣减时机与结算
- T079 施工材料配送与缺料暂停恢复

## 实现状态
- 材料来源与优先级：已实现 (T077: MaterialSourceType + MaterialSource with Priority)
- 扣减规则：已实现 (T078: 完工扣减 deduct-at-completion)
- 缺料暂停策略：已实现 (T079: checkMaterialsAvailable + pause/resume events)
- 与物流系统对接：接口契约已定义（预留物流节点作为来源）

## 实现记录

### 核心实现 (由前置任务完成)

#### T077 实现 (server/internal/gamecore/construction.go)
- `reserveConstructionMaterials`: 验证资源可用性并锁定材料
- `releaseConstructionReservation`: 释放预约的材料（取消时调用）
- `getAvailableConstructionMaterials`: 获取可用材料
- `MaterialSourceType` 和 `MaterialSource`: 材料来源类型和结构
- `MaterialReservation` 和 `ConstructionMaterialReservation`: 材料预约管理

#### T078 实现 (server/internal/gamecore/construction.go)
- `deductLockedMaterials`: 在施工完成时扣减锁定的材料
- `MaterialsDeducted` 字段: 标记材料是否已扣减
- `refundConstructionRefund`: 按剩余进度退款
- 完工扣减策略：入队锁定 → 完成扣减 → 取消按进度退款

#### T079 实现 (server/internal/gamecore/construction.go)
- `checkMaterialsAvailable`: 检查玩家是否有足够材料
- `createConstructionPauseEvent`: 创建施工暂停事件
- `createConstructionResumeEvent`: 创建施工恢复事件
- `settleConstructionQueue` 修改: 三阶段处理（暂停检查、恢复/启动、完成处理）

### 接口契约

**材料流转到施工点的接口**:
1. `reserveConstructionMaterials` 在入队时调用，锁定材料
2. `checkMaterialsAvailable` 在每 tick 检查，触发暂停/恢复
3. `deductLockedMaterials` 在完成时调用，实际扣减
4. `releaseConstructionReservation` 在取消时调用，释放锁定/退款

**与物流系统对接预留**:
- `MaterialSourceType` 支持 Local 和 Logistics 类型
- `getAvailableConstructionMaterials` 可扩展从物流节点获取材料
- 当前实现：仅本地库存，物流节点集成待后续实现

## 修改文件
- `server/internal/model/construction.go`: MaterialSource, MaterialReservation, ConstructionMaterialReservation
- `server/internal/gamecore/construction.go`: reserveConstructionMaterials, deductLockedMaterials, releaseConstructionReservation, checkMaterialsAvailable, createConstructionPauseEvent, createConstructionResumeEvent, settleConstructionQueue
- `server/internal/gamecore/construction_queue_test.go`: 测试用例

## 状态
已完成

## 测试结果
```
ok  siliconworld/internal/gamecore   (cached)
ok  siliconworld/internal/gateway    (cached)
ok  siliconworld/internal/mapgen     (cached)
ok  siliconworld/internal/model       (cached)
ok  siliconworld/internal/persistence (cached)
ok  siliconworld/internal/queue      (cached)
ok  siliconworld/internal/snapshot   (cached)
ok  siliconworld/internal/visibility (cached)
```
