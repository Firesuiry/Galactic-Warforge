package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func (gc *GameCore) execDeploySquad(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	count, err := payloadStrictInt(cmd.Payload, "count")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if count <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.count must be positive"
		return res, nil
	}

	building, deployment, result := requireOwnedDeploymentHub(ws, playerID, buildingID)
	if result != nil {
		return *result, nil
	}
	player := ws.Players[playerID]
	blueprint, ok := model.ResolveWarBlueprintDefinition(player, blueprintID)
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("blueprint %s not found", blueprintID)
		return res, nil
	}
	if blueprint.RuntimeClass != model.UnitRuntimeClassCombatSquad || blueprint.Domain == model.UnitDomainSpace {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s is not deployed via deploy_squad", blueprintID)
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot deploy %s", building.ID, blueprintID)
		return res, nil
	}
	if err := requireUnitTechUnlocked(ws, playerID, blueprint.VisibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	model.InitBuildingDeploymentState(building)
	if building.DeploymentState == nil || building.DeploymentState.PayloadInventory[blueprint.ID] < count {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d deployable payload(s) for %s", count, blueprint.ID)
		return res, nil
	}
	building.DeploymentState.PayloadInventory[blueprint.ID] -= count
	if building.DeploymentState.PayloadInventory[blueprint.ID] <= 0 {
		delete(building.DeploymentState.PayloadInventory, blueprint.ID)
	}

	targetPlanetID := ws.PlanetID
	if raw, ok := cmd.Payload["planet_id"]; ok {
		if targetPlanetID, err = payloadValueString(raw); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.planet_id must be a string"
			return res, nil
		}
	}
	targetWorld := gc.WorldForPlanet(targetPlanetID)
	if targetWorld == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("planet runtime %s not loaded", targetPlanetID)
		return res, nil
	}
	if targetWorld.CombatRuntime == nil {
		targetWorld.CombatRuntime = model.NewCombatRuntimeState()
	}

	squad := newCombatSquad(targetWorld.CombatRuntime.NextEntityID("squad"), playerID, targetPlanetID, building.ID, blueprint, count)
	targetWorld.CombatRuntime.Squads[squad.ID] = squad

	events := []*model.GameEvent{
		{
			EventType:       model.EvtSquadDeployed,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"squad_id": squad.ID,
				"squad":    squad,
			},
		},
		{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type": "combat_squad",
				"entity_id":   squad.ID,
				"squad":       squad,
			},
		},
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("squad %s deployed on %s", squad.ID, targetPlanetID)
	return res, events
}

func (gc *GameCore) execCommissionFleet(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	count, err := payloadStrictInt(cmd.Payload, "count")
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
	if count <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.count must be positive"
		return res, nil
	}
	if _, ok := gc.maps.System(systemID); !ok {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("system %s not found", systemID)
		return res, nil
	}

	building, deployment, result := requireOwnedDeploymentHub(ws, playerID, buildingID)
	if result != nil {
		return *result, nil
	}
	player := ws.Players[playerID]
	blueprint, ok := model.ResolveWarBlueprintDefinition(player, blueprintID)
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("blueprint %s not found", blueprintID)
		return res, nil
	}
	if blueprint.RuntimeClass != model.UnitRuntimeClassFleet || blueprint.Domain != model.UnitDomainSpace {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s is not commissioned via commission_fleet", blueprintID)
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot deploy %s", building.ID, blueprintID)
		return res, nil
	}
	if err := requireUnitTechUnlocked(ws, playerID, blueprint.VisibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	model.InitBuildingDeploymentState(building)
	if building.DeploymentState == nil || building.DeploymentState.PayloadInventory[blueprint.ID] < count {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d deployable payload(s) for %s", count, blueprint.ID)
		return res, nil
	}
	building.DeploymentState.PayloadInventory[blueprint.ID] -= count
	if building.DeploymentState.PayloadInventory[blueprint.ID] <= 0 {
		delete(building.DeploymentState.PayloadInventory, blueprint.ID)
	}

	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	systemRuntime := gc.spaceRuntime.EnsurePlayerSystem(playerID, systemID)
	fleetID := ""
	if raw, ok := cmd.Payload["fleet_id"]; ok {
		if fleetID, err = payloadValueString(raw); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.fleet_id must be a string"
			return res, nil
		}
	}
	if fleetID == "" {
		fleetID = gc.spaceRuntime.NextEntityID("fleet")
	}

	fleet := systemRuntime.Fleets[fleetID]
	if fleet == nil {
		fleet = &model.SpaceFleet{
			ID:               fleetID,
			OwnerID:          playerID,
			SystemID:         systemID,
			SourceBuildingID: building.ID,
			Formation:        model.FormationTypeLine,
			State:            model.FleetStateIdle,
		}
		systemRuntime.Fleets[fleetID] = fleet
	}
	addFleetUnits(fleet, blueprint, count)
	rebuildFleetStats(player, fleet)

	events := []*model.GameEvent{
		{
			EventType:       model.EvtFleetCommissioned,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"fleet_id": fleet.ID,
				"fleet":    fleet,
			},
		},
		{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type": "fleet",
				"entity_id":   fleet.ID,
				"fleet":       fleet,
			},
		},
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("fleet %s commissioned in %s", fleet.ID, systemID)
	return res, events
}

