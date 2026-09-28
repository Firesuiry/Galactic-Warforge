package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 实时移动结算（R1）：世界单位与小队每 tick 按 MoveSpeed 沿路径推进。
// 语义约定：
//   - 命令只负责“下达路径”（execMove/execUnitOrder/deploy 寻路），本文件负责推进；
//   - 单位不可与其他单位重叠（先到先占，后到绕行或等待）；
//   - 途中出现建筑/地形阻挡时立即重寻路，失败则放弃移动；
//   - 到达后按姿态转移：moving/attack_move/retreat→idle，patrol 交换两端继续。
//
// 事件策略：寻路成功/到达/放弃时发 entity_moved（携带路径或到达标记），
// 逐格推进不发事件，客户端依据 path+move_speed 插值并以快照校准。

const (
	// unitBlockedRepathTicks 单位被占位阻挡超过该 tick 数后尝试重寻路。
	unitBlockedRepathTicks = 20
	// maxPathBudget 单次寻路的深度上限（格），超出即视为不可达，需要分段指令。
	maxPathBudget = 800
)

// settleUnitMovement 推进所有世界单位的实时移动，返回到达/放弃事件。
func settleUnitMovement(ws *model.WorldState) []*model.GameEvent {
	if ws == nil || len(ws.Units) == 0 {
		return nil
	}
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var events []*model.GameEvent
	for _, id := range ids {
		unit := ws.Units[id]
		if unit == nil || unit.HP <= 0 {
			continue
		}
		normalizeUnitCombatStats(unit)
		if !unit.HasPath() {
			continue
		}
		unit.MoveProgress += unit.MoveSpeed
		for unit.MoveProgress >= 1 && unit.HasPath() {
			next := unit.Path[unit.PathIndex]
			if !tileWalkableForUnit(ws, next, unit.ID) {
				if !ws.InBounds(next.X, next.Y) || ws.TileBuilding[model.TileKey(next.X, next.Y)] != "" || !ws.Grid[next.Y][next.X].Terrain.Buildable() {
					// 路径被新建筑/地形变化堵死：立即重寻路。
					if !repathUnit(ws, unit) {
						events = append(events, unitMoveAbortedEvent(unit, "path_blocked"))
						continue
					}
					continue
				}
				// 被其他单位占位：尝试侧移绕行。
				if sidestepUnit(ws, unit) {
					unit.MoveProgress -= 1
					unit.BlockedTicks = 0
					continue
				}
				unit.BlockedTicks++
				unit.MoveProgress = 1
				if unit.BlockedTicks >= unitBlockedRepathTicks {
					if !repathUnit(ws, unit) {
						events = append(events, unitMoveAbortedEvent(unit, "blocked"))
						continue
					}
					unit.BlockedTicks = 0
				}
				break
			}
			stepUnitTo(ws, unit, next)
			unit.MoveProgress -= 1
		}
		if !unit.HasPath() && unit.MoveProgress > 0 {
			// 路径走完了剩余进度清零，避免下次寻路带入。
			unit.MoveProgress = 0
		}
		if !unit.HasPath() && (unit.Stance == model.UnitStanceMoving || unit.Stance == model.UnitStanceAttackMove || unit.Stance == model.UnitStanceRetreat || unit.Stance == model.UnitStancePatrol || unit.Stance == model.UnitStanceFollow || unit.Stance == model.UnitStanceGuard) {
			events = append(events, onUnitArrived(ws, unit)...)
		}
	}
	return events
}

