package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func (gc *GameCore) execTaskForceCreate(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = "player not found"
		return res, nil
	}
	coordination := player.EnsureWarCoordination()
	if coordination.TaskForces[taskForceID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("task force %s already exists", taskForceID)
		return res, nil
	}

	stance := model.WarTaskForceStanceHold
	if raw, ok := cmd.Payload["stance"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.stance must be a string"
			return res, nil
		}
		stance = model.WarTaskForceStance(value)
	}
	if !model.ValidWarTaskForceStance(stance) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid task force stance: %s", stance)
		return res, nil
	}

	taskForce := &model.WarTaskForce{
		ID:          taskForceID,
		OwnerID:     playerID,
		Stance:      stance,
		CreatedTick: ws.Tick,
		UpdatedTick: ws.Tick,
	}
	if raw, ok := cmd.Payload["name"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.name must be a string"
			return res, nil
		}
		taskForce.Name = value
	}
	coordination.TaskForces[taskForceID] = taskForce

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s created", taskForceID)
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

func (gc *GameCore) execTaskForceAssign(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	kindRaw, err := payloadStrictString(cmd.Payload, "member_kind")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	memberKind := model.WarTaskForceMemberKind(kindRaw)
	if !model.ValidWarTaskForceMemberKind(memberKind) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid task force member kind: %s", memberKind)
		return res, nil
	}
	memberIDs, err := payloadStringSlice(cmd.Payload, "member_ids")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = "player not found"
		return res, nil
	}
	coordination := player.EnsureWarCoordination()
	taskForce := coordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return res, nil
	}

	for _, memberID := range memberIDs {
		if err := gc.requireTaskForceMemberOwnership(ws, playerID, memberKind, memberID); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		if current := model.FindWarTaskForceByMember(player, memberKind, memberID); current != nil {
			current.Members = removeTaskForceMember(current.Members, memberKind, memberID)
			current.UpdatedTick = ws.Tick
		}
		if !taskForceHasMember(taskForce, memberKind, memberID) {
			taskForce.Members = append(taskForce.Members, model.WarTaskForceMemberRef{
				Kind:     memberKind,
				EntityID: memberID,
			})
		}
	}
	taskForce.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s assigned %d members", taskForceID, len(memberIDs))
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceSetStance(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	stanceRaw, err := payloadStrictString(cmd.Payload, "stance")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	stance := model.WarTaskForceStance(stanceRaw)
	if !model.ValidWarTaskForceStance(stance) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid task force stance: %s", stance)
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return res, nil
	}
	taskForce := player.WarCoordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return res, nil
	}
	taskForce.Stance = stance
	taskForce.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s stance set to %s", taskForceID, stance)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceDeploy(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return res, nil
	}
	taskForce := player.WarCoordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return res, nil
	}

	deployment := &model.WarTaskForceDeployment{}
	if raw, ok := cmd.Payload["system_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.system_id must be a string"
			return res, nil
		}
		deployment.SystemID = value
	}
	if raw, ok := cmd.Payload["planet_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.planet_id must be a string"
			return res, nil
		}
		deployment.PlanetID = value
	}
	if raw, ok := cmd.Payload["position"]; ok {
		position, err := payloadPosition(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		deployment.Position = position
	}
	if raw, ok := cmd.Payload["frontline_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.frontline_id must be a string"
			return res, nil
		}
		deployment.FrontlineID = value
	}
	if raw, ok := cmd.Payload["ground_order"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.ground_order must be a string"
			return res, nil
		}
		deployment.GroundOrder = model.GroundTaskForceOrder(value)
		if !model.ValidGroundTaskForceOrder(deployment.GroundOrder) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("invalid ground order: %s", value)
			return res, nil
		}
	}
	if raw, ok := cmd.Payload["support_mode"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.support_mode must be a string"
			return res, nil
		}
		deployment.OrbitalSupportMode = model.OrbitalSupportMode(value)
		if !model.ValidOrbitalSupportMode(deployment.OrbitalSupportMode) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("invalid orbital support mode: %s", value)
			return res, nil
		}
	}
	if deployment.SystemID == "" && deployment.PlanetID == "" && deployment.Position == nil && deployment.FrontlineID == "" && deployment.GroundOrder == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "task_force_deploy requires at least one target field"
		return res, nil
	}
	if raw, ok := cmd.Payload["theater_id"]; ok {
		theaterID, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.theater_id must be a string"
			return res, nil
		}
		if theaterID != "" {
			theater := player.WarCoordination.Theaters[theaterID]
			if theater == nil {
				res.Code = model.CodeEntityNotFound
				res.Message = fmt.Sprintf("theater %s not found", theaterID)
				return res, nil
			}
			taskForce.TheaterID = theaterID
		}
	}
	taskForce.Deployment = deployment
	taskForce.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("task force %s deployment updated", taskForceID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTheaterCreate(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID, err := payloadStrictString(cmd.Payload, "theater_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = "player not found"
		return res, nil
	}
	coordination := player.EnsureWarCoordination()
	if coordination.Theaters[theaterID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("theater %s already exists", theaterID)
		return res, nil
	}
	theater := &model.WarTheater{
		ID:          theaterID,
		OwnerID:     playerID,
		CreatedTick: ws.Tick,
		UpdatedTick: ws.Tick,
	}
	if raw, ok := cmd.Payload["name"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.name must be a string"
			return res, nil
		}
		theater.Name = value
	}
	coordination.Theaters[theaterID] = theater

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("theater %s created", theaterID)
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

func (gc *GameCore) execTheaterDefineZone(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID, err := payloadStrictString(cmd.Payload, "theater_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	zoneTypeRaw, err := payloadStrictString(cmd.Payload, "zone_type")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	zoneType := model.WarTheaterZoneType(zoneTypeRaw)
	if !model.ValidWarTheaterZoneType(zoneType) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid theater zone type: %s", zoneType)
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("theater %s not found", theaterID)
		return res, nil
	}
	theater := player.WarCoordination.Theaters[theaterID]
	if theater == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("theater %s not found", theaterID)
		return res, nil
	}

	zone := model.WarTheaterZone{ZoneType: zoneType}
	if raw, ok := cmd.Payload["system_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.system_id must be a string"
			return res, nil
		}
		zone.SystemID = value
	}
	if raw, ok := cmd.Payload["planet_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.planet_id must be a string"
			return res, nil
		}
		zone.PlanetID = value
	}
	if raw, ok := cmd.Payload["position"]; ok {
		position, err := payloadPosition(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		zone.Position = position
	}
	if raw, ok := cmd.Payload["radius"]; ok {
		value, err := payloadValueInt(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.radius must be integer"
			return res, nil
		}
		zone.Radius = value
	}

	replaced := false
	for index := range theater.Zones {
		if theater.Zones[index].ZoneType == zone.ZoneType {
			theater.Zones[index] = zone
			replaced = true
			break
		}
	}
	if !replaced {
		theater.Zones = append(theater.Zones, zone)
	}
	theater.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("theater %s zone %s updated", theaterID, zoneType)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theaterID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) execTheaterSetObjective(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID, err := payloadStrictString(cmd.Payload, "theater_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	objectiveType, err := payloadStrictString(cmd.Payload, "objective_type")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("theater %s not found", theaterID)
		return res, nil
	}
	theater := player.WarCoordination.Theaters[theaterID]
	if theater == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("theater %s not found", theaterID)
		return res, nil
	}

	objective := &model.WarTheaterObjective{ObjectiveType: objectiveType}
	if raw, ok := cmd.Payload["system_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.system_id must be a string"
			return res, nil
		}
		objective.SystemID = value
	}
	if raw, ok := cmd.Payload["planet_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.planet_id must be a string"
			return res, nil
		}
		objective.PlanetID = value
	}
	if raw, ok := cmd.Payload["entity_id"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.entity_id must be a string"
			return res, nil
		}
		objective.EntityID = value
	}
	if raw, ok := cmd.Payload["description"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.description must be a string"
			return res, nil
		}
		objective.Description = value
	}
	theater.Objective = objective
	theater.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("theater %s objective updated", theaterID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theaterID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) requireTaskForceMemberOwnership(ws *model.WorldState, playerID string, kind model.WarTaskForceMemberKind, entityID string) error {
	switch kind {
	case model.WarTaskForceMemberKindSquad:
		for _, world := range gc.worlds {
			if world == nil || world.CombatRuntime == nil {
				continue
			}
			squad := world.CombatRuntime.Squads[entityID]
			if squad == nil {
				continue
			}
			if squad.OwnerID != playerID {
				return fmt.Errorf("combat squad %s is not owned by %s", entityID, playerID)
			}
			return nil
		}
		return fmt.Errorf("combat squad %s not found", entityID)
	case model.WarTaskForceMemberKindFleet:
		_, fleet := findOwnedFleet(gc.spaceRuntime, playerID, entityID)
		if fleet == nil {
			return fmt.Errorf("fleet %s not found", entityID)
		}
		return nil
	default:
		return fmt.Errorf("invalid task force member kind: %s", kind)
	}
}

