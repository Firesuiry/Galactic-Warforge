package gamecore

import (
	"fmt"
	"strings"

	"siliconworld/internal/model"
)

// mechaContext 是一条命令解析出的发令者机甲：档案（背包/绑定/复活）+ 存活单位。
// 需要机甲的命令一律由它执行，不再从 target.entity_id 取机甲。
type mechaContext struct {
	Record *model.MechaRecord
	Unit   *model.Unit
	Player *model.PlayerState
	World  *model.WorldState
}

// issuerIDOf 返回请求的发令者：为空时按玩家 ID 处理（服务端内部调用/测试）。
func issuerIDOf(playerID, issuerID string) string {
	if issuerID == "" {
		return playerID
	}
	return issuerID
}

// issuerMecha 解析本命令该由哪台机甲执行（契约 §4）。解析顺序：
//
//  1. 显式点名 target.mecha_id：必须是本方机甲（ENTITY_NOT_FOUND）、必须绑定给
//     本发令者（NOT_OPERATOR）、必须在本星球（EXECUTOR_UNAVAILABLE）；
//  2. 缺省：本发令者绑定的、PlanetID == 本星球的机甲里 unit ID 最小的那台；
//  3. 一台都没有：未绑定 / 都绑在别的星球，两种 EXECUTOR_UNAVAILABLE 文案。
func issuerMecha(ws *model.WorldState, player *model.PlayerState, issuerID, mechaID string) (mechaContext, *model.CommandResult) {
	fail := func(code model.ResultCode, message string) (mechaContext, *model.CommandResult) {
		return mechaContext{}, &model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	if player == nil {
		return fail(model.CodeExecutorUnavailable, "未找到玩家")
	}
	if mechaID != "" {
		record := player.MechaByUnitID(mechaID)
		if record == nil {
			return fail(model.CodeEntityNotFound, fmt.Sprintf("未找到机甲 %s", mechaID))
		}
		if record.Operator != issuerID {
			return fail(model.CodeNotOperator, fmt.Sprintf("机甲 %s 绑定给 %s，不是你", record.UnitID, record.Operator))
		}
		if ws == nil || record.PlanetID != ws.PlanetID {
			return fail(model.CodeExecutorUnavailable, fmt.Sprintf("你的机甲 %s 在 %s，不在本星球", record.UnitID, record.PlanetID))
		}
		return mechaContextFor(ws, player, record)
	}

	bound := player.MechasByOperator(issuerID)
	if len(bound) == 0 {
		return fail(model.CodeExecutorUnavailable, fmt.Sprintf("%s 还没有绑定机甲：先用 assign_mecha 接管一台（mecha list 查看）", issuerID))
	}
	if ws != nil {
		if record := player.MechaByOperatorOnPlanet(issuerID, ws.PlanetID); record != nil {
			return mechaContextFor(ws, player, record)
		}
	}
	ids := make([]string, 0, len(bound))
	for _, record := range bound {
		ids = append(ids, record.UnitID)
	}
	return fail(model.CodeExecutorUnavailable, fmt.Sprintf(
		"你的机甲都在别的星球：%s（用 dispatch_mecha 投送，或 switch_active_planet 切焦点）", strings.Join(ids, ",")))
}

// mechaContextFor 把一台已确定在本星球的机甲档案解析成可执行的上下文。
func mechaContextFor(ws *model.WorldState, player *model.PlayerState, record *model.MechaRecord) (mechaContext, *model.CommandResult) {
	unit := ws.Units[record.UnitID]
	if unit == nil || unit.HP <= 0 || unit.OwnerID != player.PlayerID {
		if record.RespawnAtTick > 0 {
			return mechaContext{}, &model.CommandResult{
				Status:  model.StatusFailed,
				Code:    model.CodeExecutorUnavailable,
				Message: fmt.Sprintf("机甲 %s 已阵亡，tick %d 复活", record.UnitID, record.RespawnAtTick),
			}
		}
		// 正常阵亡路径必定写 RespawnAtTick；档案仍在但单位不在 ws.Units 且没有
		// 复活时间只可能是数据异常，按「等待复活」提示，避免玩家以为能立刻用。
		return mechaContext{}, &model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeExecutorUnavailable,
			Message: fmt.Sprintf("机甲 %s 已阵亡，等待复活", record.UnitID),
		}
	}
	model.SyncMechaCapabilities(unit, player)
	return mechaContext{Record: record, Unit: unit, Player: player, World: ws}, nil
}

// mechaRecordForUnit 返回某台机甲单位的档案（不存在时 nil）。
func mechaRecordForUnit(ws *model.WorldState, unit *model.Unit) *model.MechaRecord {
	if ws == nil || unit == nil {
		return nil
	}
	player := ws.Players[unit.OwnerID]
	if player == nil {
		return nil
	}
	return player.MechaByUnitID(unit.ID)
}

// taskMecha 返回施工任务所属机甲的档案（task.MechaID 在排产时写入）。
// 缺 MechaID 的任务不会去借别的机甲的料：返回 nil，调用方按缺料等待处理。
func taskMecha(ws *model.WorldState, task *model.ConstructionTask) *model.MechaRecord {
	if ws == nil || task == nil || task.MechaID == "" {
		return nil
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return nil
	}
	return player.MechaByUnitID(task.MechaID)
}

// operatorDenied 判断一台机甲是否被别的发令者绑定（空闲机甲谁都能动）。
func operatorDenied(ws *model.WorldState, playerID, issuerID string, unit *model.Unit) bool {
	if ws == nil || unit == nil || unit.Type != model.UnitTypeExecutor {
		return false
	}
	player := ws.Players[playerID]
	if player == nil {
		return false
	}
	record := player.MechaByUnitID(unit.ID)
	if record == nil || record.Operator == "" {
		return false
	}
	return record.Operator != issuerID
}
