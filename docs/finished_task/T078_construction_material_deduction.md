# T078 施工材料扣减时机与结算

## 需求细节
- 扣减策略：开工扣减、完工扣减或分阶段扣减的明确规则。
- 锁定与最终扣除：锁定数量转为实际扣除的时机与失败回滚。
- 施工队列一致性：扣减结果与施工状态同步更新。
- 覆盖异常流：材料不足、取消施工时的扣减/释放规则。

## 实现状态
- 扣减策略：已实现完工扣减（deduct-at-completion）策略
- 锁定与最终扣除：已实现锁定与扣减分离
- 施工队列一致性：扣减结果与施工状态同步更新
- 异常流处理：已覆盖

## 实现记录

### 核心变更

#### 1. 新增 MaterialsDeducted 字段 (model/construction.go)
```go
type ConstructionTask struct {
    // ... 现有字段 ...
    // MaterialsDeducted indicates whether materials have been deducted for this task.
    // When false, materials are "locked" but not yet deducted (deducted at completion).
    // When true, materials have been deducted (used for proper refund handling).
    MaterialsDeducted bool `json:"materials_deducted,omitempty"`
}
```

#### 2. 修改 reserveConstructionMaterials (gamecore/construction.go)
- 原逻辑：立即扣减资源（开工扣减）
- 新逻辑：仅锁定资源，不扣减（为完工扣减做准备）

#### 3. 新增 deductLockedMaterials 函数 (gamecore/construction.go)
```go
// deductLockedMaterials deducts the locked materials for a construction task.
// This is called when construction completes successfully.
func deductLockedMaterials(ws *model.WorldState, task *model.ConstructionTask) error
```
- 在施工完成时调用，实际扣减锁定的资源
- 设置 MaterialsDeducted = true
- 移除材料预约记录

#### 4. 修改 completeConstructionTask (gamecore/construction.go)
- 在创建建筑前调用 deductLockedMaterials
- 如果扣减失败，建筑创建失败，任务取消

#### 5. 修改 releaseConstructionReservation (gamecore/construction.go)
- 如果 MaterialsDeducted = false（从未扣减），仅释放锁定，不退款
- 如果 MaterialsDeducted = true（已扣减），按剩余进度退款

#### 6. 修改 settleConstructionQueue (gamecore/construction.go)
- 当任务完成失败时：
  - 如果 MaterialsDeducted = true：使用 refundConstructionRefund（按进度退款）
  - 如果 MaterialsDeducted = false：不退款（从未扣减）

### 扣减策略说明

**完工扣减（Deduct-at-Completion）策略**：
1. `execBuild`（入队）：锁定材料，资源不扣减，玩家仍可使用
2. `settleConstructionQueue`（完成）：调用 `deductLockedMaterials` 扣减材料
3. `execCancelConstruction`（取消）：
   - 如果任务未开始：从锁定状态释放，不退款
   - 如果任务已完成扣减：按剩余进度退款
4. `execRestoreConstruction`（恢复）：重新创建锁定，不扣减

### 异常流处理

| 场景 | 材料状态 | 处理 |
|------|---------|------|
| 入队成功，开始前取消 | 未扣减 | 仅释放锁定 |
| 入队成功，完成时扣减成功 | 已扣减 | 不退款（正常完成）|
| 入队成功，完成时扣减失败 | 未扣减 | 任务取消，无退款 |
| 入队成功，施工中失败 | 已扣减 | 按剩余进度退款 |

### 修改文件
- `server/internal/model/construction.go`: 新增 MaterialsDeducted 字段
- `server/internal/gamecore/construction.go`: 修改 reserveConstructionMaterials、completeConstructionTask、releaseConstructionReservation、settleConstructionQueue；新增 deductLockedMaterials
- `server/internal/gamecore/construction_queue_test.go`: 更新测试用例以适应新逻辑

## 测试结果
```
ok  	siliconworld/internal/gamecore	0.018s
ok  	siliconworld/internal/gateway
ok  	siliconworld/internal/mapgen
ok  	siliconworld/internal/model
ok  	siliconworld/internal/persistence
ok  	siliconworld/internal/queue
ok  	siliconworld/internal/snapshot
ok  	siliconworld/internal/visibility
```

## 状态
已完成
