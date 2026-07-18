package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// Regression for docs/player/issue/2026-07-18-gameplay-02-minerals建造货币零收入发展卡死.md:
// minerals is the only construction currency; the opening build chain must not
// deadlock the economy once the starter pack runs out. After the mining
// machine comes online, minerals must grow strictly every tick and the player
// must be able to afford the next building (depot_mk1).
func TestOpeningBuildChainMiningRestoresMineralsIncome(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)

	// Fresh game bootstrap (config-dev.yaml): 240 minerals.
	const bootstrapMinerals = 240
	player := &model.PlayerState{
		PlayerID:  "p1",
		Resources: model.Resources{Minerals: bootstrapMinerals, Energy: 100},
		IsAlive:   true,
	}
	ws.Players["p1"] = player

	// Recommended opening chain: wind_turbine -> matrix_lab -> tesla_tower -> mining_machine.
	chain := []model.BuildingType{
		model.BuildingTypeWindTurbine,
		model.BuildingTypeMatrixLab,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeMiningMachine,
	}
	for _, btype := range chain {
		def, ok := model.BuildingDefinitionByID(btype)
		if !ok {
			t.Fatalf("missing building definition %s", btype)
		}
		if player.Resources.Minerals < def.BuildCost.Minerals {
			t.Fatalf("cannot afford %s: have %d, need %d", btype, player.Resources.Minerals, def.BuildCost.Minerals)
		}
		player.Resources.Minerals -= def.BuildCost.Minerals
	}
	if player.Resources.Minerals != 20 {
		t.Fatalf("expected 20 minerals after opening chain, got %d", player.Resources.Minerals)
	}

	// Mining machine on a silicon ore node.
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

	depotDef, ok := model.BuildingDefinitionByID(model.BuildingTypeDepotMk1)
	if !ok {
		t.Fatal("missing depot_mk1 definition")
	}

	prev := player.Resources.Minerals
	totalHauled := 0
	for tick := 0; tick < 20; tick++ {
		settleResources(ws)
		got := player.Resources.Minerals
		if got <= prev {
			t.Fatalf("tick %d: minerals not strictly increasing: %d -> %d", tick, prev, got)
		}
		prev = got
		// Simulate logistics hauling the ore out so the miner keeps producing.
		miner.Storage.Tick()
		hauled, _, err := miner.Storage.Provide(model.ItemSiliconOre, 1<<30)
		if err != nil {
			t.Fatalf("tick %d: haul silicon ore: %v", tick, err)
		}
		totalHauled += hauled
	}

	if totalHauled <= 0 {
		t.Fatal("expected silicon ore to be mined and hauled")
	}
	if prev < depotDef.BuildCost.Minerals {
		t.Fatalf("expected minerals >= depot_mk1 cost %d after mining, got %d", depotDef.BuildCost.Minerals, prev)
	}
}

// Water/oil collectors feed the fluid item economy only; they must not
// generate minerals (MineralsKickback defaults to 0).
func TestFluidCollectorsDoNotYieldMinerals(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Minerals: 20}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Kind:         "water",
		Behavior:     "renewable",
		MaxAmount:    100,
		Remaining:    100,
		BaseYield:    5,
		CurrentYield: 5,
		RegenPerTick: 2,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	pump := &model.Building{
		ID:       "pump",
		Type:     model.BuildingTypeWaterPump,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeWaterPump, 1).Runtime,
	}
	model.InitBuildingStorage(pump)
	pump.Runtime.Params.EnergyConsume = 0
	if pump.Runtime.Functions.Energy != nil {
		pump.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	ws.Buildings["pump"] = pump

	for i := 0; i < 5; i++ {
		settleResources(ws)
	}
	if got := ws.Players["p1"].Resources.Minerals; got != 20 {
		t.Fatalf("expected water pump to yield no minerals, got %d", got)
	}
	if got := totalStorageItems(pump.Storage); got <= 0 {
		t.Fatalf("expected water buffered in pump storage, got %d", got)
	}
}

func TestMineExtractsFiniteResource(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
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
	ws := model.NewWorldState("planet-1", 1, 1)
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
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeMiningMachine, 1).Runtime,
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
	ws := model.NewWorldState("planet-1", 1, 1)
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

	settleResources(ws)

	if ws.Resources["r1"].Remaining != 5 {
		t.Fatalf("expected remaining 5 after regen, got %d", ws.Resources["r1"].Remaining)
	}
	if got := totalStorageItems(building.Storage); got != 2 {
		t.Fatalf("expected 2 renewable items buffered, got %d", got)
	}
}

func TestMaintenanceCostBlocksProduction(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID:  "p1",
		Resources: model.Resources{Minerals: 1, Energy: 0},
		IsAlive:   true,
	}
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Params: model.BuildingRuntimeParams{
				MaintenanceCost: model.MaintenanceCost{Minerals: 2},
			},
			Functions: model.BuildingFunctionModules{
				Collect: &model.CollectModule{YieldPerTick: 5},
			},
		},
	}
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Buildings["b1"].Runtime.State != model.BuildingWorkError {
		t.Fatalf("expected building state error, got %s", ws.Buildings["b1"].Runtime.State)
	}
	if ws.Players["p1"].Resources.Minerals != 1 {
		t.Fatalf("expected minerals 1, got %d", ws.Players["p1"].Resources.Minerals)
	}
}

func TestMiningOutputFeedsStorageAndLogistics(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Energy: 20}, IsAlive: true}

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
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 0}, model.ConveyorEast)
	depot := newDepotBuilding("depot", model.Position{X: 2, Y: 0})
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
	ws.Grid[0][0].ResourceNodeID = "r1"
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
	ws := model.NewWorldState("planet-1", 3, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Energy: 20}, IsAlive: true}

	pump := &model.Building{
		ID:       "pump",
		Type:     model.BuildingTypeWaterPump,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeWaterPump, 1).Runtime,
	}
	model.InitBuildingStorage(pump)
	pump.Runtime.Params.EnergyConsume = 0
	if pump.Runtime.Functions.Energy != nil {
		pump.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 0}, model.ConveyorEast)
	depot := newDepotBuilding("depot", model.Position{X: 2, Y: 0})
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
	ws.Grid[0][0].ResourceNodeID = "r1"

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
	ws := model.NewWorldState("planet-1", 3, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{Energy: 20}, IsAlive: true}

	extractor := &model.Building{
		ID:       "extractor",
		Type:     model.BuildingTypeOilExtractor,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeOilExtractor, 1).Runtime,
	}
	model.InitBuildingStorage(extractor)
	extractor.Runtime.Params.EnergyConsume = 0
	if extractor.Runtime.Functions.Energy != nil {
		extractor.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	belt := newConveyorBuilding("belt", model.Position{X: 1, Y: 0}, model.ConveyorEast)
	depot := newDepotBuilding("depot", model.Position{X: 2, Y: 0})
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
	ws.Grid[0][0].ResourceNodeID = "r1"

	settleResources(ws)
	settleStorage(ws)
	settleBuildingIO(ws)
	settleBuildingIO(ws)
	settleStorage(ws)

	if got := depot.Storage.OutputQuantity(model.ItemCrudeOil); got == 0 {
		t.Fatalf("expected depot to receive crude oil, got %d", got)
	}
}
