package mapgen

import (
	"testing"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/terrain"
)

// newResourceTestPlanet builds a flat all-buildable rocky planet so resource
// placement is only gated by the palette and seed.
func newResourceTestPlanet(kind mapmodel.PlanetKind, width, height, density int) *mapmodel.Planet {
	planet := &mapmodel.Planet{
		ID:              "planet-test",
		Kind:            kind,
		Width:           width,
		Height:          height,
		ResourceDensity: density,
		Terrain:         make([][]terrain.TileType, height),
	}
	for y := 0; y < height; y++ {
		planet.Terrain[y] = make([]terrain.TileType, width)
		for x := 0; x < width; x++ {
			planet.Terrain[y][x] = terrain.TileBuildable
		}
	}
	return planet
}

func TestNewResourceKindsGenerated(t *testing.T) {
	rc := mapconfig.ResourceConfig{}
	// Mirror the defaults used in production configs.
	rc.RareChance = 0.2
	rc.ClusterMin = 3
	rc.ClusterMax = 8
	rc.ClusterRadius = 3
	rc.VeinAmountMin = 80
	rc.VeinAmountMax = 200
	rc.VeinYieldMin = 2
	rc.VeinYieldMax = 6
	rc.OilYieldMin = 3
	rc.OilYieldMax = 8
	rc.OilMinYield = 1
	rc.OilDecayPerTick = 1
	rc.RenewableRegenPerTick = 2

	planet := newResourceTestPlanet(mapmodel.PlanetKindRocky, 120, 120, 20)
	nodes := generateResources(newRNG("seed-dsp-alignment"), planet, rc)
	if len(nodes) == 0 {
		t.Fatal("expected resource nodes to be generated")
	}

	byKind := make(map[mapmodel.ResourceKind][]mapmodel.ResourceNode)
	for _, n := range nodes {
		byKind[n.Kind] = append(byKind[n.Kind], n)
	}

	rare := []mapmodel.ResourceKind{
		mapmodel.ResourceKimberliteOre,
		mapmodel.ResourceSpiniformStalagmiteCrystal,
		mapmodel.ResourceOrganicCrystal,
	}
	for _, kind := range rare {
		nodesOfKind := byKind[kind]
		if len(nodesOfKind) == 0 {
			t.Fatalf("expected rare kind %s to appear at least once", kind)
		}
		for _, n := range nodesOfKind {
			if !n.IsRare {
				t.Fatalf("rare node %s not flagged rare", kind)
			}
			if n.Behavior != mapmodel.ResourceFinite {
				t.Fatalf("rare ore %s should be finite, got %s", kind, n.Behavior)
			}
		}
	}

	renewable := []mapmodel.ResourceKind{
		mapmodel.ResourceSulfuricAcid,
		mapmodel.ResourceLog,
		mapmodel.ResourcePlantFuel,
	}
	for _, kind := range renewable {
		nodesOfKind := byKind[kind]
		if len(nodesOfKind) == 0 {
			t.Fatalf("expected renewable kind %s to appear at least once", kind)
		}
		for _, n := range nodesOfKind {
			if n.Behavior != mapmodel.ResourceRenewable {
				t.Fatalf("kind %s should be renewable, got %s", kind, n.Behavior)
			}
			if n.RegenPerTick <= 0 {
				t.Fatalf("renewable kind %s missing regen per tick", kind)
			}
		}
	}
}

func TestNewRareKindsGeneratedOnIcePlanets(t *testing.T) {
	rc := mapconfig.ResourceConfig{}
	rc.RareChance = 0.2
	rc.ClusterMin = 3
	rc.ClusterMax = 8
	rc.ClusterRadius = 3
	rc.VeinAmountMin = 80
	rc.VeinAmountMax = 200
	rc.VeinYieldMin = 2
	rc.VeinYieldMax = 6
	rc.OilYieldMin = 3
	rc.OilYieldMax = 8
	rc.OilMinYield = 1
	rc.OilDecayPerTick = 1
	rc.RenewableRegenPerTick = 2

	planet := newResourceTestPlanet(mapmodel.PlanetKindIce, 120, 120, 20)
	nodes := generateResources(newRNG("seed-dsp-ice"), planet, rc)
	byKind := make(map[mapmodel.ResourceKind]bool)
	for _, n := range nodes {
		byKind[n.Kind] = true
	}
	for _, kind := range []mapmodel.ResourceKind{
		mapmodel.ResourceKimberliteOre,
		mapmodel.ResourceSpiniformStalagmiteCrystal,
		mapmodel.ResourceOrganicCrystal,
	} {
		if !byKind[kind] {
			t.Fatalf("expected rare kind %s on ice planet", kind)
		}
	}
}
