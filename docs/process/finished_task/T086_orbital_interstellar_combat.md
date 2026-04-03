# T086 轨道与星际战

## 需求细节
- 轨道战斗：行星防御、轨道打击。
- 星际战斗：太空战与编队。
- 行星防御：防御平台、太空炮台。
- 编队系统：多个单位协同作战。

## 前提任务
- 无

## 架构设计
- 详细设计请参考: `docs/process/detail/T086.md`

## 完成情况

### 实现内容

1. **新增文件**:
   - `server/internal/model/orbital_combat.go` - 轨道战斗数据模型
     - `OrbitPosition` - 轨道位置
     - `OrbitalPlatform` - 轨道防御平台
     - `FleetFormation` - 编队系统
     - `SpaceFleet` - 太空舰队
     - `FormationType` - 编队类型 (line, vee, circle, wedge)
     - `DefaultOrbitalPlatformStats()` - 默认轨道平台属性
     - `CalculateOrbitalDistance()` - 轨道距离计算
     - `CalculateFormationPositions()` - 编队位置计算

   - `server/internal/gamecore/orbital_settlement.go` - 轨道战斗结算
     - `OrbitalPlatformManager` - 轨道平台管理器
     - `SpawnOrbitalPlatform()` - 生成轨道平台
     - `settleOrbitalCombat()` - 轨道战斗结算
     - `settleFleetFormation()` - 编队协同结算

### 功能说明

1. **轨道防御平台**:
   - 三种类型：basic (均衡)、heavy (重装)、fast (快速)
   - 沿行星轨道运行
   - 激光武器攻击范围内敌对势力
   - 弹药管理系统

2. **轨道战斗**:
   - 轨道平台自动攻击最近的敌对势力
   - 轨道位置实时更新
   - 敌对势力可攻击轨道平台

3. **编队系统**:
   - 四种编队类型：线性、V形、环形、楔形
   - 编队位置计算
   - 编队成员跟随领队

### 事件
- `EvtDamageApplied` - 伤害应用事件
- `EvtEntityDestroyed` - 实体销毁事件
- `EvtLootDropped` - 战利品掉落事件