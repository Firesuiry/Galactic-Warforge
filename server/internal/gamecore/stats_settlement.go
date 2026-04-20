package gamecore

import (
	"math"

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
	stats.Efficiency = 0

	if snapshot := model.CurrentProductionSettlementSnapshot(gc.world); snapshot != nil {
		if playerSnapshot, ok := snapshot.Players[player.PlayerID]; ok {
			stats.TotalOutput = playerSnapshot.TotalOutput
			stats.ByBuildingType = cloneIntMap(playerSnapshot.ByBuildingType)
			stats.ByItem = cloneIntMap(playerSnapshot.ByItem)
		}
	}

	var totalEfficiency float64
	var buildingCount int

	for _, building := range gc.world.Buildings {
		if building.OwnerID != player.PlayerID {
			continue
		}
		if building.Runtime.Functions.Production == nil {
			continue
		}

		if building.ProductionMonitor != nil && building.ProductionMonitor.LastStats.Efficiency > 0 {
			totalEfficiency += building.ProductionMonitor.LastStats.Efficiency
			buildingCount++
		}
	}

	if buildingCount > 0 {
		stats.Efficiency = totalEfficiency / float64(buildingCount)
	}
}

func cloneIntMap(in map[string]int) map[string]int {
	out := make(map[string]int, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

// updateEnergyStats 更新能源统计
func (gc *GameCore) updateEnergyStats(player *model.PlayerState) {
	stats := &player.Stats.EnergyStats
	aggregated := buildPlayerEnergyStats(gc.world, player.PlayerID)
	shortageTicks := stats.ShortageTicks
	if aggregated.ShortageTicks > 0 {
		shortageTicks++
	}
	*stats = aggregated
	stats.ShortageTicks = shortageTicks
}

func buildPlayerEnergyStats(ws *model.WorldState, playerID string) model.EnergyStats {
	stats := model.EnergyStats{}
	if ws == nil || playerID == "" {
		return stats
	}

	if snapshot := model.CurrentPowerSettlementSnapshot(ws); snapshot != nil {
		if player, ok := snapshot.Players[playerID]; ok {
			stats.Generation = player.Generation
			stats.Consumption = player.Allocated
		}
		for _, network := range snapshot.Allocations.Networks {
			if network != nil && network.OwnerID == playerID && network.Shortage {
				stats.ShortageTicks = 1
				break
			}
		}
	}
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != playerID || building.Runtime.Functions.EnergyStorage == nil {
			continue
		}
		if building.Runtime.Functions.EnergyStorage.Capacity > 0 {
			stats.Storage += building.Runtime.Functions.EnergyStorage.Capacity
		}
		if building.EnergyStorage != nil && building.EnergyStorage.Energy > 0 {
			stats.CurrentStored += building.EnergyStorage.Energy
		}
	}
	return stats
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

	// 从 sensor contacts 获取威胁等级
	if gc.world.SensorContacts != nil {
		if state, ok := gc.world.SensorContacts[player.PlayerID]; ok && state != nil {
			maxThreat := 0
			for _, contact := range state.Contacts {
				if contact == nil || contact.FalseContact {
					continue
				}
				threatInt := int(math.Ceil(contact.ThreatLevel))
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
