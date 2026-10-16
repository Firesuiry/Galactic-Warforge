package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 16 轮契约 §3 起，生产建筑不再和皮带直连：输入只能经分拣器（分拣器只放
// 「当前配方需要、且输入缓冲没满」的物品，见 model.StoragePortPreviewInput 的
// applyProductionInputLimit）。这些用例改成「带 → 分拣器 → 机器」的真实布局。

func TestSettleStorageProductionBuildingKeepsOnlyRecipeOutputsInOutputBuffer(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 3, Y: 3}, "sulfuric_acid")
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

func TestSorterFeedsProductionBuildingOnlyRecipeInputs(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 化工厂 3×3（x4..6,y4..6）。分拣器 (2,5) 朝向 90°（背面西、正面东），Range 2：
	// 背面扫到 (1,5) 的带子取货，正面扫过空的环格 (3,5) 落进化工厂占地 (4,5)。
	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 4, Y: 4}, "sulfuric_acid")
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 5}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 5})
	sorter.Sorter.Range = 2
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)
	attachBuilding(ws, plant)

	// 带子上先放一种配方不需要的物品（铁矿），分拣器不得把它塞进机器。
	if _, _, err := belt.Conveyor.Insert(model.ItemIronOre, 4); err != nil {
		t.Fatalf("insert iron ore: %v", err)
	}

	settleSorters(ws)

	if got := currentProductionInputQuantity(plant, model.ItemIronOre); got != 0 {
		t.Fatalf("分拣器不得把配方不需要的物品放进机器，got %d", got)
	}
	if got := belt.Conveyor.TotalItems(); got != 4 {
		t.Fatalf("expected belt unchanged, got %d", got)
	}
}

func TestSorterFeedsProductionBuildingStopsWhenInputBufferFull(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 4, Y: 4}, "sulfuric_acid")
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 5}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 5})
	sorter.Sorter.Range = 2
	sorter.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: []string{model.ItemWater}}
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)
	attachBuilding(ws, plant)

	// 输入缓冲已满：分拣器不该再往机器里塞水（applyProductionInputLimit 的上限）。
	plant.Storage.Inventory = model.ItemInventory{model.ItemWater: 8}
	if _, _, err := belt.Conveyor.Insert(model.ItemWater, 4); err != nil {
		t.Fatalf("insert water: %v", err)
	}

	for tick := 0; tick < 40; tick++ {
		ws.Tick++
		settleSorters(ws)
	}

	if got := currentProductionInputQuantity(plant, model.ItemWater); got != 8 {
		t.Fatalf("输入缓冲满时不得继续进货，water = %d, want 8", got)
	}
	if got := belt.Conveyor.TotalItems(); got != 4 {
		t.Fatalf("expected belt unchanged, got %d", got)
	}
}

func TestSorterFeedsProductionBuildingRecipeInputs(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	plant := newProductionTestBuilding("plant", model.BuildingTypeChemicalPlant, model.Position{X: 4, Y: 4}, "sulfuric_acid")
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 5}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 5})
	sorter.Sorter.Range = 2
	sorter.Sorter.CycleTicks = 1
	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)
	attachBuilding(ws, plant)

	if _, _, err := belt.Conveyor.Insert(model.ItemWater, 4); err != nil {
		t.Fatalf("insert water: %v", err)
	}

	for tick := 0; tick < 8; tick++ {
		ws.Tick++
		settleSorters(ws)
	}

	if got := currentProductionInputQuantity(plant, model.ItemWater); got == 0 {
		t.Fatalf("分拣器未把配方需要的水送进机器，storage=%+v", plant.Storage)
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

func currentProductionInputQuantity(building *model.Building, itemID string) int {
	if building == nil || building.Storage == nil || itemID == "" {
		return 0
	}
	return currentStorageItem(building.Storage.InputBuffer, itemID) + currentStorageItem(building.Storage.Inventory, itemID)
}
