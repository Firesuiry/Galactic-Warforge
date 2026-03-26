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
