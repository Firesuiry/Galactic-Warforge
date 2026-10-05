package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func TestPhase1ExecutorRespawnsOnlyAtLivingHQ(t *testing.T) {
	ws := newRTTWorld(true)
	u := spawnWorldTestUnit(ws, model.UnitTypeExecutor, "p1", model.Position{X: 2, Y: 2})
	ws.Players["p1"].SetPlanetExecutor(ws.PlanetID, model.NewExecutorState(u.ID, 1, 8, 1, 1))
	hq := surfaceTestBuilding(ws, "hq", model.BuildingTypeBattlefieldAnalysisBase, model.Position{X: 4, Y: 4})
	hq.OwnerID = "p1"
	ws.Tick = 20
	killUnit(ws, u, "enemy", "p2", "unit")
	deadline := ws.Players["p1"].ExecutorForPlanet(ws.PlanetID).RespawnAtTick
	if deadline != 20+model.ExecutorRespawnTicks() {
		t.Fatalf("wrong respawn deadline %d", deadline)
	}
	ws.Tick = deadline - 1
	settleMechas(ws)
	if ws.Units[u.ID] != nil {
		t.Fatal("respawned too early")
	}
	ws.Tick = deadline
	events := settleMechas(ws)
	revived := ws.Units[u.ID]
	if revived == nil || revived.HP != revived.MaxHP || ws.SurfaceDistance(hq.Position, revived.Position) > 2 || len(events) == 0 {
		t.Fatalf("HQ respawn failed: %+v", revived)
	}
	killUnit(ws, revived, "enemy", "p2", "unit")
	delete(ws.Buildings, hq.ID)
	ws.Tick += model.ExecutorRespawnTicks()
	settleMechas(ws)
	if ws.Units[u.ID] != nil {
		t.Fatal("respawned without surviving HQ")
	}
}

func TestPhase1RayReceiversShareEnergyAcrossPlanets(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	LaunchSolarSail(core.spaceRuntime, "p1", "sys-1", 1.2, 5, 1)
	supply := GetSolarSailEnergy(core.spaceRuntime, "p1", "sys-1")
	a := newRayReceiverBuilding("a", model.Position{X: 6, Y: 6}, "p1")
	b := newRayReceiverBuilding("b", model.Position{X: 8, Y: 6}, "p1")
	a.Runtime.Functions.RayReceiver.InputPerTick = supply
	b.Runtime.Functions.RayReceiver.InputPerTick = supply
	attachBuilding(ws, a)
	attachBuilding(ws, b)
	budget := make(map[string]int)
	views := settleRayReceivers(ws, core.Maps(), core.spaceRuntime, budget)
	if views["a"].EffectiveInput+views["b"].EffectiveInput != supply {
		t.Fatalf("energy duplicated: %+v", views)
	}
	second := model.NewWorldState(ws.PlanetID, 16)
	second.Players = ws.Players
	attachBuilding(second, newRayReceiverBuilding("c", model.Position{X: 6, Y: 6}, "p1"))
	other := settleRayReceivers(second, core.Maps(), core.spaceRuntime, budget)
	if other["c"].EffectiveInput != 0 {
		t.Fatal("same system budget reused by another planet")
	}
}

func TestPhase1MiningResourceValidation(t *testing.T) {
	ws := newRTTWorld(false)
	pos := model.Position{X: 2, Y: 2}
	node := &model.ResourceNodeState{ID: "ore", Kind: "crude_oil", Position: pos}
	ws.Resources[node.ID] = node
	ws.Grid[pos.Y][pos.X].ResourceNodeID = node.ID
	if model.ValidateCollectorSite(ws, model.BuildingTypeMiningMachine, pos) == nil {
		t.Fatal("miner accepted oil")
	}
	if err := model.ValidateCollectorSite(ws, model.BuildingTypeOilExtractor, pos); err != nil {
		t.Fatal(err)
	}
	node.Kind = "iron_ore"
	if model.ValidateCollectorSite(ws, model.BuildingTypeOilExtractor, pos) == nil {
		t.Fatal("oil extractor accepted iron")
	}
	if err := model.ValidateCollectorSite(ws, model.BuildingTypeMiningMachine, pos); err != nil {
		t.Fatal(err)
	}
}

