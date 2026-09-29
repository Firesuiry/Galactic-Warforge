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

func TestPlanetSceneIncludesExploredHeight(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 0},
	}
	maps := mapgen.Generate(cfg, "height-scene")
	planet := maps.PrimaryPlanet()
	planet.Elevation = make([][]float32, planet.Height)
	for y := range planet.Elevation {
		planet.Elevation[y] = make([]float32, planet.Width)
	}
	planet.Elevation[2][2] = 0.8
	planet.Elevation[5][5] = 0.7

	discovery := mapstate.NewDiscovery([]config.PlayerConfig{{PlayerID: "p1"}}, maps)
	discovery.DiscoverPlanet("p1", planet.ID)
	ql := New(visibility.New(), maps, discovery)
	ws := model.NewWorldState(planet.ID, planet.FaceSize)
	ws.Players = map[string]*model.PlayerState{"p1": {PlayerID: "p1", IsAlive: true}}
	ws.Units = map[string]*model.Unit{
		"u": {ID: "u", OwnerID: "p1", Position: model.Position{X: 2, Y: 2}, VisionRange: 1, HP: 1},
	}
	view, ok := ql.PlanetScene(ws, "p1", planet.ID, PlanetSceneRequest{X: 0, Y: 0, Width: 6, Height: 6})
	if !ok || view.Height == nil {
		t.Fatalf("expected height slice, ok=%v height=%v", ok, view)
	}
	if len(view.Height) != len(view.Terrain) || len(view.Height[0]) != len(view.Terrain[0]) {
		t.Fatalf("height shape %dx%d != terrain", len(view.Height), len(view.Height[0]))
	}
	if view.Height[2][2] == 0 {
		t.Fatalf("explored height missing: %v", view.Height[2][2])
	}
	if view.Explored != nil && !view.Explored[5][5] && view.Height[5][5] != 0 {
		t.Fatalf("unexplored height leaked: %v", view.Height[5][5])
	}
}
