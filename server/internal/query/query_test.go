package query

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/terrain"
	"siliconworld/internal/visibility"
)

func TestPlanetSummaryShowsStaticResourceCountAfterDiscovery(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 2},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 8},
	}
	maps := mapgen.Generate(cfg, "query-planet-resources")
	discovery := mapstate.NewDiscovery([]config.PlayerConfig{{PlayerID: "p1"}}, maps)
	ql := New(visibility.New(), maps, discovery)

	targetPlanetID := "planet-2-1"
	discovery.DiscoverSystem("p1", "sys-2")
	discovery.DiscoverPlanet("p1", targetPlanetID)

	ws := model.NewWorldState(maps.PrimaryPlanetID, maps.PrimaryPlanet().Width, maps.PrimaryPlanet().Height)
	view, ok := ql.PlanetSummary(ws, "p1", targetPlanetID)
	if !ok {
		t.Fatal("expected planet summary")
	}
	if view.ResourceCount == 0 {
		t.Fatal("expected discovered non-active planet to expose static resource count")
	}
}

func TestPlanetSummaryCountsOnlyVisibleDynamicEntities(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 64, 64)
	ws.Buildings["radar"] = &model.Building{
		ID:          "radar",
		OwnerID:     "p1",
		Position:    model.Position{X: 5, Y: 5},
		VisionRange: 12,
	}
	ws.Buildings["enemy-visible"] = &model.Building{
		ID:          "enemy-visible",
		OwnerID:     "p2",
		Position:    model.Position{X: 10, Y: 10},
		VisionRange: 2,
	}
	ws.Buildings["enemy-hidden"] = &model.Building{
		ID:          "enemy-hidden",
		OwnerID:     "p2",
		Position:    model.Position{X: 48, Y: 48},
		VisionRange: 2,
	}
	ws.Units["worker"] = &model.Unit{
		ID:          "worker",
		OwnerID:     "p1",
		Position:    model.Position{X: 6, Y: 5},
		VisionRange: 4,
	}
	ws.Units["enemy-visible"] = &model.Unit{
		ID:          "enemy-visible",
		OwnerID:     "p2",
		Position:    model.Position{X: 9, Y: 9},
		VisionRange: 2,
	}
	ws.Units["enemy-hidden"] = &model.Unit{
		ID:          "enemy-hidden",
		OwnerID:     "p2",
		Position:    model.Position{X: 52, Y: 52},
		VisionRange: 2,
	}
	ws.Resources["r-1"] = &model.ResourceNodeState{ID: "r-1", PlanetID: planetID, Position: model.Position{X: 8, Y: 8}}
	ws.Resources["r-2"] = &model.ResourceNodeState{ID: "r-2", PlanetID: planetID, Position: model.Position{X: 50, Y: 50}}

	view, ok := ql.PlanetSummary(ws, "p1", planetID)
	if !ok {
		t.Fatal("expected summary view")
	}
	if view.BuildingCount != 2 {
		t.Fatalf("expected 2 visible buildings, got %d", view.BuildingCount)
	}
	if view.UnitCount != 2 {
		t.Fatalf("expected 2 visible units, got %d", view.UnitCount)
	}
	if view.ResourceCount != 2 {
		t.Fatalf("expected total resource count 2, got %d", view.ResourceCount)
	}
}

