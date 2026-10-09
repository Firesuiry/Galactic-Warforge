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
		return nil, fmt.Errorf("小队没有存活成员")
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
	// 候选格里与成员无关的部分只算一次：跨面 SurfaceDistance 很贵，
	// 不能放进「成员 × 候选格」的循环。
	type candidate struct {
		pos        model.Position
		targetDist int // 到目标的地表距离
		behind     int // 比军团当前位置更远离目标的格数
	}
	anchorDist := ws.SurfaceDistance(squad.Position, target)
	disc := ws.SurfaceDisc(target, radius+6)
	candidates := make(map[int32]candidate, len(disc))
	for _, p := range disc {
		behind := ws.SurfaceDistance(p, squad.Position) - anchorDist
		if behind < 0 {
			behind = 0
		}
		candidates[int32(p.Y*ws.MapWidth+p.X)] = candidate{p, ws.SurfaceDistance(p, target), behind}
	}
	type reserveKey struct {
		domain model.UnitDomain
		idx    int32
	}
	reserved := make(map[reserveKey]bool)
	plans := make([]squadMemberPlan, 0, len(members))
	// 已确认到不了任何候选格的连通区（洪泛没被预算截断）：同一区里的其他
	// 地面成员直接跳过，不再重复洪泛。
	sealed := make(map[int32]bool)
	slack := int32(2 * (radius + 6))
	for _, u := range members {
		fromIdx := int32(u.Position.Y*ws.MapWidth + u.Position.X)
		if u.Domain != model.UnitDomainAir && sealed[fromIdx] && ws.SurfaceDistance(u.Position, target) > radius+6 {
			continue
		}
		desired := 0
		if order == model.SquadOrderAttack || order == model.SquadOrderDefend {
			desired = min(6, max(0, squadRole(u)-members[0].AttackRange))
		}
		// 每个成员只洪泛一次，边洪泛边给可达候选格打分。旧实现按得分顺序
		// 对每个候选格各跑一次 BFS：目标附近被建筑围住时是「成员数 × 候选数
		// × 整片连通区洪泛」，单 tick 卡 6–12 秒（试玩 1009）。
		// 首个可用候选格命中后再多扩展一个候选圆直径的深度即停，同一侧的
		// 候选格都能参与比较，又不必走满全图。路径长度代替原来的直线距离做末项。
		best, bestScore, firstDepth := int32(-1), 0, int32(-1)
		budget := 2*(ws.SurfaceDistance(u.Position, target)+radius+6) + 40
		if budget > maxPathBudget {
			budget = maxPathBudget
		}
		flood := pathFlood(ws, u.Position, u.ID, false, budget, func(cur int32) bool {
			depth := ws.PathScratchDepth[cur]
			if firstDepth >= 0 && depth > firstDepth+slack {
				return true
			}
			c, ok := candidates[cur]
			if !ok || reserved[reserveKey{u.Domain, cur}] || !tileWalkableForUnit(ws, c.pos, u.ID) {
				return false
			}
			delta := c.targetDist - desired
			if delta < 0 {
				delta = -delta
			}
			score := delta*100 + c.behind*20 + int(depth)
			if best < 0 || score < bestScore {
				best, bestScore = cur, score
			}
			if firstDepth < 0 {
				firstDepth = depth
			}
			return false
		})
		if best < 0 {
			// 成员被自家建筑围住、走不出去时把它留在原地，其余成员照常出击；
			// 否则一条 squad_order 会被一个掉队单位整条顶掉（试玩报告 B）。
			if !flood.truncated && u.Domain != model.UnitDomainAir {
				for _, idx := range flood.visited {
					sealed[idx] = true
				}
			}
			continue
		}
		reserved[reserveKey{u.Domain, best}] = true
		plans = append(plans, squadMemberPlan{u, candidates[best].pos, floodPath(ws, best)})
	}
	if len(plans) == 0 {
		return nil, fmt.Errorf("小队没有可到达的阵型位置")
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
