package gamecore

import (
	"fmt"
	"math"
	"sort"

	"siliconworld/internal/model"
)

func (gc *GameCore) execTheaterCreate(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID, err := payloadStrictString(cmd.Payload, "theater_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	systemID, err := payloadStrictString(cmd.Payload, "system_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if _, ok := gc.maps.System(systemID); !ok {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("system %s not found", systemID)
		return res, nil
	}

	systemRuntime := gc.ensureSpaceRuntime().EnsurePlayerSystem(playerID, systemID)
	if systemRuntime.Theaters[theaterID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("theater %s already exists", theaterID)
		return res, nil
	}

	theater := &model.Theater{
		ID:       theaterID,
		OwnerID:  playerID,
		SystemID: systemID,
	}
	if name, err := optionalPayloadString(cmd.Payload, "name"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	} else if name != "" {
		theater.Name = name
	}
	theater.LastUpdatedTick = gc.CurrentTick()
	systemRuntime.Theaters[theaterID] = theater

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("theater %s created in %s", theaterID, systemID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theaterID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) execTheaterDefineZone(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theater, _, result := gc.requireOwnedTheater(playerID, cmd)
	if result != nil {
		return *result, nil
	}
	zoneTypeRaw, err := payloadStrictString(cmd.Payload, "zone_type")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	zoneType := model.TheaterZoneType(zoneTypeRaw)
	if !validTheaterZoneType(zoneType) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid theater zone type: %s", zoneTypeRaw)
		return res, nil
	}
	zone, err := gc.parseTheaterZone(theater.SystemID, zoneType, cmd.Payload)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	theater.Zones = append(theater.Zones, zone)
	theater.LastUpdatedTick = gc.CurrentTick()

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("theater %s zone %s updated", theater.ID, zoneType)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theater.ID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) execTheaterSetObjective(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theater, _, result := gc.requireOwnedTheater(playerID, cmd)
	if result != nil {
		return *result, nil
	}
	objectiveType, err := payloadStrictString(cmd.Payload, "objective_type")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	objective, err := gc.parseTheaterObjective(theater.SystemID, objectiveType, cmd.Payload)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	theater.Objective = objective
	theater.LastUpdatedTick = gc.CurrentTick()

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("theater %s objective set to %s", theater.ID, objectiveType)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theater.ID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) execTaskForceCreate(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	systemID, err := payloadStrictString(cmd.Payload, "system_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if _, ok := gc.maps.System(systemID); !ok {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("system %s not found", systemID)
		return res, nil
	}
	systemRuntime := gc.ensureSpaceRuntime().EnsurePlayerSystem(playerID, systemID)
	if systemRuntime.TaskForces[taskForceID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("task force %s already exists", taskForceID)
		return res, nil
	}

	taskForce := &model.TaskForce{
		ID:       taskForceID,
		OwnerID:  playerID,
		SystemID: systemID,
		Stance:   model.TaskForceStanceHold,
		Status:   model.TaskForceStatusIdle,
		Behavior: model.DefaultTaskForceBehavior(model.TaskForceStanceHold),
	}
	if name, err := optionalPayloadString(cmd.Payload, "name"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	} else if name != "" {
		taskForce.Name = name
	}
	if theaterID, err := optionalPayloadString(cmd.Payload, "theater_id"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	} else if theaterID != "" {
		if systemRuntime.Theaters[theaterID] == nil {
			res.Code = model.CodeEntityNotFound
			res.Message = fmt.Sprintf("theater %s not found", theaterID)
			return res, nil
		}
		taskForce.TheaterID = theaterID
	}
	gc.refreshTaskForceRuntime(taskForce)
	systemRuntime.TaskForces[taskForceID] = taskForce

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s created in %s", taskForceID, systemID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceAssign(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForce, _, result := gc.requireOwnedTaskForce(playerID, cmd)
	if result != nil {
		return *result, nil
	}

	fleetIDs, err := payloadStringSlice(cmd.Payload, "fleet_ids")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	squadIDs, err := payloadStringSlice(cmd.Payload, "squad_ids")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if len(fleetIDs) == 0 && len(squadIDs) == 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.fleet_ids or payload.squad_ids required"
		return res, nil
	}

	members := make([]model.TaskForceMemberRef, 0, len(fleetIDs)+len(squadIDs))
	for _, fleetID := range fleetIDs {
		systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
		if fleet == nil || systemRuntime == nil {
			res.Code = model.CodeEntityNotFound
			res.Message = fmt.Sprintf("fleet %s not found", fleetID)
			return res, nil
		}
		members = append(members, model.TaskForceMemberRef{
			UnitKind: model.RuntimeUnitKindFleet,
			UnitID:   fleet.ID,
			SystemID: systemRuntime.SystemID,
		})
	}
	for _, squadID := range squadIDs {
		squad, planetID := gc.findOwnedCombatSquad(playerID, squadID)
		if squad == nil {
			res.Code = model.CodeEntityNotFound
			res.Message = fmt.Sprintf("combat squad %s not found", squadID)
			return res, nil
		}
		planet, ok := gc.maps.Planet(planetID)
		if !ok || planet.SystemID != taskForce.SystemID {
			res.Code = model.CodeInvalidTarget
			res.Message = fmt.Sprintf("combat squad %s is outside task force system %s", squadID, taskForce.SystemID)
			return res, nil
		}
		members = append(members, model.TaskForceMemberRef{
			UnitKind: model.RuntimeUnitKindCombatSquad,
			UnitID:   squad.ID,
			PlanetID: planetID,
			SystemID: planet.SystemID,
		})
	}
	taskForce.Members = members
	gc.refreshTaskForceRuntime(taskForce)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s assigned %d member(s)", taskForce.ID, len(members))
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForce.ID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceSetStance(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForce, _, result := gc.requireOwnedTaskForce(playerID, cmd)
	if result != nil {
		return *result, nil
	}
	stanceRaw, err := payloadStrictString(cmd.Payload, "stance")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	stance := model.TaskForceStance(stanceRaw)
	if !validTaskForceStance(stance) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid task force stance: %s", stanceRaw)
		return res, nil
	}
	taskForce.Stance = stance
	gc.refreshTaskForceRuntime(taskForce)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s set to %s", taskForce.ID, stance)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForce.ID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceDeploy(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForce, _, result := gc.requireOwnedTaskForce(playerID, cmd)
	if result != nil {
		return *result, nil
	}
	target, err := gc.parseTaskForceDeploymentTarget(taskForce.SystemID, cmd.Payload)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	taskForce.DeploymentTarget = target
	taskForce.Status = model.TaskForceStatusDeploying
	gc.refreshTaskForceRuntime(taskForce)
	gc.assignTaskForceTargets(taskForce)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s deployed", taskForce.ID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForce.ID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) ensureSpaceRuntime() *model.SpaceRuntimeState {
	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	return gc.spaceRuntime
}

