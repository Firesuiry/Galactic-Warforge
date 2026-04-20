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
	blueprint, visibleTechID, err := resolveIndustryBlueprint(player, blueprintID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if warBlueprintDeployCommand(blueprint) != model.CmdDeploySquad || warBlueprintRuntimeClass(blueprint) != model.UnitRuntimeClassCombatSquad {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s is not deployed via deploy_squad", blueprintID)
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot deploy %s", building.ID, blueprintID)
		return res, nil
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	hub := player.EnsureWarIndustry()
	hubState := ensureWarDeploymentHubState(hub, building.ID, deploymentHubCapacity(deployment))
	if hubState.ReadyPayloads[blueprintID] < count {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d %s in deployment hub inventory", count, blueprintID)
		return res, nil
	}
	hubState.ReadyPayloads[blueprintID] -= count
	if hubState.ReadyPayloads[blueprintID] <= 0 {
		delete(hubState.ReadyPayloads, blueprintID)
	}
	hubState.UpdatedTick = ws.Tick

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

	squad := newCombatSquad(targetWorld, playerID, targetWorld.CombatRuntime.NextEntityID("squad"), targetPlanetID, building.ID, blueprintID, count)
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
	blueprint, visibleTechID, err := resolveIndustryBlueprint(player, blueprintID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if warBlueprintDeployCommand(blueprint) != model.CmdCommissionFleet || warBlueprintRuntimeClass(blueprint) != model.UnitRuntimeClassFleet {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s is not commissioned via commission_fleet", blueprintID)
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot deploy %s", building.ID, blueprintID)
		return res, nil
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	hub := player.EnsureWarIndustry()
	hubState := ensureWarDeploymentHubState(hub, building.ID, deploymentHubCapacity(deployment))
	if hubState.ReadyPayloads[blueprintID] < count {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d %s in deployment hub inventory", count, blueprintID)
		return res, nil
	}
	hubState.ReadyPayloads[blueprintID] -= count
	if hubState.ReadyPayloads[blueprintID] <= 0 {
		delete(hubState.ReadyPayloads, blueprintID)
	}
	hubState.UpdatedTick = ws.Tick

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
			AnchorPlanetID:   ws.PlanetID,
			SourceBuildingID: building.ID,
			Formation:        model.FormationTypeLine,
			State:            model.FleetStateIdle,
			Subsystems:       model.DefaultSpaceFleetSubsystemState(),
		}
		systemRuntime.Fleets[fleetID] = fleet
	}
	addFleetUnits(fleet, blueprintID, count)
	rebuildFleetStats(ws, playerID, fleet)

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
	return building, building.Runtime.Functions.Deployment, nil
}

func deploymentAllowsBlueprint(module *model.DeploymentModule, blueprint model.WarBlueprint) bool {
	if module == nil {
		return false
	}
	switch warBlueprintRuntimeClass(blueprint) {
	case model.UnitRuntimeClassCombatSquad:
		return module.SquadCapacity > 0
	case model.UnitRuntimeClassFleet:
		return module.FleetCapacity > 0
	default:
		return false
	}
}

func requireBlueprintTechUnlocked(ws *model.WorldState, playerID, techID string) error {
	if techID == "" {
		return nil
	}
	player := ws.Players[playerID]
	if player == nil || player.Tech == nil || !player.Tech.HasTech(techID) {
		return fmt.Errorf("blueprint tech %s requires research to unlock", techID)
	}
	return nil
}

func newCombatSquad(ws *model.WorldState, playerID, id, planetID, buildingID, blueprintID string, count int) *model.CombatSquad {
	baseHP := 80
	weapon := model.WeaponState{Type: model.WeaponTypeLaser, Damage: 20, FireRate: 10, Range: 8, AmmoCost: 0}
	shield := model.ShieldState{Level: 20, MaxLevel: 20, RechargeRate: 1, RechargeDelay: 10}
	sustainment := model.WarSustainmentState{}
	domain := model.UnitDomainGround
	baseFrameID := ""
	platformClass := "mech"
	blueprint, hasBlueprint := model.ResolveWarBlueprintForPlayer(ws.Players[playerID], blueprintID)
	if profile, ok := resolveWarBlueprintRuntimeProfile(ws, playerID, blueprintID); ok && profile.Squad != nil {
		baseHP = profile.Squad.HP
		weapon = profile.Squad.Weapon
		shield = profile.Squad.Shield
		if hasBlueprint {
			sustainment = model.InitWarSustainmentState(blueprint, profile, count)
			domain = blueprint.Domain
			baseFrameID = blueprint.BaseFrameID
			platformClass = combatSquadPlatformClass(blueprint)
		}
	}
	totalHP := baseHP * count
	return &model.CombatSquad{
		ID:               id,
		OwnerID:          playerID,
		PlanetID:         planetID,
		SourceBuildingID: buildingID,
		BlueprintID:      blueprintID,
		Domain:           domain,
		BaseFrameID:      baseFrameID,
		PlatformClass:    platformClass,
		Count:            count,
		HP:               totalHP,
		MaxHP:            totalHP,
		Shield:           shield,
		Weapon:           weapon,
		Sustainment:      sustainment,
		State:            model.CombatSquadStateIdle,
	}
}

func combatSquadPlatformClass(blueprint model.WarBlueprint) string {
	if blueprint.Domain == model.UnitDomainAir {
		return "drone"
	}
	for _, slot := range blueprint.Components {
		if component, ok := model.PublicWarBlueprintCatalogIndex().ComponentByID(slot.ComponentID); ok {
			if stringSliceContains(component.Tags, "vehicle") || stringSliceContains(component.Tags, "tracked") || stringSliceContains(component.Tags, "hover") {
				return "vehicle"
			}
		}
	}
	return "mech"
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func addFleetUnits(fleet *model.SpaceFleet, blueprintID string, count int) {
	if fleet == nil || count <= 0 {
		return
	}
	for i := range fleet.Units {
		if fleet.Units[i].BlueprintID == blueprintID {
			fleet.Units[i].Count += count
			return
		}
	}
	fleet.Units = append(fleet.Units, model.FleetUnitStack{BlueprintID: blueprintID, Count: count})
}

func rebuildFleetStats(ws *model.WorldState, playerID string, fleet *model.SpaceFleet) {
	if fleet == nil {
		return
	}
	totalDamage := 0
	totalShield := 0.0
	maxShield := 0.0
	totalArmor := 0
	totalStructure := 0
	weapons := model.SpaceWeaponMix{}
	oldCapacity := fleet.Sustainment.Capacity
	newCapacity := model.WarSupplyStock{}
	for _, stack := range fleet.Units {
		profile, ok := resolveWarBlueprintRuntimeProfile(ws, playerID, stack.BlueprintID)
		if !ok || profile.FleetUnit == nil {
			continue
		}
		totalDamage += profile.FleetUnit.Weapon.Damage * stack.Count
		totalShield += profile.FleetUnit.Shield.Level * float64(stack.Count)
		maxShield += profile.FleetUnit.Shield.MaxLevel * float64(stack.Count)
		if blueprint, ok := model.ResolveWarBlueprintForPlayer(ws.Players[playerID], stack.BlueprintID); ok {
			combatProfile := model.ResolveWarBlueprintSpaceCombatProfile(blueprint)
			totalArmor += combatProfile.Armor * stack.Count
			totalStructure += combatProfile.Structure * stack.Count
			weapons.DirectFire += combatProfile.Weapons.DirectFire * stack.Count
			weapons.Missile += combatProfile.Weapons.Missile * stack.Count
			weapons.PointDefense += combatProfile.Weapons.PointDefense * stack.Count
			weapons.ElectronicWarfare += combatProfile.Weapons.ElectronicWarfare * stack.Count
			capacity := model.InitWarSustainmentState(blueprint, profile, stack.Count).Capacity
			newCapacity.Ammo += capacity.Ammo
			newCapacity.Missiles += capacity.Missiles
			newCapacity.Fuel += capacity.Fuel
			newCapacity.SpareParts += capacity.SpareParts
			newCapacity.ShieldCells += capacity.ShieldCells
			newCapacity.RepairDrones += capacity.RepairDrones
		}
	}
	if totalArmor <= 0 && totalStructure > 0 {
		totalArmor = warMaxInt(1, totalStructure/4)
	}
	if totalStructure <= 0 {
		totalStructure = warMaxInt(60, totalDamage)
	}
	if weapons.DirectFire > 0 {
		totalDamage = weapons.DirectFire
	} else if weapons.Missile > 0 {
		totalDamage = weapons.Missile
	}
	weaponType := model.WeaponTypeLaser
	if weapons.DirectFire <= 0 && weapons.Missile > 0 {
		weaponType = model.WeaponTypeMissile
	}
	fleet.Weapon = model.WeaponState{
		Type:         weaponType,
		Damage:       totalDamage,
		FireRate:     10,
		Range:        24,
		LastFireTick: fleet.LastAttackTick,
		AmmoCost:     warMaxInt(0, 1),
	}
	fleet.Weapons = weapons
	fleet.Shield = model.ShieldState{
		Level:         totalShield,
		MaxLevel:      maxShield,
		RechargeRate:  2,
		RechargeDelay: 10,
	}
	fleet.Armor = scaleDurabilityLayer(fleet.Armor, totalArmor)
	fleet.Structure = scaleDurabilityLayer(fleet.Structure, totalStructure)
	if fleet.Subsystems.Engine.State == "" {
		fleet.Subsystems = model.DefaultSpaceFleetSubsystemState()
	}
	fleet.Sustainment.Capacity = newCapacity
	fleet.Sustainment.Current = model.RefillForAddedCapacity(fleet.Sustainment.Current, oldCapacity, newCapacity)
	fleet.Sustainment.Condition = model.WarSupplyConditionHealthy
	if fleet.Sustainment.Cohesion <= 0 {
		fleet.Sustainment.Cohesion = 1
	}
	fleet.Sustainment.Normalize()
}

func resolveWarBlueprintRuntimeProfile(ws *model.WorldState, playerID, blueprintID string) (model.WarBlueprintRuntimeProfile, bool) {
	if profile, ok := model.WarBlueprintRuntimeProfileByID(blueprintID); ok {
		return profile, true
	}
	if ws == nil {
		return model.WarBlueprintRuntimeProfile{}, false
	}
	player := ws.Players[playerID]
	if player == nil {
		return model.WarBlueprintRuntimeProfile{}, false
	}
	blueprint, ok := model.ResolveWarBlueprintForPlayer(player, blueprintID)
	if !ok {
		return model.WarBlueprintRuntimeProfile{}, false
	}
	return model.ResolveWarBlueprintRuntimeProfile(blueprint), true
}

func scaleDurabilityLayer(current model.DurabilityLayerState, maxLevel int) model.DurabilityLayerState {
	if maxLevel <= 0 {
		return model.DurabilityLayerState{}
	}
	if current.MaxLevel <= 0 {
		return model.DurabilityLayerState{Level: maxLevel, MaxLevel: maxLevel}
	}
	level := current.Level
	if current.MaxLevel > 0 {
		level = int(float64(current.Level) / float64(current.MaxLevel) * float64(maxLevel))
	}
	if level <= 0 {
		level = maxLevel
	}
	if level > maxLevel {
		level = maxLevel
	}
	return model.DurabilityLayerState{Level: level, MaxLevel: maxLevel}
}

func warBlueprintDeployCommand(blueprint model.WarBlueprint) model.CommandType {
	switch warBlueprintRuntimeClass(blueprint) {
	case model.UnitRuntimeClassCombatSquad:
		return model.CmdDeploySquad
	case model.UnitRuntimeClassFleet:
		return model.CmdCommissionFleet
	default:
		return ""
	}
}

func warBlueprintRuntimeClass(blueprint model.WarBlueprint) model.UnitRuntimeClass {
	switch blueprint.Domain {
	case model.UnitDomainGround, model.UnitDomainAir:
		return model.UnitRuntimeClassCombatSquad
	default:
		return model.UnitRuntimeClassFleet
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