func TestPlanetSceneSlicesDiscoveredPlanetBounds(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 2},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 12, ResourceDensity: 8},
	}
	maps := mapgen.Generate(cfg, "query-planet-scene")
	discovery := mapstate.NewDiscovery([]config.PlayerConfig{{PlayerID: "p1"}}, maps)
	ql := New(visibility.New(), maps, discovery)

	targetPlanetID := "planet-2-1"
	discovery.DiscoverSystem("p1", "sys-2")
	discovery.DiscoverPlanet("p1", targetPlanetID)

	ws := model.NewWorldState(maps.PrimaryPlanetID, maps.PrimaryPlanet().Width, maps.PrimaryPlanet().Height)
	view, ok := ql.PlanetScene(ws, "p1", targetPlanetID, PlanetSceneRequest{
		X:      3,
		Y:      4,
		Width:  5,
		Height: 4,
	})
	if !ok {
		t.Fatal("expected planet scene view")
	}
	if view.Bounds != (SceneBounds{X: 3, Y: 4, Width: 5, Height: 4}) {
		t.Fatalf("unexpected bounds: %+v", view.Bounds)
	}
	if len(view.Terrain) != 4 || len(view.Terrain[0]) != 5 {
		t.Fatalf("expected 4x5 terrain slice, got %dx%d", len(view.Terrain), len(view.Terrain[0]))
	}
	for _, resource := range view.Resources {
		if resource.Position.X < 3 || resource.Position.X >= 8 || resource.Position.Y < 4 || resource.Position.Y >= 8 {
			t.Fatalf("resource out of bounds: %+v", resource.Position)
		}
	}
	if view.ResourceCount == 0 {
		t.Fatal("expected discovered planet to report total resources")
	}
}

func TestPlanetOverviewAggregatesWholePlanet(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 20, Height: 20, ResourceDensity: 8},
	}
	maps := mapgen.Generate(cfg, "query-planet-overview")
	discovery := mapstate.NewDiscovery([]config.PlayerConfig{{PlayerID: "p1"}}, maps)
	ql := New(visibility.New(), maps, discovery)

	targetPlanetID := maps.PrimaryPlanetID
	discovery.DiscoverGalaxy("p1", maps.PrimaryGalaxy().ID)
	discovery.DiscoverSystem("p1", maps.PrimaryGalaxy().SystemIDs[0])
	discovery.DiscoverPlanet("p1", targetPlanetID)

	ws := model.NewWorldState(targetPlanetID, maps.PrimaryPlanet().Width, maps.PrimaryPlanet().Height)
	for _, resource := range staticPlanetResources(maps.PrimaryPlanet()) {
		ws.Resources[resource.ID] = resource
	}
	view, ok := ql.PlanetOverview(ws, "p1", targetPlanetID, PlanetOverviewRequest{Step: 5})
	if !ok {
		t.Fatal("expected planet overview view")
	}
	if view.Step != 5 {
		t.Fatalf("expected step 5, got %d", view.Step)
	}
	if view.CellsWidth != 4 || view.CellsHeight != 4 {
		t.Fatalf("expected 4x4 overview cells, got %dx%d", view.CellsWidth, view.CellsHeight)
	}
	if len(view.Terrain) != 4 || len(view.Terrain[0]) != 4 {
		t.Fatalf("expected 4x4 terrain aggregate, got %dx%d", len(view.Terrain), len(view.Terrain[0]))
	}
	if len(view.ResourceCounts) != 4 || len(view.ResourceCounts[0]) != 4 {
		t.Fatalf("expected 4x4 resource aggregate, got %dx%d", len(view.ResourceCounts), len(view.ResourceCounts[0]))
	}
	if view.ResourceCount == 0 {
		t.Fatal("expected overview to expose total resources")
	}
}

func TestStateSummaryExposesVictoryMetadata(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 20, 20)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID:  "p1",
		TeamID:    "p1",
		IsAlive:   true,
		Inventory: model.ItemInventory{"iron_ore": 8},
		Stats:     model.NewPlayerStats("p1"),
	}
	ws.Players["p2"] = &model.PlayerState{
		PlayerID: "p2",
		TeamID:   "p2",
		IsAlive:  true,
	}

	summary := ql.Summary(ws, "p1", model.VictoryState{
		WinnerID:    "p1",
		Reason:      "game_win",
		VictoryRule: "hybrid",
		TechID:      "mission_complete",
	})

	if summary.ActivePlanetID != planetID {
		t.Fatalf("expected active planet %s, got %s", planetID, summary.ActivePlanetID)
	}
	if summary.Winner != "p1" {
		t.Fatalf("expected winner p1, got %q", summary.Winner)
	}
	if summary.VictoryReason != "game_win" {
		t.Fatalf("expected victory_reason game_win, got %q", summary.VictoryReason)
	}
	if summary.VictoryRule != "hybrid" {
		t.Fatalf("expected victory_rule hybrid, got %q", summary.VictoryRule)
	}
	if summary.Players["p2"].Inventory != nil {
		t.Fatalf("expected enemy inventory to stay hidden, got %+v", summary.Players["p2"])
	}
}

