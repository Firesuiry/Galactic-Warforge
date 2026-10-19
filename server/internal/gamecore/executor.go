package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// requireBuildRange 校验建造可达性（D2）：
// 目标处于任一己方建造中心（BuildRadius>0 的建筑，如战场分析基站）覆盖半径内即可建造；
// 否则要求指定机甲（发令者绑定的那台）在 operate_range 内。
func (gc *GameCore) requireBuildRange(ws *model.WorldState, playerID string, mecha mechaContext, target model.Position) *model.CommandResult {
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
	return gc.requireMechaRange(mecha, target)
}

// requireMechaRange 要求该机甲在 operate_range 内（建筑覆盖外的兜底）。
func (gc *GameCore) requireMechaRange(mecha mechaContext, target model.Position) *model.CommandResult {
	if mecha.Unit == nil || mecha.Record == nil {
		return &model.CommandResult{Status: model.StatusFailed, Code: model.CodeExecutorUnavailable, Message: "机甲不可用"}
	}
	operateRange := model.ExecutorOperateRange()
	if mecha.World == nil {
		return &model.CommandResult{Status: model.StatusFailed, Code: model.CodeExecutorUnavailable, Message: "机甲不可用"}
	}
	distance := mecha.World.SurfaceDistance(mecha.Unit.Position, target)
	if distance > operateRange {
		return &model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeOutOfRange,
			Message: fmt.Sprintf("超出机甲作业范围：%d > %d", distance, operateRange),
		}
	}
	return nil
}

func (gc *GameCore) reserveExecutorSlot(unitID string, limit int) bool {
	if limit <= 0 {
		limit = 1
	}
	used := gc.executorUsage[unitID]
	if used >= limit {
		return false
	}
	gc.executorUsage[unitID] = used + 1
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
