package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
)

type squadMemberPlan struct {
	unit        *model.Unit
	destination model.Position
	path        []model.Position
}

func squadRole(u *model.Unit) int {
	if u.Type == model.UnitTypeSupplyTruck || u.Type == model.UnitTypeRepairVehicle {
		return 100
	}
	return u.AttackRange
}

func planSquadFormation(ws *model.WorldState, squad *model.CombatSquad, target model.Position, order model.SquadOrder) ([]squadMemberPlan, error) {
	members := squad.Members(ws)
	if len(members) == 0 {
		return nil, fmt.Errorf("squad has no living members")
	}
	sort.Slice(members, func(i, j int) bool {
		if squadRole(members[i]) != squadRole(members[j]) {
			return squadRole(members[i]) < squadRole(members[j])
		}
		return members[i].ID < members[j].ID
	})
	radius := 3
	for radius*radius < len(members)*2 {
		radius++
	}
	candidates := ws.SurfaceDisc(target, radius+6)
	reserved := make(map[string]bool)
	plans := make([]squadMemberPlan, 0, len(members))
	for _, u := range members {
		desired := 0
		if order == model.SquadOrderAttack || order == model.SquadOrderDefend {
			desired = min(6, max(0, squadRole(u)-members[0].AttackRange))
		}
		type candidate struct {
			pos   model.Position
			score int
		}
		options := make([]candidate, 0, len(candidates))
		anchorDist := ws.SurfaceDistance(squad.Position, target)
		for _, p := range candidates {
			key := fmt.Sprintf("%s:%d:%d", u.Domain, p.X, p.Y)
			if reserved[key] || !tileWalkableForUnit(ws, p, u.ID) {
				continue
			}
			distance := ws.SurfaceDistance(p, target)
			delta := distance - desired
			if delta < 0 {
				delta = -delta
			}
			behind := ws.SurfaceDistance(p, squad.Position) - anchorDist
			if behind < 0 {
				behind = 0
			}
			options = append(options, candidate{p, delta*100 + behind*20 + ws.SurfaceDistance(u.Position, p)})
		}
		sort.SliceStable(options, func(i, j int) bool { return options[i].score < options[j].score })
		found := false
		for _, option := range options {
			path, ok := computeUnitPath(ws, u.Position, option.pos, u.ID)
			if !ok {
				continue
			}
			reserved[fmt.Sprintf("%s:%d:%d", u.Domain, option.pos.X, option.pos.Y)] = true
			plans = append(plans, squadMemberPlan{u, option.pos, path})
			found = true
			break
		}
		if !found {
			return nil, fmt.Errorf("unit %s has no reachable formation slot", u.ID)
		}
	}
	return plans, nil
}

func nearestSquadSupply(ws *model.WorldState, squad *model.CombatSquad) *model.Building {
	var best *model.Building
	bestDistance := maxInt32
	for _, b := range ws.Buildings {
		if b.HP <= 0 || b.OwnerID != squad.OwnerID {
			continue
		}
		def, ok := model.BuildingDefinitionByID(b.Type)
		if !ok || def.SupplyRadius <= 0 {
			continue
		}
		if ok, _ := buildingOperationalForCommand(ws, b); !ok {
			continue
		}
		d := ws.SurfaceDistance(squad.Position, b.Position)
		if d < bestDistance || (d == bestDistance && (best == nil || b.ID < best.ID)) {
			best = b
			bestDistance = d
		}
	}
	return best
}

// settleCombatRuntime issues orders only. Unit movement, damage, ammo and death
// are settled exactly once by the regular unit pipeline.
func settleCombatRuntime(ws *model.WorldState, currentTick int64) []*model.GameEvent {
	if ws == nil || ws.CombatRuntime == nil {
		return nil
	}
	ids := make([]string, 0, len(ws.CombatRuntime.Squads))
	for id := range ws.CombatRuntime.Squads {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var events []*model.GameEvent
	for _, id := range ids {
		squad := ws.CombatRuntime.Squads[id]
		if squad == nil {
			continue
		}
		members := squad.Members(ws)
		// Blueprint-deployed squads (deploy_squad without member_ids) carry an HP
		// pool instead of a member roster; they stay until combat destroys them.
		if len(squad.MemberIDs) == 0 && squad.HP > 0 {
			if squad.State == model.CombatSquadStateDestroyed {
				delete(ws.CombatRuntime.Squads, squad.ID)
			}
			continue
		}
		squad.MemberIDs = squad.MemberIDs[:0]
		for _, u := range members {
			squad.MemberIDs = append(squad.MemberIDs, u.ID)
		}
		if len(members) == 0 {
			events = append(events, removeSquad(ws, squad)...)
			continue
		}
		sort.SliceStable(members, func(i, j int) bool { return squadRole(members[i]) < squadRole(members[j]) })
		leader := members[0]
		squad.Position = leader.Position
		squad.State = model.CombatSquadStateIdle
		// Task forces delegate their deployment to the same unit orders.
		if tf := model.FindWarTaskForceByMember(ws.Players[squad.OwnerID], model.WarTaskForceMemberKindSquad, squad.ID); tf != nil && tf.Deployment != nil && tf.Deployment.Position != nil {
			target := *tf.Deployment.Position
			if squad.Target == nil || *squad.Target != target {
				order := model.SquadOrderAttack
				if tf.Deployment.GroundOrder == model.GroundTaskForceOrderHold {
					order = model.SquadOrderDefend
				}
				gc := &GameCore{}
				_, ev := gc.execSquadOrder(ws, squad.OwnerID, model.Command{Target: model.CommandTarget{Position: &target}}, squadOrderPayload{SquadID: id, Order: string(order)})
				events = append(events, ev...)
			}
		}
		for _, u := range members {
			if u.AttackTarget != "" {
				squad.State = model.CombatSquadStateEngaging
			}
			if !u.SquadOrderActive {
				continue
			}
			if squad.Order == model.SquadOrderDefend && !u.HasPath() {
				u.Stance = model.UnitStanceHold
			}
			if squad.Order == model.SquadOrderResupply && !u.HasPath() {
				u.Stance = model.UnitStanceHold
			}
			if squad.Order == model.SquadOrderAttack && (u.Type == model.UnitTypeSupplyTruck || u.Type == model.UnitTypeRepairVehicle) && u.ID != leader.ID {
				u.Stance = model.UnitStanceFollow
				u.GuardTargetID = leader.ID
				u.OrderPos = nil
			}
		}
	}
	return events
}
