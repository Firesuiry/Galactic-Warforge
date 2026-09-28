package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// requireBuildRange 校验建造可达性（D2）：
// 目标处于任一己方建造中心（BuildRadius>0 的建筑，如战场分析基站）覆盖半径内即可建造；
// 否则回退要求执行体在操作范围内（无建造中心时的兜底）。
func (gc *GameCore) requireBuildRange(ws *model.WorldState, playerID string, target model.Position) *model.CommandResult {
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID || b.HP <= 0 {
			continue
		}
		def, ok := model.BuildingDefinitionByID(b.Type)
		if !ok || def.BuildRadius <= 0 {
			continue
		}
		if ws.SurfaceDistance(b.Position, target) <= def.BuildRadius {
			return nil
		}
	}
	_, _, execRes := gc.requireExecutor(ws, playerID, target)
	return execRes
}

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
	dist := ws.SurfaceDistance(execUnit.Position, target)
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
