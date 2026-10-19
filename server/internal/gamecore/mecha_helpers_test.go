package gamecore

import "siliconworld/internal/model"

// 本文件只放测试辅助函数（由 S1b 迁移测试时使用）；不含测试用例。
//
// 语义：
//   - starterMecha 返回玩家的开局机甲档案（operator = 玩家 ID，找不到时退回第一台
//     机甲，按 unit_id 排序保证确定性）。
//   - starterBackpack 返回该档案的背包（nil 档案时返回 nil map；必要时可写）。
//   - setStarterBackpack 整体替换该档案的背包（nil/空 map 均视为清空）。
//
// 注意：背包挂在 MechaRecord 上（PlayerState.Inventory 已删除），所有往玩家背包
// 放物品的测试都要经这些辅助函数。

// starterMecha 返回玩家开局机甲档案；玩家不存在或没有任何机甲时返回 nil。
func starterMecha(ws *model.WorldState, playerID string) *model.MechaRecord {
	if ws == nil {
		return nil
	}
	player := ws.Players[playerID]
	if player == nil {
		return nil
	}
	if record := player.MechaByOperator(playerID); record != nil {
		return record
	}
	for _, record := range player.SortedMechas() {
		return record
	}
	return nil
}

// starterBackpack 返回开局机甲的背包；没有机甲时返回 nil。
func starterBackpack(ws *model.WorldState, playerID string) model.ItemInventory {
	record := starterMecha(ws, playerID)
	if record == nil {
		return nil
	}
	return record.Inventory
}

// setStarterBackpack 整体替换开局机甲的背包（复制一份，调用方之后改原 map 不影响）。
func setStarterBackpack(ws *model.WorldState, playerID string, items model.ItemInventory) {
	record := starterMecha(ws, playerID)
	if record == nil {
		return
	}
	if len(items) == 0 {
		record.Inventory = nil
		return
	}
	record.Inventory = items.Clone()
}
