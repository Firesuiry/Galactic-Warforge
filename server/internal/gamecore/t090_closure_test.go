package gamecore

import (
	"encoding/json"
	"reflect"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func newTwoPlanetTestCore(t *testing.T) (*GameCore, *config.Config, *mapconfig.Config) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:               "t090-test-seed",
			MaxTickRate:           10,
			InitialActivePlanetID: "planet-1-2",
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 2, GasGiantRatio: 0},
		Planet: mapconfig.PlanetConfig{Width: 24, Height: 24, ResourceDensity: 12},
		Overrides: mapconfig.OverridesConfig{
			Planets: map[string]mapconfig.PlanetOverride{
				"planet-1-2": {Kind: "gas_giant"},
			},
		},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	return New(cfg, maps, queue.New(), NewEventBus(), nil), cfg, mapCfg
}

func placeBuilding(ws *model.WorldState, building *model.Building) {
	ws.Buildings[building.ID] = building
	model.RegisterPowerGridBuilding(ws, building)
	model.RegisterLogisticsStation(ws, building)
	key := model.TileKey(building.Position.X, building.Position.Y)
	ws.TileBuilding[key] = building.ID
	ws.Grid[building.Position.Y][building.Position.X].BuildingID = building.ID
}

func newBuilding(id string, btype model.BuildingType, owner string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(btype, 1)
	building := &model.Building{
		ID:          id,
		Type:        btype,
		OwnerID:     owner,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingStorage(building)
	model.InitBuildingProduction(building)
	model.InitBuildingEnergyStorage(building)
	model.InitBuildingSorter(building)
	model.InitBuildingLogisticsStation(building)
	return building
}

func issueInternalCommand(core *GameCore, playerID string, cmd model.Command) model.CommandResult {
	results, _ := core.executeRequest(&model.QueuedRequest{
		PlayerID: playerID,
		Request: model.CommandRequest{
			RequestID:  "req-test",
			IssuerType: "player",
			IssuerID:   playerID,
			Commands:   []model.Command{cmd},
		},
	})
	if len(results) != 1 {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: "missing command result"}
	}
	return results[0]
}

func TestStartResearchRequiresRunningLabAndStoredMatrices(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	res, _ := core.execStartResearch(ws, "p1", model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "electromagnetism",
		},
	})
	if res.Code == model.CodeOK {
		t.Fatalf("expected research start to fail without running lab and matrices, got OK")
	}
}

func TestResearchConsumesRealMatricesFromRunningLabs(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-1", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	if _, _, err := lab.Storage.Load("electromagnetic_matrix", 10); err != nil {
		t.Fatalf("load matrices into lab: %v", err)
	}
	placeBuilding(ws, lab)

	power := newBuilding("power-1", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	placeBuilding(ws, power)

	res, _ := core.execStartResearch(ws, "p1", model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "electromagnetism",
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("expected research start to succeed once lab and matrices exist, got %s (%s)", res.Code, res.Message)
	}

	before := 0
	if lab.Storage != nil {
		before = lab.Storage.OutputQuantity("electromagnetic_matrix")
	}
	for i := 0; i < 5; i++ {
		core.processTick()
	}
	after := 0
	if lab.Storage != nil {
		after = lab.Storage.OutputQuantity("electromagnetic_matrix")
	}
	if after >= before {
		t.Fatalf("expected matrix inventory to decrease during research, before=%d after=%d", before, after)
	}
}

func TestSwitchActivePlanetAndSaveRestorePreserveMultiPlanetRuntime(t *testing.T) {
	core, cfg, mapCfg := newTwoPlanetTestCore(t)

	res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("switch_active_planet"),
		Payload: map[string]any{
			"planet_id": "planet-1-1",
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("expected switch_active_planet to succeed, got %s (%s)", res.Code, res.Message)
	}
	if core.World().PlanetID != "planet-1-1" {
		t.Fatalf("expected active world to switch to planet-1-1, got %s", core.World().PlanetID)
	}

	save, err := core.ExportSaveFile("test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	raw, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal save: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode save payload: %v", err)
	}
	snap, _ := payload["snapshot"].(map[string]any)
	planetWorlds, _ := snap["planet_worlds"].(map[string]any)
	if len(planetWorlds) < 2 {
		t.Fatalf("expected save snapshot to contain multi-planet runtime worlds, got %v", snap["planet_worlds"])
	}

	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	restored, err := NewFromSave(cfg, maps, queue.New(), NewEventBus(), nil, save)
	if err != nil {
		t.Fatalf("restore save: %v", err)
	}
	if restored.ActivePlanetID() != "planet-1-1" {
		t.Fatalf("expected restored active planet planet-1-1, got %s", restored.ActivePlanetID())
	}
}

