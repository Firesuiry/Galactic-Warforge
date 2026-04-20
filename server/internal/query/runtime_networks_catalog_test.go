package query

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/visibility"
)

func newQueryTestContext(t *testing.T) (*Layer, *model.WorldState, string) {
	t.Helper()

	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 4},
	}
	maps := mapgen.Generate(cfg, "query-runtime")
	discovery := mapstate.NewDiscovery([]config.PlayerConfig{
		{PlayerID: "p1"},
		{PlayerID: "p2"},
	}, maps)
	ql := New(visibility.New(), maps, discovery)
	ws := model.NewWorldState(maps.PrimaryPlanetID, maps.PrimaryPlanet().Width, maps.PrimaryPlanet().Height)
	return ql, ws, maps.PrimaryPlanetID
}

func makeTestBuilding(id string, owner string, pos model.Position, btype model.BuildingType, runtime model.BuildingRuntime) *model.Building {
	return &model.Building{
		ID:          id,
		Type:        btype,
		OwnerID:     owner,
		Position:    pos,
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 6,
		Runtime:     runtime,
	}
}

func TestPlanetRuntimeReturnsOwnRuntimeViews(t *testing.T) {
	ql, ws, planetID := newQueryTestContext(t)

	station := makeTestBuilding("station-1", "p1", model.Position{X: 4, Y: 4}, model.BuildingTypePlanetaryLogisticsStation, model.BuildingRuntime{
		Params: model.BuildingRuntimeParams{
			Footprint: model.Footprint{Width: 1, Height: 1},
		},
		State: model.BuildingWorkRunning,
	})
	enemyStation := makeTestBuilding("station-2", "p2", model.Position{X: 8, Y: 8}, model.BuildingTypePlanetaryLogisticsStation, model.BuildingRuntime{
		Params: model.BuildingRuntimeParams{
			Footprint: model.Footprint{Width: 1, Height: 1},
		},
		State: model.BuildingWorkRunning,
	})
	ws.Buildings[station.ID] = station
	ws.Buildings[enemyStation.ID] = enemyStation

	ws.LogisticsStations[station.ID] = model.NewLogisticsStationState()
	ws.LogisticsStations[station.ID].Inventory = model.ItemInventory{"iron_ore": 18}
	ws.LogisticsStations[enemyStation.ID] = model.NewLogisticsStationState()

	drone := model.NewLogisticsDroneState("drone-1", station.ID, station.Position)
	drone.Cargo = model.ItemInventory{"iron_ore": 12}
	drone.TargetStationID = station.ID
	ws.LogisticsDrones[drone.ID] = drone

	ship := model.NewLogisticsShipState("ship-1", station.ID, station.Position)
	ship.Cargo = model.ItemInventory{"gear": 6}
	ship.WarpEnabled = true
	ws.LogisticsShips[ship.ID] = ship

	ws.Construction = model.NewConstructionQueue()
	task := &model.ConstructionTask{
		ID:           "c-1",
		PlayerID:     "p1",
		BuildingType: model.BuildingTypeArcSmelter,
		Position:     model.Position{X: 2, Y: 2},
		State:        model.ConstructionPending,
		Cost:         model.BuildCost{Minerals: 12, Energy: 4},
	}
	if err := ws.Construction.Enqueue(task); err != nil {
		t.Fatalf("enqueue task: %v", err)
	}
	enemyTask := &model.ConstructionTask{
		ID:           "c-2",
		PlayerID:     "p2",
		BuildingType: model.BuildingTypeArcSmelter,
		Position:     model.Position{X: 3, Y: 3},
		State:        model.ConstructionPending,
	}
	if err := ws.Construction.Enqueue(enemyTask); err != nil {
		t.Fatalf("enqueue enemy task: %v", err)
	}

	ws.EnemyForces = &model.EnemyForceState{
		ThreatLevel: model.ThreatLevelMedium,
		LastAttack:  88,
		Forces: []model.EnemyForce{{
			ID:           "enemy-force-1",
			Type:         model.EnemyForceTypeSwarm,
			Position:     model.Position{X: 10, Y: 10},
			Strength:     25,
			TargetPlayer: "p1",
			SpawnTick:    40,
		}},
	}
	ws.SensorContacts = map[string]*model.SensorContactState{
		"p1": {
			PlayerID:  "p1",
			ScopeType: model.SensorContactScopePlanet,
			ScopeID:   planetID,
			Contacts: map[string]*model.SensorContact{
				"enemy-force-1": {
					ID:               "enemy-force-1",
					ScopeType:        model.SensorContactScopePlanet,
					ScopeID:          planetID,
					ContactKind:      model.SensorContactKindEnemyForce,
					EntityID:         "enemy-force-1",
					EntityType:       "enemy_force",
					Domain:           model.UnitDomainGround,
					Position:         &model.Position{X: 10, Y: 10},
					Level:            model.SensorContactLevelConfirmedType,
					Classification:   "ground_force",
					ConfirmedType:    string(model.EnemyForceTypeSwarm),
					StrengthEstimate: 25,
					ThreatLevel:      2.5,
					LastUpdatedTick:  90,
					SignalStrength:   12,
					Sources: []model.SensorContactSource{
						{SourceType: model.SensorSourceActiveRadar, SourceID: "radar-1", SourceKind: "building", Strength: 6},
					},
				},
				"enemy-force-1-ghost": {
					ID:              "enemy-force-1-ghost",
					ScopeType:       model.SensorContactScopePlanet,
					ScopeID:         planetID,
					ContactKind:     model.SensorContactKindFalseContact,
					EntityType:      "enemy_force",
					Level:           model.SensorContactLevelUnknownSignal,
					Classification:  "ghost_signature",
					LastUpdatedTick: 90,
					FalseContact:    true,
					Sources: []model.SensorContactSource{
						{SourceType: model.SensorSourceSignalTower, SourceID: "tower-1", SourceKind: "building", Strength: 3},
					},
				},
			},
		},
	}

	view, ok := ql.PlanetRuntime(ws, "p1", planetID, planetID)
	if !ok {
		t.Fatal("expected runtime view")
	}
	if !view.Available {
		t.Fatal("expected active planet runtime to be available")
	}
	if len(view.LogisticsStations) != 1 || view.LogisticsStations[0].BuildingID != station.ID {
		t.Fatalf("expected only own logistics station, got %+v", view.LogisticsStations)
	}
	if len(view.LogisticsDrones) != 1 || view.LogisticsDrones[0].ID != drone.ID {
		t.Fatalf("expected own drone, got %+v", view.LogisticsDrones)
	}
	if len(view.LogisticsShips) != 1 || view.LogisticsShips[0].ID != ship.ID {
		t.Fatalf("expected own ship, got %+v", view.LogisticsShips)
	}
	if len(view.ConstructionTasks) != 1 || view.ConstructionTasks[0].ID != task.ID {
		t.Fatalf("expected own construction task, got %+v", view.ConstructionTasks)
	}
	if len(view.EnemyForces) != 1 || view.EnemyForces[0].ID != "enemy-force-1" {
		t.Fatalf("expected detected enemy force, got %+v", view.EnemyForces)
	}
	if len(view.Contacts) != 2 {
		t.Fatalf("expected runtime contacts including false contact, got %+v", view.Contacts)
	}
	if len(view.Detections) != 1 || len(view.Detections[0].DetectedPositions) != 1 {
		t.Fatalf("expected detection payload, got %+v", view.Detections)
	}
	if view.ThreatLevel != int(model.ThreatLevelMedium) || view.LastAttackTick != 88 {
		t.Fatalf("unexpected threat summary: %+v", view)
	}
}

