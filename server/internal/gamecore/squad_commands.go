package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
	"strings"
)

// deploySquadPayload 有两种形态：带 member_ids 时把已有单位编成小队；
// 否则按 building_id + blueprint_id [+ count，缺省 1] 从部署枢纽投放蓝图单位并编队。
type deploySquadPayload struct {
	MemberIDs   []string `json:"member_ids"`
	Name        *string  `json:"name"`
	BuildingID  string   `json:"building_id"`
	BlueprintID string   `json:"blueprint_id"`
	Count       *int     `json:"count"`
	PlanetID    string   `json:"planet_id"`
}

func (p deploySquadPayload) entityRefs() entityRefs {
	refs := entityRefs{units: p.MemberIDs}
	if p.BuildingID != "" {
		refs.buildings = []string{p.BuildingID}
	}
	return refs
}

type formSquadPayload struct {
	EntityIDs []string `json:"entity_ids" payload:"required"`
	Name      *string  `json:"name"`
}

type squadOrderPayload struct {
	SquadID string `json:"squad_id" payload:"required"`
	Order   string `json:"order" payload:"required"`
}

type dissolveSquadPayload struct {
	SquadID string `json:"squad_id" payload:"required"`
}

// execDeploySquad groups member_ids into a squad, or materializes blueprint
// payloads from a deployment hub as world units and groups those.
func (gc *GameCore) execDeploySquad(ws *model.WorldState, playerID string, cmd model.Command, p deploySquadPayload) (model.CommandResult, []*model.GameEvent) {
	if p.MemberIDs != nil {
		return gc.formSquad(ws, playerID, p.MemberIDs, p.Name, "member_ids")
	}
	return gc.deployBlueprintSquad(ws, playerID, p)
}

// execFormSquad turns selected units into a squad (order container); formation
// never manufactures health or ammunition.
func (gc *GameCore) execFormSquad(ws *model.WorldState, playerID string, cmd model.Command, p formSquadPayload) (model.CommandResult, []*model.GameEvent) {
	return gc.formSquad(ws, playerID, p.EntityIDs, p.Name, "entity_ids")
}