func TestPhase1SorterMachineIOAndAtomicConfiguration(t *testing.T) {
	ws := newRTTWorld(false)
	source := newConveyorBuilding("belt", model.Position{X: 1, Y: 2}, model.ConveyorEast)
	arm := newSorterBuilding("arm", model.Position{X: 2, Y: 2})
	machine := surfaceTestBuilding(ws, "machine", model.BuildingTypeArcSmelter, model.Position{X: 3, Y: 2})
	machine.OwnerID = "p1"
	model.InitBuildingStorage(machine)
	model.InitBuildingProduction(machine)
	machine.Production.RecipeID = "smelt_iron"
	machine.Runtime.Params.IOPorts = []model.IOPort{{ID: "in", Direction: model.PortInput}, {ID: "out", Direction: model.PortOutput}}
	attachBuilding(ws, source)
	attachBuilding(ws, arm)
	gc := &GameCore{}
	cmd := model.Command{Target: model.CommandTarget{EntityID: arm.ID}, Payload: map[string]any{"input_directions": []string{"west"}, "output_directions": []string{"east"}, "filter_items": []string{"iron_ore"}}}
	if res, _ := execCommand(gc, model.CmdConfigureSorter, ws, "p1", cmd); res.Code != model.CodeOK {
		t.Fatalf("configure: %+v", res)
	}
	source.Conveyor.Insert("iron_ore", 3)
	settleSorters(ws)
	if availableStorageItem(machine.Storage, "iron_ore") != 1 || source.Conveyor.TotalItems() != 2 {
		t.Fatal("belt to machine transfer lost or failed")
	}
	cmd.Payload["output_directions"] = []string{"west"}
	if res, _ := execCommand(gc, model.CmdConfigureSorter, ws, "p1", cmd); res.Code == model.CodeOK {
		t.Fatal("overlapping directions accepted")
	}
	if arm.Sorter.OutputDirections[0] != model.ConveyorEast {
		t.Fatal("invalid config partially mutated sorter")
	}
	// Reverse direction and extract finished products, never the machine input stock.
	cmd.Payload = map[string]any{"input_directions": []string{"east"}, "output_directions": []string{"west"}, "filter_items": []string{"iron_ingot"}}
	if res, _ := execCommand(gc, model.CmdConfigureSorter, ws, "p1", cmd); res.Code != model.CodeOK {
		t.Fatalf("reverse: %+v", res)
	}
	source.Conveyor.Output = model.ConveyorWest
	source.Conveyor.Input = model.ConveyorEast
	machine.Storage.OutputBuffer = model.ItemInventory{"iron_ingot": 2}
	before := source.Conveyor.TotalItems()
	settleSorters(ws)
	if source.Conveyor.TotalItems() != before+1 || machine.Storage.OutputBuffer["iron_ingot"] != 1 {
		t.Fatal("machine to belt transfer failed")
	}
}

func TestPhase1StatsAggregateAllPlanets(t *testing.T) {
	core, a, b := newF4DualPlanetCore(t, "off")
	a.Tick = 10
	b.Tick = 10
	for i, ws := range []*model.WorldState{a, b} {
		ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)
		ws.ProductionSnapshot.Players["p1"] = model.PlayerProductionSnapshot{TotalOutput: i + 2, ByItem: map[string]int{"ammo_bullet": i + 2}, ByBuildingType: map[string]int{"assembling_machine_mk1": i + 2}}
		ws.PowerSnapshot = &model.PowerSettlementSnapshot{Tick: ws.Tick, Players: map[string]model.PlayerPowerSnapshot{"p1": {Generation: i + 3, Demand: i + 5}}}
	}
	core.settleStats()
	stats := a.Players["p1"].Stats
	if stats.ProductionStats.TotalOutput != 5 || stats.ProductionStats.ByItem["ammo_bullet"] != 5 || stats.EnergyStats.Generation != 7 || stats.EnergyStats.Consumption != 11 {
		t.Fatalf("planet aggregation failed: %+v", stats)
	}
	if stats.EnergyStats.ShortageTicks != 1 {
		t.Fatalf("shortage counted per planet: %+v", stats.EnergyStats)
	}
	core.world = b
	core.settleStats()
	if stats.ProductionStats.TotalOutput != 5 || stats.EnergyStats.ShortageTicks != 2 {
		t.Fatal("focus changed totals or double counted a world")
	}
}
