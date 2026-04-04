package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func newE2ETestCore(t *testing.T) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "e2e-test-seed",
			MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 32, Height: 32, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := NewEventBus()
	return New(cfg, maps, q, bus, nil)
}

func TestE2E_TickCommandChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_collection")

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}

	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build command failed: %s (%s)", res.Status, res.Message)
	}

	for i := 0; i < 3; i++ {
		core.processTick()
	}

	foundBuilding := false
	ws.RLock()
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeSolarPanel && b.OwnerID == "p1" {
			foundBuilding = true
			break
		}
	}
	ws.RUnlock()
	if !foundBuilding {
		t.Fatal("solar_panel building not found after construction tick")
	}
}

func TestE2E_ResearchUnlockBuildChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-e2e", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}
	placeBuilding(ws, lab)
	power := newBuilding("power-e2e", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	placeBuilding(ws, power)

	startCmd := model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "electromagnetism",
		},
	}
	res, _ := core.execStartResearch(ws, "p1", startCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("start research failed: %s (%s)", res.Status, res.Message)
	}

	for i := 0; i < 50; i++ {
		lab.Runtime.State = model.BuildingWorkRunning
		core.processTick()
	}

	player := ws.Players["p1"]
	if player == nil || player.Tech == nil || player.Tech.CompletedTechs["electromagnetism"] == 0 {
		t.Fatal("electromagnetism should be completed after research ticks")
	}

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	buildCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "wind_turbine",
		},
	}
	buildRes, _ := core.execBuild(ws, "p1", buildCmd)
	if buildRes.Status != model.StatusExecuted {
		t.Fatalf("build unlocked wind_turbine failed: %s (%s)", buildRes.Status, buildRes.Message)
	}
}

func TestE2E_CollectorsRequireResourceNodes(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "fluid_storage", "plasma_refining")

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}

	for _, btype := range []string{"water_pump", "oil_extractor"} {
		buildCmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: pos},
			Payload: map[string]any{
				"building_type": btype,
			},
		}
		res, _ := core.execBuild(ws, "p1", buildCmd)
		if res.Status != model.StatusFailed {
			t.Fatalf("%s should fail on non-resource tile, got %s", btype, res.Status)
		}
		if res.Code != model.CodeInvalidTarget {
			t.Fatalf("%s should return INVALID_TARGET, got %s", btype, res.Code)
		}
	}
}

func TestE2E_ProductionChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "basic_assembling_processes", "solar_collection")

	player := ws.Players["p1"]
	player.Resources.Energy = 1000

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	powerPos, err := findAdjacentOpenTile(ws, *pos)
	if err != nil {
		t.Fatalf("find adjacent power tile: %v", err)
	}
	buildCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "assembling_machine_mk1",
			"recipe_id":     "gear",
		},
	}
	res, _ := core.execBuild(ws, "p1", buildCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build assembler failed: %s (%s)", res.Status, res.Message)
	}

	powerCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: powerPos},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	powerRes, _ := core.execBuild(ws, "p1", powerCmd)
	if powerRes.Status != model.StatusExecuted {
		t.Fatalf("build solar panel failed: %s (%s)", powerRes.Status, powerRes.Message)
	}

	for i := 0; i < 5; i++ {
		core.processTick()
	}

	var assembler *model.Building
	ws.RLock()
	for _, b := range ws.Buildings {
		if b.OwnerID == "p1" && b.Type == model.BuildingTypeAssemblingMachineMk1 {
			assembler = b
			break
		}
	}
	ws.RUnlock()
	if assembler == nil || assembler.Storage == nil || assembler.Production == nil {
		t.Fatal("assembler should be constructed with storage and production state")
	}
	if assembler.Production.RecipeID != "gear" {
		t.Fatalf("expected assembler recipe gear, got %q", assembler.Production.RecipeID)
	}

	accepted, remaining, err := assembler.Storage.Receive(model.ItemIronIngot, 1)
	if err != nil {
		t.Fatalf("prime assembler input: %v", err)
	}
	if accepted != 1 || remaining != 0 {
		t.Fatalf("expected to insert 1 iron_ingot, accepted=%d remaining=%d", accepted, remaining)
	}

	for i := 0; i < 25; i++ {
		core.processTick()
	}

	if got := assembler.Storage.OutputQuantity(model.ItemGear); got <= 0 {
		t.Fatalf("expected produced gear in assembler storage, got %d", got)
	}
}

