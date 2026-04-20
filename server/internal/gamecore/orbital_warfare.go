package gamecore

import (
	"fmt"
	"math"
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func (gc *GameCore) execBlockadePlanet(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	planetID, err := payloadStrictString(cmd.Payload, "planet_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	_, taskForce, failure := requireOwnedTaskForce(ws, playerID, taskForceID)
	if failure != nil {
		return *failure, nil
	}
	planet, ok := gc.maps.Planet(planetID)
	if !ok || planet == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("planet %s not found", planetID)
		return res, nil
	}
	fleets := taskForceFleetMembers(playerID, taskForce, gc.spaceRuntime)
	if len(fleets) == 0 {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("task force %s has no fleet members for blockade", taskForceID)
		return res, nil
	}
	systemID := planet.SystemID
	if taskForce.Deployment != nil && taskForce.Deployment.SystemID != "" && taskForce.Deployment.SystemID != systemID {
		res.Code = model.CodeInvalidTarget
		res.Message = "task force deployment does not match blockade system"
		return res, nil
	}
	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	systemRuntime := gc.spaceRuntime.EnsureSystemWarfare(systemID)
	blockade := systemRuntime.PlanetBlockades[planetID]
	if blockade == nil {
		blockade = &model.PlanetBlockadeState{
			PlanetID: planetID,
			SystemID: systemID,
		}
		systemRuntime.PlanetBlockades[planetID] = blockade
	}
	blockade.OwnerID = playerID
	blockade.TaskForceID = taskForceID
	blockade.Status = model.PlanetBlockadeStatusPlanned
	blockade.Intensity = 0
	blockade.LastReason = "awaiting_orbital_superiority"
	blockade.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("planet %s blockade assigned to task force %s", planetID, taskForceID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "planet_blockade",
			"planet_id":   planetID,
			"blockade":    blockade,
		},
	}}
}

func (gc *GameCore) execLandingStart(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID, err := payloadStrictString(cmd.Payload, "task_force_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	planetID, err := payloadStrictString(cmd.Payload, "planet_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	player, taskForce, failure := requireOwnedTaskForce(ws, playerID, taskForceID)
	if failure != nil {
		return *failure, nil
	}
	planet, ok := gc.maps.Planet(planetID)
	if !ok || planet == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("planet %s not found", planetID)
		return res, nil
	}
	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	systemRuntime := gc.spaceRuntime.EnsureSystemWarfare(planet.SystemID)
	operationID := ""
	if raw, ok := cmd.Payload["operation_id"]; ok {
		if operationID, err = payloadValueString(raw); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.operation_id must be a string"
			return res, nil
		}
	}
	if operationID == "" {
		operationID = gc.spaceRuntime.NextEntityID("landing")
	}
	if systemRuntime.LandingOperations[operationID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("landing operation %s already exists", operationID)
		return res, nil
	}

	transportCapacity := estimateTaskForceTransportCapacity(player, taskForce, gc.worlds, gc.spaceRuntime)
	if transportCapacity <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("task force %s lacks transport capacity for landing", taskForceID)
		return res, nil
	}
	supply := currentTaskForceSupply(player, taskForce, gc.worlds, gc.spaceRuntime)
	operation := &model.LandingOperationState{
		ID:                operationID,
		OwnerID:           playerID,
		TaskForceID:       taskForceID,
		SystemID:          planet.SystemID,
		PlanetID:          planetID,
		Stage:             model.LandingOperationStageReconnaissance,
		Result:            model.LandingOperationResultPending,
		TransportCapacity: transportCapacity,
		InitialSupply:     supply.Current,
		StartedTick:       ws.Tick,
		UpdatedTick:       ws.Tick,
	}
	systemRuntime.LandingOperations[operationID] = operation

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("landing operation %s started for %s", operationID, planetID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtLandingStarted,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"operation_id":  operationID,
			"planet_id":     planetID,
			"task_force_id": taskForceID,
		},
	}}
}

