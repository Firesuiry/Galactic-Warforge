package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func TestProductionStats_NoRecipe_ZeroOutput(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	player.Stats.ProductionStats.Efficiency = 0.75

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	building := newBuilding("idle-no-recipe", model.BuildingTypeRecomposingAssembler, "p1", *pos)
	building.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, building)

	stats := settleProductionAndCollectStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected no-recipe building to contribute zero output, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no building type output for no-recipe building, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no item output for no-recipe building, got %+v", stats.ByItem)
	}
	if stats.Efficiency != 0 {
		t.Fatalf("expected efficiency to reset to zero without sampled output, got %+v", stats)
	}
}

func TestProductionStats_InputShortage_ZeroOutput(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	building := newProductionTestBuilding("idle-input-shortage", model.BuildingTypeAssemblingMachineMk1, *pos, "gear")
	placeBuilding(ws, building)

	stats := settleProductionAndCollectStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected input shortage to contribute zero output, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no building type output during input shortage, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no item output during input shortage, got %+v", stats.ByItem)
	}
}

func TestProductionStats_SiloNoRocket_ZeroOutput(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	silo := newVerticalLaunchingSiloBuilding("idle-silo", *pos, "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	silo.Production.RecipeID = "small_carrier_rocket"
	placeBuilding(ws, silo)

	stats := settleProductionAndCollectStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected idle silo to contribute zero output, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no building type output for idle silo, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no item output for idle silo, got %+v", stats.ByItem)
	}
}

func TestProductionStats_RealProduction_Counted(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	assembler := newProductionTestBuilding("real-output", model.BuildingTypeAssemblingMachineMk1, *pos, "gear")
	assembler.Production.PendingOutputs = []model.ItemAmount{{ItemID: model.ItemGear, Quantity: 1}}
	placeBuilding(ws, assembler)

	stats := settleProductionAndCollectStats(t, core, "p1")
	if stats.TotalOutput != 1 {
		t.Fatalf("expected real output to contribute exactly one item, got %+v", stats)
	}
	if got := stats.ByBuildingType[string(model.BuildingTypeAssemblingMachineMk1)]; got != 1 {
		t.Fatalf("expected building type output 1, got %+v", stats.ByBuildingType)
	}
	if got := stats.ByItem[model.ItemGear]; got != 1 {
		t.Fatalf("expected by_item gear=1, got %+v", stats.ByItem)
	}
	if sumIntMap(stats.ByBuildingType) != stats.TotalOutput {
		t.Fatalf("expected by_building_type to sum to total_output, got %+v", stats)
	}
	if sumIntMap(stats.ByItem) != stats.TotalOutput {
		t.Fatalf("expected by_item to sum to total_output, got %+v", stats)
	}
}

func TestProductionStats_Byproducts_Counted(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	assembler := newProductionTestBuilding("real-byproducts", model.BuildingTypeAssemblingMachineMk1, *pos, "graphene_from_fire_ice")
	assembler.Production.PendingOutputs = []model.ItemAmount{{ItemID: model.ItemGraphene, Quantity: 2}}
	assembler.Production.PendingByproducts = []model.ItemAmount{{ItemID: model.ItemHydrogen, Quantity: 1}}
	placeBuilding(ws, assembler)

	stats := settleProductionAndCollectStats(t, core, "p1")
	if stats.TotalOutput != 3 {
		t.Fatalf("expected output plus byproduct total to equal 3, got %+v", stats)
	}
	if got := stats.ByBuildingType[string(model.BuildingTypeAssemblingMachineMk1)]; got != 3 {
		t.Fatalf("expected building type output 3, got %+v", stats.ByBuildingType)
	}
	if got := stats.ByItem[model.ItemGraphene]; got != 2 {
		t.Fatalf("expected graphene output 2, got %+v", stats.ByItem)
	}
	if got := stats.ByItem[model.ItemHydrogen]; got != 1 {
		t.Fatalf("expected hydrogen byproduct 1, got %+v", stats.ByItem)
	}
	if sumIntMap(stats.ByBuildingType) != stats.TotalOutput {
		t.Fatalf("expected by_building_type to sum to total_output, got %+v", stats)
	}
	if sumIntMap(stats.ByItem) != stats.TotalOutput {
		t.Fatalf("expected by_item to sum to total_output, got %+v", stats)
	}
}

