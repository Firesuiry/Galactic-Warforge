package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestAdvancedAssemblersRunAuthoritativeProductionTick(t *testing.T) {
	for _, tc := range []struct {
		building model.BuildingType
		recipe   string
		inputs   model.ItemInventory
		output   string
	}{
		{model.BuildingTypeAssemblingMachineMk2, "motor", model.ItemInventory{model.ItemGear: 1, model.ItemCircuitBoard: 1, model.ItemIronIngot: 1}, model.ItemMotor},
		{model.BuildingTypeAssemblingMachineMk3, "motor", model.ItemInventory{model.ItemGear: 1, model.ItemCircuitBoard: 1, model.ItemIronIngot: 1}, model.ItemMotor},
		{model.BuildingTypeAssemblingMachineMk2, "plasma_capsule", model.ItemInventory{model.ItemTitaniumAlloy: 1, model.ItemParticleContainer: 1, model.ItemHydrogen: 2}, model.ItemPlasmaCapsule},
	} {
		t.Run(string(tc.building)+"/"+tc.recipe, func(t *testing.T) {
			ws := model.NewWorldState("planet-advanced", 12)
			b := newProductionTestBuilding("advanced", tc.building, model.Position{X: 3, Y: 3}, tc.recipe)
			attachBuilding(ws, b)
			for item, quantity := range tc.inputs {
				b.Storage.EnsureInventory()[item] = quantity
			}
			settleProduction(ws)
			if b.Production.RemainingTicks <= 0 {
				t.Fatalf("%s did not start %s", tc.building, tc.recipe)
			}
			b.Runtime.State = model.BuildingWorkNoPower
			remaining := b.Production.RemainingTicks
			settleProduction(ws)
			if b.Production.RemainingTicks != remaining {
				t.Fatalf("unpowered %s progressed from %d to %d", tc.building, remaining, b.Production.RemainingTicks)
			}
			b.Runtime.State = model.BuildingWorkRunning
			for i := 0; i < remaining; i++ {
				settleProduction(ws)
				settleStorage(ws)
			}
			if got := b.ExportableItemQuantity(tc.output); got != 1 {
				t.Fatalf("%s output %s=%d, storage=%+v", tc.building, tc.output, got, b.Storage)
			}
		})
	}
}

// Exercise the real belt IO + production + storage phases, including a blocked
// output. Higher tiers must consume the same material per product, faster.
//
// 产出落点语义（试玩 1015 理顺）：成品只落「输出缓冲 → 主库存产出预留段」，
// 原料只落「输入缓冲 → 主库存非预留段」。因此这里把下游堵死的方式是占满输出缓冲
// 与预留段（fillProductLandingSpots），而不是往输入缓冲里塞占位料。
func TestAssemblerTiersBeltIOPowerAndBackpressure(t *testing.T) {
	for _, tc := range []struct {
		kind     model.BuildingType
		duration int
	}{
		{model.BuildingTypeAssemblingMachineMk1, 20},
		{model.BuildingTypeAssemblingMachineMk2, 10},
		{model.BuildingTypeAssemblingMachineMk3, 7},
	} {
		t.Run(string(tc.kind), func(t *testing.T) {
			ws := model.NewWorldState("planet", 12)
			// 细分网格：制造台 3×3（x3..5,y3..5）。第 16 轮契约 §3 起制造台不再与
			// 皮带直连：进料「带 (1,4) → 分拣器 (2,4)（背西面东）→ 占地 (3,4)」，
			// 出货「分拣器 (6,4)（背西面东）→ 带 (7,4)」。
			b := newProductionTestBuilding("assembler", tc.kind, model.Position{X: 3, Y: 3}, "gear")
			input := newConveyorBuilding("input", model.Position{X: 1, Y: 4}, model.ConveyorEast)
			feeder := newSorterBuilding("feeder", model.Position{X: 2, Y: 4})
			feeder.Sorter.Range = 2
			feeder.Sorter.CycleTicks = 1
			output := newConveyorBuilding("output", model.Position{X: 7, Y: 4}, model.ConveyorEast)
			drain := newSorterBuilding("drain", model.Position{X: 6, Y: 4})
			drain.Sorter.Range = 2
			drain.Sorter.CycleTicks = 1
			drain.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: []string{model.ItemGear}}
			for _, building := range []*model.Building{b, input, feeder, output, drain} {
				attachBuilding(ws, building)
			}
			input.Conveyor.Insert(model.ItemIronIngot, 1)
			settleSorters(ws)
			settleProduction(ws)
			if input.Conveyor.TotalItems() != 0 || availableStorageItem(b.Storage, model.ItemIronIngot) != 0 || b.Production.RemainingTicks != tc.duration {
				t.Fatalf("input not consumed once at tier speed: input=%d storage=%+v production=%+v", input.Conveyor.TotalItems(), b.Storage, b.Production)
			}
			b.Runtime.State = model.BuildingWorkNoPower
			for i := 0; i < 5; i++ {
				ws.Tick++
				settleProduction(ws)
			}
			if b.Production.RemainingTicks != tc.duration {
				t.Fatal("no_power advanced production")
			}
			b.Runtime.State = model.BuildingWorkRunning
			// Block every product landing spot (output buffer + output reserve) and
			// fill the output belt, then run past the cycle time. The invariant is
			// conservation: the batch stays pending and no extra gear appears.
			fillProductLandingSpots(b.Storage, model.ItemGear)
			output.Conveyor.Insert(model.ItemGear, output.Conveyor.AvailableCapacity())
			storedBefore := b.ExportableItemQuantity(model.ItemGear)
			for i := 0; i <= tc.duration+3; i++ {
				ws.Tick++
				settleProduction(ws)
				settleStorage(ws)
				settleSorters(ws)
			}
			if len(b.Production.PendingOutputs) != 1 || b.Production.RemainingTicks != 0 || b.ExportableItemQuantity(model.ItemGear) != storedBefore {
				t.Fatalf("blocked production lost or duplicated its pending output: %+v %+v", b.Production, b.Storage)
			}
			drainProductLandingSpots(b.Storage, model.ItemGear)
			output.Conveyor.Take(output.Conveyor.TotalItems())
			drain.Sorter.NextTripTick = 0
			settleProduction(ws)
			settleStorage(ws)
			settleSorters(ws)
			if output.Conveyor.TotalItems() != 1 || output.Conveyor.Buffer[0].ItemID != model.ItemGear || len(b.Production.PendingOutputs) != 0 {
				t.Fatalf("unblocking must export exactly one gear: %+v %+v", output.Conveyor, b.Production)
			}
			for i := 0; i < tc.duration+2; i++ {
				ws.Tick++
				settleProduction(ws)
				settleStorage(ws)
				settleSorters(ws)
			}
			if output.Conveyor.TotalItems() != 1 {
				t.Fatal("empty input created extra output")
			}
		})
	}
}
