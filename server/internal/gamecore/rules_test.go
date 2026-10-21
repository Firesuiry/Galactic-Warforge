package gamecore_test

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// newTestCore builds a GameCore with two players for testing
func newTestCore(t *testing.T) *gamecore.GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "test-seed",
			MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := gamecore.NewEventBus()
	return gamecore.New(cfg, maps, q, bus, nil)
}

func TestInitialPlayerResources(t *testing.T) {
	core := newTestCore(t)
	ws := core.World()
	ws.RLock()
	defer ws.RUnlock()

	p1 := ws.Players["p1"]
	if p1 == nil {
		t.Fatal("player p1 not found")
	}
	// 第 16 轮起玩家没有开局资源池（建造料在背包里），默认新局背包为空。
	if p1.Resources.Energy != 0 {
		t.Errorf("expected no starter resource pool, got %+v", p1.Resources)
	}
	if !p1.IsAlive {
		t.Error("player p1 should be alive at start")
	}
}

func TestBaseBuilding(t *testing.T) {
	core := newTestCore(t)
	ws := core.World()
	ws.RLock()
	defer ws.RUnlock()

	foundBases := 0
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeBattlefieldAnalysisBase {
			foundBases++
		}
	}
	if foundBases != 2 {
		t.Errorf("expected 2 base buildings, got %d", foundBases)
	}
}

func TestExecutorSpawnedForPlayer(t *testing.T) {
	core := newTestCore(t)
	ws := core.World()
	ws.RLock()
	defer ws.RUnlock()

	p1 := ws.Players["p1"]
	if p1 == nil || len(p1.MechasByOperator(p1.PlayerID)) == 0 {
		t.Fatal("expected executor for player p1")
	}
	record := p1.MechasByOperator(p1.PlayerID)[0]
	execUnit := ws.Units[record.UnitID]
	if execUnit == nil {
		t.Fatalf("executor unit %s not found", record.UnitID)
	}
	if execUnit.Type != model.UnitTypeExecutor {
		t.Fatalf("expected executor unit type, got %s", execUnit.Type)
	}
}

func TestBuildingStats(t *testing.T) {
	profile := model.BuildingProfileFor(model.BuildingTypeAssemblingMachineMk1, 1)
	if profile.MaxHP <= 0 {
		t.Errorf("assembler HP should be positive, got %d", profile.MaxHP)
	}
	if profile.Runtime.Params.EnergyConsume <= 0 {
		t.Errorf("assembler should consume energy")
	}

	profile2 := model.BuildingProfileFor(model.BuildingTypeAssemblingMachineMk1, 2)
	if profile2.MaxHP <= profile.MaxHP {
		t.Errorf("level 2 assembler should have more HP than level 1")
	}
}

func TestUnitStats(t *testing.T) {
	worker := model.UnitStats(model.UnitTypeWorker)
	soldier := model.UnitStats(model.UnitTypeSoldier)
	mecha := model.UnitStats(model.UnitTypeMecha)

	if soldier.HP <= worker.HP {
		t.Errorf("soldier should have more HP than worker")
	}
	if soldier.Attack <= worker.Attack {
		t.Errorf("soldier should have higher attack than worker")
	}
	if mecha.HP <= soldier.HP || mecha.Attack <= soldier.Attack || mecha.AttackRange <= soldier.AttackRange {
		t.Errorf("mecha should be the stronger controllable ground unit: %+v", mecha)
	}
	if cost := model.UnitCost(model.UnitTypeMecha); len(cost) == 0 {
		t.Fatal("mecha must require material costs")
	}
}

func TestBuildCost(t *testing.T) {
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
	if !ok {
		t.Fatal("mining machine definition missing")
	}
	if len(def.BuildCost.Items) == 0 {
		t.Error("mining machine should cost items")
	}
}

func TestSurfaceDistance(t *testing.T) {
	ws := model.NewWorldState("test", 32)
	a := model.Position{X: 0, Y: 0}
	b := model.Position{X: 3, Y: 4}
	dist := ws.SurfaceDistance(a, b)
	if dist != 7 {
		t.Errorf("expected manhattan dist 7, got %d", dist)
	}
}

func TestWorldInBounds(t *testing.T) {
	ws := model.NewWorldState("planet-1", 16)
	if !ws.InBounds(0, 0) {
		t.Error("(0,0) should be in bounds")
	}
	if !ws.InBounds(15, 15) {
		t.Error("(15,15) should be in bounds")
	}
	if ws.InBounds(ws.MapWidth, 0) {
		t.Error("map width should be out of bounds")
	}
	if ws.InBounds(-1, 0) {
		t.Error("(-1,0) should be out of bounds")
	}
}

func TestTileKey(t *testing.T) {
	k1 := model.TileKey(3, 4)
	k2 := model.TileKey(3, 4)
	k3 := model.TileKey(4, 3)
	if k1 != k2 {
		t.Errorf("same position should produce same key")
	}
	if k1 == k3 {
		t.Errorf("different positions should produce different keys")
	}
}
