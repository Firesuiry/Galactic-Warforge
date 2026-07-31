package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/terrain"
)

func t124FloatPtr(v float64) *float64 { return &v }

// newT124Universe builds a deterministic universe with harsh terrain ratios so
// spawn-area flattening is meaningfully exercised.
func newT124Universe(t *testing.T, seed string, width, height int, spawns []mapconfig.SpawnPointConfig) *mapmodel.Universe {
	t.Helper()
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{
			Width:           width,
			Height:          height,
			ResourceDensity: 8,
			Terrain: mapconfig.TerrainConfig{
				WaterRatio:   t124FloatPtr(0.3),
				LavaRatio:    t124FloatPtr(0.15),
				BlockedRatio: t124FloatPtr(0.3),
			},
		},
		SpawnPoints: spawns,
	}
	return mapgen.Generate(mapCfg, seed)
}

func newT124Core(t *testing.T, maps *mapmodel.Universe, playerIDs ...string) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-t124", MaxTickRate: 10},
	}
	for _, id := range playerIDs {
		cfg.Players = append(cfg.Players, config.PlayerConfig{PlayerID: id, Key: id + "-key"})
	}
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{IntervalTicks: 100})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	return New(cfg, maps, queue.New(), NewEventBus(), store)
}

func t124BuildingPos(t *testing.T, ws *model.WorldState, playerID string, buildingType model.BuildingType) model.Position {
	t.Helper()
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == playerID && b.Type == buildingType {
			return b.Position
		}
	}
	t.Fatalf("player %s has no %s", playerID, buildingType)
	return model.Position{}
}

func t124UnitPos(t *testing.T, ws *model.WorldState, playerID string, unitType model.UnitType) model.Position {
	t.Helper()
	for _, u := range ws.Units {
		if u != nil && u.OwnerID == playerID && u.Type == unitType {
			return u.Position
		}
	}
	t.Fatalf("player %s has no %s", playerID, unitType)
	return model.Position{}
}

func assertT124EdgeMargin(t *testing.T, ws *model.WorldState, pos model.Position, margin int) {
	t.Helper()
	if pos.X < margin || pos.Y < margin || pos.X > ws.MapWidth-1-margin || pos.Y > ws.MapHeight-1-margin {
		t.Fatalf("spawn (%d,%d) closer than %d tiles to map edge %dx%d", pos.X, pos.Y, margin, ws.MapWidth, ws.MapHeight)
	}
}

func assertT124BuildableAround(t *testing.T, ws *model.WorldState, planet *mapmodel.Planet, center model.Position, radius int) {
	t.Helper()
	for dy := -radius; dy <= radius; dy++ {
		for dx := -radius; dx <= radius; dx++ {
			if dx*dx+dy*dy > radius*radius {
				continue
			}
			x, y := center.X+dx, center.Y+dy
			if x < 0 || y < 0 || x >= ws.MapWidth || y >= ws.MapHeight {
				continue
			}
			if !ws.Grid[y][x].Terrain.Buildable() {
				t.Fatalf("world tile (%d,%d) within radius %d of spawn (%d,%d) is %s", x, y, radius, center.X, center.Y, ws.Grid[y][x].Terrain)
			}
			if planet != nil && !planet.Terrain[y][x].Buildable() {
				t.Fatalf("map-model tile (%d,%d) within radius %d of spawn (%d,%d) is %s", x, y, radius, center.X, center.Y, planet.Terrain[y][x])
			}
		}
	}
}

func TestT124AutoSpawnAreaIsBuildableAndAwayFromEdges(t *testing.T) {
	seeds := []string{"seed-t124-a", "seed-t124-b", "seed-t124-c"}
	players := []string{"p1", "p2", "p3", "p4"}
	for _, seed := range seeds {
		maps := newT124Universe(t, seed, 64, 64, nil)
		core := newT124Core(t, maps, players...)
		ws := core.World()
		planet := maps.PrimaryPlanet()
		for _, pid := range players {
			base := t124BuildingPos(t, ws, pid, model.BuildingTypeBattlefieldAnalysisBase)
			assertT124EdgeMargin(t, ws, base, 8)
			assertT124BuildableAround(t, ws, planet, base, spawnAreaRadius)

			exec := t124UnitPos(t, ws, pid, model.UnitTypeExecutor)
			if !ws.Grid[exec.Y][exec.X].Terrain.Buildable() {
				t.Fatalf("player %s executor tile (%d,%d) not buildable", pid, exec.X, exec.Y)
			}
			if dx, dy := exec.X-base.X, exec.Y-base.Y; dx < -2 || dx > 2 || dy < -2 || dy > 2 {
				t.Fatalf("player %s executor (%d,%d) not adjacent to base (%d,%d)", pid, exec.X, exec.Y, base.X, base.Y)
			}
		}
	}
}