func TestProductionStats_CollectStorageOutput_Counted(t *testing.T) {
	core, ws, _ := newIsolatedProductionStatsTestWorld("planet-collect-storage", 4, 4)

	miner := newBuilding("collect-storage", model.BuildingTypeAdvancedMiningMachine, "p1", model.Position{X: 1, Y: 1})
	miner.Runtime.State = model.BuildingWorkRunning
	disableBuildingEnergyCost(miner)
	placeBuilding(ws, miner)

	ws.Resources["r-fire-ice"] = &model.ResourceNodeState{
		ID:           "r-fire-ice",
		PlanetID:     ws.PlanetID,
		Kind:         string(mapmodel.ResourceFireIce),
		Behavior:     "finite",
		Position:     miner.Position,
		MaxAmount:    100,
		Remaining:    100,
		BaseYield:    16,
		CurrentYield: 16,
	}
	ws.Grid[miner.Position.Y][miner.Position.X].ResourceNodeID = "r-fire-ice"
	ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

	settleResources(ws)

	stats := collectProductionStats(t, core, "p1")
	if stats.TotalOutput != 16 {
		t.Fatalf("expected collect->storage output 16, got %+v", stats)
	}
	if got := stats.ByBuildingType[string(model.BuildingTypeAdvancedMiningMachine)]; got != 16 {
		t.Fatalf("expected advanced_mining_machine output 16, got %+v", stats.ByBuildingType)
	}
	if got := stats.ByItem[model.ItemFireIce]; got != 16 {
		t.Fatalf("expected fire_ice output 16, got %+v", stats.ByItem)
	}
	if sumIntMap(stats.ByBuildingType) != stats.TotalOutput {
		t.Fatalf("expected by_building_type to sum to total_output, got %+v", stats)
	}
	if sumIntMap(stats.ByItem) != stats.TotalOutput {
		t.Fatalf("expected by_item to sum to total_output, got %+v", stats)
	}
}

func TestProductionStats_DeploymentHubDoesNotCountDirectMineralsCollect(t *testing.T) {
	core, ws, player := newIsolatedProductionStatsTestWorld("planet-direct-minerals", 4, 4)
	player.Resources.Minerals = 5

	base := newBuilding("direct-minerals", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 1, Y: 1})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.MaintenanceCost.Minerals = 1
	placeBuilding(ws, base)
	ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

	settleResources(ws)

	stats := collectProductionStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected deployment hub to report no direct collect output, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no by_building_type direct collect entries, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no by_item direct collect entries, got %+v", stats.ByItem)
	}
	if player.Resources.Minerals != 5 {
		t.Fatalf("expected unpowered deployment hub to skip maintenance spend, got %d", player.Resources.Minerals)
	}
	if sumIntMap(stats.ByBuildingType) != stats.TotalOutput {
		t.Fatalf("expected by_building_type to sum to total_output, got %+v", stats)
	}
	if sumIntMap(stats.ByItem) != stats.TotalOutput {
		t.Fatalf("expected by_item to sum to total_output, got %+v", stats)
	}
}

