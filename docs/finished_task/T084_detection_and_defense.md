# T084 侦测与防御系统

## 需求细节
- 信号塔：诱导敌人改变进攻方向。
- 雷达系统：探测敌人位置和数量。
- 视野扩张：扩大玩家可见范围。
- 防御建筑：炮塔、导弹塔、干扰塔、减速装置。
- 防御建筑升级与维护。

## 前提任务
- 无

## 架构设计
- 详细设计请参考: `docs/detail/T084.md`

## 完成情况

### 实现内容

1. **新增文件**:
   - `server/internal/model/defense.go` - 防御相关数据模型
     - `EnemyIntel` - 敌人情报结构
     - `DetectionState` - 玩家侦测状态
     - `DefenseType` - 防御建筑类型枚举
     - `DefenseBuildingRuntime` - 防御建筑运行时状态
     - `DefenseStats` - 防御建筑属性
     - `IsDefenseBuilding()` - 判断建筑是否为防御建筑
     - `GetDefenseType()` - 获取防御建筑类型

2. **修改文件**:
   - `server/internal/model/world.go` - 添加 `Detections` 字段
   - `server/internal/gamecore/enemy_force_settlement.go` - 添加防御系统结算逻辑
     - `applySignalTowerEffects()` - 信号塔效果（重定向敌人）
     - `updateRadarDetection()` - 雷达检测状态更新
     - `applySlowFieldEffects()` - 减速场效果
   - `server/internal/gamecore/rules.go` - 更新 `settleTurrets` 函数
     - 支持攻击敌对势力（EnemyForce）
     - 统一处理所有防御建筑类型

### 功能说明

1. **信号塔效果**:
   - 范围内敌人有几率重定向，清除其目标
   - 每10tick检查一次

2. **雷达检测**:
   - 战场分析基地和具有侦查范围防御建筑可检测敌人
   - 更新玩家的 `DetectionState`，记录已知敌人情报和位置

3. **减速场（干扰塔）**:
   - 范围内敌人扩散速度降低

4. **防御建筑攻击**:
   - 炮塔、导弹塔等防御建筑攻击范围内的敌对势力
   - 对敌对势力造成伤害，击杀后移除

### 事件
- `EvtDamageApplied` - 伤害应用事件
- `EvtEntityDestroyed` - 实体销毁事件
- `EvtThreatLevelChanged` - 威胁等级变化事件