func settleOrbitalWarfare(worlds map[string]*model.WorldState, _ *mapmodel.Universe, spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.GameEvent {
	if spaceRuntime == nil {
		return nil
	}

	var events []*model.GameEvent
	for _, systemID := range orbitalWarfareSystemIDs(spaceRuntime) {
		systemRuntime := spaceRuntime.EnsureSystemWarfare(systemID)
		if systemRuntime == nil {
			continue
		}
		nextSuperiority := evaluateOrbitalSuperiority(worlds, spaceRuntime, systemID, currentTick)
		if orbitalSuperiorityChanged(systemRuntime.OrbitalSuperiority, nextSuperiority) {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtOrbitalSuperiorityChanged,
				VisibilityScope: "all",
				Payload: map[string]any{
					"system_id":           systemID,
					"advantage_player_id": nextSuperiority.AdvantagePlayerID,
					"contest_intensity":   nextSuperiority.ContestIntensity,
					"reason":              nextSuperiority.LastReason,
				},
			})
		}
		systemRuntime.OrbitalSuperiority = nextSuperiority

		for planetID, blockade := range systemRuntime.PlanetBlockades {
			if blockade == nil {
				continue
			}
			updatePlanetBlockade(worlds, spaceRuntime, blockade, systemID, planetID, nextSuperiority, currentTick)
		}
		for _, operationID := range landingOperationIDs(systemRuntime) {
			operation := systemRuntime.LandingOperations[operationID]
			if operation == nil || operation.Result != model.LandingOperationResultPending {
				continue
			}
			if evt := advanceLandingOperation(worlds, spaceRuntime, operation, nextSuperiority, currentTick); evt != nil {
				events = append(events, evt)
			}
		}
	}
	return events
}

func requireOwnedTaskForce(ws *model.WorldState, playerID, taskForceID string) (*model.PlayerState, *model.WarTaskForce, *model.CommandResult) {
	res := &model.CommandResult{Status: model.StatusFailed}
	if ws == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = "world runtime unavailable"
		return nil, nil, res
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return nil, nil, res
	}
	taskForce := player.WarCoordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("task force %s not found", taskForceID)
		return nil, nil, res
	}
	return player, taskForce, nil
}

func orbitalWarfareSystemIDs(spaceRuntime *model.SpaceRuntimeState) []string {
	ids := make(map[string]struct{})
	for systemID := range spaceRuntime.Systems {
		ids[systemID] = struct{}{}
	}
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for systemID := range playerRuntime.Systems {
			ids[systemID] = struct{}{}
		}
	}
	out := make([]string, 0, len(ids))
	for systemID := range ids {
		out = append(out, systemID)
	}
	sort.Strings(out)
	return out
}

func taskForceFleetMembers(playerID string, taskForce *model.WarTaskForce, spaceRuntime *model.SpaceRuntimeState) []*model.SpaceFleet {
	if taskForce == nil || spaceRuntime == nil {
		return nil
	}
	out := make([]*model.SpaceFleet, 0, len(taskForce.Members))
	for _, member := range taskForce.Members {
		if member.Kind != model.WarTaskForceMemberKindFleet {
			continue
		}
		_, fleet := findOwnedFleet(spaceRuntime, playerID, member.EntityID)
		if fleet != nil {
			out = append(out, fleet)
		}
	}
	return out
}

func currentTaskForceSupply(
	player *model.PlayerState,
	taskForce *model.WarTaskForce,
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
) model.WarSupplyStatusView {
	members := model.ResolveWarTaskForceMembers(player, taskForce, worlds, spaceRuntime)
	return model.SummarizeWarTaskForceSupply(members)
}

func estimateTaskForceTransportCapacity(
	player *model.PlayerState,
	taskForce *model.WarTaskForce,
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
) int {
	members := model.ResolveWarTaskForceMembers(player, taskForce, worlds, spaceRuntime)
	total := 0
	for _, member := range members {
		if member.Count <= 0 {
			continue
		}
		switch model.WarTaskForceMemberKind(member.Kind) {
		case model.WarTaskForceMemberKindFleet:
			total += max(4, member.Count*4)
		case model.WarTaskForceMemberKindSquad:
			total += max(1, member.Count)
		}
	}
	return total
}

