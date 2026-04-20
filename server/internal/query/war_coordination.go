package query

import (
	"sort"

	"siliconworld/internal/model"
)

// WarTaskForces returns player-owned task-force state with live runtime resolution.
func (ql *Layer) WarTaskForces(
	ws *model.WorldState,
	playerID string,
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
) *model.WarTaskForceListView {
	view := &model.WarTaskForceListView{TaskForces: []model.WarTaskForceView{}}
	if ws == nil {
		return view
	}
	ws.RLock()
	player := ws.Players[playerID]
	coordination := (*model.WarCoordinationState)(nil)
	if player != nil {
		coordination = player.WarCoordination
	}
	ws.RUnlock()
	if coordination == nil || len(coordination.TaskForces) == 0 {
		return view
	}

	ids := make([]string, 0, len(coordination.TaskForces))
	for id := range coordination.TaskForces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		taskForce := coordination.TaskForces[id]
		if taskForce == nil {
			continue
		}
		tfView := model.WarTaskForceView{
			ID:              taskForce.ID,
			Name:            taskForce.Name,
			TheaterID:       taskForce.TheaterID,
			Stance:          string(taskForce.Stance),
			Members:         model.ResolveWarTaskForceMembers(player, taskForce, worlds, spaceRuntime),
			CommandCapacity: model.EvaluateWarTaskForce(player, taskForce, worlds, spaceRuntime),
		}
		tfView.SupplyStatus = model.SummarizeWarTaskForceSupply(tfView.Members)
		if taskForce.Deployment != nil {
			deployment := *taskForce.Deployment
			if taskForce.Deployment.Position != nil {
				pos := *taskForce.Deployment.Position
				deployment.Position = &pos
			}
			tfView.Deployment = &deployment
		}
		view.TaskForces = append(view.TaskForces, tfView)
	}
	return view
}

// WarTheaters returns player-owned theater state.
func (ql *Layer) WarTheaters(ws *model.WorldState, playerID string) *model.WarTheaterListView {
	view := &model.WarTheaterListView{Theaters: []model.WarTheaterView{}}
	if ws == nil {
		return view
	}
	ws.RLock()
	player := ws.Players[playerID]
	coordination := (*model.WarCoordinationState)(nil)
	if player != nil {
		coordination = player.WarCoordination
	}
	ws.RUnlock()
	if coordination == nil || len(coordination.Theaters) == 0 {
		return view
	}

	ids := make([]string, 0, len(coordination.Theaters))
	for id := range coordination.Theaters {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		theater := coordination.Theaters[id]
		if theater == nil {
			continue
		}
		theaterView := model.WarTheaterView{
			ID:    theater.ID,
			Name:  theater.Name,
			Zones: make([]model.WarTheaterZoneView, 0, len(theater.Zones)),
		}
		for _, zone := range theater.Zones {
			zoneView := model.WarTheaterZoneView{
				ZoneType: string(zone.ZoneType),
				SystemID: zone.SystemID,
				PlanetID: zone.PlanetID,
				Radius:   zone.Radius,
			}
			if zone.Position != nil {
				pos := *zone.Position
				zoneView.Position = &pos
			}
			theaterView.Zones = append(theaterView.Zones, zoneView)
		}
		if theater.Objective != nil {
			objective := *theater.Objective
			theaterView.Objective = &model.WarTheaterObjectiveView{
				ObjectiveType: objective.ObjectiveType,
				SystemID:      objective.SystemID,
				PlanetID:      objective.PlanetID,
				EntityID:      objective.EntityID,
				Description:   objective.Description,
			}
		}
		view.Theaters = append(view.Theaters, theaterView)
	}
	return view
}
