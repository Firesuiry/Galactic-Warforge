# T085 机甲与载具战斗

## 需求细节
- 战斗单位生成与管理。
- 武器系统：伤害计算、射速、弹药消耗。
- 护盾系统：护盾值、恢复、消耗。
- 弹药管理：弹药生产、消耗、补给。
- 轨道与星际战：行星防御、太空战。
- 战斗掉落：击杀敌人后资源回收。

## 前提任务
- 无

## 架构设计
- 详细设计请参考: `docs/detail/T085.md`

## 完成情况

### 实现内容

1. **新增文件**:
   - `server/internal/model/combat_unit.go` - 战斗单位数据模型
     - `CombatUnitType` - 战斗单位类型 (mech, tank, aircraft, ship)
     - `WeaponType` - 武器类型 (gun, cannon, missile, laser)
     - `CombatUnitState` - 单位状态 (idle, moving, attacking, dead)
     - `ShieldState` - 护盾状态及方法
     - `WeaponState` - 武器状态
     - `CombatUnit` - 战斗单位完整信息
     - `LootDrop` - 掉落物品结构
     - `DefaultCombatUnitStats()` - 默认战斗单位属性
     - `CalculateDamage()` - 伤害计算
     - `ProcessWeaponFire()` - 武器开火处理
     - `CalculateLoot()` - 战斗掉落计算

   - `server/internal/gamecore/combat_settlement.go` - 战斗结算逻辑
     - `CombatUnitManager` - 战斗单位管理器
     - `SpawnCombatUnit()` - 生成战斗单位
     - `settleCombat()` - 每tick战斗结算
     - 敌对势力攻击单位逻辑
     - 掉落物品生成

2. **修改文件**:
   - `server/internal/model/event.go` - 添加 `EvtLootDropped` 事件类型

### 功能说明

1. **战斗单位类型**:
   - 机甲 (Mech): 均衡型，较高射速
   - 坦克 (Tank): 高防御，高伤害，低射速
   - 飞机 (Aircraft): 高速，导弹攻击
   - 舰船 (Ship): 高血量，高伤害，激光武器

2. **武器系统**:
   - 距离衰减：超出射程伤害为0，距离越近伤害越高
   - 冷却机制：基于FireRate的射击间隔
   - 弹药消耗：每次射击消耗弹药

3. **护盾系统**:
   - 护盾吸收30%伤害
   - 受击后延迟恢复
   - 自动恢复直到满值

4. **战斗结算**:
   - 单位自动攻击范围内敌对势力
   - 护盾恢复每tick处理
   - 敌对势力攻击范围内的单位
   - 击杀敌对势力触发掉落

### 事件
- `EvtDamageApplied` - 伤害应用事件
- `EvtEntityDestroyed` - 实体销毁事件
- `EvtLootDropped` - 战利品掉落事件
