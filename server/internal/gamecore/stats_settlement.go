package gamecore

import (
	"math"
	"sort"

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

	var totalEfficiency float64
	var buildingCount int
	for _, ws := range gc.statWorlds() {
		if snapshot := model.CurrentProductionSettlementSnapshot(ws); snapshot != nil {
			if playerSnapshot, ok := snapshot.Players[player.PlayerID]; ok {
				stats.TotalOutput += playerSnapshot.TotalOutput
				for key, value := range playerSnapshot.ByBuildingType {
					stats.ByBuildingType[key] += value
				}
				for key, value := range playerSnapshot.ByItem {
					stats.ByItem[key] += value
				}
			}
		}
		for _, building := range ws.Buildings {
			if building == nil || building.OwnerID != player.PlayerID || building.Runtime.Functions.Production == nil {
				continue
			}
			if building.ProductionMonitor != nil {
				totalEfficiency += building.ProductionMonitor.LastStats.Efficiency
				buildingCount++
			}
		}
	}

	if buildingCount > 0 {
		stats.Efficiency = totalEfficiency / float64(buildingCount)
	}
}

// updateEnergyStats 更新能源统计
func (gc *GameCore) updateEnergyStats(player *model.PlayerState) {
	stats := &player.Stats.EnergyStats
	aggregated := model.EnergyStats{}
	for _, ws := range gc.statWorlds() {
		local := buildPlayerEnergyStats(ws, player.PlayerID)
		aggregated.Generation += local.Generation
		aggregated.Consumption += local.Consumption
		aggregated.Storage += local.Storage
		aggregated.CurrentStored += local.CurrentStored
		if local.ShortageTicks > aggregated.ShortageTicks {
			aggregated.ShortageTicks = local.ShortageTicks
		}
	}
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
			// Generation = 电网供电能力；Consumption = 建筑需求（Demand）。
			// 不用 Allocated：无电时 Allocated=0 会把 0 供电/2 需求伪装成 0/0「供电稳定」。
			stats.Generation = player.Generation
			stats.Consumption = player.Demand
		}
		for _, network := range snapshot.Allocations.Networks {
			if network != nil && network.OwnerID == playerID && network.Shortage {
				stats.ShortageTicks = 1
				break
			}
		}
		// 需求 > 供电但 allocation.Shortage 未置位时（如孤立耗电节点）仍计短缺
		if stats.ShortageTicks == 0 && stats.Consumption > stats.Generation {
			stats.ShortageTicks = 1
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

	stats.ThreatLevel = 0
	for _, ws := range gc.statWorlds() {
		if state := ws.SensorContacts[player.PlayerID]; state != nil {
			for _, contact := range state.Contacts {
				if contact == nil || contact.FalseContact {
					continue
				}
				stats.ThreatLevel = max(stats.ThreatLevel, int(math.Ceil(contact.ThreatLevel)))
			}
		}
	}
	stats.HighestThreat = max(stats.HighestThreat, stats.ThreatLevel)
}

// statWorlds is stable and counts each loaded planet once, regardless of focus.
func (gc *GameCore) statWorlds() []*model.WorldState {
	ids := make([]string, 0, len(gc.worlds))
	for id := range gc.worlds {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	seen := make(map[*model.WorldState]bool)
	worlds := make([]*model.WorldState, 0, len(ids)+1)
	for _, id := range ids {
		if ws := gc.worlds[id]; ws != nil && !seen[ws] {
			worlds = append(worlds, ws)
			seen[ws] = true
		}
	}
	if gc.world != nil && !seen[gc.world] {
		worlds = append(worlds, gc.world)
	}
	return worlds
}
