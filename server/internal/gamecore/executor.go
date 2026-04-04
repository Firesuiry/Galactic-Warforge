package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func (gc *GameCore) requireExecutor(ws *model.WorldState, playerID string, target model.Position) (*model.ExecutorState, *model.Unit, *model.CommandResult) {
	player := ws.Players[playerID]
	if player == nil {
		res := model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeExecutorUnavailable,
			Message: "executor not available",
		}
		return nil, nil, &res
	}
	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		res := model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeExecutorUnavailable,
			Message: "executor not available",
		}
		return nil, nil, &res
	}
	execUnit, ok := ws.Units[execState.UnitID]
	if !ok {
		res := model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeExecutorUnavailable,
			Message: fmt.Sprintf("executor unit %s not found", execState.UnitID),
		}
		return nil, nil, &res
	}
	dist := model.ManhattanDist(execUnit.Position, target)
	if dist > execState.OperateRange {
		res := model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeOutOfRange,
			Message: fmt.Sprintf("executor out of range: %d > %d", dist, execState.OperateRange),
		}
		return nil, nil, &res
	}
	return execState, execUnit, nil
}

func (gc *GameCore) reserveExecutorSlot(playerID string, limit int) bool {
	if limit <= 0 {
		limit = 1
	}
	used := gc.executorUsage[playerID]
	if used >= limit {
		return false
	}
	gc.executorUsage[playerID] = used + 1
	return true
}

func sameTeam(ws *model.WorldState, a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	pa := ws.Players[a]
	pb := ws.Players[b]
	if pa == nil || pb == nil {
		return false
	}
	if pa.TeamID == "" || pb.TeamID == "" {
		return false
	}
	return pa.TeamID == pb.TeamID
}
