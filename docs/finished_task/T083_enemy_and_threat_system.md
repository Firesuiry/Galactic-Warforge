# T083 敌对势力生成与威胁系统

## 需求细节
- 敌对势力（黑雾）生成：定时生成敌人单位。
- 敌对势力扩张：敌人随时间向周围扩散。
- 威胁等级：计算玩家面临的威胁程度。
- 进攻节奏：控制敌人的攻击频率和强度。
- 威胁感知：玩家如何感知威胁来临。

## 前提任务
- 无

## 架构设计
- 详细设计请参考: `docs/detail/T083.md`

## 实现结果

### 新增文件
- `server/internal/model/enemy_force.go` - 敌对势力数据模型
- `server/internal/gamecore/enemy_force_settlement.go` - 敌对势力Tick结算

### 修改文件
- `server/internal/model/world.go` - 添加 EnemyForces 字段
- `server/internal/model/event.go` - 添加 EvtThreatLevelChanged 事件类型
- `server/internal/gamecore/core.go` - 在Tick循环中添加敌对势力结算

### 实现内容
1. **敌对势力生成**：每200tick（20秒）在地图边缘生成一个新敌对势力
2. **势力扩散**：敌对势力每tick向随机方向扩散
3. **威胁等级计算**：基于敌对势力数量、实力和距离计算威胁等级
4. **进攻节奏**：威胁等级越高，攻击间隔越短
5. **攻击效果**：对玩家建筑造成伤害，触发EvtDamageApplied和EvtEntityDestroyed事件
6. **威胁感知**：威胁等级变化时向玩家发送EvtThreatLevelChanged事件
