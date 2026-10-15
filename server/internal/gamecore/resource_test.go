package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 16 轮（去掉资金维度）：开局链的建造门槛只剩背包物品——遭遇战物资包
// （config-skirmish.yaml 的 bootstrap.items）必须够「3 风机 + 2 矿机 + 1 熔炉 +
// 3 电塔 + 20 传送带 + 4 分拣器」，并且矿机产出的是矿石实物（落自己的输出缓冲），
// 不再是回充的矿物池。
func TestOpeningBuildChainKitCoversOpeningBuilds(t *testing.T) {
	kit := []model.ItemAmount{
		{ItemID: model.ItemGear, Quantity: 32},
		{ItemID: model.ItemCircuitBoard, Quantity: 15},
		{ItemID: model.ItemIronIngot, Quantity: 96},
		{ItemID: model.ItemMagneticCoil, Quantity: 22},
		{ItemID: model.ItemStoneBrick, Quantity: 3},
	}
	player := &model.PlayerState{PlayerID: "p1", IsAlive: true}
	player.AddItems(kit, 0)

	// 推荐开局链：风机 → 电塔 → 矿机 → 熔炉 → 传送带 → 分拣器。
	chain := []model.BuildingType{
		model.BuildingTypeWindTurbine,
		model.BuildingTypeWindTurbine,
		model.BuildingTypeWindTurbine,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeMiningMachine,
		model.BuildingTypeMiningMachine,
		model.BuildingTypeArcSmelter,
	}
	chain = append(chain, make([]model.BuildingType, 0)...)
	for i := 0; i < 20; i++ {
		chain = append(chain, model.BuildingTypeConveyorBeltMk1)
	}
	for i := 0; i < 4; i++ {
		chain = append(chain, model.BuildingTypeSorterMk1)
	}
	for _, btype := range chain {
		def, ok := model.BuildingDefinitionByID(btype)
		if !ok {
			t.Fatalf("missing building definition %s", btype)
		}
		if !player.HasItems(def.BuildCost.Items) {
			t.Fatalf("kit cannot afford %s: need %+v, have %+v", btype, def.BuildCost.Items, player.Inventory)
		}
		if !player.DeductItems(def.BuildCost.Items) {
			t.Fatalf("deduct %s failed", btype)
		}
	}
}

// A full local storage blocks extraction: the mined amount is keyed off what
// actually reached storage, so a jammed collector neither mines nor depletes the
// vein (试玩 1015：矿机缓冲满后仍全速扣矿，8 个节点被抽干而矿石从未落地).
// 第 16 轮起采矿机只产出矿石实物（不再回充矿物池），这条不变式更关键：
// 缓冲满了就停采，玩家看到 output_blocked 后把矿运走。
func TestFullCollectorStorageStopsMining(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1)
	player := &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Players["p1"] = player
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		PlanetID:     ws.PlanetID,
		Kind:         "silicon_ore",
		Behavior:     "finite",
		MaxAmount:    1000,
		Remaining:    1000,
		BaseYield:    8,
		CurrentYield: 8,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	miner := &model.Building{
		ID:       "miner",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1).Runtime,
	}
	model.InitBuildingStorage(miner)
	miner.Runtime.Params.EnergyConsume = 0
	if miner.Runtime.Functions.Energy != nil {
		miner.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	ws.Buildings["miner"] = miner

	// 先让矿机把本地缓冲填满（每 tick 挖 yield 个，跑够 tick 数就满）。
	for i := 0; i < 64; i++ {
		settleResources(ws)
	}
	heldBefore := totalStorageItems(miner.Storage)
	if heldBefore <= 0 {
		t.Fatal("expected the collector to mine into its local storage")
	}
	preview, _, err := miner.Storage.PreviewStoreProduct(model.ItemSiliconOre, 8)
	if err != nil || preview != 0 {
		t.Fatalf("expected full storage (product preview accept 0), got preview=%d err=%v held=%d",
			preview, err, heldBefore)
	}

	prevRemaining := ws.Resources["r1"].Remaining
	for tick := 0; tick < 12; tick++ {
		settleResources(ws)
		// The vein must not be drained while the products have nowhere to go.
		if rem := ws.Resources["r1"].Remaining; rem != prevRemaining {
			t.Fatalf("tick %d: vein must not deplete while storage is full: %d -> %d", tick, prevRemaining, rem)
		}
		if held := totalStorageItems(miner.Storage); held != heldBefore {
			t.Fatalf("tick %d: storage should not grow when full (no haul): held %d -> %d", tick, heldBefore, held)
		}
		preview, _, err = miner.Storage.PreviewStoreProduct(model.ItemSiliconOre, 8)
		if err != nil || preview != 0 {
			t.Fatalf("tick %d: storage should stay full, preview=%d err=%v", tick, preview, err)
		}
		prevRemaining = ws.Resources["r1"].Remaining
	}

	// Hauling the ore out resumes extraction.
	if _, _, err := miner.Storage.Provide(model.ItemSiliconOre, 8); err != nil {
		t.Fatalf("drain collector: %v", err)
	}
	settleResources(ws)
	if rem := ws.Resources["r1"].Remaining; rem >= prevRemaining {
		t.Fatalf("drained collector must resume mining, remaining %d (was %d)", rem, prevRemaining)
	}
}