func (gc *GameCore) execFleetAssign(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID, err := payloadStrictString(cmd.Payload, "fleet_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	formationRaw, err := payloadStrictString(cmd.Payload, "formation")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	formation := model.FormationType(formationRaw)
	if !validFormationType(formation) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("invalid formation: %s", formationRaw)
		return res, nil
	}
	_, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
	if fleet == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("fleet %s not found", fleetID)
		return res, nil
	}
	fleet.Formation = formation
	fleet.State = model.FleetStateIdle
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("fleet %s assigned %s formation", fleetID, formation)
	return res, []*model.GameEvent{{
		EventType:       model.EvtFleetAssigned,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"fleet_id":  fleetID,
			"formation": string(formation),
		},
	}}
}

func (gc *GameCore) execFleetAttack(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID, err := payloadStrictString(cmd.Payload, "fleet_id")
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
	targetID, err := payloadStrictString(cmd.Payload, "target_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
	if fleet == nil || systemRuntime == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("fleet %s not found", fleetID)
		return res, nil
	}
	planet, ok := gc.maps.Planet(planetID)
	if !ok || planet == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("planet %s not found", planetID)
		return res, nil
	}
	if planet.SystemID != systemRuntime.SystemID {
		res.Code = model.CodeInvalidTarget
		res.Message = "fleet_attack currently supports targets in the same system"
		return res, nil
	}
	fleet.Target = &model.FleetTarget{PlanetID: planetID, TargetID: targetID}
	fleet.State = model.FleetStateAttacking
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("fleet %s attacking %s on %s", fleetID, targetID, planetID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtFleetAttackStarted,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"fleet_id":  fleetID,
			"planet_id": planetID,
			"target_id": targetID,
		},
	}}
}

func (gc *GameCore) execFleetDisband(_ *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID, err := payloadStrictString(cmd.Payload, "fleet_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
	if fleet == nil || systemRuntime == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("fleet %s not found", fleetID)
		return res, nil
	}
	delete(systemRuntime.Fleets, fleetID)
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("fleet %s disbanded", fleetID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtFleetDisbanded,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"fleet_id": fleetID,
		},
	}}
}

func requireOwnedDeploymentHub(ws *model.WorldState, playerID, buildingID string) (*model.Building, *model.DeploymentModule, *model.CommandResult) {
	res := &model.CommandResult{Status: model.StatusFailed}
	building := ws.Buildings[buildingID]
	if building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return nil, nil, res
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return nil, nil, res
	}
	if ok, reason := buildingOperationalForCommand(ws, building); !ok {
		res.Code = model.CodeInvalidTarget
		if reason == "" {
			reason = "not_operational"
		}
		res.Message = fmt.Sprintf("deployment hub is not operational: %s", reason)
		return nil, nil, res
	}
	if building.Runtime.Functions.Deployment == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = "target building is not a deployment hub"
		return nil, nil, res
	}
	if building.Storage == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "deployment hub has no storage"
		return nil, nil, res
	}
	model.InitBuildingDeploymentState(building)
	return building, building.Runtime.Functions.Deployment, nil
}

func requireUnitTechUnlocked(ws *model.WorldState, playerID, techID string) error {
	if techID == "" {
		return nil
	}
	player := ws.Players[playerID]
	if player == nil || player.Tech == nil || !player.Tech.HasTech(techID) {
		return fmt.Errorf("unit tech %s requires research to unlock", techID)
	}
	return nil
}