func evaluateOrbitalSuperiority(
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	systemID string,
	currentTick int64,
) *model.OrbitalSuperiorityState {
	state := &model.OrbitalSuperiorityState{
		SystemID:    systemID,
		LastReason:  "no_fleet_presence",
		UpdatedTick: currentTick,
	}
	if spaceRuntime == nil {
		return state
	}

	type scoredSide struct {
		playerID string
		score    float64
	}
	scores := make([]scoredSide, 0)
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		systemRuntime := playerRuntime.Systems[systemID]
		if systemRuntime == nil {
			continue
		}
		player := playerStateFromWorlds(worlds, playerRuntime.PlayerID)
		totalScore := 0.0
		for _, fleet := range systemRuntime.Fleets {
			if fleet == nil {
				continue
			}
			totalScore += fleetOrbitalScore(worlds, spaceRuntime, player, fleet)
		}
		if totalScore <= 0 {
			continue
		}
		scores = append(scores, scoredSide{
			playerID: playerRuntime.PlayerID,
			score:    roundOrbitalFloat(totalScore),
		})
	}
	if len(scores) == 0 {
		return state
	}
	sort.Slice(scores, func(i, j int) bool {
		if scores[i].score == scores[j].score {
			return scores[i].playerID < scores[j].playerID
		}
		return scores[i].score > scores[j].score
	})

	top := scores[0]
	secondScore := 0.0
	if len(scores) > 1 {
		secondScore = scores[1].score
	}
	if top.score > 0 {
		state.ContestIntensity = roundOrbitalFloat(math.Min(1, secondScore/math.Max(0.1, top.score)))
	}
	if top.score > 0 && (secondScore == 0 || top.score > secondScore*1.15) {
		state.AdvantagePlayerID = top.playerID
		state.LastReason = "fleet_presence_margin"
		return state
	}
	state.LastReason = "orbit_contested"
	return state
}

func fleetOrbitalScore(
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	player *model.PlayerState,
	fleet *model.SpaceFleet,
) float64 {
	if fleet == nil {
		return 0
	}
	unitCount := 0
	for _, stack := range fleet.Units {
		unitCount += max(0, stack.Count)
	}
	if unitCount == 0 {
		return 0
	}
	score := float64(unitCount*4 + 2)
	supplyFactor := 0.45 + sustainmentFillRatio(fleet.Sustainment)*0.75
	score *= supplyFactor
	taskForce := model.FindWarTaskForceByMember(player, model.WarTaskForceMemberKindFleet, fleet.ID)
	if taskForce != nil {
		status := model.EvaluateWarTaskForce(player, taskForce, worlds, spaceRuntime)
		score *= taskForceOrbitalBonus(taskForce.Stance)
		score *= 1 - math.Min(0.5, status.CoordinationPenalty*0.4)
		score *= 1 - math.Min(0.35, status.DelayPenalty*0.3)
	}
	if fleet.State == model.FleetStateAttacking {
		score *= 1.05
	}
	return roundOrbitalFloat(math.Max(0.1, score))
}

func taskForceOrbitalBonus(stance model.WarTaskForceStance) float64 {
	switch stance {
	case model.WarTaskForceStanceIntercept:
		return 1.25
	case model.WarTaskForceStanceEscort:
		return 1.15
	case model.WarTaskForceStanceSiege:
		return 1.2
	case model.WarTaskForceStanceBombard:
		return 1.1
	case model.WarTaskForceStanceHarass:
		return 1.05
	default:
		return 1
	}
}

func sustainmentFillRatio(state model.WarSustainmentState) float64 {
	currentTotal := state.Current.Ammo + state.Current.Missiles + state.Current.Fuel + state.Current.SpareParts + state.Current.ShieldCells + state.Current.RepairDrones
	capacityTotal := state.Capacity.Ammo + state.Capacity.Missiles + state.Capacity.Fuel + state.Capacity.SpareParts + state.Capacity.ShieldCells + state.Capacity.RepairDrones
	if capacityTotal <= 0 {
		return 1
	}
	return math.Min(1, float64(currentTotal)/float64(capacityTotal))
}

func orbitalSuperiorityChanged(current, next *model.OrbitalSuperiorityState) bool {
	if current == nil && next == nil {
		return false
	}
	if current == nil || next == nil {
		return true
	}
	return current.AdvantagePlayerID != next.AdvantagePlayerID ||
		current.LastReason != next.LastReason ||
		math.Abs(current.ContestIntensity-next.ContestIntensity) > 0.01
}

