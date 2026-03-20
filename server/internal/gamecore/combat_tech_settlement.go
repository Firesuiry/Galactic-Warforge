package gamecore

import (
	"siliconworld/internal/model"
)

// CombatTechManager 战斗科技管理器
type CombatTechManager struct {
	Definitions map[string]model.CombatTechDefinition
}

// NewCombatTechManager 创建战斗科技管理器
func NewCombatTechManager() *CombatTechManager {
	defs := model.DefaultCombatTechDefinitions()
	defMap := make(map[string]model.CombatTechDefinition)
	for _, def := range defs {
		defMap[def.ID] = def
	}
	return &CombatTechManager{
		Definitions: defMap,
	}
}

// StartResearch 开始研究战斗科技
func (m *CombatTechManager) StartResearch(playerState *model.PlayerCombatTechState, techID string) bool {
	def, ok := m.Definitions[techID]
	if !ok {
		return false
	}

	// 检查是否已解锁最高级
	if playerState.UnlockedTechs[techID] != nil {
		if playerState.UnlockedTechs[techID].Level >= def.MaxLevel {
			return false // 已达最高级
		}
	}

	// 创建新的研究
	tech := &model.CombatTech{
		ID:           techID,
		Name:         def.Name,
		Type:         def.Type,
		Level:        1,
		MaxLevel:     def.MaxLevel,
		ResearchCost: def.BaseCost,
		Effects:      def.Effects[0],
	}

	playerState.CurrentResearch = tech
	playerState.ResearchProgress = 0

	return true
}

// ProcessResearch 处理研究进度
func (m *CombatTechManager) ProcessResearch(playerState *model.PlayerCombatTechState, researchPoints int) *model.CombatTech {
	if playerState.CurrentResearch == nil {
		return nil
	}

	playerState.ResearchProgress += researchPoints

	// 检查是否完成研究
	if playerState.ResearchProgress >= playerState.CurrentResearch.ResearchCost {
		// 完成研究
		tech := playerState.CurrentResearch

		// 如果已有同科技，更新等级
		if existing, ok := playerState.UnlockedTechs[tech.ID]; ok {
			existing.Level++
			if existing.Level <= len(m.Definitions[tech.ID].Effects) {
				existing.Effects = m.Definitions[tech.ID].Effects[existing.Level-1]
			}
			// 更新研究成本
			existing.ResearchCost = model.GetTechResearchCost(m.Definitions[tech.ID], existing.Level)
		} else {
			// 新增科技
			playerState.UnlockedTechs[tech.ID] = tech
		}

		// 触发科技完成事件
		completedTech := playerState.CurrentResearch
		playerState.CurrentResearch = nil
		playerState.ResearchProgress = 0

		return completedTech
	}

	return nil
}

// CancelResearch 取消研究
func (m *CombatTechManager) CancelResearch(playerState *model.PlayerCombatTechState) {
	playerState.CurrentResearch = nil
	playerState.ResearchProgress = 0
}

// ApplyTechToUnit 将玩家已解锁的科技应用到单位
func (gc *GameCore) ApplyTechToUnit(playerID string, unit *model.CombatUnit) {
	if gc == nil || gc.world == nil {
		return
	}

	player := gc.world.Players[playerID]
	if player == nil || player.Tech == nil {
		return
	}

	// 应用战斗科技效果
	for _, tech := range player.Tech.UnlockedTechs {
		model.ApplyTechToCombatUnit(unit, tech)
	}
}

// settleDroneControl 处理无人机控制
func (gc *GameCore) settleDroneControl() []*model.GameEvent {
	if gc == nil || gc.world == nil {
		return nil
	}

	var events []*model.GameEvent
	ws := gc.world

	// 预留无人机控制逻辑
	// 未来可以实现:
	// 1. 无人机跟随控制者移动
	// 2. 无人机自动攻击范围内敌人
	// 3. 无人机回收和部署

	return events
}