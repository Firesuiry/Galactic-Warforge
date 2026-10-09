package gamecore

import (
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/surface"
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
	// unitBlockedAbandonTicks 连续被单位阻挡且绕不开超过该 tick 数后放弃当前路径：
	// 单位停在原地（不瞬移、不重叠），姿态/终点保留，由上层（姿态恢复/索敌）
	// 重新决策。这是单位挤成一团时唯一的出口——否则 path_index/move_progress
	// 会永远停在同一个值（试玩报告 #4：11 个兵 4 万 tick 不动）。
	unitBlockedAbandonTicks = 300
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
		if !unit.HasPath() {
			continue
		}
		unit.MoveProgress += unit.MoveSpeed
		for unit.MoveProgress >= 1 && unit.HasPath() {
			next := unit.Path[unit.PathIndex]
			if !tileWalkableForUnit(ws, next, unit.ID) {
				if !ws.InBounds(next.X, next.Y) || (!unitIsAir(ws, unit.ID) && (ws.Grid[next.Y][next.X].BuildingID != "" || !ws.Grid[next.Y][next.X].Terrain.Buildable())) {
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
				if unit.BlockedTicks >= unitBlockedAbandonTicks {
					// 长期绕不开：放弃当前路径但保留命令意图，避免
					// path_index/move_progress 永久不变地把单位钉死。
					// 必须在重寻路之前判断：重寻路"成功"不代表能走通
					// （一群单位互相占位时 BFS 仍会给出穿过占位格的路）。
					events = append(events, unitMoveAbortedEvent(unit, "blocked"))
					stopUnitMovement(unit)
					continue
				}
				if unit.BlockedTicks >= unitBlockedRepathTicks {
					// 优先绕开待命单位重寻路；绕不开再按原规则重寻路（继续等对方让开）。
					// 注意：重寻路成功不代表能走通——一群单位互相占位时 BFS 会把
					// 占位单位当障碍，仍可能回到同一条被堵死的路，因此 BlockedTicks
					// 继续累积，由上面的放弃阈值兜底。
					if repathUnitAvoidingIdle(ws, unit) || repathUnit(ws, unit) {
						continue
					}
					unit.BlockedTicks = unitBlockedRepathTicks
				}
				break
			}
			if unit.Mecha != nil {
				if failure := spendMechaEnergy(unit, unit.Mecha.MoveEnergyCost); failure != nil {
					unit.MoveProgress = 1
					break
				}
			}
			stepUnitTo(ws, unit, next)
			unit.MoveProgress -= 1
		}
		// 长跑但始终走不动（绕不开的单位团）：放弃当前路径但保留命令意图。
		// 检查放在内层循环之外，因为内层可能被重寻路 continue 掉，
		// 不再有机会在循环体内累计判断。
		if unit.HasPath() && unit.BlockedTicks >= unitBlockedAbandonTicks {
			events = append(events, unitMoveAbortedEvent(unit, "blocked"))
			stopUnitMovement(unit)
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

// tileWalkableForUnit 校验单位能否进入目标格：界内、可建地形、无建筑、无其他单位。
func tileWalkableForUnit(ws *model.WorldState, pos model.Position, selfID string) bool {
	if !ws.InBounds(pos.X, pos.Y) {
		return false
	}
	if !unitIsAir(ws, selfID) && ws.Grid[pos.Y][pos.X].BuildingID != "" {
		return false
	}
	if !unitIsAir(ws, selfID) && !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return false
	}
	for _, otherID := range ws.TileUnits[model.TileKey(pos.X, pos.Y)] {
		if otherID == selfID {
			continue
		}
		if other := ws.Units[otherID]; other != nil && other.HP > 0 && (other.Domain == model.UnitDomainAir) == unitIsAir(ws, selfID) {
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

// repathUnitAvoidingIdle 被占位阻挡后绕开待命单位重寻路；失败时不改动单位。
// 绕开待命单位的路径若仍被移动中的单位堵死，回退到普通寻路（可能与旧路径相同）。
func repathUnitAvoidingIdle(ws *model.WorldState, unit *model.Unit) bool {
	dest := unit.Path[len(unit.Path)-1]
	path, ok := computePathNear(ws, unit.Position, dest, unit.ID, true)
	if !ok || len(path) < 2 {
		return false
	}
	// 新路径若第一步就走不通（仍被占位），说明"避开待命单位"没有解，交给调用方回退。
	if !tileWalkableForUnit(ws, path[1], unit.ID) {
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

// stopUnitMovement 放弃当前路径但保留命令意图（stance/OrderPos 不动）：
// 单位挤成一团绕不开时用它脱困，避免把"攻击移动/撤退"等指令一并丢掉。
// 单位不再有路径，因此不会继续被阻挡计数钉住；上层（姿态恢复/索敌）会重新决策。
func stopUnitMovement(unit *model.Unit) {
	unit.Path = nil
	unit.PathIndex = 0
	unit.MoveProgress = 0
	unit.BlockedTicks = 0
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

// computePathNear 单次 BFS：到达终点本身（可进入时）或终点邻域（半径 1~2）中
// 距终点最近的可进入格。
// 性能：epoch 戳扁平数组做已访问/父指针（零分配），建筑占位走 Grid.BuildingID
// （零字符串分配）；大面积寻路下比 map+TileKey 版本快一个数量级。
// avoidIdle 为 true 时把停着不动（无路径）的单位所在格当作障碍——被待命单位堵住后的重寻路用，
// 否则会反复得到同一条穿过占位格的路。
func computePathNear(ws *model.WorldState, from, to model.Position, selfID string, avoidIdle bool) ([]model.Position, bool) {
	if from == to {
		return []model.Position{from}, true
	}
	dist := ws.SurfaceDistance(from, to)
	if dist == 1 && tileWalkableForUnit(ws, to, selfID) {
		return []model.Position{from, to}, true
	}
	budget := dist*2 + 40
	if dist <= 12 {
		// 近距寻路（围堵/贴身场景）用小预算，避免单位堆中对全图做 BFS。
		budget = dist*2 + 24
	}
	if budget > maxPathBudget {
		budget = maxPathBudget
	}

	targetOK := tileWalkableForUnit(ws, to, selfID)
	targetIdx := int32(to.Y*ws.MapWidth + to.X)
	// 终点邻域命中集（预算一次，BFS 中 O(1) 查询）。
	var nearSet map[int32]bool
	if !targetOK {
		nearSet = make(map[int32]bool, 32)
		for _, candidate := range ws.SurfaceDisc(to, 2) {
			if candidate != to {
				nearSet[int32(candidate.Y*ws.MapWidth+candidate.X)] = true
			}
		}
	}

	flood := pathFlood(ws, from, selfID, avoidIdle, budget, func(cur int32) bool {
		if targetOK {
			return cur == targetIdx
		}
		return nearSet[cur] && tileWalkableForUnit(ws, model.Position{X: int(cur) % ws.MapWidth, Y: int(cur) / ws.MapWidth}, selfID)
	})
	if flood.hit < 0 {
		return nil, false
	}
	return floodPath(ws, flood.hit), true
}

// floodResult 一次洪泛的结果。visited 与 ws 上的 scratch 数组共用，
// 只在下一次 pathFlood 之前有效。
type floodResult struct {
	hit       int32
	visited   []int32
	truncated bool // 有格子因到达 budget 深度而没有继续扩展（连通区未走完）
}

// pathFlood 从 from 出发按单位通行规则做一次 BFS 洪泛：epoch 戳扁平数组做
// 已访问/父指针，队列复用 ws.PathScratchQueue，邻居用 Grid.Step 逐方向取，
// 整个洪泛零分配。每个出队格先交给 stop，返回 true 即提前结束并记为 hit；
// 否则扩展到 budget 深度为止。parent/depth 链在下一次洪泛前可用 floodPath 回溯。
func pathFlood(ws *model.WorldState, from model.Position, selfID string, avoidIdle bool, budget int, stop func(idx int32) bool) floodResult {
	size := ws.MapWidth * ws.MapHeight
	if len(ws.PathScratchParent) != size {
		ws.PathScratchParent = make([]int32, size)
		ws.PathScratchDepth = make([]int32, size)
		ws.PathScratchEpoch = make([]int32, size)
		ws.PathScratchGen = 0
	}
	ws.PathScratchGen++
	gen := ws.PathScratchGen
	parent := ws.PathScratchParent
	depth := ws.PathScratchDepth
	epoch := ws.PathScratchEpoch

	width := ws.MapWidth
	fromIdx := int32(from.Y*width + from.X)
	queue := append(ws.PathScratchQueue[:0], fromIdx)
	parent[fromIdx] = fromIdx
	depth[fromIdx] = 0
	epoch[fromIdx] = gen

	air := unitIsAir(ws, selfID)
	grid := ws.Surface()
	result := floodResult{hit: -1}
	for head := 0; head < len(queue); head++ {
		cur := queue[head]
		if stop != nil && stop(cur) {
			result.hit = cur
			break
		}
		if int(depth[cur]) >= budget {
			result.truncated = true
			continue
		}
		tile := surface.Tile{X: int(cur) % width, Y: int(cur) / width}
		for d := surface.North; d <= surface.West; d++ {
			n, _ := grid.Step(tile, d)
			if !ws.InBounds(n.X, n.Y) {
				continue
			}
			nIdx := int32(n.Y*width + n.X)
			if epoch[nIdx] == gen {
				continue
			}
			if !air {
				cell := &ws.Grid[n.Y][n.X]
				if cell.BuildingID != "" || !cell.Terrain.Buildable() {
					continue
				}
			}
			if avoidIdle && tileHasIdleUnit(ws, model.Position{X: n.X, Y: n.Y}, selfID) {
				continue
			}
			epoch[nIdx] = gen
			parent[nIdx] = cur
			depth[nIdx] = depth[cur] + 1
			queue = append(queue, nIdx)
		}
	}
	ws.PathScratchQueue = queue
	result.visited = queue
	return result
}

// floodVisited 该格是否在最近一次 pathFlood 中被访问。
func floodVisited(ws *model.WorldState, idx int32) bool {
	return ws.PathScratchEpoch[idx] == ws.PathScratchGen
}

// floodPath 沿最近一次 pathFlood 的 parent 链回溯出到 idx 的路径（含起点）。
func floodPath(ws *model.WorldState, idx int32) []model.Position {
	path := make([]model.Position, ws.PathScratchDepth[idx]+1)
	for i, cur := len(path)-1, idx; i >= 0; i-- {
		path[i] = model.Position{X: int(cur) % ws.MapWidth, Y: int(cur) / ws.MapWidth}
		cur = ws.PathScratchParent[cur]
	}
	return path
}

// computeUnitPath 计算单位路径；终点被占用/不可进入时落到终点邻域。
func computeUnitPath(ws *model.WorldState, from, to model.Position, selfID string) ([]model.Position, bool) {
	return computePathNear(ws, from, to, selfID, false)
}

// tileHasIdleUnit 格内是否有停着不动的同层单位（不含自己）。
func tileHasIdleUnit(ws *model.WorldState, pos model.Position, selfID string) bool {
	air := unitIsAir(ws, selfID)
	for _, otherID := range ws.TileUnits[model.TileKey(pos.X, pos.Y)] {
		if otherID == selfID {
			continue
		}
		if other := ws.Units[otherID]; other != nil && other.HP > 0 && !other.HasPath() && (other.Domain == model.UnitDomainAir) == air {
			return true
		}
	}
	return false
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

func unitIsAir(ws *model.WorldState, id string) bool {
	u := ws.Units[id]
	return u != nil && u.Domain == model.UnitDomainAir
}