func TestMineExtractsFiniteResource(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Kind:         "iron_ore",
		Behavior:     "finite",
		MaxAmount:    10,
		Remaining:    10,
		BaseYield:    4,
		CurrentYield: 4,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1).Runtime,
	}
	building.Runtime.Params.EnergyConsume = 0
	building.Runtime.Functions.Energy.ConsumePerTick = 0
	building.Runtime.Functions.Collect.YieldPerTick = 5
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Resources["r1"].Remaining != 6 {
		t.Fatalf("expected remaining 6, got %d", ws.Resources["r1"].Remaining)
	}
	if got := building.Runtime.Functions.Collect.ResourceKind; got != "iron_ore" {
		t.Fatalf("expected resource_kind iron_ore, got %q", got)
	}
	if got := totalStorageItems(building.Storage); got != 4 {
		t.Fatalf("expected 4 ore buffered, got %d", got)
	}
}

func TestMineDecaysOilYield(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Kind:         "crude_oil",
		Behavior:     "decay",
		BaseYield:    5,
		CurrentYield: 5,
		MinYield:     2,
		DecayPerTick: 1,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeOilExtractor,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeOilExtractor, 1).Runtime,
	}
	building.Runtime.Params.EnergyConsume = 0
	building.Runtime.Functions.Energy.ConsumePerTick = 0
	building.Runtime.Functions.Collect.YieldPerTick = 4
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Resources["r1"].CurrentYield != 4 {
		t.Fatalf("expected current yield 4, got %d", ws.Resources["r1"].CurrentYield)
	}
	if got := totalStorageItems(building.Storage); got != 4 {
		t.Fatalf("expected 4 oil buffered, got %d", got)
	}
}

func TestRenewableResourceRegens(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Kind:         "coal",
		Behavior:     "renewable",
		MaxAmount:    10,
		Remaining:    5,
		BaseYield:    3,
		CurrentYield: 3,
		RegenPerTick: 2,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1).Runtime,
	}
	building.Runtime.Params.EnergyConsume = 0
	building.Runtime.Functions.Energy.ConsumePerTick = 0
	building.Runtime.Functions.Collect.YieldPerTick = 2
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building
	// 细分网格：再生结算只遍历可再生矿脉索引（地图生成/读档后重建），
	// 手工搭的世界必须显式重建一次。
	IndexRenewableResources(ws)

	settleResources(ws)

	if ws.Resources["r1"].Remaining != 5 {
		t.Fatalf("expected remaining 5 after regen, got %d", ws.Resources["r1"].Remaining)
	}
	if got := totalStorageItems(building.Storage); got != 2 {
		t.Fatalf("expected 2 renewable items buffered, got %d", got)
	}
}

