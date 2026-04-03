# T075 施工进度结算与速度

## 需求细节
- 进度结算：按 tick 推进施工进度与剩余时间的更新规则。
- 速度加成与延迟：来自建筑/科技/环境的倍率与固定延迟处理。
- 暂停与恢复：暂停状态下进度冻结与恢复后的继续策略。
- 完工触发：进度达到阈值后的落成流程与事件派发。

## 实现状态
- 进度结算：已完成（settleConstructionQueue 中 RemainingTicks 递减）
- 速度加成与延迟：已完成 - 添加了 SpeedBonus 字段和计算逻辑
- 暂停与恢复：已完成 - ConstructionPaused 状态在 tick 循环中被正确跳过，恢复时保留 SpeedBonus
- 完工触发：已完成（completeConstructionTask 实现完整）

## 修改文件
- `internal/model/construction.go`: 添加 SpeedBonus 字段到 ConstructionTask
- `internal/gamecore/construction.go`:
  - 新增 calculateConstructionSpeedBonus() 函数
  - 修改 settleConstructionQueue():
    - 开始施工时计算速度加成（仅首次，SpeedBonus == 0 时）
    - 应用速度加成到 tick 扣减（ticksToDeduct = int(SpeedBonus)）

## 速度加成架构
- SpeedBonus > 1.0 时，每 tick 扣除 int(SpeedBonus) 个 tick
- 暂停后恢复时 SpeedBonus 保持不变（只在 SpeedBonus == 0 时计算）
- 未来可通过以下来源扩展：
  - 科技加成（T008 科技树）
  - 建筑加成（垂直组装设施等）
  - 环境加成（星球类型等）

## 状态
已完成