func TestFleetListReturnsNonNilEmptySlice(t *testing.T) {
	ql, _, _ := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()
	spaceRuntime.EnsurePlayerSystem("p1", "sys-1")

	fleets := ql.Fleets("p1", spaceRuntime)
	if fleets == nil {
		t.Fatal("expected fleets to be a non-nil empty slice")
	}

	body, err := json.Marshal(fleets)
	if err != nil {
		t.Fatalf("marshal fleets: %v", err)
	}
	if string(body) != "[]" {
		t.Fatalf("expected empty fleet list to marshal as [], got %s", string(body))
	}
}

func TestFleetListIncludesFleetDetailsWhenPresent(t *testing.T) {
	ql, _, _ := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()
	systemRuntime := spaceRuntime.EnsurePlayerSystem("p1", "sys-1")
	systemRuntime.Fleets["fleet-alpha"] = &model.SpaceFleet{
		ID:               "fleet-alpha",
		OwnerID:          "p1",
		SystemID:         "sys-1",
		SourceBuildingID: "base-1",
		Formation:        model.FormationTypeWedge,
		State:            model.FleetStateIdle,
		Units:            []model.FleetUnitStack{{BlueprintID: "corvette", Count: 2}},
		Weapon: model.WeaponState{
			Type:     "laser",
			Damage:   40,
			FireRate: 10,
			Range:    24,
		},
		Shield: model.ShieldState{
			Level:         40,
			MaxLevel:      40,
			RechargeRate:  2,
			RechargeDelay: 10,
		},
		LastAttackTick: 99,
	}

	fleets := ql.Fleets("p1", spaceRuntime)
	if len(fleets) != 1 {
		t.Fatalf("expected one fleet, got %+v", fleets)
	}
	if fleets[0].FleetID != "fleet-alpha" || fleets[0].SystemID != "sys-1" {
		t.Fatalf("unexpected fleet view: %+v", fleets[0])
	}
	if fleets[0].Formation != string(model.FormationTypeWedge) {
		t.Fatalf("expected wedge formation, got %+v", fleets[0])
	}
	if len(fleets[0].Units) != 1 || fleets[0].Units[0].BlueprintID != "corvette" {
		t.Fatalf("expected corvette blueprint stack, got %+v", fleets[0].Units)
	}
}

func TestSystemRuntimeIncludesDysonSphereForDiscoveredSystem(t *testing.T) {
	ql, _, _ := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()
	state := model.EnsureDysonSphereState(spaceRuntime, "p1", "sys-1")
	state.AddLayer(0, 1.2)
	state.Layers[0].Nodes = append(state.Layers[0].Nodes, model.DysonNode{
		ID:           "node-1",
		LayerIndex:   0,
		Latitude:     10,
		Longitude:    20,
		EnergyOutput: 10,
		Built:        true,
	})
	state.Layers[0].Shells = append(state.Layers[0].Shells, model.DysonShell{
		ID:           "shell-1",
		LayerIndex:   0,
		LatitudeMin:  -10,
		LatitudeMax:  10,
		Coverage:     0.35,
		EnergyOutput: 350,
		Built:        true,
	})
	state.TotalEnergy = 360

	view, ok := ql.SystemRuntime("p1", "sys-1", "", nil, spaceRuntime)
	if !ok {
		t.Fatal("expected system runtime view")
	}
	if view.DysonSphere == nil {
		t.Fatal("expected dyson sphere view for discovered system")
	}
	if view.DysonSphere.SystemID != "sys-1" || len(view.DysonSphere.Layers) != 1 {
		t.Fatalf("unexpected dyson sphere payload: %+v", view.DysonSphere)
	}

	view.DysonSphere.Layers[0].Nodes[0].ID = "mutated"
	if got := model.GetDysonSphereState(spaceRuntime, "p1", "sys-1").Layers[0].Nodes[0].ID; got != "node-1" {
		t.Fatalf("expected returned dyson sphere to be copied, got %q", got)
	}
}