func TestE2E_VerticalLaunchingSiloUsesDefaultRocketRecipe(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "vertical_launching")

	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}

	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeVerticalLaunchingSilo),
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("build silo failed: %s (%s)", res.Status, res.Message)
	}

	var silo *model.Building
	for i := 0; i < 80; i++ {
		core.processTick()
		ws.RLock()
		for _, building := range ws.Buildings {
			if building != nil && building.OwnerID == "p1" && building.Type == model.BuildingTypeVerticalLaunchingSilo {
				silo = building
				break
			}
		}
		ws.RUnlock()
		if silo != nil {
			break
		}
	}
	if silo == nil {
		t.Fatal("expected silo to be constructed")
	}
	if silo.Production == nil {
		t.Fatal("expected silo to have production state")
	}
	if silo.Production.RecipeID != "small_carrier_rocket" {
		t.Fatalf("expected silo default recipe small_carrier_rocket, got %q", silo.Production.RecipeID)
	}
}

func TestE2E_LogisticsStationConstructionAutoProvision(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "planetary_logistics", "interstellar_logistics")

	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	if pos == nil {
		t.Fatal("find open tile: no open tile found")
	}

	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeInterstellarLogisticsStation),
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("build command failed: %s (%s)", res.Status, res.Message)
	}

	var built *model.Building
	for i := 0; i < 80; i++ {
		core.processTick()

		ws.RLock()
		for _, b := range ws.Buildings {
			if b == nil {
				continue
			}
			if b.OwnerID == "p1" && b.Type == model.BuildingTypeInterstellarLogisticsStation && b.Position == *pos {
				built = b
				break
			}
		}
		ws.RUnlock()
		if built != nil {
			break
		}
	}
	if built == nil || built.LogisticsStation == nil {
		t.Fatal("interstellar logistics station not found after construction ticks")
	}

	if got, want := model.StationDroneCount(ws, built.ID), built.LogisticsStation.DroneCapacityValue(); got != want {
		t.Fatalf("expected station drones=%d after construction, got %d", want, got)
	}
	if got, want := model.StationShipCount(ws, built.ID), built.LogisticsStation.ShipSlotCapacityValue(); got != want {
		t.Fatalf("expected station ships=%d after construction, got %d", want, got)
	}
}

func TestE2E_LogisticsStationConstructionFailureDoesNotSpendMaterialsOrLeakState(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "planetary_logistics", "interstellar_logistics")

	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000
	beforeMinerals := player.Resources.Minerals
	beforeEnergy := player.Resources.Energy
	beforeInventory := player.Inventory.Clone()

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	if pos == nil {
		t.Fatal("find open tile: no open tile found")
	}

	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeInterstellarLogisticsStation),
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("build command failed: %s (%s)", res.Status, res.Message)
	}

	blockerProfile := model.BuildingProfileFor(model.BuildingTypeSolarPanel, 1)
	blocker := &model.Building{
		ID:          "construction-blocker",
		Type:        model.BuildingTypeSolarPanel,
		OwnerID:     "p2",
		Position:    *pos,
		HP:          blockerProfile.MaxHP,
		MaxHP:       blockerProfile.MaxHP,
		Level:       1,
		VisionRange: blockerProfile.VisionRange,
		Runtime:     blockerProfile.Runtime,
	}
	attachBuilding(ws, blocker)

	for i := 0; i < 3; i++ {
		core.processTick()
	}

	if player.Resources.Minerals != beforeMinerals || player.Resources.Energy != beforeEnergy {
		t.Fatalf("expected materials unchanged after failed completion, got minerals=%d energy=%d", player.Resources.Minerals, player.Resources.Energy)
	}
	if len(player.Inventory) != len(beforeInventory) {
		t.Fatalf("expected inventory unchanged after failed completion")
	}
	for itemID, qty := range beforeInventory {
		if player.Inventory[itemID] != qty {
			t.Fatalf("expected inventory for %s unchanged at %d, got %d", itemID, qty, player.Inventory[itemID])
		}
	}
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == "p1" && b.Type == model.BuildingTypeInterstellarLogisticsStation && b.Position == *pos {
			t.Fatal("unexpected interstellar logistics station created on blocked tile")
		}
	}
	for stationID := range ws.LogisticsStations {
		if _, ok := ws.Buildings[stationID]; !ok {
			t.Fatalf("found orphan logistics station %s", stationID)
		}
	}
	for _, drone := range ws.LogisticsDrones {
		if drone != nil {
			if _, ok := ws.Buildings[drone.StationID]; !ok {
				t.Fatalf("found orphan logistics drone bound to missing station %s", drone.StationID)
			}
		}
	}
	for _, ship := range ws.LogisticsShips {
		if ship != nil {
			if _, ok := ws.Buildings[ship.StationID]; !ok {
				t.Fatalf("found orphan logistics ship bound to missing station %s", ship.StationID)
			}
		}
	}
}