func updatePlanetBlockade(
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	blockade *model.PlanetBlockadeState,
	systemID, planetID string,
	superiority *model.OrbitalSuperiorityState,
	currentTick int64,
) {
	if blockade == nil {
		return
	}
	blockade.SystemID = systemID
	blockade.PlanetID = planetID
	blockade.UpdatedTick = currentTick

	player := playerStateFromWorlds(worlds, blockade.OwnerID)
	taskForce := (*model.WarTaskForce)(nil)
	if player != nil && player.WarCoordination != nil {
		taskForce = player.WarCoordination.TaskForces[blockade.TaskForceID]
	}
	if taskForce == nil || len(taskForceFleetMembers(blockade.OwnerID, taskForce, spaceRuntime)) == 0 {
		blockade.Status = model.PlanetBlockadeStatusBroken
		blockade.Intensity = 0
		blockade.LastReason = "task_force_unavailable"
		return
	}
	switch {
	case superiority != nil && superiority.AdvantagePlayerID == blockade.OwnerID:
		blockade.Status = model.PlanetBlockadeStatusActive
		blockade.Intensity = roundOrbitalFloat(math.Max(0.25, 1-superiority.ContestIntensity))
		blockade.LastReason = "orbital_superiority_held"
	case superiority != nil && superiority.AdvantagePlayerID == "":
		blockade.Status = model.PlanetBlockadeStatusContested
		blockade.Intensity = roundOrbitalFloat(math.Max(0.1, superiority.ContestIntensity))
		blockade.LastReason = "orbit_contested"
	default:
		blockade.Status = model.PlanetBlockadeStatusBroken
		blockade.Intensity = 0
		blockade.LastReason = "lost_orbital_superiority"
	}
}

func advanceLandingOperation(
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	operation *model.LandingOperationState,
	superiority *model.OrbitalSuperiorityState,
	currentTick int64,
) *model.GameEvent {
	player := playerStateFromWorlds(worlds, operation.OwnerID)
	taskForce := (*model.WarTaskForce)(nil)
	if player != nil && player.WarCoordination != nil {
		taskForce = player.WarCoordination.TaskForces[operation.TaskForceID]
	}
	if taskForce == nil || len(taskForceFleetMembers(operation.OwnerID, taskForce, spaceRuntime)) == 0 {
		return failLandingOperation(operation, "task_force_unavailable", currentTick)
	}

	blockade := activeEnemyPlanetBlockade(spaceRuntime, operation.SystemID, operation.PlanetID, operation.OwnerID)
	switch operation.Stage {
	case model.LandingOperationStageReconnaissance:
		if superiority == nil || superiority.AdvantagePlayerID != operation.OwnerID {
			if blockade != nil {
				blockade.InterdictedLandings++
				blockade.UpdatedTick = currentTick
			}
			return failLandingOperation(operation, "insufficient_orbital_superiority", currentTick)
		}
		supply := currentTaskForceSupply(player, taskForce, worlds, spaceRuntime)
		operation.InitialSupply = supply.Current
		if !landingSupplyAdequate(operation.InitialSupply) {
			return failLandingOperation(operation, "insufficient_initial_supply", currentTick)
		}
		targetWorld := worlds[operation.PlanetID]
		operation.LandingZoneSafety = landingZoneSafety(targetWorld, superiority, blockade, operation.OwnerID)
		operation.Stage = model.LandingOperationStageLandingWindowOpen
		operation.UpdatedTick = currentTick
	case model.LandingOperationStageLandingWindowOpen:
		if operation.LandingZoneSafety < 0.35 {
			return failLandingOperation(operation, "landing_zone_unsafe", currentTick)
		}
		operation.Stage = model.LandingOperationStageVanguardLanding
		operation.UpdatedTick = currentTick
	case model.LandingOperationStageVanguardLanding:
		targetWorld := worlds[operation.PlanetID]
		bridgeheadID := ensureLandingBridgehead(targetWorld, operation, currentTick)
		operation.BridgeheadID = bridgeheadID
		operation.Stage = model.LandingOperationStageBeachheadEstablished
		operation.Result = model.LandingOperationResultSuccess
		operation.CompletedTick = currentTick
		operation.UpdatedTick = currentTick
	}
	return nil
}

func failLandingOperation(operation *model.LandingOperationState, reason string, currentTick int64) *model.GameEvent {
	if operation == nil {
		return nil
	}
	operation.Stage = model.LandingOperationStageFailed
	operation.Result = model.LandingOperationResultFailed
	operation.BlockedReason = reason
	operation.CompletedTick = currentTick
	operation.UpdatedTick = currentTick
	return &model.GameEvent{
		EventType:       model.EvtLandingFailed,
		VisibilityScope: operation.OwnerID,
		Payload: map[string]any{
			"operation_id":   operation.ID,
			"planet_id":      operation.PlanetID,
			"blocked_reason": reason,
		},
	}
}

