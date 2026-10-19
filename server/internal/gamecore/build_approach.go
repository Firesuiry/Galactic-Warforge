package gamecore

import "siliconworld/internal/model"

// planBuildApproach 只让指定机甲（发令者绑定的那台）走向施工点：
// 同星球的其它机甲互不打断路径。
func planBuildApproach(ws *model.WorldState, mechaID string, pos model.Position) (*model.Unit, []model.Position) {
	if ws == nil || mechaID == "" {
		return nil, nil
	}
	unit := ws.Units[mechaID]
	if unit == nil || unit.HP <= 0 {
		return nil, nil
	}
	operateRange := model.ExecutorOperateRange()
	path, ok := computeUnitPath(ws, unit.Position, pos, unit.ID)
	if !ok {
		return nil, nil
	}
	for i, p := range path {
		if ws.SurfaceDistance(p, pos) <= operateRange {
			return unit, path[:i+1]
		}
	}
	return nil, nil
}

func startBuildApproach(unit *model.Unit, path []model.Position) {
	unit.ClearMovement()
	unit.ClearEngagement()
	unit.Path = path
	unit.PathIndex = 1
	unit.PathIntent = model.PathIntentTask
	unit.Stance = model.UnitStanceMoving
}