func TestProductionStats_OrbitalCollector_Counted(t *testing.T) {
	core, ws, _ := newIsolatedProductionStatsTestWorld("planet-1", 4, 4)
	collector := newOrbitalCollectorBuilding("orbital-counted", model.Position{X: 1, Y: 1}, "p1")
	collector.Runtime.State = model.BuildingWorkRunning
	disableBuildingEnergyCost(collector)
	placeBuilding(ws, collector)
	ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

	settleOrbitalCollectors(ws, testUniverseWithPlanet(mapmodel.PlanetKindGasGiant))

	stats := collectProductionStats(t, core, "p1")
	if stats.TotalOutput != 5 {
		t.Fatalf("expected orbital collector output 5, got %+v", stats)
	}
	if got := stats.ByBuildingType[string(model.BuildingTypeOrbitalCollector)]; got != 5 {
		t.Fatalf("expected orbital_collector output 5, got %+v", stats.ByBuildingType)
	}
	if got := stats.ByItem[model.ItemHydrogen]; got != 4 {
		t.Fatalf("expected hydrogen output 4, got %+v", stats.ByItem)
	}
	if got := stats.ByItem[model.ItemDeuterium]; got != 1 {
		t.Fatalf("expected deuterium output 1, got %+v", stats.ByItem)
	}
	if sumIntMap(stats.ByBuildingType) != stats.TotalOutput {
		t.Fatalf("expected by_building_type to sum to total_output, got %+v", stats)
	}
	if sumIntMap(stats.ByItem) != stats.TotalOutput {
		t.Fatalf("expected by_item to sum to total_output, got %+v", stats)
	}
}

func TestProductionStats_CollectStorageNoResource_ZeroOutput(t *testing.T) {
	core, ws, _ := newIsolatedProductionStatsTestWorld("planet-no-resource", 4, 4)

	miner := newBuilding("collect-no-resource", model.BuildingTypeAdvancedMiningMachine, "p1", model.Position{X: 1, Y: 1})
	miner.Runtime.State = model.BuildingWorkRunning
	disableBuildingEnergyCost(miner)
	placeBuilding(ws, miner)
	ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

	settleResources(ws)

	stats := collectProductionStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected collect without real resource output to stay zero, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no building type output without real resource output, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no item output without real resource output, got %+v", stats.ByItem)
	}
}

func TestProductionStats_OrbitalCollectorFullInventory_ZeroOutput(t *testing.T) {
	core, ws, _ := newIsolatedProductionStatsTestWorld("planet-1", 4, 4)
	collector := newOrbitalCollectorBuilding("orbital-full", model.Position{X: 1, Y: 1}, "p1")
	collector.Runtime.State = model.BuildingWorkRunning
	disableBuildingEnergyCost(collector)
	collector.LogisticsStation.Inventory = model.ItemInventory{
		model.ItemHydrogen:  collector.Runtime.Functions.Orbital.MaxInventory,
		model.ItemDeuterium: collector.Runtime.Functions.Orbital.MaxInventory,
	}
	placeBuilding(ws, collector)
	ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

	settleOrbitalCollectors(ws, testUniverseWithPlanet(mapmodel.PlanetKindGasGiant))

	stats := collectProductionStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected full orbital collector inventory to stay zero, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no building type output with full orbital inventory, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no item output with full orbital inventory, got %+v", stats.ByItem)
	}
}