func TestSystemRuntimeIncludesActivePlanetContextForCurrentSystem(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()

	ws.Buildings["ejector-1"] = &model.Building{
		ID:      "ejector-1",
		Type:    model.BuildingTypeEMRailEjector,
		OwnerID: "p1",
		Runtime: model.BuildingRuntime{State: model.BuildingWorkIdle},
	}
	ws.Buildings["silo-1"] = &model.Building{
		ID:      "silo-1",
		Type:    model.BuildingTypeVerticalLaunchingSilo,
		OwnerID: "p1",
		Runtime: model.BuildingRuntime{State: model.BuildingWorkIdle},
	}
	ws.Buildings["receiver-1"] = &model.Building{
		ID:      "receiver-1",
		Type:    model.BuildingTypeRayReceiver,
		OwnerID: "p1",
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Functions: model.BuildingFunctionModules{
				RayReceiver: &model.RayReceiverModule{Mode: model.RayReceiverModePhoton},
			},
		},
	}
	ws.Buildings["receiver-2"] = &model.Building{
		ID:      "receiver-2",
		Type:    model.BuildingTypeRayReceiver,
		OwnerID: "p1",
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Functions: model.BuildingFunctionModules{
				RayReceiver: &model.RayReceiverModule{Mode: model.RayReceiverModePower},
			},
		},
	}
	ws.Buildings["receiver-foreign"] = &model.Building{
		ID:      "receiver-foreign",
		Type:    model.BuildingTypeRayReceiver,
		OwnerID: "p2",
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Functions: model.BuildingFunctionModules{
				RayReceiver: &model.RayReceiverModule{Mode: model.RayReceiverModeHybrid},
			},
		},
	}

	view, ok := ql.SystemRuntime("p1", "sys-1", planetID, ws, spaceRuntime)
	if !ok {
		t.Fatal("expected system runtime view")
	}
	if view.ActivePlanetContext == nil {
		t.Fatal("expected active planet context")
	}
	if view.ActivePlanetContext.PlanetID != planetID {
		t.Fatalf("expected active planet context for %s, got %+v", planetID, view.ActivePlanetContext)
	}
	if view.ActivePlanetContext.EMRailEjectorCount != 1 {
		t.Fatalf("expected one ejector, got %+v", view.ActivePlanetContext)
	}
	if view.ActivePlanetContext.VerticalLaunchingSiloCount != 1 {
		t.Fatalf("expected one silo, got %+v", view.ActivePlanetContext)
	}
	if view.ActivePlanetContext.RayReceiverCount != 2 {
		t.Fatalf("expected two owned ray receivers, got %+v", view.ActivePlanetContext)
	}
	if got := view.ActivePlanetContext.RayReceiverModes[string(model.RayReceiverModePhoton)]; got != 1 {
		t.Fatalf("expected photon mode count 1, got %+v", view.ActivePlanetContext.RayReceiverModes)
	}
	if got := view.ActivePlanetContext.RayReceiverModes[string(model.RayReceiverModePower)]; got != 1 {
		t.Fatalf("expected power mode count 1, got %+v", view.ActivePlanetContext.RayReceiverModes)
	}
}

func TestSystemRuntimeOmitsActivePlanetContextWhenActivePlanetNotInSystem(t *testing.T) {
	ql, ws, _ := newPlanetQueryFixture(t, 16, 16)
	spaceRuntime := model.NewSpaceRuntimeState()

	view, ok := ql.SystemRuntime("p1", "sys-1", "planet-other", ws, spaceRuntime)
	if !ok {
		t.Fatal("expected system runtime view")
	}
	if view.ActivePlanetContext != nil {
		t.Fatalf("expected no active planet context, got %+v", view.ActivePlanetContext)
	}
}

