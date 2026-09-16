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
		{model.BuildingTypeAssemblingMachineMk2, "prototype", model.ItemInventory{model.ItemCircuitBoard: 2, model.ItemProcessor: 1, model.ItemTitaniumAlloy: 1}, model.ItemPrototype},
		{model.BuildingTypeAssemblingMachineMk3, "precision_drone", model.ItemInventory{model.ItemPrototype: 1, model.ItemQuantumChip: 1, model.ItemDeuteriumFuelRod: 1}, model.ItemPrecisionDrone},
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
			b := newProductionTestBuilding("assembler", tc.kind, model.Position{X: 3, Y: 3}, "gear")
			input := newConveyorBuilding("input", model.Position{X: 2, Y: 3}, model.ConveyorEast)
			output := newConveyorBuilding("output", model.Position{X: 4, Y: 3}, model.ConveyorEast)
			for _, building := range []*model.Building{b, input, output} {
				attachBuilding(ws, building)
			}
			input.Conveyor.Insert(model.ItemIronIngot, 1)
			settleBuildingIO(ws)
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
			// Fill every output destination after inputs have been consumed.
			b.Storage.EnsureInventory()[model.ItemStoneOre] = b.Storage.Capacity
			b.Storage.EnsureInputBuffer()[model.ItemStoneOre] = b.Storage.InputBufferCapacity()
			output.Conveyor.Insert(model.ItemGear, output.Conveyor.AvailableCapacity())
			for i := 0; i <= tc.duration+3; i++ {
				ws.Tick++
				settleProduction(ws)
				settleStorage(ws)
				settleBuildingIO(ws)
			}
			if len(b.Production.PendingOutputs) != 1 || b.Production.RemainingTicks != 0 || b.ExportableItemQuantity(model.ItemGear) != 0 {
				t.Fatalf("blocked production lost or duplicated its pending output: %+v %+v", b.Production, b.Storage)
			}
			delete(b.Storage.Inventory, model.ItemStoneOre)
			delete(b.Storage.InputBuffer, model.ItemStoneOre)
			delete(b.Storage.OutputBuffer, model.ItemStoneOre)
			output.Conveyor.Take(output.Conveyor.TotalItems())
			settleProduction(ws)
			settleStorage(ws)
			settleBuildingIO(ws)
			if output.Conveyor.TotalItems() != 1 || output.Conveyor.Buffer[0].ItemID != model.ItemGear || len(b.Production.PendingOutputs) != 0 {
				t.Fatalf("unblocking must export exactly one gear: %+v %+v", output.Conveyor, b.Production)
			}
			for i := 0; i < tc.duration+2; i++ {
				settleProduction(ws)
				settleStorage(ws)
				settleBuildingIO(ws)
			}
			if output.Conveyor.TotalItems() != 1 {
				t.Fatal("empty input created extra output")
			}
		})
	}
}
