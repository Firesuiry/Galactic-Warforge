package mapgen

import (
	"math"
	"testing"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

func TestSphereNoiseMatchesRatiosAndFormsOceans(t *testing.T) {
	for _, seed := range []string{"seed-alpha", "seed-001", "skirmish-001"} {
		cfg := testMapConfig()
		cfg.Planet.FaceSize = 32
		u := Generate(cfg, seed)
		planet := u.PrimaryPlanet()
		if planet == nil || len(planet.Elevation) != planet.Height || len(planet.Elevation[0]) != planet.Width {
			t.Fatalf("%s: missing elevation grid", seed)
		}
		water, lava, blocked, total := terrainCounts(planet.Terrain)
		assertRatio(t, seed, "water", float64(water)/float64(total), 0.12)
		assertRatio(t, seed, "lava", float64(lava)/float64(total), 0.04)
		assertRatio(t, seed, "blocked", float64(blocked)/float64(total), 0.08)
		if water == 0 {
			t.Fatalf("%s: expected some water", seed)
		}
		frac := largestComponentFraction(planet.Terrain, planet.FaceSize, terrain.TileWater)
		if frac <= 0.25 {
			t.Fatalf("%s: largest water component %.3f, want > 0.25", seed, frac)
		}
		seam := meanSeamHeightDelta(planet.Elevation, planet.FaceSize)
		if seam > 0.15 {
			t.Fatalf("%s: cross-face height delta %.3f; noise looks atlas-disconnected", seed, seam)
		}
	}
}

func TestSphereNoiseDeterministicIncludingElevation(t *testing.T) {
	cfg := testMapConfig()
	cfg.Planet.FaceSize = 16
	a := Generate(cfg, "seed-alpha")
	b := Generate(cfg, "seed-alpha")
	pa, pb := a.PrimaryPlanet(), b.PrimaryPlanet()
	if len(pa.Elevation) == 0 || len(pa.Elevation) != len(pb.Elevation) {
		t.Fatal("elevation missing")
	}
	for y := range pa.Elevation {
		for x := range pa.Elevation[y] {
			if pa.Elevation[y][x] != pb.Elevation[y][x] || pa.Terrain[y][x] != pb.Terrain[y][x] {
				t.Fatalf("terrain/elevation diverged at %d,%d", x, y)
			}
		}
	}
}

func terrainCounts(grid [][]terrain.TileType) (water, lava, blocked, total int) {
	for _, row := range grid {
		for _, tile := range row {
			total++
			switch tile {
			case terrain.TileWater:
				water++
			case terrain.TileLava:
				lava++
			case terrain.TileBlocked:
				blocked++
			}
		}
	}
	return water, lava, blocked, total
}

func assertRatio(t *testing.T, seed, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.05 {
		t.Fatalf("%s: %s ratio %.3f, want %.3f ±0.05", seed, name, got, want)
	}
}

func largestComponentFraction(grid [][]terrain.TileType, faceSize int, kind terrain.TileType) float64 {
	if faceSize < 1 || len(grid) == 0 {
		return 0
	}
	width := len(grid[0])
	g := surface.Grid{Size: faceSize}
	seen := make([]bool, len(grid)*width)
	total := 0
	largest := 0
	for y := range grid {
		for x, tile := range grid[y] {
			if tile != kind {
				continue
			}
			total++
			id := y*width + x
			if seen[id] {
				continue
			}
			q := []surface.Tile{{X: x, Y: y}}
			seen[id] = true
			size := 0
			for head := 0; head < len(q); head++ {
				cur := q[head]
				size++
				for _, n := range g.Neighbors(cur) {
					nid := n.Y*width + n.X
					if seen[nid] || grid[n.Y][n.X] != kind {
						continue
					}
					seen[nid] = true
					q = append(q, n)
				}
			}
			if size > largest {
				largest = size
			}
		}
	}
	if total == 0 {
		return 0
	}
	return float64(largest) / float64(total)
}

func meanSeamHeightDelta(elev [][]float32, faceSize int) float64 {
	g := surface.Grid{Size: faceSize}
	sum := 0.0
	n := 0
	for y := range elev {
		for x := range elev[y] {
			tile := surface.Tile{X: x, Y: y}
			for _, nb := range g.Neighbors(tile) {
				if g.Face(nb) == g.Face(tile) {
					continue
				}
				if nb.Y < y || (nb.Y == y && nb.X < x) {
					continue
				}
				d := float64(elev[y][x] - elev[nb.Y][nb.X])
				if d < 0 {
					d = -d
				}
				sum += d
				n++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

func TestLoadUsesNoiseNotIndependentRolls(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 32, ResourceDensity: 4},
	}
	u := Generate(cfg, "continent-check")
	planet := u.PrimaryPlanet()
	frac := largestComponentFraction(planet.Terrain, planet.FaceSize, terrain.TileWater)
	if frac <= 0.25 {
		t.Fatalf("expected continental water, got %.3f", frac)
	}
}
