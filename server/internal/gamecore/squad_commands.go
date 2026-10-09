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

const defaultSquadName = "军团"

// squadName validates an optional squad name (1–40 characters, trimmed); nil
// falls back to the given default.
func squadName(raw *string, fallback string) (string, bool) {
	if raw == nil {
		return fallback, true
	}
	value := strings.TrimSpace(*raw)
	if value == "" || len([]rune(*raw)) > 40 {
		return "", false
	}
	return value, true
}

func (gc *GameCore) formSquad(ws *model.WorldState, playerID string, ids []string, rawName *string, idsField string) (model.CommandResult, []*model.GameEvent) {
	if len(ids) == 0 || len(ids) > 300 {
		return mechaJobFailed(model.CodeValidationFailed, idsField+" 必须包含 1–300 个存活单位")
	}
	ids = append([]string(nil), ids...)
	name, ok := squadName(rawName, defaultSquadName)
	if !ok {
		return mechaJobFailed(model.CodeValidationFailed, "name 必须为 1–40 个字符")
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			return mechaJobFailed(model.CodeValidationFailed, "member_id 重复")
		}
		seen[id] = true
		u := ws.Units[id]
		if u == nil || u.HP <= 0 {
			return mechaJobFailed(model.CodeEntityNotFound, "成员不在本星球或已阵亡")
		}
		if u.OwnerID != playerID {
			return mechaJobFailed(model.CodeNotOwner, "成员属于其他玩家")
		}
		if u.Mecha != nil || u.Type == model.UnitTypeExecutor || u.Type == model.UnitTypeWorker {
			return mechaJobFailed(model.CodeInvalidTarget, "只有军事单位可以编入小队")
		}
		if u.SquadID != "" {
			return mechaJobFailed(model.CodeInvalidTarget, "请先解散原小队再重新编组其成员")
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
		return mechaJobFailed(model.CodeValidationFailed, "未提供 member_ids 时需要 payload.building_id 和 payload.blueprint_id")
	case count < 1 || count > 300:
		return mechaJobFailed(model.CodeValidationFailed, "payload.count 必须为 1–300")
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
		return mechaJobFailed(model.CodeValidationFailed, fmt.Sprintf("蓝图 %s 不能从建筑 %s 部署", p.BlueprintID, building.ID))
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	profile, ok := resolveWarBlueprintRuntimeProfile(ws, playerID, p.BlueprintID)
	if !ok || profile.Squad == nil {
		return mechaJobFailed(model.CodeValidationFailed, fmt.Sprintf("蓝图 %s 没有小队运行时配置", p.BlueprintID))
	}
	fallbackName := defaultSquadName
	if bpName, ok := squadName(&blueprint.Name, ""); ok {
		fallbackName = bpName
	}
	name, ok := squadName(p.Name, fallbackName)
	if !ok {
		return mechaJobFailed(model.CodeValidationFailed, "name 必须为 1–40 个字符")
	}
	hubState := ensureWarDeploymentHubState(player.EnsureWarIndustry(), building.ID, deploymentHubCapacity(deployment))
	if hubState.ReadyPayloads[p.BlueprintID] < count {
		return mechaJobFailed(model.CodeInsufficientResource, fmt.Sprintf("部署枢纽库存缺少 %d 个 %s", count, p.BlueprintID))
	}
	target := ws
	if p.PlanetID != "" && p.PlanetID != ws.PlanetID {
		if target = gc.WorldForPlanet(p.PlanetID); target == nil {
			return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("星球 %s 运行时未加载", p.PlanetID))
		}
	}
	anchor := building.Position
	if target != ws {
		anchor = model.Position{X: target.MapWidth / 2, Y: target.MapHeight / 2}
	}
	tiles := freeDeployTiles(target, anchor, blueprint.Domain, count)
	if len(tiles) < count {
		return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("%[2]s 上没有空间部署 %[1]d 个单位", count, target.PlanetID))
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
	res, squadEvents := gc.formSquad(target, playerID, ids, &name, "member_ids")
	return res, append(events, squadEvents...)
}

// freeDeployTiles returns up to n distinct tiles nearest to anchor where a new
// unit of the given domain may stand. 与出厂/复活共用同一套占位判定
// （tileHasLiveUnit）：部署单位同样不与同层单位堆叠。
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
		if tileHasLiveUnit(ws, pos, air) {
			continue
		}
		out = append(out, model.Position{X: pos.X, Y: pos.Y})
	}
	return out
}

func ownedSquad(ws *model.WorldState, playerID, id string) (*model.CombatSquad, *model.CommandResult) {
	fail := func(code model.ResultCode, message string) (*model.CombatSquad, *model.CommandResult) {
		return nil, &model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	if ws.CombatRuntime == nil || ws.CombatRuntime.Squads[id] == nil {
		return fail(model.CodeEntityNotFound, "本星球上未找到该小队")
	}
	squad := ws.CombatRuntime.Squads[id]
	if squad.OwnerID != playerID {
		return fail(model.CodeNotOwner, "该小队属于其他玩家")
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
		return mechaJobFailed(model.CodeValidationFailed, "order 必须为 attack、defend、retreat 或 resupply")
	}
	var target model.Position
	if order == model.SquadOrderResupply {
		station := nearestSquadSupply(ws, squad)
		if station == nil {
			return mechaJobFailed(model.CodeInvalidTarget, "本星球没有可运行的补给站")
		}
		target = station.Position
	} else {
		if cmd.Target.Position == nil || !ws.InBounds(cmd.Target.Position.X, cmd.Target.Position.Y) {
			return mechaJobFailed(model.CodeInvalidTarget, "target.position 必须位于本星球")
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
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("军团「%s」已执行 %s 指令", squad.Name, order)}, []*model.GameEvent{squadEvent(squad, model.EvtEntityUpdated)}
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
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "小队已解散，单位保留原有指令"}, removeSquad(ws, squad)
}

func squadEvent(squad *model.CombatSquad, eventType model.EventType) *model.GameEvent {
	return &model.GameEvent{EventType: eventType, VisibilityScope: squad.OwnerID, Payload: map[string]any{"entity_id": squad.ID, "entity_kind": "combat_squad", "entity_type": "combat_squad", "squad_id": squad.ID, "squad": squad.Clone()}}
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
