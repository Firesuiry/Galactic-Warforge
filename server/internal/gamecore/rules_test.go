package gamecore_test

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
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
			MapWidth:    16,
			MapHeight:   16,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	q := queue.New()
	bus := gamecore.NewEventBus()
	return gamecore.New(cfg, q, bus)
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
	if p1.Resources.Minerals < 100 {
		t.Errorf("expected minerals >= 100, got %d", p1.Resources.Minerals)
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
		if b.Type == model.BuildingTypeBase {
			foundBases++
		}
	}
	if foundBases != 2 {
		t.Errorf("expected 2 base buildings, got %d", foundBases)
	}
}

func TestBuildingStats(t *testing.T) {
	stats := model.BuildingStats(model.BuildingTypeFactory, 1)
	if stats.HP <= 0 {
		t.Errorf("factory HP should be positive, got %d", stats.HP)
	}
	if stats.EnergyConsume <= 0 {
		t.Errorf("factory should consume energy")
	}

	stats2 := model.BuildingStats(model.BuildingTypeFactory, 2)
	if stats2.MaxHP <= stats.MaxHP {
		t.Errorf("level 2 factory should have more HP than level 1")
	}
}

func TestUnitStats(t *testing.T) {
	worker := model.UnitStats(model.UnitTypeWorker)
	soldier := model.UnitStats(model.UnitTypeSoldier)

	if soldier.HP <= worker.HP {
		t.Errorf("soldier should have more HP than worker")
	}
	if soldier.Attack <= worker.Attack {
		t.Errorf("soldier should have higher attack than worker")
	}
}

func TestBuildCost(t *testing.T) {
	m, e := model.BuildingCost(model.BuildingTypeMine)
	if m <= 0 {
		t.Errorf("mine should cost minerals")
	}
	_ = e
}

func TestManhattanDist(t *testing.T) {
	a := model.Position{X: 0, Y: 0}
	b := model.Position{X: 3, Y: 4}
	dist := model.ManhattanDist(a, b)
	if dist != 7 {
		t.Errorf("expected manhattan dist 7, got %d", dist)
	}
}

func TestWorldInBounds(t *testing.T) {
	ws := model.NewWorldState(16, 16)
	if !ws.InBounds(0, 0) {
		t.Error("(0,0) should be in bounds")
	}
	if !ws.InBounds(15, 15) {
		t.Error("(15,15) should be in bounds")
	}
	if ws.InBounds(16, 0) {
		t.Error("(16,0) should be out of bounds")
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
