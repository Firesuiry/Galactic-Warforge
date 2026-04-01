package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestSettleStorageProductionBuildingKeepsOnlyRecipeOutputsInOutputBuffer(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 1, Y: 1}, "sulfuric_acid")
	plant.Storage.Inventory = model.ItemInventory{
		model.ItemStoneOre:     3,
		model.ItemSulfuricAcid: 2,
	}
	attachBuilding(ws, plant)

	settleStorage(ws)

	if got := plant.Storage.OutputQuantity(model.ItemStoneOre); got != 3 {
		t.Fatalf("expected stone ore to stay in inventory only, total available=%d", got)
	}
	if got := currentStorageItem(plant.Storage.OutputBuffer, model.ItemStoneOre); got != 0 {
		t.Fatalf("expected stone ore output buffer to stay empty, got %d", got)
	}
	if got := currentStorageItem(plant.Storage.OutputBuffer, model.ItemSulfuricAcid); got == 0 {
		t.Fatal("expected sulfuric acid to refill output buffer")
	}
}

func TestBuildingIOProductionInputSelectionBalancesRecipeNeeds(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5, 5)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 2, Y: 2}, "sulfuric_acid")
	north := newConveyorBuilding("north", model.Position{X: 2, Y: 1}, model.ConveyorSouth)
	east := newConveyorBuilding("east", model.Position{X: 3, Y: 2}, model.ConveyorWest)
	south := newConveyorBuilding("south", model.Position{X: 2, Y: 3}, model.ConveyorNorth)
	west := newConveyorBuilding("west", model.Position{X: 1, Y: 2}, model.ConveyorWest)
	depot := newDepotBuilding("depot", model.Position{X: 0, Y: 2})

	attachBuilding(ws, depot)
	attachBuilding(ws, west)
	attachBuilding(ws, north)
	attachBuilding(ws, east)
	attachBuilding(ws, south)
	attachBuilding(ws, plant)

	if _, _, err := north.Conveyor.Insert(model.ItemStoneOre, 8); err != nil {
		t.Fatalf("insert stone: %v", err)
	}
	if _, _, err := east.Conveyor.Insert(model.ItemWater, 8); err != nil {
		t.Fatalf("insert water: %v", err)
	}
	if _, _, err := south.Conveyor.Insert(model.ItemRefinedOil, 8); err != nil {
		t.Fatalf("insert refined oil: %v", err)
	}

	for i := 0; i < 4; i++ {
		settleBuildingIO(ws)
		settleStorage(ws)
	}

	recipe, ok := model.Recipe("sulfuric_acid")
	if !ok {
		t.Fatal("sulfuric acid recipe missing")
	}
	if _, ok := collectRecipeInputs(plant.Storage, recipe); !ok {
		t.Fatalf("expected plant to have complete recipe inputs, storage=%+v", plant.Storage)
	}
	if got := depot.Storage.OutputQuantity(model.ItemStoneOre); got != 0 {
		t.Fatalf("expected no raw stone export while gathering inputs, got %d", got)
	}
	if got := west.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected west output belt to stay empty, got %d", got)
	}
}

func TestBuildingIOProductionInputSelectionCanPullNeededItemBehindMixedFrontStack(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5, 5)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 2, Y: 2}, "sulfuric_acid")
	east := newConveyorBuilding("east", model.Position{X: 3, Y: 2}, model.ConveyorWest)
	south := newConveyorBuilding("south", model.Position{X: 2, Y: 3}, model.ConveyorNorth)

	attachBuilding(ws, east)
	attachBuilding(ws, south)
	attachBuilding(ws, plant)

	plant.Storage.Inventory = model.ItemInventory{
		model.ItemStoneOre: 1,
	}
	east.Conveyor.MaxStack = 8
	if _, _, err := east.Conveyor.Insert(model.ItemStoneOre, 1); err != nil {
		t.Fatalf("insert stone: %v", err)
	}
	if _, _, err := east.Conveyor.Insert(model.ItemWater, 1); err != nil {
		t.Fatalf("insert water: %v", err)
	}
	if _, _, err := south.Conveyor.Insert(model.ItemRefinedOil, 2); err != nil {
		t.Fatalf("insert refined oil: %v", err)
	}

	settleBuildingIO(ws)

	if got := currentProductionInputQuantity(plant, model.ItemWater); got != 1 {
		t.Fatalf("expected plant to pull trailing water from mixed conveyor, got %d", got)
	}
	if len(east.Conveyor.Buffer) == 0 || east.Conveyor.Buffer[0].ItemID != model.ItemStoneOre {
		t.Fatalf("expected front stone stack to remain on east conveyor, got %+v", east.Conveyor.Buffer)
	}
}

func TestBuildingIOProductionBuildingDoesNotExportRecipeInputsAlreadyInOutputBuffer(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 1, Y: 1}, "sulfuric_acid")
	plant.Storage.OutputBuffer = model.ItemInventory{model.ItemStoneOre: 2}
	west := newConveyorBuilding("west", model.Position{X: 0, Y: 1}, model.ConveyorWest)

	attachBuilding(ws, west)
	attachBuilding(ws, plant)

	settleBuildingIO(ws)
	settleStorage(ws)

	if got := west.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected west belt to ignore stale recipe inputs, got %d", got)
	}
	if got := currentStorageItem(plant.Storage.OutputBuffer, model.ItemStoneOre); got != 0 {
		t.Fatalf("expected stale recipe input to be cleaned from output buffer, got %d", got)
	}
	if got := currentStorageItem(plant.Storage.Inventory, model.ItemStoneOre); got != 2 {
		t.Fatalf("expected cleaned stone ore to return to inventory, got %d", got)
	}
}

func TestBuildingIOProductionInputCapLeavesRoomForOutputsAndByproducts(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	assembler := newProductionTestBuilding("assembler", model.BuildingTypeAssemblingMachineMk1, model.Position{X: 1, Y: 1}, "oil_fractionation")
	south := newConveyorBuilding("south", model.Position{X: 1, Y: 2}, model.ConveyorNorth)
	south.Conveyor.MaxStack = 32

	attachBuilding(ws, south)
	attachBuilding(ws, assembler)

	if _, _, err := south.Conveyor.Insert(model.ItemCrudeOil, 20); err != nil {
		t.Fatalf("insert crude oil: %v", err)
	}

	for i := 0; i < 200; i++ {
		settleBuildingIO(ws)
		settleProduction(ws)
		settleStorage(ws)
	}

	totalCrudeOil := currentStorageItem(assembler.Storage.InputBuffer, model.ItemCrudeOil) +
		currentStorageItem(assembler.Storage.Inventory, model.ItemCrudeOil)
	if totalCrudeOil > 4 {
		t.Fatalf("expected crude oil buffered at or below 4, got %d", totalCrudeOil)
	}
	if got := assembler.Storage.OutputQuantity(model.ItemRefinedOil); got == 0 {
		t.Fatal("expected refined oil to be stored")
	}
}

func newProductionTestBuilding(id string, btype model.BuildingType, pos model.Position, recipeID string) *model.Building {
	profile := model.BuildingProfileFor(btype, 1)
	b := &model.Building{
		ID:          id,
		Type:        btype,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
		Production:  &model.ProductionState{RecipeID: recipeID, Mode: model.BonusModeSpeed},
	}
	model.InitBuildingStorage(b)
	b.Runtime.State = model.BuildingWorkRunning
	b.Runtime.Params.EnergyConsume = 0
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	return b
}
