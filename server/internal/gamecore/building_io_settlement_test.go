package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestBuildingIOInputFromConveyor(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 1, Y: 0})
	belt := newConveyorBuilding("belt", model.Position{X: 0, Y: 0}, model.ConveyorEast)

	attachBuilding(ws, belt)
	attachBuilding(ws, depot)

	if _, _, err := belt.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleBuildingIO(ws)

	if got := belt.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected belt items 1, got %d", got)
	}
	if got := depot.Storage.UsedInputBuffer(); got != 2 {
		t.Fatalf("expected input buffer 2, got %d", got)
	}
}

func TestBuildingIOInputToEMRailEjector(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	ejector := newEMRailEjectorBuilding("ejector", model.Position{X: 1, Y: 0}, "p1")
	belt := newConveyorBuilding("belt", model.Position{X: 0, Y: 0}, model.ConveyorEast)

	attachBuilding(ws, belt)
	attachBuilding(ws, ejector)

	if _, _, err := belt.Conveyor.Insert(model.ItemSolarSail, 3); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleBuildingIO(ws)

	if got := belt.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected belt items 1, got %d", got)
	}
	if got := ejector.Storage.UsedInputBuffer(); got != 2 {
		t.Fatalf("expected ejector input buffer 2, got %d", got)
	}
}

func TestBuildingIOOutputToConveyor(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 0, Y: 0})
	// 细分网格：仓库占地 3×3（x0..2,y0..2），输出带必须落在占地外圈且方向背离仓库。
	belt := newConveyorBuilding("belt", model.Position{X: 3, Y: 0}, model.ConveyorEast)
	belt.Conveyor.MaxStack = 1

	attachBuilding(ws, depot)
	attachBuilding(ws, belt)

	if _, _, err := depot.Storage.Receive(model.ItemIronOre, 2); err != nil {
		t.Fatalf("receive error: %v", err)
	}
	depot.Storage.Tick()

	before := totalStorageItems(depot.Storage)
	settleBuildingIO(ws)
	after := totalStorageItems(depot.Storage)

	if got := belt.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected belt items 1, got %d", got)
	}
	if before-after != 1 {
		t.Fatalf("expected storage decrease 1, got %d", before-after)
	}
}

func TestBuildingIOInputRollbackOnFullStorage(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 1, Y: 0})
	depot.Storage = model.NewStorageState(model.StorageModule{
		Capacity:       1,
		Slots:          1,
		Buffer:         0,
		InputPriority:  1,
		OutputPriority: 1,
	})
	if _, _, err := depot.Storage.Receive(model.ItemIronOre, 1); err != nil {
		t.Fatalf("receive error: %v", err)
	}

	belt := newConveyorBuilding("belt", model.Position{X: 0, Y: 0}, model.ConveyorEast)
	attachBuilding(ws, belt)
	attachBuilding(ws, depot)

	if _, _, err := belt.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleBuildingIO(ws)

	if got := belt.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected belt items 1, got %d", got)
	}
	if got := totalStorageItems(depot.Storage); got != 1 {
		t.Fatalf("expected storage items 1, got %d", got)
	}
}

func TestBuildingIOOutputRollbackOnBlockedConveyor(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 0, Y: 0})
	belt := newConveyorBuilding("belt", model.Position{X: 3, Y: 0}, model.ConveyorEast)
	belt.Conveyor.MaxStack = 1

	attachBuilding(ws, depot)
	attachBuilding(ws, belt)

	if _, _, err := depot.Storage.Receive(model.ItemIronOre, 1); err != nil {
		t.Fatalf("receive error: %v", err)
	}
	depot.Storage.Tick()

	if _, _, err := belt.Conveyor.Insert(model.ItemCopperOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	before := totalStorageItems(depot.Storage)
	settleBuildingIO(ws)
	after := totalStorageItems(depot.Storage)

	if got := belt.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected belt items 1, got %d", got)
	}
	if before != after {
		t.Fatalf("expected storage unchanged, got %d -> %d", before, after)
	}
}

func TestBuildingIOOutputPrefersNonDuplicateConveyorTarget(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	profile := model.BuildingProfileFor(model.BuildingTypeWaterPump, 1)
	pump := &model.Building{
		ID:          "pump",
		Type:        model.BuildingTypeWaterPump,
		OwnerID:     "p1",
		Position:    model.Position{X: 3, Y: 3},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(pump)
	pump.Storage.OutputBuffer = model.ItemInventory{
		model.ItemWater: 1,
	}

	// 细分网格：抽水站占地 3×3（x3..5,y3..5）。两条候选输出带都在占地外圈且
	// 方向背离建筑；south 上已有水（重复），west 为空（优先）。
	south := newConveyorBuilding("south", model.Position{X: 3, Y: 6}, model.ConveyorSouth)
	west := newConveyorBuilding("west", model.Position{X: 2, Y: 3}, model.ConveyorWest)

	if _, _, err := south.Conveyor.Insert(model.ItemWater, 1); err != nil {
		t.Fatalf("insert south water: %v", err)
	}

	attachBuilding(ws, south)
	attachBuilding(ws, west)
	attachBuilding(ws, pump)

	settleBuildingIO(ws)

	if got := south.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected south belt to keep existing water only, got %d", got)
	}
	if got := west.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected west belt to receive water, got %d", got)
	}
	if got := conveyorItemQty(west.Conveyor, model.ItemWater); got != 1 {
		t.Fatalf("expected west belt water 1, got %d", got)
	}
	if got := pump.Storage.OutputQuantity(model.ItemWater); got != 0 {
		t.Fatalf("expected pump output buffer drained, got %d", got)
	}
}

func newDepotBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeDepotMk1, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeDepotMk1,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b)
	return b
}

func totalStorageItems(storage *model.StorageState) int {
	if storage == nil {
		return 0
	}
	return storage.UsedInventory() + storage.UsedInputBuffer() + storage.UsedOutputBuffer()
}
