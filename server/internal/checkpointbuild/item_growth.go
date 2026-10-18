package checkpointbuild

import (
	"fmt"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/model"
)

// 契约加强：`item_growth` —— 存档点落档前再推进 N tick，断言「产线末端真的在
// 流动」（某台建筑里某物品的存量增长 ≥ 阈值）。
//
// 为什么需要它：试玩 1016 报告问题 1 的 cp-logistics 存档点上，契约里的
// building_item_at_gte 只断言「存量 ≥ 2」——存量是读档前就攒下的，产线其实
// 早就死锁（熔炉 output_blocked、分拣器 last_transfer 冻结），契约照样通过。
// 存量断言只能证明「曾经产出过」，不能证明「现在还在流动」。
//
// 步骤形态（构建记录里与 cmd / advance_to_tick / wait_until 并列）：
//
//	{"item_growth": {"position": {"x":64,"y":132,"z":0},
//	                 "item_id": "iron_ingot", "growth": 1, "advance_ticks": 1200}}
//
// 执行方式是「先数一次 → 推进 advance_ticks → 再数一次」，两次之差就是增量；
// 增量 < growth 时这一步失败，并把起点 tick、终点 tick、两次计数写进失败原因。
// 建筑按落点定位（与 building_item_at_gte 同一口径：建筑 ID 换一次重建就会变，
// 落点不会）。

// runItemGrowth 执行一条 item_growth 步骤，返回给人看的进度说明。
func (r *Runner) runItemGrowth(core *gamecore.GameCore, step checkpoint.ItemGrowthStep) (string, error) {
	if err := step.Validate(); err != nil {
		return "", err
	}
	before, err := buildingItemCountAtLayer(core, step.Position, step.Elevation, step.ItemID)
	if err != nil {
		return "", err
	}
	startTick := core.CurrentTick()
	deadline := startTick + step.Window()
	for core.CurrentTick() < deadline {
		core.AdvanceTick()
	}
	after, err := buildingItemCountAtLayer(core, step.Position, step.Elevation, step.ItemID)
	if err != nil {
		return "", err
	}
	message := fmt.Sprintf("item_growth %s @(%d,%d,%d)：tick %d 的 %d → tick %d 的 %d（要求增长 ≥ %d）",
		step.ItemID, step.Position.X, step.Position.Y, step.Elevation, startTick, before, core.CurrentTick(), after, step.Growth)
	if after-before < step.Growth {
		return message, fmt.Errorf("产线没有流动：%s", message)
	}
	return message, nil
}

// buildingItemCountAt 按落点找该玩家的建筑并数它存储里的物品总量
// （主库存 + 输入缓冲 + 输出缓冲，与契约 building_item_at_gte 同口径）。
func buildingItemCountAt(core *gamecore.GameCore, pos model.Position, itemID string) (int, error) {
	return buildingItemCountAtLayer(core, pos, 0, itemID)
}

// buildingItemCountAtLayer 同 buildingItemCountAt，但可以指定高架层（elevation ≥ 1）。
// 高架带不写 TileBuilding，必须按 BeltLayers 找。
func buildingItemCountAtLayer(core *gamecore.GameCore, pos model.Position, elevation int, itemID string) (int, error) {
	if core == nil {
		return 0, fmt.Errorf("没有活动对局")
	}
	for _, ws := range core.Worlds() {
		ws.RLock()
		var building *model.Building
		if elevation > 0 {
			building = ws.Buildings[ws.BeltLayerAt(pos.X, pos.Y, elevation)]
		} else {
			building = ws.Buildings[ws.TileBuilding[model.TileKey(pos.X, pos.Y)]]
		}
		if building != nil && building.HP > 0 {
			count := 0
			if building.Storage != nil {
				count = building.Storage.ItemQuantity(itemID)
			}
			ws.RUnlock()
			return count, nil
		}
		ws.RUnlock()
	}
	if elevation > 0 {
		return 0, fmt.Errorf("(%d,%d) 第 %d 层上没有建筑，无法做 item_growth", pos.X, pos.Y, elevation)
	}
	return 0, fmt.Errorf("(%d,%d) 上没有建筑，无法做 item_growth", pos.X, pos.Y)
}
