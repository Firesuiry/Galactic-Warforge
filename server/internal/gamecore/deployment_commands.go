package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

type commissionFleetPayload struct {
	buildingRef
	BlueprintID string `json:"blueprint_id" payload:"required"`
	Count       int    `json:"count" payload:"required"`
	SystemID    string `json:"system_id" payload:"required"`
	FleetID     string `json:"fleet_id"`
}

type fleetAssignPayload struct {
	FleetID   string `json:"fleet_id" payload:"required"`
	Formation string `json:"formation" payload:"required"`
}

type fleetAttackPayload struct {
	FleetID  string `json:"fleet_id" payload:"required"`
	PlanetID string `json:"planet_id" payload:"required"`
	TargetID string `json:"target_id" payload:"required"`
}

type fleetMovePayload struct {
	FleetID        string `json:"fleet_id" payload:"required"`
	TargetSystemID string `json:"target_system_id" payload:"required"`
}

type fleetDisbandPayload struct {
	FleetID string `json:"fleet_id" payload:"required"`
}

func (gc *GameCore) execCommissionFleet(ws *model.WorldState, playerID string, cmd model.Command, p commissionFleetPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID := p.BuildingID
	blueprintID := p.BlueprintID
	count := p.Count
	systemID := p.SystemID
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
	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	systemRuntime := gc.spaceRuntime.EnsurePlayerSystem(playerID, systemID)
	fleetID := p.FleetID
	if fleetID == "" {
		fleetID = gc.spaceRuntime.NextEntityID("fleet")
	}
	if existing := systemRuntime.Fleets[fleetID]; existing != nil && existing.Transit != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is in transit and cannot take reinforcements", fleetID)
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

func (gc *GameCore) execFleetAssign(_ *model.WorldState, playerID string, cmd model.Command, p fleetAssignPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID := p.FleetID
	formationRaw := p.Formation
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
	if fleet.Transit != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is in transit and cannot be assigned", fleetID)
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

func (gc *GameCore) execFleetAttack(_ *model.WorldState, playerID string, cmd model.Command, p fleetAttackPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID := p.FleetID
	planetID := p.PlanetID
	targetID := p.TargetID
	systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
	if fleet == nil || systemRuntime == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("fleet %s not found", fleetID)
		return res, nil
	}
	if fleet.Transit != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is in transit and cannot attack", fleetID)
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

func (gc *GameCore) execFleetMove(_ *model.WorldState, playerID string, cmd model.Command, p fleetMovePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID := p.FleetID
	targetSystemID := p.TargetSystemID
	_, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
	if fleet == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("fleet %s not found", fleetID)
		return res, nil
	}
	if fleet.State != model.FleetStateIdle {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is %s and cannot move", fleetID, fleet.State)
		return res, nil
	}
	if fleet.Transit != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is already in transit to %s", fleetID, fleet.Transit.TargetSystemID)
		return res, nil
	}
	if targetSystemID == fleet.SystemID {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is already in %s", fleetID, targetSystemID)
		return res, nil
	}
	if _, ok := gc.maps.System(targetSystemID); !ok {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("system %s not found", targetSystemID)
		return res, nil
	}
	if !gc.maps.SystemsLinkedByLane(fleet.SystemID, targetSystemID, fleetLaneNeighborCount) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("no direct lane between %s and %s", fleet.SystemID, targetSystemID)
		return res, nil
	}

	fleet.Transit = &model.FleetTransitState{
		FromSystemID:   fleet.SystemID,
		TargetSystemID: targetSystemID,
		TotalTicks:     FleetTransitTicks,
		RemainingTicks: FleetTransitTicks,
	}
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("fleet %s jumping from %s to %s (%d ticks)", fleetID, fleet.SystemID, targetSystemID, FleetTransitTicks)
	return res, []*model.GameEvent{{
		EventType:       model.EvtFleetMoveStarted,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"fleet_id":       fleetID,
			"from_system_id": fleet.SystemID,
			"to_system_id":   targetSystemID,
			"total_ticks":    FleetTransitTicks,
		},
	}}
}

func (gc *GameCore) execFleetDisband(_ *model.WorldState, playerID string, cmd model.Command, p fleetDisbandPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	fleetID := p.FleetID
	systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, fleetID)
	if fleet == nil || systemRuntime == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("fleet %s not found", fleetID)
		return res, nil
	}
	if fleet.Transit != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("fleet %s is in transit and cannot be disbanded", fleetID)
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