func TestPlanetNetworksReturnsOwnPowerAndPipelineViews(t *testing.T) {
	ql, ws, planetID := newQueryTestContext(t)

	provider := makeTestBuilding("tesla-1", "p1", model.Position{X: 2, Y: 2}, model.BuildingTypeTeslaTower, model.BuildingRuntime{
		Params: model.BuildingRuntimeParams{
			EnergyGenerate: 12,
			Footprint:      model.Footprint{Width: 1, Height: 1},
		},
		State: model.BuildingWorkRunning,
	})
	consumer := makeTestBuilding("miner-1", "p1", model.Position{X: 3, Y: 2}, model.BuildingTypeMiningMachine, model.BuildingRuntime{
		Params: model.BuildingRuntimeParams{
			EnergyConsume: 3,
			Footprint:     model.Footprint{Width: 1, Height: 1},
		},
		State: model.BuildingWorkRunning,
	})
	enemyProvider := makeTestBuilding("tesla-2", "p2", model.Position{X: 12, Y: 12}, model.BuildingTypeTeslaTower, model.BuildingRuntime{
		Params: model.BuildingRuntimeParams{
			EnergyGenerate: 20,
			Footprint:      model.Footprint{Width: 1, Height: 1},
		},
		State: model.BuildingWorkRunning,
	})

	pump := makeTestBuilding("pump-1", "p1", model.Position{X: 5, Y: 5}, model.BuildingTypeWaterPump, model.BuildingRuntime{
		Params: model.BuildingRuntimeParams{
			Footprint: model.Footprint{Width: 1, Height: 1},
			IOPorts: []model.IOPort{{
				ID:           "out-0",
				Direction:    model.PortOutput,
				Offset:       model.GridOffset{X: 0, Y: 0},
				Capacity:     6,
				AllowedItems: []string{model.ItemWater},
			}},
		},
		State: model.BuildingWorkRunning,
	})
	pump.Storage = &model.StorageState{
		Capacity:     20,
		OutputBuffer: model.ItemInventory{model.ItemWater: 8},
	}

	ws.Buildings[provider.ID] = provider
	ws.Buildings[consumer.ID] = consumer
	ws.Buildings[enemyProvider.ID] = enemyProvider
	ws.Buildings[pump.ID] = pump
	model.RegisterPowerGridBuilding(ws, provider)
	model.RegisterPowerGridBuilding(ws, consumer)
	model.RegisterPowerGridBuilding(ws, enemyProvider)

	ws.Pipelines = &model.PipelineNetworkState{
		Nodes: map[string]*model.PipelineNode{
			"n-1": {ID: "n-1", Position: model.Position{X: 5, Y: 5}, State: model.PipelineNodeState{Buffer: 6, Pressure: 2, FluidID: model.ItemWater}},
			"n-2": {ID: "n-2", Position: model.Position{X: 7, Y: 5}, State: model.PipelineNodeState{Buffer: 4, Pressure: 1, FluidID: model.ItemWater}},
		},
		Segments: map[string]*model.PipelineSegment{
			"s-1": {
				ID:     "s-1",
				From:   "n-1",
				To:     "n-2",
				Params: model.PipelineSegmentParams{FlowRate: 5, Pressure: 2, Capacity: 10},
				State:  model.PipelineSegmentState{CurrentFlow: 3, Buffer: 2, Pressure: 1, FluidID: model.ItemWater},
			},
		},
	}

	view, ok := ql.PlanetNetworks(ws, "p1", planetID, planetID)
	if !ok {
		t.Fatal("expected networks view")
	}
	if !view.Available {
		t.Fatal("expected active planet networks to be available")
	}
	if len(view.PowerNetworks) != 1 {
		t.Fatalf("expected 1 own power network, got %+v", view.PowerNetworks)
	}
	if len(view.PowerLinks) != 1 {
		t.Fatalf("expected provider-consumer power link, got %+v", view.PowerLinks)
	}
	if len(view.PowerCoverage) < 2 {
		t.Fatalf("expected power coverage for own buildings, got %+v", view.PowerCoverage)
	}
	if len(view.PipelineNodes) != 2 || len(view.PipelineSegments) != 1 || len(view.PipelineEndpoints) != 1 {
		t.Fatalf("unexpected pipeline view: nodes=%d segments=%d endpoints=%d", len(view.PipelineNodes), len(view.PipelineSegments), len(view.PipelineEndpoints))
	}
}

