package query

import (
	"siliconworld/internal/terrain"
	"testing"
)

func TestPlanetQueriesReflectFoundationTerrainChanges(t *testing.T) {
	ql, ws, id := newPlanetQueryFixture(t, 16, 16)
	for _, kind := range []terrain.TileType{terrain.TileWater, terrain.TileBuildable, terrain.TileWater} {
		ws.Grid[1][1].Terrain = kind
		planet, ok := ql.Planet(ws, "p1", id)
		if !ok || planet.Terrain[1][1] != kind {
			t.Fatalf("full planet terrain stale: %s", kind)
		}
		scene, ok := ql.PlanetScene(ws, "p1", id, PlanetSceneRequest{X: 0, Y: 0, Width: 4, Height: 4})
		if !ok || scene.Terrain[1][1] != kind {
			t.Fatalf("scene terrain stale: %s", kind)
		}
		overview, ok := ql.PlanetOverview(ws, "p1", id, PlanetOverviewRequest{Step: 1})
		if !ok || overview.Terrain[1][1] != kind {
			t.Fatalf("overview terrain stale: %s", kind)
		}
	}
}
