package mapgen

import (
	"strconv"
	"strings"
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

// TestResourceClusterConservesTotalReserves 细分网格下「一个资源格 = 3×3 cell」的
// 守恒口径：簇内每个 cell 与簇首格同储量同产速（世界尺度上的矿脉范围、总产速
// 与采空时间都不变），且密度基准格数除以成簇倍数，矿脉个数/世界面积保持原值。
func TestResourceClusterConservesTotalReserves(t *testing.T) {
	rc := mapconfig.ResourceConfig{}
	rc.RareChance = 0.2
	rc.ClusterMin = 3
	rc.ClusterMax = 8
	rc.ClusterRadius = 3
	rc.VeinAmountMin = 80000
	rc.VeinAmountMax = 200000
	rc.VeinYieldMin = 2
	rc.VeinYieldMax = 6
	rc.OilYieldMin = 3
	rc.OilYieldMax = 8
	rc.OilMinYield = 1
	rc.OilDecayPerTick = 1
	rc.RenewableRegenPerTick = 2

	const width, height, density = 288, 192, 8
	planet := newResourceTestPlanet(mapmodel.PlanetKindRocky, width, height, density)
	planet.FaceSize = width / 3
	nodes := generateResources(newRNG("seed-cluster-conserve"), planet, rc)
	if len(nodes) == 0 {
		t.Fatal("expected resource nodes to be generated")
	}

	// 基准格数 = 面积 × 密度 ÷ (100 × 成簇倍数)：矿脉个数/世界面积与细分前一致。
	wantBase := (width * height * density) / (100 * resourceClusterScale)
	// 一个"资源格"的 ID 形如 "<planet>-res-<n>"，其 3×3 cell 簇的 ID 是
	// "<planet>-res-<n>-<cell>"。位置 (x,y) 就是它的簇首格：同簇 cell 全部
	// 落在以簇首为中心的 3×3 邻域内（一个矿脉由 3–8 个资源格组成，同一
	// ClusterID 里可以有多个资源格，所以按簇首格分组而不是按 ClusterID 分组）。
	byVein := map[string][]mapmodel.ResourceNode{}
	heads := 0
	for _, n := range nodes {
		head, isHead := resourceVeinHeadID(n.ID)
		byVein[head] = append(byVein[head], n)
		if isHead {
			heads++
		}
	}
	if heads > wantBase {
		t.Fatalf("vein heads %d exceed the density budget %d", heads, wantBase)
	}

	// 每个 cell 与同资源格的其他 cell 同储量同产速（成簇不改变世界尺度上的矿量）。
	for base, group := range byVein {
		if len(group) == 0 {
			continue
		}
		first := group[0]
		for _, n := range group {
			if n.Kind != first.Kind || n.Behavior != first.Behavior {
				t.Fatalf("vein %s mixes kinds: %s vs %s", base, n.Kind, first.Kind)
			}
			if n.Total != first.Total || n.BaseYield != first.BaseYield || n.RegenPerTick != first.RegenPerTick {
				t.Fatalf("vein %s cell %s reserves differ: %+v vs %+v", base, n.ID, n, first)
			}
		}
	}
}

// resourceVeinHeadID 把 "<planet>-res-<n>" 与 "<planet>-res-<n>-<cell>" 归到同一
// 资源格：簇首是 ID 里没有额外 "-<cell>" 后缀的那个，其 Position 就是簇首格。
func resourceVeinHeadID(id string) (string, bool) {
	// "<planet>-res-<n>" 是簇首；"<planet>-res-<n>-<cell>" 是簇内 cell，
	// 归到去掉最后一段的簇首 ID。只有末尾两段都是数字才算 cell。
	idx := strings.LastIndex(id, "-")
	if idx <= 0 {
		return id, true
	}
	if _, err := strconv.Atoi(id[idx+1:]); err != nil {
		return id, true
	}
	prev := strings.LastIndex(id[:idx], "-")
	if prev > 0 {
		if _, err := strconv.Atoi(id[prev+1 : idx]); err == nil {
			return id[:idx], false
		}
	}
	return id, true
}
