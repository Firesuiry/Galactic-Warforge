package mapgen

import (
	"math"
	"reflect"
	"testing"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
)

func testMapConfig() *mapconfig.Config {
	return &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{
			SystemCount: 3,
			Width:       800,
			Height:      600,
		},
		System: mapconfig.SystemConfig{
			PlanetsPerSystem: 4,
			GasGiantRatio:    0.4,
			MaxMoons:         3,
		},
		Planet: mapconfig.PlanetConfig{
			Width:           16,
			Height:          16,
			ResourceDensity: 10,
		},
	}
}

func TestGenerateDeterministic(t *testing.T) {
	cfg := testMapConfig()
	a := Generate(cfg, "seed-alpha")
	b := Generate(cfg, "seed-alpha")
	if !reflect.DeepEqual(a, b) {
		t.Fatal("expected deterministic map generation for same seed")
	}
}

func TestDistanceMatrix(t *testing.T) {
	cfg := testMapConfig()
	u := Generate(cfg, "seed-beta")
	g := u.PrimaryGalaxy()
	if g == nil {
		t.Fatal("expected primary galaxy")
	}
	if len(g.DistanceMatrix) != len(g.SystemIDs) {
		t.Fatalf("distance matrix rows mismatch: %d vs %d", len(g.DistanceMatrix), len(g.SystemIDs))
	}
	for i := range g.SystemIDs {
		if len(g.DistanceMatrix[i]) != len(g.SystemIDs) {
			t.Fatalf("distance matrix row %d size mismatch", i)
		}
		if math.Abs(g.DistanceMatrix[i][i]) > 1e-9 {
			t.Fatalf("distance matrix diagonal at %d not zero", i)
		}
		for j := i + 1; j < len(g.SystemIDs); j++ {
			sysA := u.Systems[g.SystemIDs[i]]
			sysB := u.Systems[g.SystemIDs[j]]
			if sysA == nil || sysB == nil {
				t.Fatalf("missing system for matrix check")
			}
			expected := math.Hypot(sysA.Position.X-sysB.Position.X, sysA.Position.Y-sysB.Position.Y)
			if math.Abs(g.DistanceMatrix[i][j]-expected) > 1e-9 {
				t.Fatalf("distance matrix mismatch for %d,%d", i, j)
			}
			if g.DistanceMatrix[i][j] != g.DistanceMatrix[j][i] {
				t.Fatalf("distance matrix not symmetric for %d,%d", i, j)
			}
		}
	}
}

func TestPlanetOrbitsIncrease(t *testing.T) {
	cfg := testMapConfig()
	u := Generate(cfg, "seed-gamma")
	for _, sys := range u.Systems {
		prev := 0.0
		for idx, pid := range sys.PlanetIDs {
			p := u.Planets[pid]
			if p == nil {
				t.Fatalf("missing planet %s", pid)
			}
			if idx > 0 && p.Orbit.DistanceAU <= prev {
				t.Fatalf("planet orbit not increasing for system %s", sys.ID)
			}
			prev = p.Orbit.DistanceAU
		}
	}
}

func TestResourceNodesBuildable(t *testing.T) {
	cfg := testMapConfig()
	u := Generate(cfg, "seed-resource")
	if len(u.Planets) == 0 {
		t.Fatal("expected planets")
	}
	for _, planet := range u.Planets {
		for _, node := range planet.Resources {
			if node.Position.X < 0 || node.Position.X >= planet.Width || node.Position.Y < 0 || node.Position.Y >= planet.Height {
				t.Fatalf("resource node out of bounds on %s", planet.ID)
			}
			tile := planet.Terrain[node.Position.Y][node.Position.X]
			if !tile.Buildable() {
				t.Fatalf("resource node placed on non-buildable tile on %s", planet.ID)
			}
		}
	}
}

func TestGenerateAppliesPlanetKindOverrides(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{
			SystemCount: 1,
		},
		System: mapconfig.SystemConfig{
			PlanetsPerSystem: 3,
			GasGiantRatio:    0,
		},
		Planet: mapconfig.PlanetConfig{
			Width:           16,
			Height:          16,
			ResourceDensity: 10,
		},
		Overrides: mapconfig.OverridesConfig{
			Planets: map[string]mapconfig.PlanetOverride{
				"planet-1-2": {Kind: string(mapmodel.PlanetKindGasGiant)},
			},
		},
	}

	universe := Generate(cfg, "override-seed")
	planet := universe.Planets["planet-1-2"]
	if planet == nil {
		t.Fatal("expected overridden planet to exist")
	}
	if planet.Kind != mapmodel.PlanetKindGasGiant {
		t.Fatalf("expected override to force gas giant, got %s", planet.Kind)
	}
}
