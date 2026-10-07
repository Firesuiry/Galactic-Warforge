package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

// airborneLogistics 是防空炮可锁定的空中物流载具（站间物流无人机、配送机器人）。
// 只有 in_flight 阶段的载具算“在空中”；起降阶段视为在地面/塔台掩护下。
type airborneLogistics struct {
	kind    string // logistics_drone | logistics_bot
	id      string
	ownerID string
	pos     model.Position
	cargo   model.ItemInventory
}

// logisticsDroneAirPosition 按剩余飞行时间在起点与目标之间插值，得到当前所在瓦片。
func logisticsDroneAirPosition(ws *model.WorldState, d *model.LogisticsDroneState) model.Position {
	if d.TargetPos == nil || d.TravelTicks <= 0 {
		return d.Position
	}
	// 记录在 Position 的是出发点：去程为源站，返程为目的站。
	dist := ws.SurfaceDistance(d.Position, *d.TargetPos)
	elapsed := d.TravelTicks - d.RemainingTicks
	if elapsed <= 0 || dist == 0 {
		return d.Position
	}
	steps := dist * elapsed / d.TravelTicks
	pos := d.Position
	for i := 0; i < steps; i++ {
		best := pos
		bestDist := ws.SurfaceDistance(pos, *d.TargetPos)
		for _, c := range ws.SurfaceNeighbors(pos) {
			if cd := ws.SurfaceDistance(c, *d.TargetPos); cd < bestDist {
				best, bestDist = c, cd
			}
		}
		if best == pos {
			break
		}
		pos = best
	}
	return pos
}

// hostileAirborneLogistics 按 ID 序列出射程内、属于敌方的空中物流载具（确定性）。
func hostileAirborneLogistics(ws *model.WorldState, turret *model.Building, combat *model.CombatModule) *airborneLogistics {
	var found []airborneLogistics
	hostileOwner := func(owner string) bool {
		return owner != "" && owner != turret.OwnerID && !sameTeam(ws, owner, turret.OwnerID)
	}
	for id, d := range ws.LogisticsDrones {
		if d == nil || d.Status != model.LogisticsDroneInFlight || !hostileOwner(d.OwnerID) {
			continue
		}
		pos := logisticsDroneAirPosition(ws, d)
		if ws.SurfaceWithin(turret.Position, pos, combat.Range) {
			found = append(found, airborneLogistics{"logistics_drone", id, d.OwnerID, pos, d.Cargo})
		}
	}
	for id, b := range ws.LogisticsBots {
		if b == nil || b.Status != model.LogisticsDroneInFlight || !hostileOwner(b.OwnerID) {
			continue
		}
		if ws.SurfaceWithin(turret.Position, b.Position, combat.Range) {
			found = append(found, airborneLogistics{"logistics_bot", id, b.OwnerID, b.Position, b.Cargo})
		}
	}
	if len(found) == 0 {
		return nil
	}
	sort.Slice(found, func(i, j int) bool {
		if found[i].kind != found[j].kind {
			return found[i].kind < found[j].kind
		}
		return found[i].id < found[j].id
	})
	return &found[0]
}

// shootDownLogistics 击落载具：载具与所载货物一并损失，站点库存不回补；
// 站点无人机/机器人名额随之释放，可重新装机补充。
func shootDownLogistics(ws *model.WorldState, turret *model.Building, target *airborneLogistics) []*model.GameEvent {
	cargoLost := make(map[string]int, len(target.cargo))
	for item, qty := range target.cargo {
		if qty > 0 {
			cargoLost[item] = qty
		}
	}
	switch target.kind {
	case "logistics_drone":
		model.UnregisterLogisticsDrone(ws, target.id)
	case "logistics_bot":
		model.UnregisterLogisticsBot(ws, target.id)
	}
	payload := map[string]any{
		"entity_id":   target.id,
		"entity_kind": target.kind,
		"entity_type": target.kind,
		"owner_id":    target.ownerID,
		"reason":      "shot_down",
		"attacker_id": turret.ID,
		"cargo_lost":  cargoLost,
		"position":    target.pos,
	}
	return []*model.GameEvent{
		{EventType: model.EvtEntityDestroyed, VisibilityScope: target.ownerID, Payload: payload},
		{EventType: model.EvtEntityDestroyed, VisibilityScope: turret.OwnerID, Payload: payload},
	}
}
