package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// footprintPushRadius 落成时把占地里的单位推出去的搜索半径（格）。
// 细分网格下占地 1×1~5×5：站在 5×5 正中的单位最多走 3 格才出占地，再留一圈
// 逃逸余量（邻格可能被自家建筑堵住），取 6（与单位寻路的终点邻域容差同一量级）。
const footprintPushRadius = 6

// displaceFootprintUnits 把站在施工占地里的地面单位推到占地外最近的空位。
// 返回被推走的单位；ok=false 表示有单位一格空位都找不到（占地被围得水泄不通），
// 调用方必须推迟落成，绝不能把单位封进墙里。
//
// 为什么需要它：建造命令下达后单位可能自己走进即将合拢的占地——bot 长跑
// tick 14440 里补给站 b-86（3×3）落成时步兵 u-74 正站在占地里，落成后
// buildObstacles 把建筑格视为不可通行，单位四邻全堵、永久砌在墙里。落成前把
// 单位推出去是"绝不封死任何单位"的最简实现，也与"看到单位站在那儿就不该把建筑
// 压上去"的直觉一致（选址侧的对应改动见 botBuildSpotNear / spotCoversGroundUnit）。
//
// 推法：两阶段——先给占地里每台单位各算一个互不冲突的逃逸格，全部算得出来才
// 一起落位。这样要么全员让开、要么原地不动推迟落成，不会出现"推走一半"却因为
// 拿不到落成事件而让客户端位置错乱的情况。
func displaceFootprintUnits(ws *model.WorldState, task *model.ConstructionTask, tiles []model.Position) ([]*model.Unit, bool) {
	if ws == nil || task == nil {
		return nil, true
	}
	// 叠层（Z>0）与仓库顶的配送器都不占地面格，地面单位不会被它们封死。
	if task.Position.Z > 0 || task.BuildingType == model.BuildingTypeLogisticsDistributor {
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
	type relocation struct {
		unit *model.Unit
		to   model.Position
	}
	planned := make([]relocation, 0, 4)
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
		planned = append(planned, relocation{unit: unit, to: target})
	}
	displaced := make([]*model.Unit, 0, len(planned))
	for _, move := range planned {
		relocateUnit(ws, move.unit, move.to)
		displaced = append(displaced, move.unit)
	}
	return displaced, true
}

// footprintEscapeCell 占地外最近的可站立格：SurfaceDisc 由内向外按图距枚举，
// 取第一个「不在占地里、没被本次其它单位预定、且符合单位通行判定」的格子。
// 通行判定复用 tileWalkableForUnit（地形可建、无建筑、无同层单位），因此推出去
// 的单位落地后一定能正常行走；枚举顺序确定，同一局面必得同一个落点。
func footprintEscapeCell(ws *model.WorldState, unit *model.Unit, inside map[model.Position]bool, taken map[model.Position]bool) (model.Position, bool) {
	for _, cell := range ws.SurfaceDisc(unit.Position, footprintPushRadius) {
		pos := model.Position{X: cell.X, Y: cell.Y}
		if inside[pos] || taken[pos] {
			continue
		}
		if !tileWalkableForUnit(ws, pos, unit.ID) {
			continue
		}
		return pos, true
	}
	return model.Position{}, false
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
