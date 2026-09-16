package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func TestRefineryCyclesConsumeSeedAndEmitExactProducts(t *testing.T) {
	for _, tc := range []struct {
		id              string
		inputs, outputs model.ItemInventory
	}{
		{"oil_fractionation", model.ItemInventory{model.ItemCrudeOil: 2}, model.ItemInventory{model.ItemRefinedOil: 2, model.ItemHydrogen: 1}},
		{"xray_cracking", model.ItemInventory{model.ItemRefinedOil: 1, model.ItemHydrogen: 2}, model.ItemInventory{model.ItemHydrogen: 3, model.ItemEnergeticGraphite: 1}},
		{"reformed_refinement", model.ItemInventory{model.ItemRefinedOil: 2, model.ItemHydrogen: 1, model.ItemCoal: 1}, model.ItemInventory{model.ItemRefinedOil: 3}},
	} {
		t.Run(tc.id, func(t *testing.T) {
			ws := model.NewWorldState("planet", 8)
			b := newProductionTestBuilding("refinery", model.BuildingTypeOilRefinery, model.Position{X: 3, Y: 3}, tc.id)
			attachBuilding(ws, b)
			for item, qty := range tc.inputs {
				b.Storage.EnsureInventory()[item] = qty
			}
			settleStorage(ws)
			for item := range tc.inputs {
				if b.IsFeedbackItem(item) {
					if qty, _, err := model.StoragePortOutput(b, "out-main", item, 10); err != nil || qty != 0 {
						t.Fatalf("exported unprocessed seed %s: %d %v", item, qty, err)
					}
				}
			}
			b.Runtime.State = model.BuildingWorkNoPower
			settleProduction(ws)
			if b.Production.RemainingTicks != 0 {
				t.Fatal("started cycle without power")
			}
			b.Runtime.State = model.BuildingWorkRunning
			settleProduction(ws)
			for item := range tc.inputs {
				if qty := availableStorageItem(b.Storage, item); qty != 0 {
					t.Fatalf("input %s not consumed: %d", item, qty)
				}
			}
			duration := b.Production.RemainingTicks
			b.Runtime.State = model.BuildingWorkNoPower
			settleProduction(ws)
			if b.Production.RemainingTicks != duration {
				t.Fatal("unpowered cycle progressed")
			}
			b.Runtime.State = model.BuildingWorkRunning
			for i := 0; i < duration; i++ {
				settleProduction(ws)
				settleStorage(ws)
			}
			for item, want := range tc.outputs {
				if got := b.ExportableItemQuantity(item); got != want {
					t.Fatalf("output %s=%d want %d; storage=%+v", item, got, want, b.Storage)
				}
			}
			for i := 0; i < duration*2; i++ {
				settleProduction(ws)
				settleStorage(ws)
			}
			for item, want := range tc.outputs {
				if got := b.ExportableItemQuantity(item); got != want {
					t.Fatalf("outputs reused as inputs without a return belt: %s=%d want %d", item, got, want)
				}
			}
		})
	}
}

func TestRefineryFeedbackOutputBackpressureIsAtomic(t *testing.T) {
	ws := model.NewWorldState("planet", 8)
	b := newProductionTestBuilding("refinery", model.BuildingTypeOilRefinery, model.Position{X: 3, Y: 3}, "xray_cracking")
	attachBuilding(ws, b)
	b.Storage.Inventory = model.ItemInventory{model.ItemRefinedOil: 1, model.ItemHydrogen: 2}
	settleProduction(ws)
	b.Storage.OutputBuffer = model.ItemInventory{model.ItemHydrogen: b.Storage.OutputBufferCapacity()}
	for i := 0; i < 100; i++ {
		settleProduction(ws)
	}
	if b.Production.RemainingTicks != 0 || len(b.Production.PendingOutputs) == 0 {
		t.Fatal("blocked batch was lost")
	}
	if availableStorageItem(b.Storage, model.ItemEnergeticGraphite) != 0 {
		t.Fatal("partially committed blocked batch")
	}
	b.Storage.OutputBuffer = nil
	settleProduction(ws)
	settleStorage(ws)
	if b.ExportableItemQuantity(model.ItemHydrogen) != 3 || b.ExportableItemQuantity(model.ItemEnergeticGraphite) != 1 {
		t.Fatalf("incorrect resumed batch: %+v", b.Storage)
	}
	if len(b.Production.PendingOutputs) > 0 || len(b.Production.PendingByproducts) > 0 {
		t.Fatal("batch not cleared after commit")
	}
}

