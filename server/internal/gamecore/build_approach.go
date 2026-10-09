package gamecore

import "siliconworld/internal/model"

func planBuildApproach(ws *model.WorldState, playerID string, pos model.Position) (*model.Unit, []model.Position) {
	player := ws.Players[playerID]
	if player == nil {
		return nil, nil
	}
	executor := player.ExecutorForPlanet(ws.PlanetID)
	if executor == nil {
		return nil, nil
	}
	unit := ws.Units[executor.UnitID]
	if unit == nil || unit.HP <= 0 {
		return nil, nil
	}
	path, ok := computeUnitPath(ws, unit.Position, pos, unit.ID)
	if !ok {
		return nil, nil
	}
	for i, p := range path {
		if ws.SurfaceDistance(p, pos) <= executor.OperateRange {
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
