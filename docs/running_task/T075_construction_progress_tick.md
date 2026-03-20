# T075 施工进度结算与速度

## 需求细节
- 进度结算：按 tick 推进施工进度与剩余时间的更新规则。
- 速度加成与延迟：来自建筑/科技/环境的倍率与固定延迟处理。
- 暂停与恢复：暂停状态下进度冻结与恢复后的继续策略。
- 完工触发：进度达到阈值后的落成流程与事件派发。

## 实现状态
- 进度结算：部分完成（settleConstructionQueue 中 RemainingTicks 递减）
- 速度加成与延迟：**未实现** - 需要添加建筑/科技/环境倍率计算
- 暂停与恢复：**未完成** - ConstructionPaused 状态存在但 tick 循环未处理
- 完工触发：已完成（completeConstructionTask 实现完整）

## 缺失实现
1. 速度加成：需要计算玩家建筑科技加成、环境加成等对 TotalTicks 的影响
2. 暂停处理：settleConstructionQueue 需要跳过 ConstructionPaused 状态的任务
3. 恢复处理：从 Paused 恢复到 InProgress 时继续递减 RemainingTicks