func (gc *GameCore) formSquad(ws *model.WorldState, playerID string, ids []string, rawName *string, idsField string) (model.CommandResult, []*model.GameEvent) {
	if len(ids) == 0 || len(ids) > 300 {
		return mechaJobFailed(model.CodeValidationFailed, idsField+" must contain 1–300 living units")
	}
	ids = append([]string(nil), ids...)
	name := "军团"
	if rawName != nil {
		value := *rawName
		if len([]rune(strings.TrimSpace(value))) == 0 || len([]rune(value)) > 40 {
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

// deployBlueprintSquad consumes ready ground/air payloads from a deployment hub,
// spawns one world unit per payload next to the hub (or at the target planet's
// center when deploying to another planet) and forms them into a squad. Every
// check runs before payloads are consumed.
func (gc *GameCore) deployBlueprintSquad(ws *model.WorldState, playerID string, p deploySquadPayload) (model.CommandResult, []*model.GameEvent) {
	count := 1
	if p.Count != nil {
		count = *p.Count
	}
	switch {
	case p.BuildingID == "" || p.BlueprintID == "":
		return mechaJobFailed(model.CodeValidationFailed, "payload.building_id and payload.blueprint_id required without member_ids")
	case count < 1 || count > 300:
		return mechaJobFailed(model.CodeValidationFailed, "payload.count must be 1–300")
	}
	building, deployment, result := requireOwnedDeploymentHub(ws, playerID, p.BuildingID)
	if result != nil {
		return *result, nil
	}
	player := ws.Players[playerID]
	blueprint, visibleTechID, err := resolveIndustryBlueprint(player, p.BlueprintID)
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	if warBlueprintDeployCommand(blueprint) != model.CmdDeploySquad || !deploymentAllowsBlueprint(deployment, blueprint) {
		return mechaJobFailed(model.CodeValidationFailed, fmt.Sprintf("blueprint %s is not deployable from building %s", p.BlueprintID, building.ID))
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	profile, ok := resolveWarBlueprintRuntimeProfile(ws, playerID, p.BlueprintID)
	if !ok || profile.Squad == nil {
		return mechaJobFailed(model.CodeValidationFailed, fmt.Sprintf("blueprint %s has no squad runtime profile", p.BlueprintID))
	}
	hubState := ensureWarDeploymentHubState(player.EnsureWarIndustry(), building.ID, deploymentHubCapacity(deployment))
	if hubState.ReadyPayloads[p.BlueprintID] < count {
		return mechaJobFailed(model.CodeInsufficientResource, fmt.Sprintf("need %d %s in deployment hub inventory", count, p.BlueprintID))
	}
	target := ws
	if p.PlanetID != "" && p.PlanetID != ws.PlanetID {
		if target = gc.WorldForPlanet(p.PlanetID); target == nil {
			return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("planet runtime %s not loaded", p.PlanetID))
		}
	}
	anchor := building.Position
	if target != ws {
		anchor = model.Position{X: target.MapWidth / 2, Y: target.MapHeight / 2}
	}
	tiles := freeDeployTiles(target, anchor, blueprint.Domain, count)
	if len(tiles) < count {
		return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("no room to deploy %d units on %s", count, target.PlanetID))
	}

	hubState.ReadyPayloads[p.BlueprintID] -= count
	if hubState.ReadyPayloads[p.BlueprintID] <= 0 {
		delete(hubState.ReadyPayloads, p.BlueprintID)
	}
	hubState.UpdatedTick = ws.Tick
	ids := make([]string, 0, count)
	events := make([]*model.GameEvent, 0, count+1)
	for _, pos := range tiles {
		u := model.WarBlueprintUnit(blueprint, *profile.Squad)
		u.ID = target.NextEntityID("u")
		u.OwnerID = playerID
		u.Position = pos
		target.Units[u.ID] = &u
		key := model.TileKey(pos.X, pos.Y)
		target.TileUnits[key] = append(target.TileUnits[key], u.ID)
		ids = append(ids, u.ID)
		events = append(events, &model.GameEvent{EventType: model.EvtEntityCreated, VisibilityScope: playerID, Payload: map[string]any{"entity_type": "unit", "entity_id": u.ID, "unit": u.Clone(), "planet_id": target.PlanetID}})
	}
	name := p.Name
	if name == nil && blueprint.Name != "" && len([]rune(blueprint.Name)) <= 40 {
		name = &blueprint.Name
	}
	res, squadEvents := gc.formSquad(target, playerID, ids, name, "member_ids")
	return res, append(events, squadEvents...)
}

// freeDeployTiles returns up to n distinct tiles nearest to anchor where a new
// unit of the given domain may stand.
func freeDeployTiles(ws *model.WorldState, anchor model.Position, domain model.UnitDomain, n int) []model.Position {
	air := domain == model.UnitDomainAir
	out := make([]model.Position, 0, n)
	for _, pos := range ws.SurfaceDisc(anchor, 4+n) {
		if len(out) == n {
			break
		}
		tile := ws.Grid[pos.Y][pos.X]
		if !air && (tile.BuildingID != "" || !tile.Terrain.Buildable()) {
			continue
		}
		occupied := false
		for _, id := range ws.TileUnits[model.TileKey(pos.X, pos.Y)] {
			if other := ws.Units[id]; other != nil && other.HP > 0 && (other.Domain == model.UnitDomainAir) == air {
				occupied = true
				break
			}
		}
		if !occupied {
			out = append(out, model.Position{X: pos.X, Y: pos.Y})
		}
	}
	return out
}

func ownedSquad(ws *model.WorldState, playerID, id string) (*model.CombatSquad, *model.CommandResult) {
	fail := func(code model.ResultCode, message string) (*model.CombatSquad, *model.CommandResult) {
		return nil, &model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
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

func (gc *GameCore) execSquadOrder(ws *model.WorldState, playerID string, cmd model.Command, p squadOrderPayload) (model.CommandResult, []*model.GameEvent) {
	squad, failure := ownedSquad(ws, playerID, p.SquadID)
	if failure != nil {
		return *failure, nil
	}
	raw := p.Order
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

func (gc *GameCore) execDissolveSquad(ws *model.WorldState, playerID string, cmd model.Command, p dissolveSquadPayload) (model.CommandResult, []*model.GameEvent) {
	squad, failure := ownedSquad(ws, playerID, p.SquadID)
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
