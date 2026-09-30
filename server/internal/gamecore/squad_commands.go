package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
	"strings"
)

// execDeploySquad keeps the legacy member_ids grouping path; blueprint payloads
// deploy through execDeployBlueprintSquad.
func (gc *GameCore) execDeploySquad(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	if _, grouped := cmd.Payload["member_ids"]; !grouped {
		return gc.execDeployBlueprintSquad(ws, playerID, cmd)
	}
	return gc.formSquad(ws, playerID, cmd, "member_ids")
}

// execFormSquad turns selected units into a squad (order container); formation
// never manufactures health or ammunition.
func (gc *GameCore) execFormSquad(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	return gc.formSquad(ws, playerID, cmd, "entity_ids")
}

func (gc *GameCore) formSquad(ws *model.WorldState, playerID string, cmd model.Command, idsField string) (model.CommandResult, []*model.GameEvent) {
	ids, err := payloadStringSlice(cmd.Payload, idsField)
	if err != nil || len(ids) == 0 || len(ids) > 300 {
		return mechaJobFailed(model.CodeValidationFailed, idsField+" must contain 1–300 living units")
	}
	name := "军团"
	if raw, ok := cmd.Payload["name"]; ok {
		value, ok := raw.(string)
		if !ok || len([]rune(strings.TrimSpace(value))) == 0 || len([]rune(value)) > 40 {
			return mechaJobFailed(model.CodeValidationFailed, "name must contain 1–40 characters")
		}
		name = strings.TrimSpace(value)
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			return mechaJobFailed(model.CodeValidationFailed, "duplicate member_id")
		}
		seen[id] = true
		u := ws.Units[id]
		if u == nil || u.HP <= 0 {
			return mechaJobFailed(model.CodeEntityNotFound, "member is not alive on this planet")
		}
		if u.OwnerID != playerID {
			return mechaJobFailed(model.CodeNotOwner, "member belongs to another player")
		}
		if u.Mecha != nil || u.Type == model.UnitTypeExecutor || u.Type == model.UnitTypeWorker {
			return mechaJobFailed(model.CodeInvalidTarget, "only military units may join a squad")
		}
		if u.SquadID != "" {
			return mechaJobFailed(model.CodeInvalidTarget, "dissolve the previous squad before regrouping its members")
		}
	}
	sort.Strings(ids)
	if ws.CombatRuntime == nil {
		ws.CombatRuntime = model.NewCombatRuntimeState()
	}
	squad := &model.CombatSquad{ID: ws.NextEntityID("squad"), OwnerID: playerID, PlanetID: ws.PlanetID, Name: name, MemberIDs: ids, State: model.CombatSquadStateIdle, Position: ws.Units[ids[0]].Position, Order: model.SquadOrderIdle}
	for _, id := range ids {
		ws.Units[id].SquadID = squad.ID
	}
	ws.CombatRuntime.Squads[squad.ID] = squad
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: squad.ID}, []*model.GameEvent{squadEvent(squad, model.EvtSquadDeployed)}
}