func newCombatSquad(id, playerID, planetID, buildingID string, blueprint model.WarBlueprintDefinition, count int) *model.CombatSquad {
	profile, err := model.WarBlueprintRuntimeProfileForDefinition(blueprint)
	if err != nil {
		profile = model.WarBlueprintRuntimeProfile{
			SquadBaseHP: 80,
			SquadWeapon: model.WeaponState{Type: model.WeaponTypeLaser, Damage: 20, FireRate: 10, Range: 8, AmmoCost: 0},
			SquadShield: model.ShieldState{Level: 20, MaxLevel: 20, RechargeRate: 1, RechargeDelay: 10},
		}
	}
	totalHP := profile.SquadBaseHP * count
	return &model.CombatSquad{
		ID:               id,
		OwnerID:          playerID,
		PlanetID:         planetID,
		SourceBuildingID: buildingID,
		BlueprintID:      blueprint.ID,
		UnitType:         blueprint.ID,
		Count:            count,
		HP:               totalHP,
		MaxHP:            totalHP,
		Shield:           profile.SquadShield,
		Weapon:           profile.SquadWeapon,
		State:            model.CombatSquadStateIdle,
	}
}

func addFleetUnits(fleet *model.SpaceFleet, blueprint model.WarBlueprintDefinition, count int) {
	if fleet == nil || count <= 0 {
		return
	}
	for i := range fleet.Units {
		if fleet.Units[i].BlueprintID == blueprint.ID || fleet.Units[i].UnitType == blueprint.ID {
			fleet.Units[i].Count += count
			fleet.Units[i].BlueprintID = blueprint.ID
			fleet.Units[i].UnitType = blueprint.ID
			return
		}
	}
	fleet.Units = append(fleet.Units, model.FleetUnitStack{BlueprintID: blueprint.ID, UnitType: blueprint.ID, Count: count})
}

func rebuildFleetStats(player *model.PlayerState, fleet *model.SpaceFleet) {
	if fleet == nil {
		return
	}
	totalDamage := 0
	totalShield := 0.0
	maxShield := 0.0
	fireRate := 10
	fireRange := 24.0
	weaponType := model.WeaponTypeLaser
	rechargeRate := 2.0
	rechargeDelay := 10
	for _, stack := range fleet.Units {
		blueprintID := stack.BlueprintID
		if blueprintID == "" {
			blueprintID = stack.UnitType
		}
		blueprint, ok := model.ResolveWarBlueprintDefinition(player, blueprintID)
		if !ok {
			continue
		}
		profile, err := model.WarBlueprintRuntimeProfileForDefinition(blueprint)
		if err != nil || profile.FleetWeaponDamage <= 0 {
			continue
		}
		totalDamage += profile.FleetWeaponDamage * stack.Count
		totalShield += profile.FleetShield * float64(stack.Count)
		maxShield += profile.FleetShield * float64(stack.Count)
		if profile.FleetWeaponType != "" {
			weaponType = profile.FleetWeaponType
		}
		if profile.FleetWeaponFireRate > 0 {
			fireRate = profile.FleetWeaponFireRate
		}
		if profile.FleetWeaponRange > 0 {
			fireRange = profile.FleetWeaponRange
		}
		if profile.FleetShieldRechargeRate > 0 {
			rechargeRate = profile.FleetShieldRechargeRate
		}
		if profile.FleetShieldRechargeDelay > 0 {
			rechargeDelay = profile.FleetShieldRechargeDelay
		}
	}
	fleet.Weapon = model.WeaponState{
		Type:         weaponType,
		Damage:       totalDamage,
		FireRate:     fireRate,
		Range:        fireRange,
		LastFireTick: fleet.LastAttackTick,
	}
	fleet.Shield = model.ShieldState{
		Level:         totalShield,
		MaxLevel:      maxShield,
		RechargeRate:  rechargeRate,
		RechargeDelay: rechargeDelay,
	}
}

func validFormationType(formation model.FormationType) bool {
	switch formation {
	case model.FormationTypeLine, model.FormationTypeVee, model.FormationTypeCircle, model.FormationTypeWedge:
		return true
	default:
		return false
	}
}

func findOwnedFleet(spaceRuntime *model.SpaceRuntimeState, playerID, fleetID string) (*model.PlayerSystemRuntime, *model.SpaceFleet) {
	if spaceRuntime == nil || fleetID == "" {
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
			if fleet := systemRuntime.Fleets[fleetID]; fleet != nil {
				return systemRuntime, fleet
			}
		}
	}
	return nil, nil
}

func payloadValueString(raw any) (string, error) {
	value := fmt.Sprintf("%v", raw)
	if value == "" {
		return "", fmt.Errorf("value must be a non-empty string")
	}
	return value, nil
}
