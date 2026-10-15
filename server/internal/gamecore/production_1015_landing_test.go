package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1015 回归 1：上游皮带持续送料 + 下游慢速取货（等价于 pace_output=2 的
// 慢分拣/慢皮带）时，生产建筑不能永久卡在 output_blocked。
//
// 旧实现把成品经 Receive 落进「输入缓冲 → 主库存」，成品与原料互相占位：
// 熔炉表面 state=running，输入缓冲被铁块塞满、每 tick storeProductionOutputs
// 失败，矿机送来的铁矿再也进不来，产量永久停在 0（试玩实测：
// inventory{iron_ore:23} + input_buffer{iron_ingot:5} + output_buffer{} +
// pending_outputs[{iron_ingot:1}]）。
//
// 修法：成品只落「输出缓冲 → 主库存产出预留段」，原料只落「输入缓冲 →
// 主库存非预留段」，两条通道互不挤占。本测试锁住这条不变量：
//   - 任何时刻输入缓冲里都不会出现成品；
//   - 下游慢速取货时产量仍持续增长；
//   - output_blocked 只会短暂出现（下游一取货就恢复），不会永久阻塞。
func TestProductionKeepsGrowingWithBeltFeedAndSlowDownstreamPickup(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 熔炉 3×3（x3..5,y3..5）。第 16 轮契约 §3 起熔炉不再与皮带直连：
	// 进料「带 (1,4) → 分拣器 (2,4)（背西面东）→ 占地 (3,4)」，
	// 出货「分拣器 (6,4)（背西面东）→ 带 (7,4)」。
	furnace := newProductionTestBuilding("furnace", model.BuildingTypeArcSmelter, model.Position{X: 3, Y: 3}, "smelt_iron")
	input := newConveyorBuilding("input", model.Position{X: 1, Y: 4}, model.ConveyorEast)
	feeder := newSorterBuilding("feeder", model.Position{X: 2, Y: 4})
	feeder.Sorter.Range = 2
	feeder.Sorter.CycleTicks = 1
	output := newConveyorBuilding("output", model.Position{X: 7, Y: 4}, model.ConveyorEast)
	drain := newSorterBuilding("drain", model.Position{X: 6, Y: 4})
	drain.Sorter.Range = 2
	drain.Sorter.CycleTicks = 1
	drain.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: []string{model.ItemIronIngot}}
	for _, b := range []*model.Building{furnace, input, feeder, output, drain} {
		attachBuilding(ws, b)
	}
	// 输出带容量有限（等价于「下游取货慢」）：只在有空位时才被取走。
	output.Conveyor.MaxStack = 4

	const (
		ticks = 3000
		// 熔炉 smelt_iron 一批 60 tick（本测试不缩放 pace_output），下游每 60 tick
		// 才取 1 个铁块——与产量同速，是最容易「堆满落点后永久阻塞」的节奏。
		pickupPeriod = 60
	)
	produced := 0
	blockedRun := 0
	worstBlockedRun := 0
	for tick := 0; tick < ticks; tick++ {
		ws.Tick++
		// 上游：皮带持续送铁矿（留 1 个给下一 tick，避免无限堆料）。
		if input.Conveyor.TotalItems() < 2 {
			if _, _, err := input.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
				t.Fatalf("tick %d: insert ore: %v", tick, err)
			}
		}
		// 下游：慢速取货。
		if tick%pickupPeriod == 0 {
			produced += countStacks(output.Conveyor.Take(output.Conveyor.TotalItems()))
		}

		settleSorters(ws)
		settleProduction(ws)
		settleStorage(ws)

		if got := furnace.Storage.InputBuffer[model.ItemIronIngot]; got > 0 {
			t.Fatalf("tick %d: finished iron ingots landed in the input buffer (%d): 成品必须只走输出缓冲与产出预留段",
				tick, got)
		}
		if furnace.Runtime.StateReason == stateReasonOutputBlocked {
			blockedRun++
			if blockedRun > worstBlockedRun {
				worstBlockedRun = blockedRun
			}
		} else {
			blockedRun = 0
		}
	}

	produced += countStacks(output.Conveyor.Take(output.Conveyor.TotalItems()))
	inMachine := furnace.ExportableItemQuantity(model.ItemIronIngot)
	// 3000 tick / 60 tick 一批 ≈ 50 个；落点共 5 处（输出缓冲 4 + 预留 1），
	// 允许最多 5 批还压在机器里没被取走。
	if produced < ticks/pickupPeriod-6 {
		t.Fatalf("慢速下游下熔炉产量停滞：3000 tick 只取走 %d 个铁块（机器内 %d 个），期望至少 %d 个",
			produced, inMachine, ticks/pickupPeriod-6)
	}
	// output_blocked 只允许短暂出现：落点被占满后，下游下一轮取货（≤ 5 批 ×
	// pickupPeriod）就该恢复。旧实现是「永久阻塞」——成品挤占输入缓冲后
	// 每 tick storeProductionOutputs 都失败，产量永久为 0。
	if worstBlockedRun > 6*pickupPeriod {
		t.Fatalf("熔炉连续 %d tick 停在 output_blocked（下游每 %d tick 取一次货），说明产出落点被原料挤占",
			worstBlockedRun, pickupPeriod)
	}
}
