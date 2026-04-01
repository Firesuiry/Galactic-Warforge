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

func TestPlanetShowsStaticResourcesAfterDiscovery(t *testing.T) {
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
	view, ok := ql.Planet(ws, "p1", targetPlanetID)
	if !ok {
		t.Fatal("expected planet view")
	}
	if len(view.Resources) == 0 {
		t.Fatal("expected discovered non-active planet to expose static resources")
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