// TestT124RelocatedSpawnAreaIsFlattened forces the auto spawn to relocate
// towards a distant ore node, then asserts the flattened area follows the
// final base position on both terrain copies.
func TestT124RelocatedSpawnAreaIsFlattened(t *testing.T) {
	maps := newT124Universe(t, "seed-t124-relocate", 64, 64, nil)
	planet := maps.PrimaryPlanet()
	// Strip all generated nodes and pin a single ore node far from the
	// single-player center spawn, forcing relocation.
	planet.Resources = []mapmodel.ResourceNode{{
		ID: "res-coal-1", PlanetID: planet.ID, Kind: mapmodel.ResourceCoal, Behavior: mapmodel.ResourceFinite,
		Position: mapmodel.GridPos{X: 20, Y: 20}, Total: 100, BaseYield: 2,
	}}

	core := newT124Core(t, maps, "p1")
	ws := core.World()
	base := t124BuildingPos(t, ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)

	if base.X == ws.MapWidth/2 && base.Y == ws.MapHeight/2 {
		t.Fatalf("expected spawn relocated away from center (%d,%d)", base.X, base.Y)
	}
	if dist := model.ManhattanDist(base, model.Position{X: 20, Y: 20}); dist > spawnMineDistance([]config.PlayerConfig{{Executor: config.ExecutorConfig{OperateRange: 6}}}) {
		t.Fatalf("base (%d,%d) not relocated next to ore node (20,20), dist=%d", base.X, base.Y, dist)
	}
	assertT124EdgeMargin(t, ws, base, 8)
	assertT124BuildableAround(t, ws, planet, base, spawnAreaRadius)
}

// TestT124ResumeSyncsFlattenedTerrainToMapModel verifies the map-model
// terrain copy matches the flattened runtime terrain after a save/resume.
func TestT124ResumeSyncsFlattenedTerrainToMapModel(t *testing.T) {
	seed := "seed-t124-resume"
	maps := newT124Universe(t, seed, 64, 64, nil)
	core := newT124Core(t, maps, "p1", "p2")
	ws := core.World()
	base := t124BuildingPos(t, ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}

	// Regenerate the map from the same seed: terrain is back to its raw,
	// unflattened state, as on a fresh resume.
	resumedMaps := newT124Universe(t, seed, 64, 64, nil)
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{IntervalTicks: 100})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	resumed, err := NewFromSave(core.cfg, resumedMaps, queue.New(), NewEventBus(), store, save)
	if err != nil {
		t.Fatalf("resume from save: %v", err)
	}
	assertT124BuildableAround(t, resumed.World(), resumedMaps.PrimaryPlanet(), base, spawnAreaRadius)
}

func TestT124ExplicitSpawnPointsAreUsedAndFlattened(t *testing.T) {
	spawns := []mapconfig.SpawnPointConfig{{X: 20, Y: 24}, {X: 44, Y: 40}}
	maps := newT124Universe(t, "seed-t124-explicit", 64, 64, spawns)
	core := newT124Core(t, maps, "p1", "p2")
	ws := core.World()
	planet := maps.PrimaryPlanet()
	for i, pid := range []string{"p1", "p2"} {
		base := t124BuildingPos(t, ws, pid, model.BuildingTypeBattlefieldAnalysisBase)
		if base.X != spawns[i].X || base.Y != spawns[i].Y {
			t.Fatalf("player %s base at (%d,%d), expected explicit spawn (%d,%d)", pid, base.X, base.Y, spawns[i].X, spawns[i].Y)
		}
		assertT124BuildableAround(t, ws, planet, base, spawnAreaRadius)
	}
}