func taskForceHasMember(taskForce *model.WarTaskForce, kind model.WarTaskForceMemberKind, entityID string) bool {
	if taskForce == nil {
		return false
	}
	for _, member := range taskForce.Members {
		if member.Kind == kind && member.EntityID == entityID {
			return true
		}
	}
	return false
}

func removeTaskForceMember(members []model.WarTaskForceMemberRef, kind model.WarTaskForceMemberKind, entityID string) []model.WarTaskForceMemberRef {
	if len(members) == 0 {
		return members
	}
	out := make([]model.WarTaskForceMemberRef, 0, len(members))
	for _, member := range members {
		if member.Kind == kind && member.EntityID == entityID {
			continue
		}
		out = append(out, member)
	}
	return out
}

func payloadPosition(raw any) (*model.Position, error) {
	if raw == nil {
		return nil, nil
	}
	if position, ok := raw.(model.Position); ok {
		return &position, nil
	}
	record, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("payload.position must be an object with x and y")
	}
	xRaw, ok := record["x"]
	if !ok {
		return nil, fmt.Errorf("payload.position.x required")
	}
	yRaw, ok := record["y"]
	if !ok {
		return nil, fmt.Errorf("payload.position.y required")
	}
	x, err := payloadValueInt(xRaw)
	if err != nil {
		return nil, fmt.Errorf("payload.position.x must be integer")
	}
	y, err := payloadValueInt(yRaw)
	if err != nil {
		return nil, fmt.Errorf("payload.position.y must be integer")
	}
	position := &model.Position{X: x, Y: y}
	if rawZ, ok := record["z"]; ok {
		z, err := payloadValueInt(rawZ)
		if err != nil {
			return nil, fmt.Errorf("payload.position.z must be integer")
		}
		position.Z = z
	}
	return position, nil
}
