package gamecore

import (
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// countActiveExecutorUsage 统计每名玩家在所有已加载行星上的执行体占用
// （建造任务 + 建筑生产作业），供并发任务上限校验使用（F4：命令可落在
// 任意已加载行星，占用也必须跨行星聚合）。
func countActiveExecutorUsage(worlds []*model.WorldState) map[string]int {
	usage := make(map[string]int)
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, building := range ws.Buildings {
			if building == nil || building.Job == nil {
				continue
			}
			usage[building.OwnerID]++
		}
		if ws.Construction != nil {
			for _, task := range ws.Construction.Tasks {
				if task == nil || task.State != model.ConstructionInProgress {
					continue
				}
				usage[task.PlayerID]++
			}
		}
	}
	return usage
}

// settleBuildingJobs 推进建筑作业（升级/拆除）。
//
// alerts 用于在拆除完成时解除该建筑名下仍成立的产线告警：建筑一旦消失，
// 它的 belt_blocked / haul_unreachable / output_blocked 等条件永远不会再被
// 结算，不在这里收尾就会在告警条里留下「建筑已不存在」的悬挂条目
// （试玩 1016 严重 3）。nil 时跳过（只关心作业本身的测试）。
func settleBuildingJobs(ws *model.WorldState, alerts *AlertHistory) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	var events []*model.GameEvent
	for _, building := range ws.Buildings {
		if building == nil || building.Job == nil {
			continue
		}
		job := building.Job
		if job.RemainingTicks > 0 {
			job.RemainingTicks--
		}
		if job.RemainingTicks > 0 {
			continue
		}

		building.Job = nil
		switch job.Type {
		case model.BuildingJobUpgrade:
			prevState := building.Runtime.State
			applyUpgrade(building, job.TargetLevel, job.PrevState)
			if prevState != building.Runtime.State {
				reason := deriveBuildingStateReason(prevState, building.Runtime.State)
				events = append(events, &model.GameEvent{
					EventType:       model.EvtBuildingStateChanged,
					VisibilityScope: building.OwnerID,
					Payload: map[string]any{
						"building_id":   building.ID,
						"building_type": building.Type,
						"prev_state":    prevState,
						"next_state":    building.Runtime.State,
						"reason":        reason,
					},
				})
			}
		case model.BuildingJobDemolish:
			events = append(events, demolishBuilding(ws, alerts, building, job.RefundRate)...)
		}
	}
	return events
}
func applyUpgrade(building *model.Building, level int, prevState model.BuildingWorkState) {
	if building == nil {
		return
	}
	if level <= 0 {
		level = 1
	}
	if prevState == "" {
		prevState = building.Runtime.State
	}
	building.Level = level

	newProfile := model.BuildingProfileFor(building.Type, building.Level)
	building.MaxHP = newProfile.MaxHP
	if building.HP > building.MaxHP {
		building.HP = building.MaxHP
	}
	building.VisionRange = newProfile.VisionRange
	building.Runtime = newProfile.Runtime
	model.InitBuildingStorage(building)
	model.SyncBuildingProduction(building)
	model.SyncBuildingConveyor(building)
	model.SyncBuildingLogisticsStation(building)
	if prevState != "" {
		building.Runtime.State = prevState
	}
}

// demolishBuilding 移除一座建筑（含叠在其上的层），返还材料并发 entity_destroyed。
// alerts 非 nil 时同步解除该建筑名下仍成立的全部产线告警。
func demolishBuilding(ws *model.WorldState, alerts *AlertHistory, building *model.Building, refundRate float64) []*model.GameEvent {
	if ws == nil || building == nil {
		return nil
	}
	var events []*model.GameEvent
	// A demolished lower layer brings everything stacked above it down in the
	// same action; each cascaded layer refunds at the same rate as the base.
	// The recursion already covers higher layers, so skip anything a lower
	// layer's cascade has removed while this loop was walking the snapshot.
	for _, layer := range stackedLayersAbove(ws, building) {
		if ws.Buildings[layer.ID] != layer {
			continue
		}
		events = append(events, demolishBuilding(ws, alerts, layer, refundRate)...)
	}

	refund := model.BuildingDemolishRefundWithRate(building.Type, building.Level, refundRate)
	player := ws.Players[building.OwnerID]
	if player != nil {
		// 拆除返还同样受机甲背包上限约束（背包永远不会超过上限）。
		player.AddItems(refund.Items, mechaInventoryCapacity(ws, nil, player))
	}

	entityID := building.ID
	// 建筑消失了，它名下的产线告警全部解除（试玩 1016 严重 3）。先取「仍成立
	// 的类型」写进事件，再解除历史条目：客户端/审计能看出随建筑一起消失的问题。
	resolvedTypes := resolveBuildingAlerts(alerts, building.OwnerID, ws.PlanetID, entityID, ws.Tick)
	detachStationFleet(ws, entityID)
	model.UnregisterLogisticsStation(ws, entityID)
	model.UnregisterPowerGridBuilding(ws, entityID)
	delete(ws.Buildings, entityID)
	ws.UnindexBuilding(building)
	if building.Type == model.BuildingTypeFoundation && len(building.FoundationTerrain) > 0 {
		if tiles, err := ws.BuildingTiles(building); err == nil {
			for i, p := range tiles {
				if i < len(building.FoundationTerrain) {
					ws.Grid[p.Y][p.X].Terrain = terrain.TileType(building.FoundationTerrain[i])
				}
			}
		}
	}

	payload := map[string]any{
		"entity_id":   entityID,
		"entity_kind": "building",
		"entity_type": string(building.Type),
		"owner_id":    building.OwnerID,
		"reason":      "demolish",
	}
	if len(resolvedTypes) > 0 {
		payload["resolved_alert_types"] = resolvedTypes
	}
	return append(events, &model.GameEvent{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: building.OwnerID,
		Payload:         payload,
	})
}

// resolveBuildingAlerts 解除某座建筑仍成立的全部产线告警，返回被解除的告警类型
// （稳定顺序，供 entity_destroyed 事件使用）。alerts 为 nil 时什么都不做。
func resolveBuildingAlerts(alerts *AlertHistory, playerID, planetID, buildingID string, tick int64) []string {
	if alerts == nil {
		return nil
	}
	var types []string
	for _, alert := range alerts.All() {
		if alert == nil || !alert.Active || alert.BuildingID != buildingID {
			continue
		}
		if alert.PlanetID != "" && planetID != "" && alert.PlanetID != planetID {
			continue
		}
		if playerID != "" && alert.PlayerID != playerID {
			continue
		}
		types = append(types, string(alert.AlertType))
	}
	if len(types) == 0 {
		return nil
	}
	sort.Strings(types)
	alerts.ResolveBuilding(playerID, planetID, buildingID, tick)
	return types
}

func detachStationFleet(ws *model.WorldState, stationID string) {
	if ws == nil || stationID == "" {
		return
	}
	for _, drone := range ws.LogisticsDrones {
		if drone != nil && drone.StationID == stationID {
			if drone.Status == model.LogisticsDroneIdle {
				drone.Status = model.LogisticsDroneStranded
				drone.StateReason = "home_unavailable"
			}
		}
	}
	for _, ship := range ws.LogisticsShips {
		if ship != nil && ship.StationID == stationID {
			if ship.Status == model.LogisticsShipIdle {
				ship.Status = model.LogisticsShipStranded
				ship.StateReason = "home_unavailable"
			}
		}
	}
}
