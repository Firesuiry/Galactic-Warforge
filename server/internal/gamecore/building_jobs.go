package gamecore

import (
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

func countActiveExecutorUsage(ws *model.WorldState) map[string]int {
	usage := make(map[string]int)
	if ws == nil {
		return usage
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
	return usage
}

func settleBuildingJobs(ws *model.WorldState) []*model.GameEvent {
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
			events = append(events, demolishBuilding(ws, building, job.RefundRate)...)
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

func demolishBuilding(ws *model.WorldState, building *model.Building, refundRate float64) []*model.GameEvent {
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
		events = append(events, demolishBuilding(ws, layer, refundRate)...)
	}

	refund := model.BuildingDemolishRefundWithRate(building.Type, building.Level, refundRate)
	player := ws.Players[building.OwnerID]
	if player != nil {
		player.Resources.Minerals += refund.Minerals
		player.Resources.Energy += refund.Energy
		player.AddItems(refund.Items)
	}

	entityID := building.ID
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

	return append(events, &model.GameEvent{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: building.OwnerID,
		Payload: map[string]any{
			"entity_id":   entityID,
			"entity_type": "building",
			"owner_id":    building.OwnerID,
			"reason":      "demolish",
		},
	})
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
