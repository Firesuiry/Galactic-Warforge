package gamecore

import "siliconworld/internal/model"

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
	refund := model.BuildingDemolishRefundWithRate(building.Type, building.Level, refundRate)
	player := ws.Players[building.OwnerID]
	if player != nil {
		player.Resources.Minerals += refund.Minerals
		player.Resources.Energy += refund.Energy
		player.AddItems(refund.Items)
	}

	entityID := building.ID
	model.UnregisterLogisticsStation(ws, entityID)
	model.UnregisterPowerGridBuilding(ws, entityID)
	delete(ws.Buildings, entityID)
	tileKey := model.TileKey(building.Position.X, building.Position.Y)
	delete(ws.TileBuilding, tileKey)
	ws.Grid[building.Position.Y][building.Position.X].BuildingID = ""

	return []*model.GameEvent{
		{
			EventType:       model.EvtEntityDestroyed,
			VisibilityScope: building.OwnerID,
			Payload: map[string]any{
				"entity_id":   entityID,
				"entity_type": "building",
				"owner_id":    building.OwnerID,
				"reason":      "demolish",
			},
		},
	}
}