func (gc *GameCore) requireOwnedTaskForce(playerID string, cmd model.Command) (*model.TaskForce, *model.PlayerSystemRuntime, *model.CommandResult) {
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		return nil, nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: err.Error()}
	}
	systemRuntime, taskForce := findOwnedTaskForce(gc.spaceRuntime, playerID, taskForceID)
	if taskForce == nil || systemRuntime == nil {
		return nil, nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeEntityNotFound, Message: fmt.Sprintf("task force %s not found", taskForceID)}
	}
	return taskForce, systemRuntime, nil
}

func (gc *GameCore) requireOwnedTheater(playerID string, cmd model.Command) (*model.Theater, *model.PlayerSystemRuntime, *model.CommandResult) {
	theaterID, err := payloadStrictString(cmd.Payload, "theater_id")
	if err != nil {
		return nil, nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: err.Error()}
	}
	systemRuntime, theater := findOwnedTheater(gc.spaceRuntime, playerID, theaterID)
	if theater == nil || systemRuntime == nil {
		return nil, nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeEntityNotFound, Message: fmt.Sprintf("theater %s not found", theaterID)}
	}
	return theater, systemRuntime, nil
}

func validTaskForceStance(stance model.TaskForceStance) bool {
	switch stance {
	case model.TaskForceStanceHold,
		model.TaskForceStancePatrol,
		model.TaskForceStanceEscort,
		model.TaskForceStanceIntercept,
		model.TaskForceStanceHarass,
		model.TaskForceStanceSiege,
		model.TaskForceStanceBombard,
		model.TaskForceStanceRetreatOnLosses,
		model.TaskForceStancePreserveStealth,
		model.TaskForceStanceAggressivePursuit:
		return true
	default:
		return false
	}
}

