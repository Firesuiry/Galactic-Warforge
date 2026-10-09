package mapgen

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

// 遭遇战地图多 seed 回归（试玩报告 tmp/playtest-1009 阻断 A）。
// 覆盖：出生点/争夺中心连通、出生点附近开局原矿齐全、没有 <200 格的孤立陆地
// （资源/出生点/争夺中心都不落在上面），以及默认 seed 的改动量尽量小。
//
// skirmishDefaultSeed 与 config-skirmish.yaml 的 battlefield.map_seed 一致：这是
// 大厅「开新局」默认用的 seed，改动量必须最小（本测试打印改动格数）。
const skirmishDefaultSeed = "skirmish-seed-001"

// defaultSeedMaxChangedTiles 是默认 seed 允许被连通性保证改动的格子上限。默认局
// 出生点/争夺中心本就连通，改动只来自封小陆地与就近补矿，实测远低于此值。
const (
	defaultSeedMaxChangedTiles  = 256
	defaultSeedMaxResourceDelta = 32
)

func skirmishConfig(t *testing.T) *mapconfig.Config {
	t.Helper()
	cfg, err := mapconfig.Load(filepath.Join("..", "..", "map-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load map-skirmish: %v", err)
	}
	return cfg
}

func connectivitySeeds() []string {
	seeds := []string{"pt1009-g2", "pt1009-seed", "skirmish-seed-001"}
	for i := 0; i < 97; i++ {
		seeds = append(seeds, fmt.Sprintf("seed-%d", i))
	}
	return seeds
}

// planetSnapshot 是连通性保证生效前的行星快照，用于测改动量与修复前的分量大小。
type planetSnapshot struct {
	terrain    [][]terrain.TileType
	resources  []mapmodel.ResourceNode
	spawnLand  int
	landmasses []int
}

func capturePlanet(planet *mapmodel.Planet) planetSnapshot {
	grid := surface.Grid{Size: planet.FaceSize}
	snap := planetSnapshot{}
	snap.terrain = make([][]terrain.TileType, len(planet.Terrain))
	for y, row := range planet.Terrain {
		snap.terrain[y] = append([]terrain.TileType(nil), row...)
	}
	snap.resources = append([]mapmodel.ResourceNode(nil), planet.Resources...)
	components := floodLandComponents(planet, grid)
	for _, members := range components.members {
		snap.landmasses = append(snap.landmasses, len(members))
	}
	if len(planet.SpawnPoints) > 0 {
		tile := surface.Tile{X: planet.SpawnPoints[0].X, Y: planet.SpawnPoints[0].Y}
		snap.spawnLand = len(components.componentOf(tile))
	}
	return snap
}

func (s planetSnapshot) changedTiles(planet *mapmodel.Planet) int {
	changed := 0
	for y, row := range s.terrain {
		for x := range row {
			if planet.Terrain[y][x] != row[x] {
				changed++
			}
		}
	}
	return changed
}

// changedResources 是资源节点的净改动（新增数 + 删除数），衡量资源层被改动多少。
func (s planetSnapshot) changedResources(planet *mapmodel.Planet) int {
	before := map[string]bool{}
	for _, node := range s.resources {
		before[node.ID] = true
	}
	after := map[string]bool{}
	for _, node := range planet.Resources {
		after[node.ID] = true
	}
	delta := 0
	for id := range before {
		if !after[id] {
			delta++
		}
	}
	for id := range after {
		if !before[id] {
			delta++
		}
	}
	return delta
}

func generateWithSnapshot(t *testing.T, cfg *mapconfig.Config, seed string) (*mapmodel.Universe, planetSnapshot) {
	t.Helper()
	var snap planetSnapshot
	previous := connectivityObserver
	connectivityObserver = func(planet *mapmodel.Planet) {
		if planet != nil {
			snap = capturePlanet(planet)
		}
	}
	defer func() { connectivityObserver = previous }()
	u := Generate(cfg, seed)
	return u, snap
}

