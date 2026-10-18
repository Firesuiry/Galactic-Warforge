package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 16 轮契约 §2 的补充用例：一条传送带路过三台机器、各自的分拣器都能取到货；
// 三级分拣器的节拍与目录一致；退货辅助在预览/提交不一致时保住货物。

// 一条带子从三台熔炉旁边路过，每台熔炉配一台自己的分拣器：三台都要吃到料。
// （DSP 里这就是「一条主带供多个车间」的最基本形态。）
func TestSorterFeedsThreeSmeltersOnOneBelt(t *testing.T) {
	ws := model.NewWorldState("planet-1", 20)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 熔炉 3×3 占地 y8..10；分拣器在 (x,11) 朝向 0°（背面南=带子、正面北=熔炉）；
	// 主带在 y12 一路向东。
	smelters := make([]*model.Building, 0, 3)
	for i, anchorX := range []int{1, 5, 9} {
		smelter := newProductionTestBuilding("smelter", model.BuildingTypeArcSmelter, model.Position{X: anchorX, Y: 8}, "smelt_iron")
		smelter.ID = "smelter-" + string(rune('a'+i))
		sorter := newSorterBuilding("feeder-"+string(rune('a'+i)), model.Position{X: anchorX + 1, Y: 11})
		sorter.Rotation = model.PlanRotation0
		sorter.Sorter.Range = 1
		sorter.Sorter.CycleTicks = 1
		attachBuilding(ws, smelter)
		attachBuilding(ws, sorter)
		smelters = append(smelters, smelter)
	}
	belts := make([]*model.Building, 0, 14)
	for x := 0; x <= 13; x++ {
		belt := newConveyorBuilding("belt-"+string(rune('a'+x)), model.Position{X: x, Y: 12}, model.ConveyorEast)
		attachBuilding(ws, belt)
		belts = append(belts, belt)
	}

	for tick := 0; tick < 1200; tick++ {
		ws.Tick++
		if head := belts[0]; head.Conveyor.TotalItems() < 4 {
			if _, _, err := head.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
				t.Fatalf("tick %d: insert ore: %v", tick, err)
			}
		}
		settleConveyors(ws)
		settleSorters(ws)
		settleProduction(ws)
		settleStorage(ws)
	}

	for _, smelter := range smelters {
		if got := smelter.ExportableItemQuantity(model.ItemIronIngot); got == 0 {
			t.Fatalf("熔炉 %s 没被分拣器喂到料：storage=%+v", smelter.ID, smelter.Storage)
		}
	}
}

// 三级分拣器的 cycle_ticks / range 与目录一致（第 19 轮起所有档位都能跨 3 格），
// 且吞吐与 cycle_ticks 成反比。
func TestSorterTierCycleTicksMatchCatalog(t *testing.T) {
	for _, tc := range []struct {
		btype      model.BuildingType
		cycleTicks int
		reach      int
	}{
		{model.BuildingTypeSorterMk1, 6, 3},
		{model.BuildingTypeSorterMk2, 3, 3},
		{model.BuildingTypeSorterMk3, 2, 3},
		{model.BuildingTypePileSorter, 2, 3},
	} {
		t.Run(string(tc.btype), func(t *testing.T) {
			sorter := newSorterBuilding("sorter", model.Position{X: 1, Y: 2})
			sorter.Type = tc.btype
			sorter.Runtime = model.BuildingProfileFor(tc.btype, 1).Runtime
			model.InitBuildingSorter(sorter)
			sorter.Runtime.State = model.BuildingWorkRunning
			if sorter.Sorter.CycleTicks != tc.cycleTicks || sorter.Sorter.Range != tc.reach {
				t.Fatalf("%s: cycle_ticks=%d range=%d, want %d/%d", tc.btype, sorter.Sorter.CycleTicks, sorter.Sorter.Range, tc.cycleTicks, tc.reach)
			}
		})
	}

	// 同一布局（两端点各距 1 格 → 往返长度 1）：mk1 周期 6 tick，mk2 周期 3 tick，
	// 120 tick 窗口里 mk2 的搬运次数正好是 mk1 的两倍。
	trips := func(btype model.BuildingType) int {
		ws := model.NewWorldState("planet-1", 6)
		ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
		input := newConveyorBuilding("in", model.Position{X: 1, Y: 2}, model.ConveyorEast)
		output := newConveyorBuilding("out", model.Position{X: 3, Y: 2}, model.ConveyorEast)
		sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 2})
		sorter.Type = btype
		sorter.Runtime = model.BuildingProfileFor(btype, 1).Runtime
		model.InitBuildingSorter(sorter)
		sorter.Runtime.State = model.BuildingWorkRunning
		for _, b := range []*model.Building{input, output, sorter} {
			attachBuilding(ws, b)
		}
		// 带子容量按 MaxStack 计，先放大再装够 200 件，否则 10 件就见底了。
		input.Conveyor.MaxStack = 300
		input.Conveyor.Insert(model.ItemIronOre, 200)
		moved := 0
		for tick := int64(0); tick <= 120; tick++ {
			ws.Tick = tick
			settleSorters(ws)
			// 输出带容量有限，每 tick 清空，避免背压掩盖节拍差异。
			moved += countStacks(output.Conveyor.Take(output.Conveyor.TotalItems()))
		}
		return moved
	}
	// tick 0 起可搬：mk1 周期 6 → tick 0/6/…/120 共 21 次；mk2 周期 3 → 41 次。
	mk1, mk2 := trips(model.BuildingTypeSorterMk1), trips(model.BuildingTypeSorterMk2)
	if mk1 != 21 || mk2 != 41 {
		t.Fatalf("120 tick 内 mk1 搬运 %d 次、mk2 搬运 %d 次，want 21 / 41（周期 6 / 3）", mk1, mk2)
	}
}