func TestE2E_LogisticsStationProvisionFailureRollsBackState(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "planetary_logistics", "interstellar_logistics")

	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000
	beforeMinerals := player.Resources.Minerals
	beforeEnergy := player.Resources.Energy

	originalProvisioner := provisionConstructionStationFleet
	provisionConstructionStationFleet = func(ws *model.WorldState, building *model.Building) error {
		return fmt.Errorf("injected fleet provisioning failure")
	}
	t.Cleanup(func() {
		provisionConstructionStationFleet = originalProvisioner
	})

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	if pos == nil {
		t.Fatal("find open tile: no open tile found")
	}

	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeInterstellarLogisticsStation),
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("build command failed: %s (%s)", res.Status, res.Message)
	}

	for i := 0; i < 3; i++ {
		core.processTick()
	}

	if player.Resources.Minerals != beforeMinerals || player.Resources.Energy != beforeEnergy {
		t.Fatalf("expected materials unchanged after provision rollback, got minerals=%d energy=%d", player.Resources.Minerals, player.Resources.Energy)
	}
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == "p1" && b.Type == model.BuildingTypeInterstellarLogisticsStation && b.Position == *pos {
			t.Fatal("unexpected interstellar logistics station created after provision failure")
		}
	}
	for stationID := range ws.LogisticsStations {
		if _, ok := ws.Buildings[stationID]; !ok {
			t.Fatalf("found orphan logistics station %s after provision rollback", stationID)
		}
	}
	for _, drone := range ws.LogisticsDrones {
		if drone != nil {
			if _, ok := ws.Buildings[drone.StationID]; !ok {
				t.Fatalf("found orphan logistics drone bound to missing station %s", drone.StationID)
			}
		}
	}
	for _, ship := range ws.LogisticsShips {
		if ship != nil {
			if _, ok := ws.Buildings[ship.StationID]; !ok {
				t.Fatalf("found orphan logistics ship bound to missing station %s", ship.StationID)
			}
		}
	}
}

func TestDemolishBuildingRemovesStationFleet(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	posA, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	if posA == nil {
		t.Fatal("find open tile: no open tile found")
	}

	stationA := newInterstellarLogisticsStationBuilding("station-demolish-a", *posA)
	stationA.Runtime.State = model.BuildingWorkIdle
	attachBuilding(ws, stationA)
	model.RegisterLogisticsStation(ws, stationA)

	posB, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find second open tile: %v", err)
	}
	if posB == nil {
		t.Fatal("find second open tile: no open tile found")
	}
	stationB := newInterstellarLogisticsStationBuilding("station-demolish-b", *posB)
	stationB.Runtime.State = model.BuildingWorkIdle
	attachBuilding(ws, stationB)
	model.RegisterLogisticsStation(ws, stationB)

	if err := ensureStationFleet(ws, stationA); err != nil {
		t.Fatalf("ensure station A fleet: %v", err)
	}
	if err := ensureStationFleet(ws, stationB); err != nil {
		t.Fatalf("ensure station B fleet: %v", err)
	}

	if got := model.StationDroneCount(ws, stationA.ID); got != stationA.LogisticsStation.DroneCapacityValue() {
		t.Fatalf("expected precondition station A drones=%d, got %d", stationA.LogisticsStation.DroneCapacityValue(), got)
	}
	if got := model.StationShipCount(ws, stationA.ID); got != stationA.LogisticsStation.ShipSlotCapacityValue() {
		t.Fatalf("expected precondition station A ships=%d, got %d", stationA.LogisticsStation.ShipSlotCapacityValue(), got)
	}
	baselineBDrones := model.StationDroneCount(ws, stationB.ID)
	baselineBShips := model.StationShipCount(ws, stationB.ID)

	res, _ := core.execDemolish(ws, "p1", model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: stationA.ID},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("demolish command failed: %s (%s)", res.Status, res.Message)
	}
	for i := 0; i < 6; i++ {
		core.processTick()
		if _, ok := ws.Buildings[stationA.ID]; !ok {
			break
		}
	}
	if _, ok := ws.Buildings[stationA.ID]; ok {
		t.Fatal("station A should be removed after demolish job completes")
	}

	if got := model.StationDroneCount(ws, stationA.ID); got != 0 {
		t.Fatalf("expected station A drones cleared after demolish, got %d", got)
	}
	if got := model.StationShipCount(ws, stationA.ID); got != 0 {
		t.Fatalf("expected station A ships cleared after demolish, got %d", got)
	}
	if got := model.StationDroneCount(ws, stationB.ID); got != baselineBDrones {
		t.Fatalf("expected station B drones unchanged at %d, got %d", baselineBDrones, got)
	}
	if got := model.StationShipCount(ws, stationB.ID); got != baselineBShips {
		t.Fatalf("expected station B ships unchanged at %d, got %d", baselineBShips, got)
	}
}