// settleSquadMovement 推进所有小队（编组战斗群）的实时移动。
// 小队不受单位占位限制（编队内可共格），仅受建筑与地形约束。
func settleSquadMovement(ws *model.WorldState) []*model.GameEvent {
	if ws == nil || ws.CombatRuntime == nil || len(ws.CombatRuntime.Squads) == 0 {
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
		if squad == nil || squad.State == model.CombatSquadStateDestroyed || !squad.HasPath() {
			continue
		}
		squad.MoveProgress += squad.MoveSpeed
		for squad.MoveProgress >= 1 && squad.HasPath() {
			next := squad.Path[squad.PathIndex]
			if !ws.InBounds(next.X, next.Y) || ws.TileBuilding[model.TileKey(next.X, next.Y)] != "" || !ws.Grid[next.Y][next.X].Terrain.Buildable() {
				dest := squad.Path[len(squad.Path)-1]
				path, ok := computeSurfacePath(ws, squad.Position, dest)
				if !ok {
					squad.ClearPath()
					events = append(events, squadMoveAbortedEvent(squad, "path_blocked"))
					break
				}
				squad.Path = path
				squad.PathIndex = 1
				continue
			}
			squad.Position = next
			squad.PathIndex++
			squad.MoveProgress -= 1
		}
		if !squad.HasPath() {
			squad.MoveProgress = 0
			events = append(events, &model.GameEvent{
				EventType:       model.EvtEntityMoved,
				VisibilityScope: squad.OwnerID,
				Payload: map[string]any{
					"entity_id":   squad.ID,
					"entity_kind": "combat_squad",
					"to":          squad.Position,
					"arrived":     true,
				},
			})
		}
	}
	return events
}

// tileWalkableForUnit 校验单位能否进入目标格：界内、可建地形、无建筑、无其他单位。
func tileWalkableForUnit(ws *model.WorldState, pos model.Position, selfID string) bool {
	if !ws.InBounds(pos.X, pos.Y) {
		return false
	}
	if ws.TileBuilding[model.TileKey(pos.X, pos.Y)] != "" {
		return false
	}
	if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return false
	}
	for _, otherID := range ws.TileUnits[model.TileKey(pos.X, pos.Y)] {
		if otherID == selfID {
			continue
		}
		if other := ws.Units[otherID]; other != nil && other.HP > 0 {
			return false
		}
	}
	return true
}

// stepUnitTo 执行单格移动并维护瓦片索引。
func stepUnitTo(ws *model.WorldState, unit *model.Unit, next model.Position) {
	oldKey := model.TileKey(unit.Position.X, unit.Position.Y)
	removeUnitFromTile(ws, oldKey, unit.ID)
	unit.Position = next
	unit.PathIndex++
	unit.BlockedTicks = 0
	newKey := model.TileKey(next.X, next.Y)
	ws.TileUnits[newKey] = append(ws.TileUnits[newKey], unit.ID)
}

// sidestepUnit 被占位时尝试侧移一格（选择离终点最近的可用邻格）。
func sidestepUnit(ws *model.WorldState, unit *model.Unit) bool {
	if !unit.HasPath() {
		return false
	}
	dest := unit.Path[len(unit.Path)-1]
	bestDist := -1
	var best *model.Position
	for _, n := range ws.SurfaceNeighbors(unit.Position) {
		if !tileWalkableForUnit(ws, n, unit.ID) {
			continue
		}
		d := ws.SurfaceDistance(n, dest)
		if d >= ws.SurfaceDistance(unit.Position, dest) {
			continue
		}
		if bestDist < 0 || d < bestDist {
			candidate := n
			best = &candidate
			bestDist = d
		}
	}
	if best == nil {
		return false
	}
	// 侧移：只改位置与瓦片索引，不推进 PathIndex——原目标格仍是下一步。
	oldKey := model.TileKey(unit.Position.X, unit.Position.Y)
	removeUnitFromTile(ws, oldKey, unit.ID)
	unit.Position = *best
	unit.BlockedTicks = 0
	newKey := model.TileKey(best.X, best.Y)
	ws.TileUnits[newKey] = append(ws.TileUnits[newKey], unit.ID)
	return true
}

// repathUnit 从当前位置向原终点重新寻路。
func repathUnit(ws *model.WorldState, unit *model.Unit) bool {
	if !unit.HasPath() {
		return false
	}
	dest := unit.Path[len(unit.Path)-1]
	path, ok := computeUnitPath(ws, unit.Position, dest, unit.ID)
	if !ok {
		abortUnitMovement(unit)
		return false
	}
	unit.Path = path
	unit.PathIndex = 1
	unit.MoveProgress = 0
	return true
}