func TestCatalogReturnsMetadataSlices(t *testing.T) {
	ql, _, _ := newQueryTestContext(t)

	view := ql.Catalog()
	if len(view.Buildings) == 0 || len(view.Items) == 0 || len(view.Recipes) == 0 || len(view.Techs) == 0 {
		t.Fatalf("expected non-empty catalog slices, got %+v", view)
	}
	if len(view.WorldUnits) != 2 {
		t.Fatalf("expected exactly 2 public world units, got %+v", view.WorldUnits)
	}
	worldUnitIDs := map[string]bool{}
	for _, entry := range view.WorldUnits {
		worldUnitIDs[entry.ID] = true
		if !entry.Public {
			t.Fatalf("expected public world unit entry, got %+v", entry)
		}
		if entry.ProductionMode != model.UnitProductionModeWorldProduce || entry.RuntimeClass != model.UnitRuntimeClassWorld {
			t.Fatalf("expected world unit production metadata, got %+v", entry)
		}
	}
	for _, id := range []string{"worker", "soldier"} {
		if !worldUnitIDs[id] {
			t.Fatalf("expected %s in catalog world_units, got %+v", id, view.WorldUnits)
		}
	}
	if view.Warfare == nil {
		t.Fatal("expected warfare catalog section")
	}
	if len(view.Warfare.BaseFrames) == 0 || len(view.Warfare.BaseHulls) == 0 {
		t.Fatalf("expected designable base frames and hulls, got %+v", view.Warfare)
	}
	if len(view.Warfare.PublicBlueprints) != 4 {
		t.Fatalf("expected 4 public preset blueprints, got %+v", view.Warfare.PublicBlueprints)
	}
	componentCategories := map[model.WarComponentCategory]bool{}
	for _, component := range view.Warfare.Components {
		componentCategories[component.Category] = true
	}
	for _, category := range []model.WarComponentCategory{
		model.WarComponentCategoryPower,
		model.WarComponentCategoryPropulsion,
		model.WarComponentCategoryDefense,
		model.WarComponentCategorySensor,
		model.WarComponentCategoryWeapon,
		model.WarComponentCategoryUtility,
	} {
		if !componentCategories[category] {
			t.Fatalf("expected warfare component category %s, got %+v", category, view.Warfare.Components)
		}
	}
	blueprintByID := map[string]model.WarPublicBlueprintCatalogEntry{}
	for _, blueprint := range view.Warfare.PublicBlueprints {
		blueprintByID[blueprint.ID] = blueprint
		if blueprint.Source != model.WarBlueprintSourcePreset {
			t.Fatalf("expected preset public blueprint source, got %+v", blueprint)
		}
		if blueprint.VisibleTechID == "" || len(blueprint.ProducerRecipes) == 0 || blueprint.DeployCommand == "" {
			t.Fatalf("expected deployment metadata on public blueprint, got %+v", blueprint)
		}
	}
	if blueprintByID["prototype"].BaseFrameID == "" || blueprintByID["prototype"].Domain != model.UnitDomainGround {
		t.Fatalf("expected prototype preset blueprint to bind a ground frame, got %+v", blueprintByID["prototype"])
	}
	if blueprintByID["precision_drone"].BaseFrameID == "" || blueprintByID["precision_drone"].Domain != model.UnitDomainAir {
		t.Fatalf("expected precision_drone preset blueprint to bind an air frame, got %+v", blueprintByID["precision_drone"])
	}
	if blueprintByID["corvette"].BaseHullID == "" || blueprintByID["corvette"].Domain != model.UnitDomainSpace {
		t.Fatalf("expected corvette preset blueprint to bind a space hull, got %+v", blueprintByID["corvette"])
	}
	if blueprintByID["destroyer"].BaseHullID == "" || blueprintByID["destroyer"].Domain != model.UnitDomainSpace {
		t.Fatalf("expected destroyer preset blueprint to bind a space hull, got %+v", blueprintByID["destroyer"])
	}

	var mining *BuildingCatalogEntry
	for i := range view.Buildings {
		if view.Buildings[i].ID == model.BuildingTypeMiningMachine {
			mining = &view.Buildings[i]
			break
		}
	}
	if mining == nil || mining.Name == "" || mining.Color == "" || mining.IconKey == "" {
		t.Fatalf("expected mining machine metadata, got %+v", mining)
	}

	var silo *BuildingCatalogEntry
	for i := range view.Buildings {
		if view.Buildings[i].ID == model.BuildingTypeVerticalLaunchingSilo {
			silo = &view.Buildings[i]
			break
		}
	}
	if silo == nil {
		t.Fatal("expected vertical launching silo metadata")
	}
	if silo.DefaultRecipeID != "small_carrier_rocket" {
		t.Fatalf("expected silo default recipe small_carrier_rocket, got %+v", silo)
	}

	foundTech := false
	for _, tech := range view.Techs {
		if tech.ID == "electromagnetism" {
			foundTech = true
			if tech.Color == "" || tech.IconKey == "" {
				t.Fatalf("expected tech display metadata, got %+v", tech)
			}
			break
		}
	}
	if !foundTech {
		t.Fatal("expected electromagnetism tech metadata")
	}
}
