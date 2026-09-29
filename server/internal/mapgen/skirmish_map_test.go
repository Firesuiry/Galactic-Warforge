package mapgen

import (
	"path/filepath"
	"testing"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

func TestSkirmishMapSpawnsBuildableAndContestedCenterIsFair(t *testing.T) {
	cfg, err := mapconfig.Load(filepath.Join("..", "..", "map-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load map-skirmish: %v", err)
	}
	if cfg.Planet.FaceSize < 64 || cfg.Planet.FaceSize > 128 {
		t.Fatalf("face_size %d outside 64-128", cfg.Planet.FaceSize)
	}
	if cfg.Galaxy.SystemCount != 1 || cfg.System.PlanetsPerSystem != 1 {
		t.Fatalf("skirmish map must stay single-planet, got systems=%d planets=%d", cfg.Galaxy.SystemCount, cfg.System.PlanetsPerSystem)
	}
	if !cfg.Planet.Resources.ContestedCenter || len(cfg.SpawnPoints) != 2 {
		t.Fatalf("expected contested center and 2 spawns, got %+v points=%d", cfg.Planet.Resources.ContestedCenter, len(cfg.SpawnPoints))
	}

	u := Generate(cfg, "skirmish-001")
	planet := u.PrimaryPlanet()
	if planet == nil {
		t.Fatal("missing primary planet")
	}
	grid := surface.Grid{Size: planet.FaceSize}
	a := surface.Tile{X: planet.SpawnPoints[0].X, Y: planet.SpawnPoints[0].Y}
	b := surface.Tile{X: planet.SpawnPoints[1].X, Y: planet.SpawnPoints[1].Y}
	if grid.Face(a) != grid.Face(b) {
		t.Fatalf("spawns on different faces: %v %v", a, b)
	}
	dist := grid.Distance(a, b)
	ratio := float64(dist) / float64(planet.FaceSize)
	if ratio < 0.4 || ratio > 0.7 {
		t.Fatalf("spawn distance %d is %.2f of face width, want 0.40-0.70", dist, ratio)
	}
	for _, sp := range []surface.Tile{a, b} {
		assertPadBuildable(t, planet, grid, sp)
	}

	center := contestedCenterTile(planet)
	d0 := grid.Distance(a, center)
	d1 := grid.Distance(b, center)
	if diff := absInt(d0 - d1); float64(diff) > float64(planet.FaceSize)*0.15 {
		t.Fatalf("spawn-to-center distances %d and %d differ by more than 15%% of face width", d0, d1)
	}
	if !hasKindNear(planet, center, 3, mapmodel.ResourceIronOre) || !hasKindNear(planet, center, 3, mapmodel.ResourceCopperOre) {
		t.Fatalf("expected iron and copper within 3 of contested center %v", center)
	}
}

func assertPadBuildable(t *testing.T, planet *mapmodel.Planet, grid surface.Grid, tile surface.Tile) {
	t.Helper()
	tiles := append([]surface.Tile{tile}, grid.Neighbors(tile)...)
	for _, p := range tiles {
		if planet.Terrain[p.Y][p.X] != terrain.TileBuildable {
			t.Fatalf("spawn pad %v is %s", p, planet.Terrain[p.Y][p.X])
		}
	}
}

func hasKindNear(planet *mapmodel.Planet, center surface.Tile, radius int, kind mapmodel.ResourceKind) bool {
	grid := surface.Grid{Size: planet.FaceSize}
	for _, tile := range grid.Disc(center, radius) {
		for _, node := range planet.Resources {
			if node.Kind == kind && node.Position.X == tile.X && node.Position.Y == tile.Y {
				return true
			}
		}
	}
	return false
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
