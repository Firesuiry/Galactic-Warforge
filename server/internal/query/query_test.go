package query

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
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
		Units:            []model.FleetUnitStack{{UnitType: "corvette", Count: 2}},
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
	if len(fleets[0].Units) != 1 || fleets[0].Units[0].UnitType != "corvette" {
		t.Fatalf("expected corvette units, got %+v", fleets[0].Units)
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

	view, ok := ql.SystemRuntime("p1", "sys-1", spaceRuntime)
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

func newPlanetQueryFixture(t *testing.T, width, height int) (*Layer, *model.WorldState, string) {
	t.Helper()

	planetID := "planet-1"
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