func landingZoneSafety(
	targetWorld *model.WorldState,
	superiority *model.OrbitalSuperiorityState,
	blockade *model.PlanetBlockadeState,
	ownerID string,
) float64 {
	safety := 0.6
	if superiority != nil && superiority.AdvantagePlayerID == ownerID {
		safety += 0.2
	}
	if blockade != nil && blockade.OwnerID != ownerID {
		safety -= 0.25
	}
	if targetWorld != nil && targetWorld.EnemyForces != nil {
		totalThreat := 0
		for _, force := range targetWorld.EnemyForces.Forces {
			totalThreat += max(0, force.Strength)
		}
		safety -= math.Min(0.45, float64(totalThreat)/600)
	}
	return roundOrbitalFloat(math.Max(0.05, math.Min(1, safety)))
}

func landingSupplyAdequate(stock model.WarSupplyStock) bool {
	return stock.Ammo > 0 && stock.Fuel > 0 && stock.SpareParts > 0
}

func ensureLandingBridgehead(targetWorld *model.WorldState, operation *model.LandingOperationState, currentTick int64) string {
	if targetWorld == nil {
		return ""
	}
	if targetWorld.CombatRuntime == nil {
		targetWorld.CombatRuntime = model.NewCombatRuntimeState()
	}
	if targetWorld.CombatRuntime.Bridgeheads == nil {
		targetWorld.CombatRuntime.Bridgeheads = make(map[string]*model.LandingBridgehead)
	}
	if operation.BridgeheadID != "" {
		if bridgehead := targetWorld.CombatRuntime.Bridgeheads[operation.BridgeheadID]; bridgehead != nil {
			bridgehead.Status = model.LandingBridgeheadStatusActive
			bridgehead.LastSupportTick = currentTick
			if bridgehead.ExpansionLevel <= 0 {
				bridgehead.ExpansionLevel = 0.35
			}
			if bridgehead.FortificationLevel <= 0 {
				bridgehead.FortificationLevel = 0.25
			}
			return bridgehead.ID
		}
	}
	bridgeheadID := targetWorld.CombatRuntime.NextEntityID("bridgehead")
	targetWorld.CombatRuntime.Bridgeheads[bridgeheadID] = &model.LandingBridgehead{
		ID:                 bridgeheadID,
		OperationID:        operation.ID,
		OwnerID:            operation.OwnerID,
		PlanetID:           operation.PlanetID,
		Status:             model.LandingBridgeheadStatusActive,
		ExpansionLevel:     0.35,
		FortificationLevel: 0.25,
		EstablishedTick:    currentTick,
		LastSupportTick:    currentTick,
		TransportCapacity:  operation.TransportCapacity,
	}
	return bridgeheadID
}

func landingOperationIDs(systemRuntime *model.SystemWarfareRuntime) []string {
	if systemRuntime == nil {
		return nil
	}
	ids := make([]string, 0, len(systemRuntime.LandingOperations))
	for operationID := range systemRuntime.LandingOperations {
		ids = append(ids, operationID)
	}
	sort.Strings(ids)
	return ids
}

func activeEnemyPlanetBlockade(spaceRuntime *model.SpaceRuntimeState, systemID, planetID, ownerID string) *model.PlanetBlockadeState {
	if spaceRuntime == nil {
		return nil
	}
	systemRuntime := spaceRuntime.SystemWarfare(systemID)
	if systemRuntime == nil || systemRuntime.PlanetBlockades == nil {
		return nil
	}
	blockade := systemRuntime.PlanetBlockades[planetID]
	if blockade == nil || blockade.OwnerID == ownerID || blockade.Status != model.PlanetBlockadeStatusActive {
		return nil
	}
	return blockade
}

func recordPlanetBlockadeInterdiction(
	spaceRuntime *model.SpaceRuntimeState,
	systemID, planetID, ownerID string,
	supply, transports int,
	reason string,
	currentTick int64,
) {
	blockade := activeEnemyPlanetBlockade(spaceRuntime, systemID, planetID, ownerID)
	if blockade == nil {
		return
	}
	blockade.InterdictedSupply += max(0, supply)
	blockade.InterdictedTransports += max(0, transports)
	blockade.LastReason = reason
	blockade.UpdatedTick = currentTick
}

func roundOrbitalFloat(value float64) float64 {
	return math.Round(value*100) / 100
}
