package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

const (
	// footprintPushRadius 落成时把占地里的单位推出去的搜索半径（格）。
	// 细分网格下占地 1×1~5×5：站在 5×5 正中的单位最多走 3 格才出占地，再留一圈
	// 逃逸余量（邻格可能被自家建筑堵住），取 6（与单位寻路的终点邻域容差同一量级）。
	footprintPushRadius = 6
	// escapeMinRegion 逃逸格所在的连通可行走区域下限（格）。低于它就说明单位只是
	// 被塞进了另一个小口袋（四邻全被建筑/地形堵住），换个地方砌墙不算"让开"，
	// 宁可推迟落成。64 格 ≈ 8×8，足够一台单位在里面正常走动。
	escapeMinRegion = 64
)

// footprintRelocation 一台要被让开的单位与它的逃逸格。
type footprintRelocation struct {
	unit *model.Unit
	to   model.Position
}

// planFootprintDisplacement 计算把站在施工占地里的地面单位推到占地外的方案，
// **不改动任何状态**；ok=false 表示有单位找不到合格的空位，调用方必须推迟落成
// （errFootprintOccupied），绝不能把单位封进墙里。
//
// 为什么需要它：建造命令下达后单位可能自己走进即将合拢的占地——bot 长跑
// tick 14440 里补给站 b-86（3×3）落成时步兵 u-74 正站在占地里，落成后
// buildObstacles 把建筑格视为不可通行，单位四邻全堵、永久砌在墙里。落成前把
// 单位推出去是"绝不封死任何单位"的最简实现，也与"看到单位站在那儿就不该把建筑
// 压上去"的直觉一致（选址侧的对应改动见 botBuildSpotNear / spotCoversGroundUnit）。
//
// 推法：先给占地里每台地面单位各算一个互不冲突的逃逸格，全部算得出来才由调用方
// 一起落位（applyFootprintDisplacement 必须在建筑索引成功之后调用）。这样要么
// 全员让开、要么原地不动推迟落成，不会出现"推走一半"或"建筑没落成却把单位瞬移了"。
func planFootprintDisplacement(ws *model.WorldState, task *model.ConstructionTask, tiles []model.Position) ([]footprintRelocation, bool) {
	if ws == nil || task == nil {
		return nil, true
	}
	// 叠层（Z>0）与仓库顶的配送器都不占地面格；地基是地形改写、不登记 TileBuilding，
	// 三种情况下地面单位都不会被它们封死，不需要（也不该）被推开。
	if task.Position.Z > 0 ||
		task.BuildingType == model.BuildingTypeLogisticsDistributor ||
		task.BuildingType == model.BuildingTypeFoundation {
		return nil, true
	}
	inside := make(map[model.Position]bool, len(tiles))
	for _, tile := range tiles {
		inside[model.Position{X: tile.X, Y: tile.Y}] = true
	}
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids) // 落点与顺序都按实体 ID 定序，保证同一局面可复现
	planned := make([]footprintRelocation, 0, 4)
	taken := make(map[model.Position]bool, 4)
	for _, id := range ids {
		unit := ws.Units[id]
		if unit == nil || unit.HP <= 0 || unitIsAir(ws, id) {
			continue
		}
		if !inside[model.Position{X: unit.Position.X, Y: unit.Position.Y}] {
			continue
		}
		target, ok := footprintEscapeCell(ws, unit, inside, taken)
		if !ok {
			return nil, false
		}
		taken[target] = true
		planned = append(planned, footprintRelocation{unit: unit, to: target})
	}
	return planned, true
}

// applyFootprintDisplacement 把方案里的单位挪到逃逸格，返回真正被挪动的单位
// （调用方据此下发位移事件）。调用方必须保证建筑已经索引成功——让开与落成是
// 同一件事的两半，不允许只发生一半。
func applyFootprintDisplacement(ws *model.WorldState, plan []footprintRelocation) []*model.Unit {
	displaced := make([]*model.Unit, 0, len(plan))
	for _, move := range plan {
		relocateUnit(ws, move.unit, move.to)
		displaced = append(displaced, move.unit)
	}
	return displaced
}