// Starter matrix chain needs iron + copper inside operate range. When mapgen
// only drops coal/silicon near spawn (seed-001 playtest), inject the missing
// kinds so research is reachable without wandering the whole map.
func TestT124StarterIronAndCopperWithinMineDistance(t *testing.T) {
	// Explicit spawn far from any natural iron/copper: only coal nearby.
	spawns := []mapconfig.SpawnPointConfig{{X: 16, Y: 16}}
	maps := newT124Universe(t, "seed-t124-starter-ores", 48, 48, spawns)
	planet := maps.PrimaryPlanet()
	planet.Resources = []mapmodel.ResourceNode{{
		ID: "res-coal-only", PlanetID: planet.ID, Kind: mapmodel.ResourceCoal, Behavior: mapmodel.ResourceFinite,
		Position: mapmodel.GridPos{X: 18, Y: 16}, Total: 100, BaseYield: 2,
	}}

	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-t124-starter-ores", MaxTickRate: 10},
		Players: []config.PlayerConfig{{
			PlayerID: "p1",
			Key:      "p1-key",
			Executor: config.ExecutorConfig{OperateRange: 6},
		}},
	}
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{IntervalTicks: 100})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	core := New(cfg, maps, queue.New(), NewEventBus(), store)
	ws := core.World()
	base := t124BuildingPos(t, ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
	mineDist := spawnMineDistance(cfg.Players)

	for _, kind := range []string{string(mapmodel.ResourceIronOre), string(mapmodel.ResourceCopperOre)} {
		if !hasResourceKindWithin(ws, base, mineDist, kind) {
			t.Fatalf("expected %s within mine dist %d of base %+v", kind, mineDist, base)
		}
	}
	// Coal from the fixture must still be present; injection is additive.
	if !hasResourceKindWithin(ws, base, mineDist, string(mapmodel.ResourceCoal)) {
		t.Fatalf("expected original coal near base %+v", base)
	}
}

// config-dev + map.yaml (seed-001) must guarantee iron/copper near the base so
// the documented matrix chain is operable without seed luck.
func TestConfigDevStarterOresReachableForMatrixChain(t *testing.T) {
	core := newConfigDevTestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}
	base := findOwnedBuildingByType(ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
	if base == nil {
		t.Fatal("expected p1 base")
	}
	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		t.Fatal("expected executor state")
	}
	mineDist := spawnMineDistance([]config.PlayerConfig{{
		Executor: config.ExecutorConfig{OperateRange: execState.OperateRange},
	}})
	for _, kind := range []string{string(mapmodel.ResourceIronOre), string(mapmodel.ResourceCopperOre)} {
		if !hasResourceKindWithin(ws, base.Position, mineDist, kind) {
			t.Fatalf("config-dev seed: expected %s within dist %d of base %+v (operate_range=%d)",
				kind, mineDist, base.Position, execState.OperateRange)
		}
	}
}

func TestT124ComputeStartPositionsRespectEdgeMargin(t *testing.T) {
	cfg := &config.Config{Players: []config.PlayerConfig{{PlayerID: "p1"}, {PlayerID: "p2"}, {PlayerID: "p3"}, {PlayerID: "p4"}, {PlayerID: "p5"}}}
	for _, pos := range computeStartPositions(cfg, 64, 48) {
		if pos.X < 8 || pos.Y < 8 || pos.X > 64-1-8 || pos.Y > 48-1-8 {
			t.Fatalf("start position (%d,%d) violates edge margin on 64x48 map", pos.X, pos.Y)
		}
	}
}

func TestT124FlattenSpawnAreaOnlyTouchesRadius(t *testing.T) {
	ws := model.NewWorldState("planet-1-1", 32, 32)
	planet := &mapmodel.Planet{ID: "planet-1-1", Width: 32, Height: 32}
	planet.Terrain = make([][]terrain.TileType, 32)
	for y := range ws.Grid {
		planet.Terrain[y] = make([]terrain.TileType, 32)
		for x := range ws.Grid[y] {
			ws.Grid[y][x].Terrain = terrain.TileWater
			planet.Terrain[y][x] = terrain.TileWater
		}
	}
	center := model.Position{X: 16, Y: 16}
	flattenSpawnArea(ws, planet, center, spawnAreaRadius)
	assertT124BuildableAround(t, ws, planet, center, spawnAreaRadius)
	if ws.Grid[0][0].Terrain != terrain.TileWater {
		t.Fatalf("tile outside flatten radius changed to %s", ws.Grid[0][0].Terrain)
	}
	if ws.Grid[16][16+spawnAreaRadius+1].Terrain != terrain.TileWater {
		t.Fatalf("tile past flatten radius changed to %s", ws.Grid[16][16+spawnAreaRadius+1].Terrain)
	}
}