func validTheaterZoneType(zoneType model.TheaterZoneType) bool {
	switch zoneType {
	case model.TheaterZonePrimary,
		model.TheaterZoneSecondary,
		model.TheaterZoneExclusion,
		model.TheaterZoneAssembly,
		model.TheaterZoneSupplyPriority:
		return true
	default:
		return false
	}
}

func payloadStringSlice(payload map[string]any, key string) ([]string, error) {
	raw, ok := payload[key]
	if !ok {
		return nil, nil
	}
	switch value := raw.(type) {
	case []string:
		out := make([]string, 0, len(value))
		for _, item := range value {
			if item != "" {
				out = append(out, item)
			}
		}
		return out, nil
	case []any:
		out := make([]string, 0, len(value))
		for _, item := range value {
			text, ok := item.(string)
			if !ok || text == "" {
				return nil, fmt.Errorf("payload.%s must be an array of strings", key)
			}
			out = append(out, text)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("payload.%s must be an array of strings", key)
	}
}

func payloadPosition(raw any) (*model.Position, error) {
	switch value := raw.(type) {
	case model.Position:
		pos := value
		return &pos, nil
	case *model.Position:
		if value == nil {
			return nil, nil
		}
		pos := *value
		return &pos, nil
	case map[string]any:
		x, err := payloadValueInt(value["x"])
		if err != nil {
			return nil, fmt.Errorf("payload.position.x must be integer")
		}
		y, err := payloadValueInt(value["y"])
		if err != nil {
			return nil, fmt.Errorf("payload.position.y must be integer")
		}
		return &model.Position{X: x, Y: y}, nil
	default:
		return nil, fmt.Errorf("payload.position must be an object")
	}
}

func (gc *GameCore) parseTaskForceDeploymentTarget(defaultSystemID string, payload map[string]any) (*model.TaskForceDeploymentTarget, error) {
	target := &model.TaskForceDeploymentTarget{SystemID: defaultSystemID}
	if systemID, err := optionalPayloadString(payload, "system_id"); err != nil {
		return nil, err
	} else if systemID != "" {
		if _, exists := gc.maps.System(systemID); !exists {
			return nil, fmt.Errorf("system %s not found", systemID)
		}
		target.SystemID = systemID
		target.Layer = "system"
	}
	if planetID, err := optionalPayloadString(payload, "planet_id"); err != nil {
		return nil, err
	} else if planetID != "" {
		planet, exists := gc.maps.Planet(planetID)
		if !exists {
			return nil, fmt.Errorf("planet %s not found", planetID)
		}
		target.Layer = "planet"
		target.PlanetID = planetID
		target.SystemID = planet.SystemID
	}
	if rawPos, ok := payload["position"]; ok {
		pos, err := payloadPosition(rawPos)
		if err != nil {
			return nil, err
		}
		target.Position = pos
		target.Layer = "position"
		if target.PlanetID == "" {
			if planetID, err := optionalPayloadString(payload, "planet_id"); err == nil && planetID != "" {
				target.PlanetID = planetID
			} else if err != nil {
				return nil, err
			}
		}
	}
	if target.Layer == "" {
		return nil, fmt.Errorf("payload.system_id, payload.planet_id or payload.position required")
	}
	return target, nil
}

func (gc *GameCore) parseTheaterZone(systemID string, zoneType model.TheaterZoneType, payload map[string]any) (model.TheaterZone, error) {
	zone := model.TheaterZone{ZoneType: zoneType, SystemID: systemID}
	if planetID, err := optionalPayloadString(payload, "planet_id"); err != nil {
		return zone, err
	} else if planetID != "" {
		planet, exists := gc.maps.Planet(planetID)
		if !exists {
			return zone, fmt.Errorf("planet %s not found", planetID)
		}
		zone.PlanetID = planetID
		zone.SystemID = planet.SystemID
	}
	if rawPos, ok := payload["position"]; ok {
		pos, err := payloadPosition(rawPos)
		if err != nil {
			return zone, err
		}
		zone.Position = pos
	}
	return zone, nil
}

func (gc *GameCore) parseTheaterObjective(defaultSystemID, objectiveType string, payload map[string]any) (*model.TheaterObjective, error) {
	objective := &model.TheaterObjective{
		ObjectiveType:  objectiveType,
		TargetSystemID: defaultSystemID,
	}
	if systemID, err := optionalPayloadString(payload, "target_system_id"); err != nil {
		return nil, err
	} else if systemID != "" {
		if _, exists := gc.maps.System(systemID); !exists {
			return nil, fmt.Errorf("system %s not found", systemID)
		}
		objective.TargetSystemID = systemID
	}
	if planetID, err := optionalPayloadString(payload, "target_planet_id"); err != nil {
		return nil, err
	} else if planetID != "" {
		planet, exists := gc.maps.Planet(planetID)
		if !exists {
			return nil, fmt.Errorf("planet %s not found", planetID)
		}
		objective.TargetPlanetID = planetID
		objective.TargetSystemID = planet.SystemID
	}
	if rawPos, ok := payload["position"]; ok {
		pos, err := payloadPosition(rawPos)
		if err != nil {
			return nil, err
		}
		objective.Position = pos
	}
	return objective, nil
}

func findOwnedTaskForce(spaceRuntime *model.SpaceRuntimeState, playerID, taskForceID string) (*model.PlayerSystemRuntime, *model.TaskForce) {
	if spaceRuntime == nil || taskForceID == "" {
		return nil, nil
	}
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil || playerRuntime.PlayerID != playerID {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			if taskForce := systemRuntime.TaskForces[taskForceID]; taskForce != nil {
				return systemRuntime, taskForce
			}
		}
	}
	return nil, nil
}