func TestRefinerySeparatesOilAndHydrogenOverRepeatedBatches(t *testing.T) {
	ws := model.NewWorldState("planet", 8)
	b := newProductionTestBuilding("refinery", model.BuildingTypeOilRefinery, model.Position{X: 3, Y: 3}, "oil_fractionation")
	input := newConveyorBuilding("input", model.Position{X: 3, Y: 4}, model.ConveyorNorth)
	oil := newConveyorBuilding("oil", model.Position{X: 3, Y: 2}, model.ConveyorNorth)
	hydrogen := newConveyorBuilding("hydrogen", model.Position{X: 2, Y: 3}, model.ConveyorWest)
	for _, building := range []*model.Building{b, input, oil, hydrogen} {
		attachBuilding(ws, building)
	}
	totals := model.ItemInventory{}
	acceptedCrude := 0
	for tick := 0; tick < 800; tick++ {
		if tick < 10 {
			accepted, _, err := input.Conveyor.Insert(model.ItemCrudeOil, 2)
			if err != nil {
				t.Fatal(err)
			}
			acceptedCrude += accepted
		}
		settleBuildingIO(ws)
		settleProduction(ws)
		settleStorage(ws)
		for _, out := range []*model.Building{oil, hydrogen} {
			for _, stack := range out.Conveyor.Take(100) {
				want := model.ItemRefinedOil
				if out == hydrogen {
					want = model.ItemHydrogen
				}
				if stack.ItemID != want {
					t.Fatalf("cross-contaminated %s belt: %+v", out.ID, stack)
				}
				totals[stack.ItemID] += stack.Quantity
			}
		}
	}
	// Input delivery is capped at two batches; account for every accepted item.
	if totals[model.ItemRefinedOil] == 0 || totals[model.ItemRefinedOil] != acceptedCrude || totals[model.ItemRefinedOil] != 2*totals[model.ItemHydrogen] {
		t.Fatalf("unbalanced refining outputs: %+v", totals)
	}
}

func TestRefineryBuildRequiresRecipeResearch(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "plasma_refining")
	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find build tile: %v", err)
	}
	command := model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: pos}, Payload: map[string]any{"building_type": "oil_refinery", "recipe_id": "xray_cracking"}}
	result, _ := core.execBuild(ws, "p1", command)
	if result.Code != model.CodeValidationFailed {
		t.Fatalf("unresearched cracking accepted: %+v", result)
	}
	grantTechs(ws, "p1", "xray_cracking")
	result, _ = core.execBuild(ws, "p1", command)
	if result.Code != model.CodeOK {
		t.Fatalf("researched cracking rejected: %+v", result)
	}
}

func TestRefineryPipelineDoesNotExportUnprocessedSeed(t *testing.T) {
	b := newProductionTestBuilding("refinery", model.BuildingTypeOilRefinery, model.Position{X: 3, Y: 3}, "xray_cracking")
	b.Storage.Inventory = model.ItemInventory{model.ItemHydrogen: 2}
	endpoint := model.PipelineEndpoint{AllowedItems: []string{model.ItemHydrogen}}
	if item := selectOutputFluid(b, endpoint); item != "" {
		t.Fatalf("raw seed selected as pipeline output: %s", item)
	}
	if accepted, _, err := b.Storage.ReceiveOutput(model.ItemHydrogen, 3); err != nil || accepted != 3 {
		t.Fatalf("deposit produced hydrogen: %d %v", accepted, err)
	}
	if item := selectOutputFluid(b, endpoint); item != model.ItemHydrogen {
		t.Fatalf("completed hydrogen not selectable: %s", item)
	}
	if provided, _, err := model.StoragePortOutput(b, "out-main", model.ItemHydrogen, 10); err != nil || provided != 3 {
		t.Fatalf("unexpected export: %d %v", provided, err)
	}
	if got := b.Storage.Inventory[model.ItemHydrogen]; got != 2 {
		t.Fatalf("unprocessed seed was exported: %d", got)
	}
}