// abortUnitMovement 放弃移动：清路径并回到 idle。
func abortUnitMovement(unit *model.Unit) {
	unit.ClearMovement()
	if unit.Stance != model.UnitStanceHold {
		unit.Stance = model.UnitStanceIdle
	}
}

// onUnitArrived 处理单位到达终点后的姿态转移。
func onUnitArrived(ws *model.WorldState, unit *model.Unit) []*model.GameEvent {
	arrived := &model.GameEvent{
		EventType:       model.EvtEntityMoved,
		VisibilityScope: unit.OwnerID,
		Payload: map[string]any{
			"entity_id":   unit.ID,
			"entity_kind": "unit",
			"to":          unit.Position,
			"arrived":     true,
			"stance":      unit.Stance,
		},
	}
	switch unit.Stance {
	case model.UnitStancePatrol:
		// 巡逻：交换两端，继续往返。
		if unit.OrderPos != nil && unit.CombatAnchor != nil {
			unit.OrderPos, unit.CombatAnchor = unit.CombatAnchor, unit.OrderPos
			path, ok := computeUnitPath(ws, unit.Position, *unit.OrderPos, unit.ID)
			if ok && len(path) > 1 {
				unit.Path = path
				unit.PathIndex = 1
				unit.MoveProgress = 0
				return []*model.GameEvent{arrived}
			}
		}
		unit.Stance = model.UnitStanceIdle
	case model.UnitStanceFollow, model.UnitStanceGuard:
		// 跟随/守卫：到达后保持姿态，由交战结算决定下一次跟随。
		unit.ClearMovement()
		return []*model.GameEvent{arrived}
	default:
		unit.Stance = model.UnitStanceIdle
	}
	unit.ClearMovement()
	return []*model.GameEvent{arrived}
}

// computeSurfacePath 以终点可达为前提计算表面路径（供小队等无占位需求的实体）。
func computeSurfacePath(ws *model.WorldState, from, to model.Position) ([]model.Position, bool) {
	if from == to {
		return []model.Position{from}, true
	}
	dist := ws.SurfaceDistance(from, to)
	budget := dist*2 + 40
	if budget > maxPathBudget {
		budget = maxPathBudget
	}
	return ws.SurfacePath(from, to, budget)
}

// computeUnitPath 计算单位路径；若终点被建筑占用或不可进入，
// 退而求其次寻路到终点附近可进入的邻格。
func computeUnitPath(ws *model.WorldState, from, to model.Position, selfID string) ([]model.Position, bool) {
	if from == to {
		return []model.Position{from}, true
	}
	if tileWalkableForUnit(ws, to, selfID) {
		if path, ok := computeSurfacePath(ws, from, to); ok {
			return path, true
		}
	}
	// 终点不可进入：在终点邻域（半径1~2）找可进入且可达的格子。
	bestDist := -1
	var bestPath []model.Position
	for radius := 1; radius <= 2; radius++ {
		for _, candidate := range ws.SurfaceDisc(to, radius) {
			if candidate == from {
				continue
			}
			if !tileWalkableForUnit(ws, candidate, selfID) {
				continue
			}
			path, ok := computeSurfacePath(ws, from, candidate)
			if !ok || len(path) < 2 {
				continue
			}
			d := ws.SurfaceDistance(candidate, to)
			if bestDist < 0 || d < bestDist {
				bestDist = d
				bestPath = path
			}
		}
		if bestPath != nil {
			break
		}
	}
	if bestPath == nil {
		return nil, false
	}
	return bestPath, true
}

func unitMoveAbortedEvent(unit *model.Unit, reason string) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtEntityMoved,
		VisibilityScope: unit.OwnerID,
		Payload: map[string]any{
			"entity_id":   unit.ID,
			"entity_kind": "unit",
			"to":          unit.Position,
			"arrived":     false,
			"reason":      reason,
		},
	}
}

func squadMoveAbortedEvent(squad *model.CombatSquad, reason string) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtEntityMoved,
		VisibilityScope: squad.OwnerID,
		Payload: map[string]any{
			"entity_id":   squad.ID,
			"entity_kind": "combat_squad",
			"to":          squad.Position,
			"arrived":     false,
			"reason":      reason,
		},
	}
}