func findOwnedTheater(spaceRuntime *model.SpaceRuntimeState, playerID, theaterID string) (*model.PlayerSystemRuntime, *model.Theater) {
	if spaceRuntime == nil || theaterID == "" {
		return nil, nil
	}
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil || playerRuntime.PlayerID != playerID {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			if theater := systemRuntime.Theaters[theaterID]; theater != nil {
				return systemRuntime, theater
			}
		}
	}
	return nil, nil
}

func (gc *GameCore) findOwnedCombatSquad(playerID, squadID string) (*model.CombatSquad, string) {
	if squadID == "" {
		return nil, ""
	}
	planetIDs := make([]string, 0, len(gc.worlds))
	for planetID := range gc.worlds {
		planetIDs = append(planetIDs, planetID)
	}
	sort.Strings(planetIDs)
	for _, planetID := range planetIDs {
		world := gc.worlds[planetID]
		if world == nil || world.CombatRuntime == nil {
			continue
		}
		squad := world.CombatRuntime.Squads[squadID]
		if squad != nil && squad.OwnerID == playerID {
			return squad, planetID
		}
	}
	return nil, ""
}

func (gc *GameCore) refreshTaskForceRuntime(taskForce *model.TaskForce) {
	if taskForce == nil {
		return
	}
	taskForce.Behavior = model.DefaultTaskForceBehavior(taskForce.Stance)
	taskForce.CommandCapacity = gc.computeTaskForceCommandCapacity(taskForce)
	taskForce.LastUpdatedTick = gc.CurrentTick()
}