func TestInterstellarLogisticsDispatchesAcrossLoadedPlanets(t *testing.T) {
	core, _, _ := newTwoPlanetTestCore(t)

	origin := core.World()
	originStation := newBuilding("origin-station", model.BuildingTypeInterstellarLogisticsStation, "p1", model.Position{X: 6, Y: 6})
	if originStation.LogisticsStation == nil {
		t.Fatal("expected origin logistics station state")
	}
	originStation.LogisticsStation.Interstellar.Enabled = true
	originStation.LogisticsStation.InterstellarSettings = map[string]model.LogisticsStationItemSetting{
		"hydrogen": {ItemID: "hydrogen", Mode: model.LogisticsStationModeSupply, LocalStorage: 50},
	}
	originStation.LogisticsStation.Inventory = model.ItemInventory{"hydrogen": 80}
	originStation.LogisticsStation.RefreshCapacityCache()
	placeBuilding(origin, originStation)
	model.RegisterLogisticsStation(origin, originStation)
	ship := model.NewLogisticsShipState("ship-1", originStation.ID, originStation.Position)
	ship.WarpEnabled = false
	origin.LogisticsShips[ship.ID] = ship

	switchRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("switch_active_planet"),
		Payload: map[string]any{
			"planet_id": "planet-1-1",
		},
	})
	if switchRes.Code != model.CodeOK {
		t.Fatalf("switch to rocky planet failed: %s (%s)", switchRes.Code, switchRes.Message)
	}

	target := core.World()
	targetStation := newBuilding("target-station", model.BuildingTypeInterstellarLogisticsStation, "p1", model.Position{X: 8, Y: 8})
	if targetStation.LogisticsStation == nil {
		t.Fatal("expected target logistics station state")
	}
	targetStation.LogisticsStation.Interstellar.Enabled = true
	targetStation.LogisticsStation.InterstellarSettings = map[string]model.LogisticsStationItemSetting{
		"hydrogen": {ItemID: "hydrogen", Mode: model.LogisticsStationModeDemand, LocalStorage: 60},
	}
	targetStation.LogisticsStation.RefreshCapacityCache()
	placeBuilding(target, targetStation)
	model.RegisterLogisticsStation(target, targetStation)

	switchBack := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("switch_active_planet"),
		Payload: map[string]any{
			"planet_id": "planet-1-2",
		},
	})
	if switchBack.Code != model.CodeOK {
		t.Fatalf("switch back to gas planet failed: %s (%s)", switchBack.Code, switchBack.Message)
	}

	for i := 0; i < 12; i++ {
		core.processTick()
	}

	checkTarget := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("switch_active_planet"),
		Payload: map[string]any{
			"planet_id": "planet-1-1",
		},
	})
	if checkTarget.Code != model.CodeOK {
		t.Fatalf("switch to target planet for verification failed: %s (%s)", checkTarget.Code, checkTarget.Message)
	}
	target = core.World()
	got := 0
	if station := target.LogisticsStations[targetStation.ID]; station != nil && station.Inventory != nil {
		got = station.Inventory["hydrogen"]
	}
	if got <= 0 {
		t.Fatalf("expected cross-planet logistics to deliver hydrogen, got %d", got)
	}
}

func TestSetRayReceiverModeRequiresUnlockAndPersistsOnBuilding(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	receiver := newBuilding("rr-1", model.BuildingTypeRayReceiver, "p1", model.Position{X: 6, Y: 6})
	placeBuilding(ws, receiver)

	denied := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("set_ray_receiver_mode"),
		Payload: map[string]any{
			"building_id": "rr-1",
			"mode":        "photon",
		},
	})
	if denied.Code == model.CodeOK {
		t.Fatalf("expected photon mode to require tech unlock")
	}

	grantTechs(ws, "p1", "dirac_inversion")
	allowed := issueInternalCommand(core, "p1", model.Command{
		Type: model.CommandType("set_ray_receiver_mode"),
		Payload: map[string]any{
			"building_id": "rr-1",
			"mode":        "photon",
		},
	})
	if allowed.Code != model.CodeOK {
		t.Fatalf("expected photon mode switch to succeed, got %s (%s)", allowed.Code, allowed.Message)
	}
	if receiver.Runtime.Functions.RayReceiver == nil || receiver.Runtime.Functions.RayReceiver.Mode != model.RayReceiverModePhoton {
		t.Fatalf("expected ray receiver mode to be photon, got %+v", receiver.Runtime.Functions.RayReceiver)
	}
}