// execDeployBlueprintSquad materializes a produced war payload into the legacy
// squad runtime. It remains the deployment path for the blueprint production
// system; player controlled world units use execDeploySquad's member_ids path.
func (gc *GameCore) execDeployBlueprintSquad(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	count, err := payloadStrictInt(cmd.Payload, "count")
	if err != nil || count <= 0 {
		if err != nil {
			return mechaJobFailed(model.CodeValidationFailed, err.Error())
		}
		return mechaJobFailed(model.CodeValidationFailed, "payload.count must be positive")
	}
	building, deployment, result := requireOwnedDeploymentHub(ws, playerID, buildingID)
	if result != nil {
		return *result, nil
	}
	player := ws.Players[playerID]
	blueprint, visibleTechID, err := resolveIndustryBlueprint(player, blueprintID)
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	if warBlueprintDeployCommand(blueprint) != model.CmdDeploySquad || !deploymentAllowsBlueprint(deployment, blueprint) {
		return mechaJobFailed(model.CodeValidationFailed, fmt.Sprintf("blueprint %s is not deployable from building %s", blueprintID, building.ID))
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	hubState := ensureWarDeploymentHubState(player.EnsureWarIndustry(), building.ID, deploymentHubCapacity(deployment))
	if hubState.ReadyPayloads[blueprintID] < count {
		return mechaJobFailed(model.CodeInsufficientResource, fmt.Sprintf("need %d %s in deployment hub inventory", count, blueprintID))
	}
	hubState.ReadyPayloads[blueprintID] -= count
	if hubState.ReadyPayloads[blueprintID] <= 0 {
		delete(hubState.ReadyPayloads, blueprintID)
	}
	hubState.UpdatedTick = ws.Tick
	targetPlanetID := ws.PlanetID
	if raw, ok := cmd.Payload["planet_id"]; ok {
		targetPlanetID, err = payloadValueString(raw)
		if err != nil {
			return mechaJobFailed(model.CodeValidationFailed, "payload.planet_id must be a string")
		}
	}
	targetWorld := gc.WorldForPlanet(targetPlanetID)
	if targetWorld == nil {
		return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("planet runtime %s not loaded", targetPlanetID))
	}
	if targetWorld.CombatRuntime == nil {
		targetWorld.CombatRuntime = model.NewCombatRuntimeState()
	}
	squad := newCombatSquad(targetWorld, playerID, targetWorld.CombatRuntime.NextEntityID("squad"), targetPlanetID, building.ID, blueprintID, count)
	targetWorld.CombatRuntime.Squads[squad.ID] = squad
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("squad %s deployed on %s", squad.ID, targetPlanetID)}, []*model.GameEvent{{
		EventType: model.EvtSquadDeployed, VisibilityScope: playerID, Payload: map[string]any{"squad_id": squad.ID, "squad": squad},
	}, {
		EventType: model.EvtEntityCreated, VisibilityScope: playerID, Payload: map[string]any{"entity_type": "combat_squad", "entity_id": squad.ID, "squad": squad},
	}}
}

func newCombatSquad(ws *model.WorldState, playerID, id, planetID, buildingID, blueprintID string, count int) *model.CombatSquad {
	baseHP := 80
	weapon := model.WeaponState{Type: model.WeaponTypeLaser, Damage: 20, FireRate: 10, Range: 8}
	shield := model.ShieldState{Level: 20, MaxLevel: 20, RechargeRate: 1, RechargeDelay: 10}
	domain, baseFrameID, platformClass := model.UnitDomainGround, "", "mech"
	blueprint, hasBlueprint := model.ResolveWarBlueprintForPlayer(ws.Players[playerID], blueprintID)
	if profile, ok := resolveWarBlueprintRuntimeProfile(ws, playerID, blueprintID); ok && profile.Squad != nil {
		baseHP, weapon, shield = profile.Squad.HP, profile.Squad.Weapon, profile.Squad.Shield
		if hasBlueprint {
			domain, baseFrameID, platformClass = blueprint.Domain, blueprint.BaseFrameID, combatSquadPlatformClass(blueprint)
		}
	}
	position := model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	if building := ws.Buildings[buildingID]; building != nil {
		position = building.Position
		if free := findAdjacentFree(ws, building.Position); free != nil {
			position = *free
		}
	}
	return &model.CombatSquad{ID: id, OwnerID: playerID, PlanetID: planetID, SourceBuildingID: buildingID, BlueprintID: blueprintID, Domain: domain, BaseFrameID: baseFrameID, PlatformClass: platformClass, Count: count, MemberMaxHP: baseHP, HP: baseHP * count, MaxHP: baseHP * count, Shield: shield, Weapon: weapon, State: model.CombatSquadStateIdle, Position: position, MoveSpeed: 0.2}
}

func combatSquadPlatformClass(blueprint model.WarBlueprint) string {
	if blueprint.Domain == model.UnitDomainAir {
		return "drone"
	}
	for _, slot := range blueprint.Components {
		if component, ok := model.PublicWarBlueprintCatalogIndex().ComponentByID(slot.ComponentID); ok && (stringSliceContains(component.Tags, "vehicle") || stringSliceContains(component.Tags, "tracked") || stringSliceContains(component.Tags, "hover")) {
			return "vehicle"
		}
	}
	return "mech"
}