func (gc *GameCore) computeTaskForceCommandCapacity(taskForce *model.TaskForce) model.TaskForceCommandCapacity {
	capacity := model.TaskForceCommandCapacity{}
	if taskForce == nil {
		return capacity
	}
	capacity.Sources = append(capacity.Sources, model.CommandCapacitySource{
		Type:     model.CommandCapacitySourceCommandCenter,
		SourceID: "command-center:" + taskForce.OwnerID,
		Label:    "Strategic Command",
		Capacity: 4,
	})
	capacity.Total += 4

	for _, world := range gc.worlds {
		if world == nil || world.PlanetID == "" {
			continue
		}
		planet, ok := gc.maps.Planet(world.PlanetID)
		if !ok || planet.SystemID != taskForce.SystemID {
			continue
		}
		for _, building := range world.Buildings {
			if building == nil || building.OwnerID != taskForce.OwnerID || building.Runtime.State != model.BuildingWorkRunning {
				continue
			}
			switch building.Type {
			case model.BuildingTypeBattlefieldAnalysisBase:
				capacity.Sources = append(capacity.Sources, model.CommandCapacitySource{
					Type:     model.CommandCapacitySourceBattlefieldAnalysisBase,
					SourceID: building.ID,
					Label:    "Battlefield Analysis Base",
					Capacity: 6,
				})
				capacity.Total += 6
			case model.BuildingTypeSelfEvolutionLab:
				capacity.Sources = append(capacity.Sources, model.CommandCapacitySource{
					Type:     model.CommandCapacitySourceMilitaryAICore,
					SourceID: building.ID,
					Label:    "Military AI Core",
					Capacity: 5,
				})
				capacity.Total += 5
			}
		}
	}

	player := gc.playerState(taskForce.OwnerID)
	for _, member := range taskForce.Members {
		if member.UnitKind != model.RuntimeUnitKindFleet {
			continue
		}
		_, fleet := findOwnedFleet(gc.spaceRuntime, taskForce.OwnerID, member.UnitID)
		if fleet == nil {
			continue
		}
		commandShipCapacity := commandShipCapacityForFleet(player, fleet)
		if commandShipCapacity <= 0 {
			continue
		}
		capacity.Sources = append(capacity.Sources, model.CommandCapacitySource{
			Type:     model.CommandCapacitySourceCommandShip,
			SourceID: fleet.ID,
			Label:    "Flag Command Ship",
			Capacity: commandShipCapacity,
		})
		capacity.Total += commandShipCapacity
	}

	capacity.Used = gc.taskForceUsage(taskForce)
	capacity.Over = max(0, capacity.Used-capacity.Total)
	capacity.Penalty = commandPenaltyForOver(capacity.Over)
	return capacity
}

func commandShipCapacityForFleet(player *model.PlayerState, fleet *model.SpaceFleet) int {
	if fleet == nil {
		return 0
	}
	totalUnits := 0
	bonus := 0
	for _, stack := range fleet.Units {
		totalUnits += max(0, stack.Count)
		blueprintID := stack.BlueprintID
		if blueprintID == "" {
			blueprintID = stack.UnitType
		}
		blueprint, ok := model.ResolveWarBlueprintDefinition(player, blueprintID)
		if ok && blueprint.SlotAssignments["utility"] == "command_uplink" {
			bonus += max(1, stack.Count)
		}
	}
	if totalUnits == 0 {
		return 0
	}
	return 2 + totalUnits/2 + bonus
}

func commandPenaltyForOver(over int) model.CommandCapacityPenalty {
	if over <= 0 {
		return model.CommandCapacityPenalty{
			HitRateMultiplier:      1,
			FormationMultiplier:    1,
			CoordinationMultiplier: 1,
		}
	}
	return model.CommandCapacityPenalty{
		DelayTicks:             min(5, 1+over/2),
		HitRateMultiplier:      math.Max(0.45, 1.0-float64(over)*0.08),
		FormationMultiplier:    math.Max(0.4, 1.0-float64(over)*0.1),
		CoordinationMultiplier: math.Max(0.35, 1.0-float64(over)*0.09),
	}
}

func (gc *GameCore) taskForceUsage(taskForce *model.TaskForce) int {
	if taskForce == nil {
		return 0
	}
	used := 0
	hasFleet := false
	hasSquad := false
	for _, member := range taskForce.Members {
		switch member.UnitKind {
		case model.RuntimeUnitKindFleet:
			hasFleet = true
			_, fleet := findOwnedFleet(gc.spaceRuntime, taskForce.OwnerID, member.UnitID)
			if fleet == nil {
				continue
			}
			totalUnits := 0
			for _, stack := range fleet.Units {
				totalUnits += max(0, stack.Count)
			}
			used += 4 + totalUnits*3 + len(fleet.Units)*2
		case model.RuntimeUnitKindCombatSquad:
			hasSquad = true
			squad, _ := gc.findOwnedCombatSquad(taskForce.OwnerID, member.UnitID)
			if squad == nil {
				continue
			}
			used += 2 + max(1, squad.Count)*2
		}
	}
	if hasFleet && hasSquad {
		used += 2
	}
	if taskForce.TheaterID != "" {
		used++
	}
	if taskForce.DeploymentTarget != nil && taskForce.DeploymentTarget.Layer == "position" {
		used++
	}
	return used
}

