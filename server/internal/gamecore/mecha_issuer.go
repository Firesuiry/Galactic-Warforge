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

// optionalIssuerMecha 在命令只在「本机甲背包」参与时才需要机甲（如装卸 source=storage）。
func optionalIssuerMecha(ws *model.WorldState, player *model.PlayerState, issuerID string) (mechaContext, *model.CommandResult) {
	if player == nil {
		return mechaContext{}, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeExecutorUnavailable, Message: "未找到玩家"}
	}
	record := player.MechaByOperator(issuerID)
	if record == nil {
		return mechaContext{}, nil
	}
	return issuerMecha(ws, player, issuerID)
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

// taskMecha 返回施工任务所属机甲的档案：优先 task.MechaID，老数据回落到玩家
// 第一台机甲（确定性顺序）。
func taskMecha(ws *model.WorldState, task *model.ConstructionTask) *model.MechaRecord {
	if ws == nil || task == nil {
		return nil
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return nil
	}
	if task.MechaID != "" {
		return player.MechaByUnitID(task.MechaID)
	}
	for _, mecha := range player.SortedMechas() {
		return mecha
	}
	return nil
}

// mechaSlots 返回该档案的背包格数上限（同玩家所有机甲相同）。
func mechaSlots(record *model.MechaRecord, player *model.PlayerState) int {
	if record == nil {
		return 0
	}
	return model.MechaInventorySlots(player)
}

// mechaInventoryOf 返回机甲的背包（不存在时 nil）。
func mechaInventoryOf(player *model.PlayerState, unitID string) model.ItemInventory {
	if player == nil {
		return nil
	}
	if record := player.MechaByUnitID(unitID); record != nil {
		return record.Inventory
	}
	return nil
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