// footprintEscapeCell 占地外最近的可站立格：SurfaceDisc 由内向外按图距枚举，
// 取第一个「不在占地里、没被本次其它单位预定、符合单位通行判定、且落在足够大的
// 连通区域里」的格子。通行判定复用 tileWalkableForUnit（地形可建、无建筑、无同层
// 单位），因此推出去的单位落地后一定能正常行走；枚举顺序确定，同一局面必得同一个落点。
func footprintEscapeCell(ws *model.WorldState, unit *model.Unit, inside map[model.Position]bool, taken map[model.Position]bool) (model.Position, bool) {
	for _, cell := range ws.SurfaceDisc(unit.Position, footprintPushRadius) {
		pos := model.Position{X: cell.X, Y: cell.Y}
		if inside[pos] || taken[pos] {
			continue
		}
		if !tileWalkableForUnit(ws, pos, unit.ID) {
			continue
		}
		if !footprintRegionOpen(ws, pos, inside) {
			continue
		}
		return pos, true
	}
	return model.Position{}, false
}

// footprintRegionOpen 逃逸格所在的连通可行走区域是否够大（≥ escapeMinRegion 格）：
// 只有一格宽的小口袋不算"让开"，单位进去照样出不来。
//
// 障碍口径是「已落成建筑 + 本次施工的占地」——占地马上要变成建筑，必须当障碍算，
// 否则洪泛会穿过还没索引的占地格，把占地对面的小口袋看成开阔地（这正是本判定要
// 拦的情况）。其它施工预留不算障碍：它们只是"将来"的建筑，单位在落成前还能走开。
// 单位不参与判定（建筑才是永久障碍，单位会移动），与 tileWalkableForUnit 的差别仅此一处。
func footprintRegionOpen(ws *model.WorldState, pos model.Position, inside map[model.Position]bool) bool {
	if ws == nil {
		return false
	}
	seen := map[model.Position]bool{pos: true}
	queue := []model.Position{pos}
	for head := 0; head < len(queue); head++ {
		if len(seen) >= escapeMinRegion {
			return true
		}
		for _, next := range ws.SurfaceNeighbors(queue[head]) {
			if seen[next] || inside[next] || !footprintTilePassable(ws, next) {
				continue
			}
			seen[next] = true
			queue = append(queue, next)
		}
	}
	return len(seen) >= escapeMinRegion
}

// footprintTilePassable 单格作为地面单位的通道是否可通行（只算永久障碍：
// 地形与已落成建筑）。
func footprintTilePassable(ws *model.WorldState, pos model.Position) bool {
	if !ws.InBounds(pos.X, pos.Y) {
		return false
	}
	cell := ws.Grid[pos.Y][pos.X]
	return cell.Terrain.Buildable() && cell.BuildingID == ""
}

// relocateUnit 把单位瞬移到新格：维护 TileUnits 索引并清掉旧路径（旧路径的第一步
// 多半正落在刚落成的建筑格上）。姿态与命令意图保留，上层（姿态恢复/索敌）会重新决策。
func relocateUnit(ws *model.WorldState, unit *model.Unit, pos model.Position) {
	if ws == nil || unit == nil || unit.Position == pos {
		return
	}
	from := unit.Position
	removeUnitFromTile(ws, model.TileKey(from.X, from.Y), unit.ID)
	unit.Position = pos
	unit.ClearMovement()
	key := model.TileKey(pos.X, pos.Y)
	ws.TileUnits[key] = append(ws.TileUnits[key], unit.ID)
}

// footprintDisplacementEvents 被推走单位的 entity_moved 事件：客户端据此把单位
// 挪到新位置（与 abort 事件同一载荷形状，多带一个 reason 便于排查）。
func footprintDisplacementEvents(units []*model.Unit) []*model.GameEvent {
	if len(units) == 0 {
		return nil
	}
	events := make([]*model.GameEvent, 0, len(units))
	for _, unit := range units {
		if unit == nil {
			continue
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityMoved,
			VisibilityScope: unit.OwnerID,
			Payload: map[string]any{
				"entity_id":   unit.ID,
				"entity_kind": "unit",
				"to":          unit.Position,
				"arrived":     false,
				"reason":      "footprint_displaced",
			},
		})
	}
	return events
}