func (gc *GameCore) playerState(playerID string) *model.PlayerState {
	for _, world := range gc.worlds {
		if world == nil {
			continue
		}
		if player := world.Players[playerID]; player != nil {
			return player
		}
	}
	return nil
}

func (gc *GameCore) assignTaskForceTargets(taskForce *model.TaskForce) {
	if taskForce == nil || taskForce.DeploymentTarget == nil {
		return
	}
	targetWorld := gc.targetWorldForTaskForce(taskForce)
	var preferred *model.EnemyForce
	if targetWorld != nil {
		preferred = selectEnemyForceForTaskForce(targetWorld, taskForce.Behavior, taskForce.DeploymentTarget)
	}
	for _, member := range taskForce.Members {
		switch member.UnitKind {
		case model.RuntimeUnitKindFleet:
			_, fleet := findOwnedFleet(gc.spaceRuntime, taskForce.OwnerID, member.UnitID)
			if fleet == nil {
				continue
			}
			if preferred != nil && targetWorld != nil {
				fleet.Target = &model.FleetTarget{PlanetID: targetWorld.PlanetID, TargetID: preferred.ID}
				fleet.State = model.FleetStateAttacking
				taskForce.Status = model.TaskForceStatusEngaging
			} else {
				fleet.Target = nil
				fleet.State = model.FleetStateIdle
			}
		case model.RuntimeUnitKindCombatSquad:
			squad, _ := gc.findOwnedCombatSquad(taskForce.OwnerID, member.UnitID)
			if squad == nil {
				continue
			}
			if preferred != nil && targetWorld != nil && squad.PlanetID == targetWorld.PlanetID {
				squad.TargetEnemyID = preferred.ID
				squad.State = model.CombatSquadStateEngaging
				taskForce.Status = model.TaskForceStatusEngaging
			} else {
				squad.TargetEnemyID = ""
				squad.State = model.CombatSquadStateIdle
			}
		}
	}
}

func (gc *GameCore) targetWorldForTaskForce(taskForce *model.TaskForce) *model.WorldState {
	if taskForce == nil || taskForce.DeploymentTarget == nil {
		return nil
	}
	if taskForce.DeploymentTarget.PlanetID != "" {
		return gc.worlds[taskForce.DeploymentTarget.PlanetID]
	}
	for _, world := range gc.worlds {
		if world == nil {
			continue
		}
		planet, ok := gc.maps.Planet(world.PlanetID)
		if ok && planet.SystemID == taskForce.DeploymentTarget.SystemID {
			return world
		}
	}
	return nil
}

func selectEnemyForceForTaskForce(ws *model.WorldState, behavior model.TaskForceBehaviorProfile, target *model.TaskForceDeploymentTarget) *model.EnemyForce {
	if ws == nil || ws.EnemyForces == nil || len(ws.EnemyForces.Forces) == 0 {
		return nil
	}
	var selected *model.EnemyForce
	for index := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[index]
		if force.Strength <= 0 {
			continue
		}
		if selected == nil {
			selected = force
			continue
		}
		switch behavior.TargetPriority {
		case "highest_threat", "fortified_target", "planetary_target":
			if force.Strength > selected.Strength {
				selected = force
			}
		case "weakest_target", "survivable_target", "isolated_target":
			if force.Strength < selected.Strength {
				selected = force
			}
		case "fastest_contact", "closest_threat_to_objective", "nearest_threat":
			fallthrough
		default:
			if distanceToTaskForceTarget(force.Position, target) < distanceToTaskForceTarget(selected.Position, target) {
				selected = force
			}
		}
	}
	return selected
}

func distanceToTaskForceTarget(position model.Position, target *model.TaskForceDeploymentTarget) float64 {
	if target == nil || target.Position == nil {
		return 0
	}
	return model.CalculateDistance(position, *target.Position)
}