func TestProductionStats_ProcessTickCollectAndOrbitalOutputsCounted(t *testing.T) {
	core, _, _ := newTwoPlanetTestCore(t)
	ws := model.NewWorldState("planet-1-2", 12, 12)
	for _, playerID := range []string{"p1", "p2"} {
		ws.Players[playerID] = &model.PlayerState{
			PlayerID: playerID,
			IsAlive:  true,
			Tech:     model.NewPlayerTechState(playerID),
			Stats:    model.NewPlayerStats(playerID),
		}
	}
	core.world = ws
	core.worlds = map[string]*model.WorldState{ws.PlanetID: ws}
	core.activePlanetID = ws.PlanetID

	p1Base := newBuilding("base-p1", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 0, Y: 0})
	p1Base.Runtime.State = model.BuildingWorkPaused
	placeBuilding(ws, p1Base)
	p2Base := newBuilding("base-p2", model.BuildingTypeBattlefieldAnalysisBase, "p2", model.Position{X: 11, Y: 11})
	p2Base.Runtime.State = model.BuildingWorkPaused
	placeBuilding(ws, p2Base)

	miner := newBuilding("tick-miner", model.BuildingTypeAdvancedMiningMachine, "p1", model.Position{X: 2, Y: 2})
	miner.Runtime.State = model.BuildingWorkRunning
	disableBuildingEnergyCost(miner)
	placeBuilding(ws, miner)
	ws.Resources["r-tick-fire-ice"] = &model.ResourceNodeState{
		ID:           "r-tick-fire-ice",
		PlanetID:     ws.PlanetID,
		Kind:         string(mapmodel.ResourceFireIce),
		Behavior:     "finite",
		Position:     miner.Position,
		MaxAmount:    100,
		Remaining:    100,
		BaseYield:    16,
		CurrentYield: 16,
	}
	ws.Grid[miner.Position.Y][miner.Position.X].ResourceNodeID = "r-tick-fire-ice"

	collector := newOrbitalCollectorBuilding("tick-orbital", model.Position{X: 3, Y: 2}, "p1")
	collector.Runtime.State = model.BuildingWorkRunning
	disableBuildingEnergyCost(collector)
	placeBuilding(ws, collector)

	core.processTick()

	stats := ws.Players["p1"].Stats.ProductionStats
	if stats.TotalOutput != 21 {
		t.Fatalf("expected processTick authoritative output 21, got %+v", stats)
	}
	if got := stats.ByBuildingType[string(model.BuildingTypeAdvancedMiningMachine)]; got != 16 {
		t.Fatalf("expected advanced_mining_machine processTick output 16, got %+v", stats.ByBuildingType)
	}
	if got := stats.ByBuildingType[string(model.BuildingTypeOrbitalCollector)]; got != 5 {
		t.Fatalf("expected orbital_collector processTick output 5, got %+v", stats.ByBuildingType)
	}
	if got := stats.ByItem[model.ItemFireIce]; got != 16 {
		t.Fatalf("expected processTick fire_ice output 16, got %+v", stats.ByItem)
	}
	if got := stats.ByItem[model.ItemHydrogen]; got != 4 {
		t.Fatalf("expected processTick hydrogen output 4, got %+v", stats.ByItem)
	}
	if got := stats.ByItem[model.ItemDeuterium]; got != 1 {
		t.Fatalf("expected processTick deuterium output 1, got %+v", stats.ByItem)
	}
	if sumIntMap(stats.ByBuildingType) != stats.TotalOutput {
		t.Fatalf("expected by_building_type to sum to total_output, got %+v", stats)
	}
	if sumIntMap(stats.ByItem) != stats.TotalOutput {
		t.Fatalf("expected by_item to sum to total_output, got %+v", stats)
	}
}

func settleProductionAndCollectStats(t *testing.T, core *GameCore, playerID string) model.ProductionStats {
	t.Helper()
	ws := core.World()
	if ws == nil {
		t.Fatal("expected active world")
	}

	settleProduction(ws)
	return collectProductionStats(t, core, playerID)
}

func collectProductionStats(t *testing.T, core *GameCore, playerID string) model.ProductionStats {
	t.Helper()
	ws := core.World()
	if ws == nil {
		t.Fatal("expected active world")
	}
	player := ws.Players[playerID]
	if player == nil {
		t.Fatalf("expected player %s", playerID)
	}
	if player.Stats == nil {
		player.Stats = model.NewPlayerStats(playerID)
	}

	core.updateProductionStats(player)
	return player.Stats.ProductionStats
}

func newIsolatedProductionStatsTestWorld(planetID string, width, height int) (*GameCore, *model.WorldState, *model.PlayerState) {
	ws := model.NewWorldState(planetID, width, height)
	player := &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Stats:    model.NewPlayerStats("p1"),
	}
	ws.Players[player.PlayerID] = player
	return &GameCore{world: ws}, ws, player
}

func disableBuildingEnergyCost(building *model.Building) {
	if building == nil {
		return
	}
	building.Runtime.Params.EnergyConsume = 0
	if building.Runtime.Functions.Energy != nil {
		building.Runtime.Functions.Energy.ConsumePerTick = 0
	}
}

func sumIntMap(values map[string]int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}
