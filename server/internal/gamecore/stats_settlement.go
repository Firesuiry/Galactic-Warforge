package gamecore

import (
	"siliconworld/internal/model"
)

// settleStats 更新玩家统计
func (gc *GameCore) settleStats() {
	if gc == nil || gc.world == nil {
		return
	}

	ws := gc.world
	tick := ws.Tick

	// 更新每个玩家的统计
	for _, player := range ws.Players {
		if player == nil || player.Stats == nil {
			continue
		}

		stats := player.Stats
		stats.Tick = tick

		// 更新生产统计
		gc.updateProductionStats(player)

		// 更新能源统计
		gc.updateEnergyStats(player)

		// 更新物流统计
		gc.updateLogisticsStats(player)

		// 更新战斗统计
		gc.updateCombatStats(player)
	}
}

// updateProductionStats 更新生产统计
func (gc *GameCore) updateProductionStats(player *model.PlayerState) {
	stats := &player.Stats.ProductionStats
	stats.TotalOutput = 0
	stats.ByBuildingType = make(map[string]int)
	stats.ByItem = make(map[string]int)

	var totalEfficiency float64
	var buildingCount int

	for _, building := range gc.world.Buildings {
		if building.OwnerID != player.PlayerID {
			continue
		}
		if building.Runtime.Functions.Production == nil {
			continue
		}

		throughput := building.Runtime.Functions.Production.Throughput
		stats.TotalOutput += throughput
		stats.ByBuildingType[string(building.Type)] += throughput

		if building.ProductionMonitor != nil && building.ProductionMonitor.LastStats.Efficiency > 0 {
			totalEfficiency += building.ProductionMonitor.LastStats.Efficiency
			buildingCount++
		}
	}

	if buildingCount > 0 {
		stats.Efficiency = totalEfficiency / float64(buildingCount)
	}
}

// updateEnergyStats 更新能源统计
func (gc *GameCore) updateEnergyStats(player *model.PlayerState) {
	stats := &player.Stats.EnergyStats
	stats.Generation = 0
	stats.Consumption = 0
	stats.Storage = 0
	stats.CurrentStored = 0

	for _, building := range gc.world.Buildings {
		if building.OwnerID != player.PlayerID {
			continue
		}

		// 发电建筑
		if building.Runtime.Functions.Energy != nil && building.Runtime.Functions.Energy.OutputPerTick > 0 {
			stats.Generation += building.Runtime.Functions.Energy.OutputPerTick
		}
		// 耗电建筑
		if building.Runtime.Functions.Energy != nil && building.Runtime.Functions.Energy.ConsumePerTick > 0 {
			stats.Consumption += building.Runtime.Functions.Energy.ConsumePerTick
		}
		// 储能建筑
		if building.Runtime.Functions.EnergyStorage != nil && building.Runtime.Functions.EnergyStorage.Capacity > 0 {
			stats.Storage += building.Runtime.Functions.EnergyStorage.Capacity
			stats.CurrentStored += building.HP // 假设HP代表当前储能
		}
	}
}

// updateLogisticsStats 更新物流统计
func (gc *GameCore) updateLogisticsStats(player *model.PlayerState) {
	stats := &player.Stats.LogisticsStats

	// 简单统计：计算配送次数
	// 实际实现需要跟踪每个物流配送
	stats.Deliveries = 0
	stats.Throughput = 0
	stats.AvgDistance = 0
	stats.AvgTravelTime = 0
}

// updateCombatStats 更新战斗统计
func (gc *GameCore) updateCombatStats(player *model.PlayerState) {
	stats := &player.Stats.CombatStats

	// 从Detections获取威胁等级
	if gc.world.Detections != nil {
		if det, ok := gc.world.Detections[player.PlayerID]; ok {
			// 从已知敌人中计算最大威胁等级
			maxThreat := 0
			for _, enemy := range det.KnownEnemies {
				threatInt := int(enemy.ThreatLevel)
				if threatInt > maxThreat {
					maxThreat = threatInt
				}
			}
			stats.ThreatLevel = maxThreat
			if maxThreat > stats.HighestThreat {
				stats.HighestThreat = maxThreat
			}
		}
	}

	// 统计击杀数（从事件历史中获取）
	// 这里简化处理，实际需要更复杂的逻辑
}