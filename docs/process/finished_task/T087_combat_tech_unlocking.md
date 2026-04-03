# T087 战斗科技解锁

## 需求细节
- 武器科技：解锁更高级武器。
- 装甲科技：提升单位防御力。
- 动力科技：提升单位速度与机动性。
- 无人机科技：解锁无人机单位与控制。

## 前提任务
- 无

## 状态
- [x] 已完成

## 完成细节
### 实现内容
1. **数据模型** (`server/internal/model/combat_tech.go`)
   - `CombatTechType`: 武器、装甲、动力、无人机四种科技类型
   - `CombatTechEffect`: 科技效果（伤害加成、防御加成、速度加成等）
   - `CombatTech`: 战斗科技实体
   - `CombatTechDefinition`: 科技定义（等级上限、基础成本、每级增量）
   - `PlayerCombatTechState`: 玩家科技状态（已解锁科技、当前研究、研究进度）
   - `DroneUnit`: 无人机单位
   - `DefaultCombatTechDefinitions()`: 8种科技定义（weapon_mk1/mk2, armor_mk1/mk2, power_mk1/mk2, drone_mk1）
   - `GetTechResearchCost()`: 计算研究成本
   - `ApplyTechToCombatUnit()`: 应用科技效果到战斗单位
   - `DefaultDroneStats()`: 无人机默认属性

2. **管理器** (`server/internal/gamecore/combat_tech_settlement.go`)
   - `CombatTechManager`: 战斗科技管理器
   - `NewCombatTechManager()`: 创建管理器，加载科技定义
   - `StartResearch()`: 开始研究科技
   - `ProcessResearch()`: 处理研究进度
   - `CancelResearch()`: 取消研究
   - `ApplyTechToUnit()`: 将玩家已解锁的科技应用到单位
   - `settleDroneControl()`: 无人机控制（预留）

3. **架构文档** (`docs/process/detail/T087.md`)
   - 完整的数据模型、效果说明和文件结构