func TestSkirmishPlayableConnectivityAcrossSeeds(t *testing.T) {
	cfg := skirmishConfig(t)
	seeds := connectivitySeeds()
	grid := surface.Grid{Size: cfg.Planet.FaceSize}
	mainSpawn := surface.Tile{X: cfg.SpawnPoints[0].X, Y: cfg.SpawnPoints[0].Y}
	center := contestedCenterTile(&mapmodel.Planet{
		FaceSize:    cfg.Planet.FaceSize,
		SpawnPoints: []mapmodel.GridPos{{X: cfg.SpawnPoints[0].X, Y: cfg.SpawnPoints[0].Y}, {X: cfg.SpawnPoints[1].X, Y: cfg.SpawnPoints[1].Y}},
	})

	g2Before, g2After := 0, 0
	defaultChanged, defaultResourceDelta := 0, 0
	for _, seed := range seeds {
		u, before := generateWithSnapshot(t, cfg, seed)
		planet := u.PrimaryPlanet()
		if planet == nil {
			t.Fatalf("seed %s: missing primary planet", seed)
		}
		if len(planet.SpawnPoints) != 2 {
			t.Fatalf("seed %s: want 2 spawns, got %d", seed, len(planet.SpawnPoints))
		}
		components := floodLandComponents(planet, grid)
		mainLabel := components.labelOf(mainSpawn)
		if mainLabel < 0 {
			t.Fatalf("seed %s: spawn %v is not walkable terrain (%s)", seed, mainSpawn, planet.Terrain[mainSpawn.Y][mainSpawn.X])
		}

		// 1. 两个出生点与争夺中心同一连通区。
		for i, sp := range planet.SpawnPoints {
			tile := surface.Tile{X: sp.X, Y: sp.Y}
			if label := components.labelOf(tile); label != mainLabel {
				t.Fatalf("seed %s: spawn[%d] %v in component %d, want main %d (sizes %v)",
					seed, i, tile, label, mainLabel, components.sizes())
			}
		}
		if label := components.labelOf(center); label != mainLabel {
			t.Fatalf("seed %s: contested center %v in component %d, want main %d (sizes %v)",
				seed, center, label, mainLabel, components.sizes())
		}

		// 2. 没有小于阈值的孤立陆地（单位走进去不会被困）。
		for id, members := range components.members {
			if len(members) < smallLandmassTiles {
				t.Fatalf("seed %s: landmass #%d has %d tiles (< %d), resources on it would strand units",
					seed, id, len(members), smallLandmassTiles)
			}
		}

		// 3. 每个出生点 24 格地面路径内有开局科技链必需的原矿。
		for i, sp := range planet.SpawnPoints {
			tile := surface.Tile{X: sp.X, Y: sp.Y}
			dist := landDistances(planet, grid, tile, spawnResourcePathRange)
			for _, kind := range openingResourceKinds {
				if !resourceKindWithin(planet, dist, kind) {
					t.Fatalf("seed %s: spawn[%d] %v has no %s within %d ground steps (present kinds %v)",
						seed, i, tile, kind, spawnResourcePathRange, kindsWithin(planet, dist))
				}
			}
		}

		if seed == "pt1009-g2" {
			g2Before, g2After = before.spawnLand, len(components.componentOf(mainSpawn))
			t.Logf("pt1009-g2: spawn landmass %d -> %d tiles; pre-fix landmasses %v",
				g2Before, g2After, before.landmasses)
			// 修复前的种子：出生点自己就在 5 格孤岛上（报告里的「145 格」是旧版地图参数
			// 下的同一个孤岛），修复后必须并进主大陆。
			if g2Before >= smallLandmassTiles {
				t.Fatalf("pt1009-g2 pre-fix spawn landmass %d, want the isolated island this regression guards", g2Before)
			}
		}
		if seed == skirmishDefaultSeed {
			defaultChanged = before.changedTiles(planet)
			defaultResourceDelta = before.changedResources(planet)
			// 默认局本就连通，改动只来自封小陆地 + 就近补矿：地形改动要极少，
			// 资源节点改动（新增/删除）也应是个位数级别。
			if defaultChanged > defaultSeedMaxChangedTiles {
				t.Fatalf("default seed %s changed %d terrain tiles, want <= %d", skirmishDefaultSeed, defaultChanged, defaultSeedMaxChangedTiles)
			}
			if defaultResourceDelta > defaultSeedMaxResourceDelta {
				t.Fatalf("default seed %s changed %d resource nodes, want <= %d", skirmishDefaultSeed, defaultResourceDelta, defaultSeedMaxResourceDelta)
			}
		}
	}

	if g2After < smallLandmassTiles {
		t.Fatalf("pt1009-g2 spawn landmass after fix is %d, want >= %d", g2After, smallLandmassTiles)
	}
	t.Logf("seeds checked: %d; pt1009-g2 spawn landmass %d -> %d", len(seeds), g2Before, g2After)
	t.Logf("default seed %s: changed terrain tiles %d (limit %d), resource delta %d (limit %d)",
		skirmishDefaultSeed, defaultChanged, defaultSeedMaxChangedTiles, defaultResourceDelta, defaultSeedMaxResourceDelta)
}