func TestE2E_PlanetaryLogisticsDeliveryAfterConfiguration(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	posA, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find origin tile: %v", err)
	}
	if posA == nil {
		t.Fatal("find origin tile: no open tile found")
	}
	origin := newLogisticsStationBuilding("station-e2e-planetary-origin", *posA)
	attachBuilding(ws, origin)
	model.RegisterLogisticsStation(ws, origin)

	posB, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find target tile: %v", err)
	}
	if posB == nil {
		t.Fatal("find target tile: no open tile found")
	}
	target := newLogisticsStationBuilding("station-e2e-planetary-target", *posB)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, target)

	if err := ensureStationFleet(ws, origin); err != nil {
		t.Fatalf("ensure origin fleet: %v", err)
	}
	if err := ensureStationFleet(ws, target); err != nil {
		t.Fatalf("ensure target fleet: %v", err)
	}
	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 120})
	target.LogisticsStation.SetInventory(model.ItemInventory{})

	res, _ := core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: origin.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          "supply",
			"local_storage": 20,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("configure origin slot failed: %s (%s)", res.Status, res.Message)
	}
	res, _ = core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: target.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          "demand",
			"local_storage": 60,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("configure target slot failed: %s (%s)", res.Status, res.Message)
	}

	core.processTick()
	var dispatchedDroneID string
	for id, drone := range ws.LogisticsDrones {
		if drone != nil && drone.TargetStationID == target.ID && drone.CargoQty() == 60 {
			dispatchedDroneID = id
			break
		}
	}
	if dispatchedDroneID == "" {
		t.Fatal("expected a dispatched drone carrying 60 iron ore")
	}

	for i := 0; i < 10 && target.LogisticsStation.Inventory[model.ItemIronOre] < 60; i++ {
		core.processTick()
	}
	if got := origin.LogisticsStation.Inventory[model.ItemIronOre]; got != 60 {
		t.Fatalf("expected origin inventory 60, got %d", got)
	}
	if got := target.LogisticsStation.Inventory[model.ItemIronOre]; got != 60 {
		t.Fatalf("expected target inventory 60, got %d", got)
	}
	drone := ws.LogisticsDrones[dispatchedDroneID]
	if drone == nil {
		t.Fatalf("expected dispatched drone %s to remain registered", dispatchedDroneID)
	}
	if drone.Status != model.LogisticsDroneIdle {
		t.Fatalf("expected dispatched drone idle after delivery, got %s", drone.Status)
	}
	if got := drone.CargoQty(); got != 0 {
		t.Fatalf("expected dispatched drone cargo cleared, got %d", got)
	}
}

