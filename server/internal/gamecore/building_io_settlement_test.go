package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 16 轮契约 §3：只有 direct_belt_io 的建筑能直接和相邻传送带换货。仓储 /
// 生产 / 研究 / 炮塔等一律经分拣器。本文件覆盖直连白名单与「必须走分拣器」的边界。

func TestBuildingIODepotNoLongerTakesDirectlyFromBelt(t *testing.T) {
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

	if got := belt.Conveyor.TotalItems(); got != 3 {
		t.Fatalf("仓储不得再直接从皮带进货，belt items = %d, want 3", got)
	}
	if got := depot.Storage.UsedInputBuffer(); got != 0 {
		t.Fatalf("expected depot input buffer 0, got %d", got)
	}
}

func TestBuildingIODepotTakesFromBeltThroughSorter(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 细分网格：仓库 3×3（x3..5,y0..2）。带子贴在仓库西侧外圈 (2,0) 朝东，
	// 分拣器在带子与仓库之间… 这里改为：带子 (2,0) → 分拣器 (3,0)（背西面东）→
	// 仓库占地内 (4,0)。
	belt := newConveyorBuilding("belt", model.Position{X: 2, Y: 0}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 3, Y: 0})
	sorter.Sorter.Range = 1
	depot := newDepotBuilding("depot", model.Position{X: 4, Y: 0})

	attachBuilding(ws, belt)
	attachBuilding(ws, sorter)
	attachBuilding(ws, depot)

	if _, _, err := belt.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleBuildingIO(ws)
	settleSorters(ws)

	if got := depot.Storage.UsedInputBuffer(); got != 1 {
		t.Fatalf("expected depot input buffer 1 through the sorter, got %d", got)
	}
	if got := belt.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected belt items 2, got %d", got)
	}
}

func TestBuildingIOEMRailEjectorNoLongerTakesDirectlyFromBelt(t *testing.T) {
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

	if got := belt.Conveyor.TotalItems(); got != 3 {
		t.Fatalf("电磁轨道弹射器不得再直接从皮带装料，belt items = %d, want 3", got)
	}
	if got := ejector.Storage.UsedInputBuffer(); got != 0 {
		t.Fatalf("expected ejector input buffer 0, got %d", got)
	}
}

func TestBuildingIOCollectorOutputsDirectlyToConveyor(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 采集类是白名单：抽水站（3×3，x0..2,y0..2）直接把水放进东侧外圈 (3,0) 的带子。
	pump := newWaterPumpBuilding("pump", model.Position{X: 0, Y: 0})
	belt := newConveyorBuilding("belt", model.Position{X: 3, Y: 0}, model.ConveyorEast)
	belt.Conveyor.MaxStack = 4

	attachBuilding(ws, pump)
	attachBuilding(ws, belt)
	pump.Storage.OutputBuffer = model.ItemInventory{model.ItemWater: 2}

	// out-0 端口 capacity=1：每次结算最多搬 1 件，两 tick 搬完 2 件。
	settleBuildingIO(ws)
	settleBuildingIO(ws)

	if got := belt.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected belt items 2, got %d", got)
	}
	if got := pump.Storage.OutputQuantity(model.ItemWater); got != 0 {
		t.Fatalf("expected pump output buffer drained, got %d", got)
	}
}

func TestBuildingIOInputRollbackOnFullStorage(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	// 采集类直连皮带，但目标带子满时不能吞掉产出（回滚）。
	pump := newWaterPumpBuilding("pump", model.Position{X: 0, Y: 0})
	belt := newConveyorBuilding("belt", model.Position{X: 3, Y: 0}, model.ConveyorEast)
	belt.Conveyor.MaxStack = 1

	attachBuilding(ws, pump)
	attachBuilding(ws, belt)
	pump.Storage.OutputBuffer = model.ItemInventory{model.ItemWater: 2}
	if _, _, err := belt.Conveyor.Insert(model.ItemCopperOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleBuildingIO(ws)

	if got := belt.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected belt items 1, got %d", got)
	}
	if got := pump.Storage.OutputQuantity(model.ItemWater); got != 2 {
		t.Fatalf("expected pump output buffer kept (2), got %d", got)
	}
}

func TestBuildingIOOutputPrefersNonDuplicateConveyorTarget(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	pump := newWaterPumpBuilding("pump", model.Position{X: 3, Y: 3})
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

// newWaterPumpBuilding 造一台抽水站（采集类，direct_belt_io）。
func newWaterPumpBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeWaterPump, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeWaterPump,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b)
	b.Runtime.State = model.BuildingWorkRunning
	return b
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
	b.Runtime.State = model.BuildingWorkRunning
	return b
}

func totalStorageItems(storage *model.StorageState) int {
	if storage == nil {
		return 0
	}
	return storage.UsedInventory() + storage.UsedInputBuffer() + storage.UsedOutputBuffer()
}

// 白名单数据驱动：只有 buildings.yaml 里标了 direct_belt_io 的建筑类型能直连皮带。
// 白名单就是「采集类 + 物流站 + 带上设备」，生产 / 仓储 / 研究 / 发电 / 军事一律
// 不在其中——它们是第 16 轮契约 §3 要求必须经分拣器进出货的对象。
func TestBuildingIODirectBeltWhitelistMatchesCatalog(t *testing.T) {
	want := map[model.BuildingType]bool{
		model.BuildingTypeMiningMachine:                true,
		model.BuildingTypeAdvancedMiningMachine:        true,
		model.BuildingTypeWaterPump:                    true,
		model.BuildingTypeOilExtractor:                 true,
		model.BuildingTypeOrbitalCollector:             true,
		model.BuildingTypeConveyorBeltMk1:              true,
		model.BuildingTypeConveyorBeltMk2:              true,
		model.BuildingTypeConveyorBeltMk3:              true,
		model.BuildingTypeSplitter:                     true,
		model.BuildingTypeAutomaticPiler:               true,
		model.BuildingTypeTrafficMonitor:               true,
		model.BuildingTypePlanetaryLogisticsStation:    true,
		model.BuildingTypeInterstellarLogisticsStation: true,
	}
	for btype := range want {
		if !model.BuildingHasDirectBeltIO(btype) {
			t.Errorf("%s 应保留直连皮带 IO", btype)
		}
	}
	for _, btype := range []model.BuildingType{
		model.BuildingTypeDepotMk1,
		model.BuildingTypeArcSmelter,
		model.BuildingTypeAssemblingMachineMk1,
		model.BuildingTypeChemicalPlant,
		model.BuildingTypeOilRefinery,
		model.BuildingTypeMatrixLab,
		model.BuildingTypeWindTurbine,
		model.BuildingTypeThermalPowerPlant,
		model.BuildingTypeBattlefieldAnalysisBase,
		model.BuildingType("barracks"),
		model.BuildingTypeEMRailEjector,
	} {
		if model.BuildingHasDirectBeltIO(btype) {
			t.Errorf("%s 不该直连皮带（必须经分拣器）", btype)
		}
	}
}