func TestOfficialMidgameSystemRuntimeExposesDysonBootstrapAnchors(t *testing.T) {
	cfgPath := filepath.Join("..", "..", "config-midgame.yaml")
	mapCfgPath := filepath.Join("..", "..", "map-midgame.yaml")

	rawCfg, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read midgame config: %v", err)
	}

	tempCfgPath := filepath.Join(t.TempDir(), "config-midgame.yaml")
	rewritten := strings.Replace(string(rawCfg), `data_dir: "data-midgame"`, `data_dir: "`+t.TempDir()+`"`, 1)
	if err := os.WriteFile(tempCfgPath, []byte(rewritten), 0o644); err != nil {
		t.Fatalf("write temp midgame config: %v", err)
	}

	cfg, err := config.Load(tempCfgPath)
	if err != nil {
		t.Fatalf("load midgame config: %v", err)
	}
	mapCfg, err := mapconfig.Load(mapCfgPath)
	if err != nil {
		t.Fatalf("load midgame map config: %v", err)
	}

	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core := gamecore.New(cfg, maps, queue.New(), gamecore.NewEventBus(), nil)
	ql := New(visibility.New(), maps, core.Discovery())

	view, ok := ql.SystemRuntime("p1", "sys-1", core.ActivePlanetID(), core.World(), core.SpaceRuntime())
	if !ok {
		t.Fatal("expected official midgame system runtime")
	}
	if !view.Available {
		t.Fatalf("expected official midgame system runtime to be available, got %+v", view)
	}
	if view.ActivePlanetContext == nil || view.ActivePlanetContext.PlanetID != "planet-1-2" {
		t.Fatalf("expected active planet dyson context for planet-1-2, got %+v", view.ActivePlanetContext)
	}
	if view.ActivePlanetContext.EMRailEjectorCount == 0 {
		t.Fatalf("expected at least one ejector in active planet context, got %+v", view.ActivePlanetContext)
	}
	if view.ActivePlanetContext.VerticalLaunchingSiloCount == 0 {
		t.Fatalf("expected at least one silo in active planet context, got %+v", view.ActivePlanetContext)
	}
	if view.ActivePlanetContext.RayReceiverCount == 0 {
		t.Fatalf("expected at least one ray receiver in active planet context, got %+v", view.ActivePlanetContext)
	}
	if view.DysonSphere == nil || len(view.DysonSphere.Layers) == 0 {
		t.Fatalf("expected dyson sphere view, got %+v", view.DysonSphere)
	}
	if view.SolarSailOrbit == nil || len(view.SolarSailOrbit.Sails) == 0 {
		t.Fatalf("expected solar sail orbit view, got %+v", view.SolarSailOrbit)
	}
}