func ownedSquad(ws *model.WorldState, playerID string, cmd model.Command) (*model.CombatSquad, *model.CommandResult) {
	id, err := payloadStrictString(cmd.Payload, "squad_id")
	fail := func(code model.ResultCode, message string) (*model.CombatSquad, *model.CommandResult) {
		return nil, &model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	if err != nil {
		return fail(model.CodeValidationFailed, err.Error())
	}
	if ws.CombatRuntime == nil || ws.CombatRuntime.Squads[id] == nil {
		return fail(model.CodeEntityNotFound, "squad not found on this planet")
	}
	squad := ws.CombatRuntime.Squads[id]
	if squad.OwnerID != playerID {
		return fail(model.CodeNotOwner, "squad belongs to another player")
	}
	return squad, nil
}

func (gc *GameCore) execSquadOrder(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	squad, failure := ownedSquad(ws, playerID, cmd)
	if failure != nil {
		return *failure, nil
	}
	raw, err := payloadStrictString(cmd.Payload, "order")
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	order := model.SquadOrder(raw)
	switch order {
	case model.SquadOrderAttack, model.SquadOrderDefend, model.SquadOrderRetreat, model.SquadOrderResupply:
	default:
		return mechaJobFailed(model.CodeValidationFailed, "order must be attack, defend, retreat or resupply")
	}
	var target model.Position
	if order == model.SquadOrderResupply {
		station := nearestSquadSupply(ws, squad)
		if station == nil {
			return mechaJobFailed(model.CodeInvalidTarget, "no operational supply station on this planet")
		}
		target = station.Position
	} else {
		if cmd.Target.Position == nil || !ws.InBounds(cmd.Target.Position.X, cmd.Target.Position.Y) {
			return mechaJobFailed(model.CodeInvalidTarget, "target.position must be on this planet")
		}
		target = *cmd.Target.Position
	}
	plans, err := planSquadFormation(ws, squad, target, order)
	if err != nil {
		return mechaJobFailed(model.CodeOutOfRange, err.Error())
	}
	squad.Order, squad.Target, squad.LastOrderTick = order, &target, ws.Tick
	for _, plan := range plans {
		u := plan.unit
		u.ClearMovement()
		u.ClearEngagement()
		u.GuardTargetID = ""
		u.SquadOrderActive = true
		u.Path, u.PathIndex, u.OrderPos = plan.path, 1, &plan.destination
		u.Stance = model.UnitStanceAttackMove
		if order != model.SquadOrderAttack {
			u.Stance = model.UnitStanceRetreat
		}
	}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("%s: %s", squad.ID, order)}, []*model.GameEvent{squadEvent(squad, model.EvtEntityUpdated)}
}

func (gc *GameCore) execDissolveSquad(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	squad, failure := ownedSquad(ws, playerID, cmd)
	if failure != nil {
		return *failure, nil
	}
	for _, u := range squad.Members(ws) {
		u.SquadID = ""
		u.SquadOrderActive = false
	}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "squad dissolved; units retain their orders"}, removeSquad(ws, squad)
}

func squadEvent(squad *model.CombatSquad, eventType model.EventType) *model.GameEvent {
	return &model.GameEvent{EventType: eventType, VisibilityScope: squad.OwnerID, Payload: map[string]any{"entity_id": squad.ID, "entity_type": "combat_squad", "squad_id": squad.ID, "squad": squad.Clone()}}
}

func removeSquad(ws *model.WorldState, squad *model.CombatSquad) []*model.GameEvent {
	delete(ws.CombatRuntime.Squads, squad.ID)
	if p := ws.Players[squad.OwnerID]; p != nil && p.WarCoordination != nil {
		for _, tf := range p.WarCoordination.TaskForces {
			if tf == nil {
				continue
			}
			members := tf.Members[:0]
			for _, m := range tf.Members {
				if m.Kind != model.WarTaskForceMemberKindSquad || m.EntityID != squad.ID {
					members = append(members, m)
				}
			}
			tf.Members = members
		}
	}
	squad.State = model.CombatSquadStateDestroyed
	return []*model.GameEvent{squadEvent(squad, model.EvtEntityDestroyed)}
}