func TestE2E_InterstellarLogisticsDeliveryAfterConfiguration(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	posA, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find origin tile: %v", err)
	}
	if posA == nil {
		t.Fatal("find origin tile: no open tile found")
	}
	origin := newInterstellarLogisticsStationBuilding("station-e2e-interstellar-origin", *posA)
	attachBuilding(ws, origin)
	model.RegisterLogisticsStation(ws, origin)

	posB, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find target tile: %v", err)
	}
	if posB == nil {
		t.Fatal("find target tile: no open tile found")
	}
	target := newInterstellarLogisticsStationBuilding("station-e2e-interstellar-target", *posB)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, target)

	if err := ensureStationFleet(ws, origin); err != nil {
		t.Fatalf("ensure origin fleet: %v", err)
	}
	if err := ensureStationFleet(ws, target); err != nil {
		t.Fatalf("ensure target fleet: %v", err)
	}
	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemHydrogen: 200})
	target.LogisticsStation.SetInventory(model.ItemInventory{})

	res, _ := core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: origin.ID},
		Payload: map[string]any{
			"scope":         "interstellar",
			"item_id":       model.ItemHydrogen,
			"mode":          "supply",
			"local_storage": 50,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("configure origin slot failed: %s (%s)", res.Status, res.Message)
	}
	res, _ = core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: target.ID},
		Payload: map[string]any{
			"scope":         "interstellar",
			"item_id":       model.ItemHydrogen,
			"mode":          "demand",
			"local_storage": 80,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("configure target slot failed: %s (%s)", res.Status, res.Message)
	}

	core.processTick()
	var dispatchedShipID string
	for id, ship := range ws.LogisticsShips {
		if ship != nil && ship.TargetStationID == target.ID && ship.CargoQty() == 80 {
			dispatchedShipID = id
			break
		}
	}
	if dispatchedShipID == "" {
		t.Fatal("expected a dispatched ship carrying 80 hydrogen")
	}

	for i := 0; i < 12 && target.LogisticsStation.Inventory[model.ItemHydrogen] < 80; i++ {
		core.processTick()
	}
	if got := origin.LogisticsStation.Inventory[model.ItemHydrogen]; got != 120 {
		t.Fatalf("expected origin inventory 120, got %d", got)
	}
	if got := target.LogisticsStation.Inventory[model.ItemHydrogen]; got != 80 {
		t.Fatalf("expected target inventory 80, got %d", got)
	}
	ship := ws.LogisticsShips[dispatchedShipID]
	if ship == nil {
		t.Fatalf("expected dispatched ship %s to remain registered", dispatchedShipID)
	}
	if ship.Status != model.LogisticsShipIdle {
		t.Fatalf("expected dispatched ship idle after delivery, got %s", ship.Status)
	}
	if got := ship.CargoQty(); got != 0 {
		t.Fatalf("expected dispatched ship cargo cleared, got %d", got)
	}
}

func findOpenTile(ws *model.WorldState, margin int) (*model.Position, error) {
	if ws == nil {
		return nil, nil
	}
	ws.RLock()
	defer ws.RUnlock()

	for y := margin; y < ws.MapHeight-margin; y++ {
		for x := margin; x < ws.MapWidth-margin; x++ {
			if !ws.Grid[y][x].Terrain.Buildable() {
				continue
			}
			if ws.Grid[y][x].ResourceNodeID != "" {
				continue
			}
			if _, occupied := ws.TileBuilding[model.TileKey(x, y)]; occupied {
				continue
			}
			return &model.Position{X: x, Y: y}, nil
		}
	}
	return nil, nil
}

func findAdjacentOpenTile(ws *model.WorldState, origin model.Position) (*model.Position, error) {
	if ws == nil {
		return nil, nil
	}
	candidates := []model.Position{
		{X: origin.X + 1, Y: origin.Y},
		{X: origin.X - 1, Y: origin.Y},
		{X: origin.X, Y: origin.Y + 1},
		{X: origin.X, Y: origin.Y - 1},
	}
	ws.RLock()
	defer ws.RUnlock()
	for _, candidate := range candidates {
		if !ws.InBounds(candidate.X, candidate.Y) {
			continue
		}
		tile := ws.Grid[candidate.Y][candidate.X]
		if !tile.Terrain.Buildable() || tile.ResourceNodeID != "" {
			continue
		}
		if _, occupied := ws.TileBuilding[model.TileKey(candidate.X, candidate.Y)]; occupied {
			continue
		}
		pos := candidate
		return &pos, nil
	}
	return nil, nil
}