func newPlanetQueryFixture(t *testing.T, width, height int) (*Layer, *model.WorldState, string) {
	t.Helper()

	planetID := "planet-1"
	otherPlanetID := "planet-2"
	terrainGrid := make([][]terrain.TileType, height)
	for y := 0; y < height; y++ {
		row := make([]terrain.TileType, width)
		for x := 0; x < width; x++ {
			row[x] = terrain.TileBuildable
		}
		terrainGrid[y] = row
	}

	universe := &mapmodel.Universe{
		Galaxies: map[string]*mapmodel.Galaxy{
			"galaxy-1": {ID: "galaxy-1", SystemIDs: []string{"sys-1"}},
		},
		Systems: map[string]*mapmodel.System{
			"sys-1": {ID: "sys-1", GalaxyID: "galaxy-1", PlanetIDs: []string{planetID}},
			"sys-2": {ID: "sys-2", GalaxyID: "galaxy-1", PlanetIDs: []string{otherPlanetID}},
		},
		Planets: map[string]*mapmodel.Planet{
			planetID: {
				ID:       planetID,
				SystemID: "sys-1",
				Kind:     mapmodel.PlanetKindRocky,
				Width:    width,
				Height:   height,
				Terrain:  terrainGrid,
				Resources: []mapmodel.ResourceNode{
					{ID: "static-r-1", PlanetID: planetID, Position: mapmodel.GridPos{X: 1, Y: 1}, Kind: mapmodel.ResourceIronOre, Behavior: mapmodel.ResourceFinite, Total: 100, BaseYield: 1},
				},
			},
			otherPlanetID: {
				ID:       otherPlanetID,
				SystemID: "sys-2",
				Kind:     mapmodel.PlanetKindRocky,
				Width:    width,
				Height:   height,
				Terrain:  terrainGrid,
			},
		},
		PrimaryGalaxyID: "galaxy-1",
		PrimaryPlanetID: planetID,
	}

	discovery := mapstate.NewDiscovery([]config.PlayerConfig{
		{PlayerID: "p1"},
		{PlayerID: "p2"},
	}, universe)
	ql := New(visibility.New(), universe, discovery)
	ws := model.NewWorldState(planetID, width, height)
	ws.Tick = 1
	return ql, ws, planetID
}