// fleetStackAggregate is the blueprint-derived combat baseline for one fleet's stacks.
// Tech settlement multiplies this baseline; it must stay identical to deploy-time stats.
type fleetStackAggregate struct {
	hasProfile     bool
	totalDamage    int
	totalShield    float64
	maxShield      float64
	totalArmor     int
	totalStructure int
	weapons        model.SpaceWeaponMix
	supply         model.WarSupplyStock
}

func aggregateFleetStacks(ws *model.WorldState, playerID string, stacks []model.FleetUnitStack) fleetStackAggregate {
	var agg fleetStackAggregate
	var player *model.PlayerState
	if ws != nil {
		player = ws.Players[playerID]
	}
	for _, stack := range stacks {
		profile, ok := resolveWarBlueprintRuntimeProfile(ws, playerID, stack.BlueprintID)
		if !ok || profile.FleetUnit == nil {
			continue
		}
		agg.hasProfile = true
		agg.totalDamage += profile.FleetUnit.Weapon.Damage * stack.Count
		agg.totalShield += profile.FleetUnit.Shield.Level * float64(stack.Count)
		agg.maxShield += profile.FleetUnit.Shield.MaxLevel * float64(stack.Count)
		blueprint, ok := model.ResolveWarBlueprintForPlayer(player, stack.BlueprintID)
		if !ok {
			continue
		}
		combatProfile := model.ResolveWarBlueprintSpaceCombatProfile(blueprint)
		agg.totalArmor += combatProfile.Armor * stack.Count
		agg.totalStructure += combatProfile.Structure * stack.Count
		agg.weapons.DirectFire += combatProfile.Weapons.DirectFire * stack.Count
		agg.weapons.Missile += combatProfile.Weapons.Missile * stack.Count
		agg.weapons.PointDefense += combatProfile.Weapons.PointDefense * stack.Count
		agg.weapons.ElectronicWarfare += combatProfile.Weapons.ElectronicWarfare * stack.Count
		capacity := model.InitWarSustainmentState(blueprint, profile, stack.Count).Capacity
		agg.supply.Ammo += capacity.Ammo
		agg.supply.Shells += capacity.Shells
		agg.supply.Missiles += capacity.Missiles
	}
	return agg
}

func finalizedFleetCombat(agg fleetStackAggregate) (damage int, weaponType model.WeaponType, weapons model.SpaceWeaponMix, armor, structure int) {
	armor = agg.totalArmor
	structure = agg.totalStructure
	weapons = agg.weapons
	damage = agg.totalDamage
	if armor <= 0 && structure > 0 {
		armor = warMaxInt(1, structure/4)
	}
	if structure <= 0 {
		structure = warMaxInt(60, damage)
	}
	if weapons.DirectFire > 0 {
		damage = weapons.DirectFire
	} else if weapons.Missile > 0 {
		damage = weapons.Missile
	}
	weaponType = model.WeaponTypeLaser
	if weapons.DirectFire <= 0 && weapons.Missile > 0 {
		weaponType = model.WeaponTypeMissile
	}
	return damage, weaponType, weapons, armor, structure
}

func rebuildFleetStats(ws *model.WorldState, playerID string, fleet *model.SpaceFleet) {
	if fleet == nil {
		return
	}
	agg := aggregateFleetStacks(ws, playerID, fleet.Units)
	totalDamage, weaponType, weapons, totalArmor, totalStructure := finalizedFleetCombat(agg)
	oldCapacity := fleet.Sustainment.Capacity
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
		Level:         agg.totalShield,
		MaxLevel:      agg.maxShield,
		RechargeRate:  2,
		RechargeDelay: 10,
	}
	fleet.Armor = scaleDurabilityLayer(fleet.Armor, totalArmor)
	fleet.Structure = scaleDurabilityLayer(fleet.Structure, totalStructure)
	if fleet.Subsystems.Engine.State == "" {
		fleet.Subsystems = model.DefaultSpaceFleetSubsystemState()
	}
	fleet.Sustainment.Capacity = agg.supply
	fleet.Sustainment.Current = model.RefillForAddedCapacity(fleet.Sustainment.Current, oldCapacity, agg.supply)
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