// returnSourceItems 是「预览/提交不一致」时的兜底：货物必须原样退回来源，
// 一条都不能丢（契约 §2 要求跳过本次搬运并记日志，而不是 panic）。
func TestSorterReturnSourceItemsKeepsCargo(t *testing.T) {
	t.Run("belt", func(t *testing.T) {
		ws := model.NewWorldState("planet-1", 4)
		ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
		belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 1}, model.ConveyorEast)
		attachBuilding(ws, belt)
		cargo := []model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 3}}
		returnSourceItems(belt, "", cargo, 2)
		if got := belt.Conveyor.TotalItems(); got != 2 {
			t.Fatalf("退货后带子上应剩 2 件，got %d", got)
		}
	})
	t.Run("storage", func(t *testing.T) {
		ws := model.NewWorldState("planet-1", 4)
		ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
		pump := newWaterPumpBuilding("pump", model.Position{X: 0, Y: 0})
		attachBuilding(ws, pump)
		cargo := []model.ItemStack{{ItemID: model.ItemWater, Quantity: 3}}
		returnSourceItems(pump, "out-0", cargo, 3)
		if got := pump.Storage.OutputQuantity(model.ItemWater); got != 3 {
			t.Fatalf("退货后采集建筑输出应回到 3，got %d", got)
		}
	})
	t.Run("nothing_to_return", func(t *testing.T) {
		returnSourceItems(nil, "", nil, 0)
	})
}

// 目标建筑（非皮带）收不下时：分拣器不搬、不推进周期、不记 transfer，也不 panic。
func TestSorterSkipsBlockedStorageTargetWithoutLosingCargo(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 1}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 1})
	depot := newDepotBuilding("depot", model.Position{X: 3, Y: 1})
	depot.Storage = model.NewStorageState(model.StorageModule{Capacity: 2, Slots: 1})
	if accepted, _, err := depot.Storage.Load(model.ItemIronOre, 2); err != nil || accepted != 2 {
		t.Fatalf("preload depot: %d %v", accepted, err)
	}
	for _, b := range []*model.Building{belt, sorter, depot} {
		attachBuilding(ws, b)
	}
	if _, _, err := belt.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert belt: %v", err)
	}
	ws.Tick = 5
	settleSorters(ws)
	if sorter.Sorter.LastTransfer != nil || sorter.Sorter.NextTripTick != 0 {
		t.Fatalf("被拒绝的搬运不该记账或消耗周期：%+v next=%d", sorter.Sorter.LastTransfer, sorter.Sorter.NextTripTick)
	}
	if got := belt.Conveyor.TotalItems(); got != 3 {
		t.Fatalf("货物必须留在带子上，got %d", got)
	}
	if got := depot.Storage.ItemQuantity(model.ItemIronOre); got != 2 {
		t.Fatalf("仓库不该多收，got %d", got)
	}
}