func TestAgentBriefingAggregatesSelfWarFleetAlertsAndCommands(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 16, 16)
	ws.Tick = 42
	ws.Players["p1"] = &model.PlayerState{
		PlayerID:  "p1",
		TeamID:    "team-1",
		Role:      "commander",
		IsAlive:   true,
		Resources: model.Resources{Minerals: 240, Energy: 80},
		Inventory: model.ItemInventory{"iron_ore": 12},
		Tech: &model.PlayerTechState{
			PlayerID: "p1",
			CompletedTechs: map[string]int{
				"dyson_sphere_program": 1,
				"electromagnetism":     1,
			},
			CurrentResearch: &model.PlayerResearch{
				TechID:    "basic_logistics",
				State:     model.ResearchInProgress,
				Progress:  3,
				TotalCost: 10,
			},
			ResearchQueue:   []*model.PlayerResearch{{TechID: "energy_matrix"}},
			TotalResearched: 99,
		},
		Stats: model.NewPlayerStats("p1"),
	}
	ws.Players["p1"].SetPermissions([]string{"*"})
	ws.Players["p1"].Stats.EnergyStats.Generation = 120
	ws.Players["p1"].Stats.CombatStats.EnemiesKilled = 4

	// Enemy alert should be filtered out; keep newest own alerts within limit.
	alerts := []*model.ProductionAlert{
		{AlertID: "a1", Tick: 10, PlayerID: "p1", Message: "old"},
		{AlertID: "a2", Tick: 20, PlayerID: "p2", Message: "enemy"},
		{AlertID: "a3", Tick: 30, PlayerID: "p1", Message: "mid"},
		{AlertID: "a4", Tick: 40, PlayerID: "p1", Message: "new"},
	}

	spaceRuntime := model.NewSpaceRuntimeState()
	systemRuntime := spaceRuntime.EnsurePlayerSystem("p1", "sys-1")
	systemRuntime.Fleets["fleet-alpha"] = &model.SpaceFleet{
		ID:        "fleet-alpha",
		OwnerID:   "p1",
		SystemID:  "sys-1",
		Formation: model.FormationTypeWedge,
		State:     model.FleetStateIdle,
		Units:     []model.FleetUnitStack{{BlueprintID: "corvette", Count: 3}},
		Transit: &model.FleetTransitState{
			FromSystemID:   "sys-1",
			TargetSystemID: "sys-2",
			TotalTicks:     10,
			RemainingTicks: 4,
		},
	}

	worlds := map[string]*model.WorldState{planetID: ws}
	briefing := ql.AgentBriefing(
		ws,
		"p1",
		model.VictoryState{
			WinnerID:    "p1",
			Reason:      "game_win",
			VictoryRule: "hybrid",
		},
		worlds,
		spaceRuntime,
		alerts,
		2,
	)

	if briefing.Tick != 42 {
		t.Fatalf("expected tick 42, got %d", briefing.Tick)
	}
	if briefing.ActivePlanetID != planetID {
		t.Fatalf("expected active planet %s, got %s", planetID, briefing.ActivePlanetID)
	}
	if briefing.Winner != "p1" || briefing.VictoryReason != "game_win" || briefing.VictoryRule != "hybrid" {
		t.Fatalf("unexpected victory metadata: %+v", briefing)
	}
	if briefing.Self.PlayerID != "p1" || briefing.Self.Resources.Minerals != 240 {
		t.Fatalf("unexpected self payload: %+v", briefing.Self)
	}
	if briefing.Self.Tech == nil || briefing.Self.Tech.CompletedCount != 2 {
		t.Fatalf("expected compact tech summary, got %+v", briefing.Self.Tech)
	}
	if briefing.Self.Tech.CurrentResearch == nil || briefing.Self.Tech.CurrentResearch.TechID != "basic_logistics" {
		t.Fatalf("expected current research, got %+v", briefing.Self.Tech)
	}
	if briefing.Self.Tech.ResearchQueueLen != 1 {
		t.Fatalf("expected research_queue_len=1, got %d", briefing.Self.Tech.ResearchQueueLen)
	}
	if briefing.EnergyStats.Generation != 120 || briefing.CombatStats.EnemiesKilled != 4 {
		t.Fatalf("unexpected stats projection: energy=%+v combat=%+v", briefing.EnergyStats, briefing.CombatStats)
	}
	if len(briefing.RecentAlerts) != 2 {
		t.Fatalf("expected newest 2 own alerts, got %+v", briefing.RecentAlerts)
	}
	if briefing.RecentAlerts[0].AlertID != "a3" || briefing.RecentAlerts[1].AlertID != "a4" {
		t.Fatalf("expected alerts a3,a4 (newest window), got %+v", briefing.RecentAlerts)
	}
	if len(briefing.Fleets) != 1 {
		t.Fatalf("expected one fleet card, got %+v", briefing.Fleets)
	}
	if briefing.Fleets[0].UnitCount != 3 || !briefing.Fleets[0].InTransit || briefing.Fleets[0].TransitTo != "sys-2" {
		t.Fatalf("unexpected fleet card: %+v", briefing.Fleets[0])
	}
	if briefing.TaskForces == nil || briefing.Theaters == nil || briefing.EnemyForces == nil {
		t.Fatalf("expected non-nil war/enemy slices")
	}
	if len(briefing.AvailableCommands) == 0 {
		t.Fatal("expected wildcard permissions to expose available commands")
	}
	foundBuild := false
	for _, cmd := range briefing.AvailableCommands {
		if cmd == string(model.CmdBuild) {
			foundBuild = true
			break
		}
	}
	if !foundBuild {
		t.Fatalf("expected build in available_commands, got %v", briefing.AvailableCommands)
	}

	// Enemy inventory / foreign player state must not leak via self.
	if briefing.Self.PlayerID != "p1" {
		t.Fatalf("self must stay scoped to caller")
	}
}

func TestAgentBriefingFiltersCommandsByPermission(t *testing.T) {
	ql, ws, _ := newPlanetQueryFixture(t, 12, 12)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
	}
	ws.Players["p1"].SetPermissions([]string{"build", "move"})

	briefing := ql.AgentBriefing(ws, "p1", model.VictoryState{}, map[string]*model.WorldState{}, model.NewSpaceRuntimeState(), nil, 5)
	if len(briefing.AvailableCommands) != 2 {
		t.Fatalf("expected 2 allowed commands, got %v", briefing.AvailableCommands)
	}
	got := map[string]bool{}
	for _, cmd := range briefing.AvailableCommands {
		got[cmd] = true
	}
	if !got["build"] || !got["move"] {
		t.Fatalf("expected build+move only, got %v", briefing.AvailableCommands)
	}
}