func TestMiningOutputFeedsStorageAndLogistics(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Energy: 20}, IsAlive: true}

	miner := &model.Building{
		ID:       "miner",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 1, Y: 1},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1).Runtime,
	}
	model.InitBuildingStorage(miner)
	miner.Runtime.Params.EnergyConsume = 0
	if miner.Runtime.Functions.Energy != nil {
		miner.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	// 细分网格：采矿机 3×3（x1..3,y1..3），传送带贴在东侧外圈、方向背离建筑。
	belt := newConveyorBuilding("belt", model.Position{X: 4, Y: 1}, model.ConveyorEast)
	depot := newDepotBuilding("depot", model.Position{X: 5, Y: 1})
	attachBuilding(ws, miner)
	attachBuilding(ws, belt)
	attachBuilding(ws, depot)

	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		PlanetID:     ws.PlanetID,
		Kind:         "titanium_ore",
		Behavior:     "finite",
		Position:     miner.Position,
		MaxAmount:    100,
		Remaining:    100,
		BaseYield:    8,
		CurrentYield: 8,
	}
	ws.Grid[1][1].ResourceNodeID = "r1"
	settleResources(ws)
	settleStorage(ws)
	settleBuildingIO(ws)
	settleBuildingIO(ws)
	settleStorage(ws)

	if got := depot.Storage.OutputQuantity(model.ItemTitaniumOre); got == 0 {
		t.Fatalf("expected depot to receive titanium ore, got %d", got)
	}
}

func TestWaterPumpFeedsStorageAndLogistics(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Energy: 20}, IsAlive: true}

	pump := &model.Building{
		ID:       "pump",
		Type:     model.BuildingTypeWaterPump,
		OwnerID:  "p1",
		Position: model.Position{X: 1, Y: 1},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeWaterPump, 1).Runtime,
	}
	model.InitBuildingStorage(pump)
	pump.Runtime.Params.EnergyConsume = 0
	if pump.Runtime.Functions.Energy != nil {
		pump.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	belt := newConveyorBuilding("belt", model.Position{X: 4, Y: 1}, model.ConveyorEast)
	depot := newDepotBuilding("depot", model.Position{X: 5, Y: 1})
	attachBuilding(ws, pump)
	attachBuilding(ws, belt)
	attachBuilding(ws, depot)

	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		PlanetID:     ws.PlanetID,
		Kind:         "water",
		Behavior:     "renewable",
		Position:     pump.Position,
		MaxAmount:    100,
		Remaining:    100,
		BaseYield:    5,
		CurrentYield: 5,
		RegenPerTick: 2,
	}
	ws.Grid[1][1].ResourceNodeID = "r1"

	settleResources(ws)
	settleStorage(ws)
	settleBuildingIO(ws)
	settleBuildingIO(ws)
	settleStorage(ws)

	if got := depot.Storage.OutputQuantity(model.ItemWater); got == 0 {
		t.Fatalf("expected depot to receive water, got %d", got)
	}
}

func TestOilExtractorFeedsStorageAndLogistics(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Energy: 20}, IsAlive: true}

	extractor := &model.Building{
		ID:       "extractor",
		Type:     model.BuildingTypeOilExtractor,
		OwnerID:  "p1",
		Position: model.Position{X: 1, Y: 1},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeOilExtractor, 1).Runtime,
	}
	model.InitBuildingStorage(extractor)
	extractor.Runtime.Params.EnergyConsume = 0
	if extractor.Runtime.Functions.Energy != nil {
		extractor.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	belt := newConveyorBuilding("belt", model.Position{X: 4, Y: 1}, model.ConveyorEast)
	depot := newDepotBuilding("depot", model.Position{X: 5, Y: 1})
	attachBuilding(ws, extractor)
	attachBuilding(ws, belt)
	attachBuilding(ws, depot)

	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		PlanetID:     ws.PlanetID,
		Kind:         "crude_oil",
		Behavior:     "decay",
		Position:     extractor.Position,
		BaseYield:    5,
		CurrentYield: 5,
		MinYield:     2,
		DecayPerTick: 1,
	}
	ws.Grid[1][1].ResourceNodeID = "r1"

	settleResources(ws)
	settleStorage(ws)
	settleBuildingIO(ws)
	settleBuildingIO(ws)
	settleStorage(ws)

	if got := depot.Storage.OutputQuantity(model.ItemCrudeOil); got == 0 {
		t.Fatalf("expected depot to receive crude oil, got %d", got)
	}
}
