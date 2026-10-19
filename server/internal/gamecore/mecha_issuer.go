package gamecore

import (
	"fmt"

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

// issuerMecha 解析发令者绑定的机甲，失败统一 EXECUTOR_UNAVAILABLE，消息分三种
// （未绑定 / 不在本星球 / 阵亡）。
func issuerMecha(ws *model.WorldState, player *model.PlayerState, issuerID string) (mechaContext, *model.CommandResult) {
	fail := func(message string) (mechaContext, *model.CommandResult) {
		return mechaContext{}, &model.CommandResult{
			Status:  model.StatusFailed,
			Code:    model.CodeExecutorUnavailable,
			Message: message,
		}
	}
	if player == nil {
		return fail("未找到玩家")
	}
	record := player.MechaByOperator(issuerID)
	if record == nil {
		return fail(fmt.Sprintf("%s 还没有绑定机甲：先用 assign_mecha 接管一台（mecha list 查看）", issuerID))
	}
	if ws == nil || record.PlanetID != ws.PlanetID {
		return fail(fmt.Sprintf("你的机甲 %s 在 %s，不在本星球", record.UnitID, record.PlanetID))
	}
	unit := ws.Units[record.UnitID]
	if unit == nil || unit.HP <= 0 || unit.OwnerID != player.PlayerID {
		if record.RespawnAtTick > 0 {
			return fail(fmt.Sprintf("机甲 %s 已阵亡，tick %d 复活", record.UnitID, record.RespawnAtTick))
		}
		return fail(fmt.Sprintf("机甲 %s 已阵亡，等待复活", record.UnitID))
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