// TestMapgenWalkabilityMatchesGamecorePredicate 确认 mapgen 的通行判定与服务端一致：
// gamecore.tileWalkableForUnit / pathFlood 用 `cell.Terrain.Buildable()` 过滤格子
// （见 internal/gamecore/unit_movement_settlement.go），mapgen 的 landWalkable 复用
// 同一个 terrain.TileType.Buildable()，两侧不是各写一套。
func TestMapgenWalkabilityMatchesGamecorePredicate(t *testing.T) {
	cfg := skirmishConfig(t)
	planet := Generate(cfg, "walkability-parity").PrimaryPlanet()
	if planet == nil {
		t.Fatal("missing primary planet")
	}
	grid := surface.Grid{Size: planet.FaceSize}
	for y := 0; y < grid.Height(); y++ {
		for x := 0; x < grid.Width(); x++ {
			tile := surface.Tile{X: x, Y: y}
			if got, want := landWalkable(planet, tile), planet.Terrain[y][x].Buildable(); got != want {
				t.Fatalf("walkability mismatch at %v: mapgen=%v terrain.Buildable()=%v", tile, got, want)
			}
		}
	}
}

func (c *landComponents) sizes() []int {
	out := make([]int, 0, len(c.members))
	for _, members := range c.members {
		out = append(out, len(members))
	}
	return out
}

// TestSkirmishConnectivityDeterministic 保证连通性保证本身是确定性的：同一 seed
// 两次生成（含补矿簇的 rng）结果完全一致。
func TestSkirmishConnectivityDeterministic(t *testing.T) {
	cfg := skirmishConfig(t)
	for _, seed := range []string{"pt1009-g2", "skirmish-seed-001", "seed-42"} {
		first := Generate(cfg, seed).PrimaryPlanet()
		second := Generate(cfg, seed).PrimaryPlanet()
		if !reflect.DeepEqual(first, second) {
			t.Fatalf("seed %s: connectivity pass is not deterministic", seed)
		}
	}
}

func resourceKindWithin(planet *mapmodel.Planet, dist map[surface.Tile]int, kind mapmodel.ResourceKind) bool {
	for _, node := range planet.Resources {
		if node.Kind != kind {
			continue
		}
		if d, ok := dist[surface.Tile{X: node.Position.X, Y: node.Position.Y}]; ok && d <= spawnResourcePathRange {
			return true
		}
	}
	return false
}

func kindsWithin(planet *mapmodel.Planet, dist map[surface.Tile]int) []mapmodel.ResourceKind {
	seen := map[mapmodel.ResourceKind]bool{}
	for _, node := range planet.Resources {
		if d, ok := dist[surface.Tile{X: node.Position.X, Y: node.Position.Y}]; ok && d <= spawnResourcePathRange {
			seen[node.Kind] = true
		}
	}
	out := make([]mapmodel.ResourceKind, 0, len(seen))
	for kind := range seen {
		out = append(out, kind)
	}
	return out
}