func TestT091SRPlasmaTurretDamagesEnemyForceWhenPowered(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	turret := newBuilding("sr-1", model.BuildingTypeSRPlasmaTurret, "p1", model.Position{X: 6, Y: 6})
	turret.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, turret)

	ws.EnemyForces = &model.EnemyForceState{
		Forces: []model.EnemyForce{{
			ID:           "force-1",
			Position:     model.Position{X: 7, Y: 6},
			Strength:     120,
			SpreadRadius: 1,
			TargetPlayer: "p1",
		}},
	}

	events := settleTurrets(ws)
	if len(events) == 0 {
		t.Fatalf("expected sr_plasma_turret to emit damage events")
	}
	if got := ws.EnemyForces.Forces[0].Strength; got >= 120 {
		t.Fatalf("expected sr_plasma_turret to reduce enemy force strength, got %d", got)
	}

	turret.Runtime.State = model.BuildingWorkNoPower
	ws.EnemyForces.Forces[0].Strength = 120
	events = settleTurrets(ws)
	if len(events) != 0 {
		t.Fatalf("expected no_power sr_plasma_turret to stop attacking, got %d events", len(events))
	}
	if got := ws.EnemyForces.Forces[0].Strength; got != 120 {
		t.Fatalf("expected no_power sr_plasma_turret not to change strength, got %d", got)
	}
}

func TestT091PlanetaryShieldGeneratorChargesAndAbsorbsDamage(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	generator := newBuilding("shield-1", model.BuildingTypePlanetaryShieldGenerator, "p1", model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2})
	generator.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, generator)

	for i := 0; i < 20; i++ {
		settlePlanetaryShields(ws)
	}

	shieldField := reflect.ValueOf(&generator.Runtime.Functions).Elem().FieldByName("Shield")
	if !shieldField.IsValid() || shieldField.IsNil() {
		t.Fatalf("expected planetary_shield_generator runtime to include Shield module")
	}

	module := shieldField.Elem()
	currentCharge := module.FieldByName("CurrentCharge")
	if !currentCharge.IsValid() {
		t.Fatalf("expected Shield module to expose CurrentCharge")
	}
	if got := int(currentCharge.Int()); got <= 0 {
		t.Fatalf("expected planetary_shield_generator to charge over time, got %d", got)
	}

	ws.EnemyForces = &model.EnemyForceState{
		Forces: []model.EnemyForce{{
			ID:           "force-1",
			Position:     model.Position{X: 1, Y: 1},
			Strength:     90,
			SpreadRadius: 1,
			TargetPlayer: "p1",
		}},
	}

	beforeHP := generator.HP
	events := core.executeEnemyAttack(ws, model.AttackRhythm{StrengthPerAttack: 30})
	if generator.HP != beforeHP {
		t.Fatalf("expected planetary shield to absorb enemy attack before HP loss, before=%d after=%d", beforeHP, generator.HP)
	}

	foundAbsorb := false
	for _, evt := range events {
		if evt == nil || evt.EventType != model.EvtDamageApplied {
			continue
		}
		absorbedRaw, ok := evt.Payload["shield_absorbed"]
		if !ok {
			continue
		}
		if eventPayloadInt(absorbedRaw) > 0 {
			foundAbsorb = true
		}
		if _, ok := evt.Payload["shield_remaining"]; !ok {
			t.Fatalf("expected damage event to expose shield_remaining, payload=%+v", evt.Payload)
		}
	}
	if !foundAbsorb {
		t.Fatalf("expected shield absorption to be reported in damage events")
	}
}

func TestT091SelfEvolutionLabSupportsResearchAndMatrixRecipes(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	researchLab := newBuilding("sel-research", model.BuildingTypeSelfEvolutionLab, "p1", model.Position{X: 6, Y: 6})
	researchLab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, researchLab)

	if researchLab.Runtime.Functions.Research == nil || researchLab.Runtime.Functions.Production == nil || researchLab.Storage == nil {
		t.Fatalf("expected self_evolution_lab to expose research + production + storage runtime, got %+v", researchLab.Runtime.Functions)
	}

	if _, _, err := researchLab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}

	res, _ := core.execStartResearch(ws, "p1", model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "electromagnetism",
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("expected self_evolution_lab to start research, got %s (%s)", res.Code, res.Message)
	}

	productionLab := newBuilding("sel-production", model.BuildingTypeSelfEvolutionLab, "p1", model.Position{X: 8, Y: 6})
	productionLab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, productionLab)
	productionLab.Production.RecipeID = "electromagnetic_matrix"

	if accepted, remaining, err := productionLab.Storage.Receive(model.ItemCircuitBoard, 1); err != nil || accepted != 1 || remaining != 0 {
		t.Fatalf("prime self_evolution_lab with circuit_board failed: accepted=%d remaining=%d err=%v", accepted, remaining, err)
	}
	if accepted, remaining, err := productionLab.Storage.Receive(model.ItemEnergeticGraphite, 1); err != nil || accepted != 1 || remaining != 0 {
		t.Fatalf("prime self_evolution_lab with energetic_graphite failed: accepted=%d remaining=%d err=%v", accepted, remaining, err)
	}

	for i := 0; i < 70; i++ {
		settleProduction(ws)
		settleStorage(ws)
	}

	if got := productionLab.Storage.OutputQuantity(model.ItemElectromagneticMatrix); got <= 0 {
		t.Fatalf("expected self_evolution_lab to produce electromagnetic_matrix, got %d", got)
	}
}

func eventPayloadInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int8:
		return int(n)
	case int16:
		return int(n)
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float32:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}
