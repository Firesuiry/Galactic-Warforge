package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
)

func TestReplayMatchesSnapshot(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "replay-seed",
			MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
		},
		Server: config.ServerConfig{
			Port:                   9999,
			RateLimit:              100,
			SnapshotIntervalTicks:  1,
			SnapshotRetentionCount: 10,
			SnapshotRetentionTicks: 100,
		},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)

	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 10,
		RetentionTicks: 100,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	q := queue.New()
	bus := NewEventBus()
	core := New(cfg, maps, q, bus, store)

	ws := core.World()
	ws.RLock()
	p1 := ws.Players["p1"]
	if p1 == nil || p1.Executor == nil {
		ws.RUnlock()
		t.Fatal("player executor missing")
	}
	execID := p1.Executor.UnitID
	exec := ws.Units[execID]
	if exec == nil {
		ws.RUnlock()
		t.Fatal("executor unit missing")
	}
	target := findMoveTarget(ws, exec.Position)
	ws.RUnlock()
	if target == nil {
		t.Fatal("no available move target found")
	}

	req := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  "req-1",
			IssuerType: "player",
			IssuerID:   "p1",
			Commands: []model.Command{
				{
					Type:   model.CmdMove,
					Target: model.CommandTarget{EntityID: execID, Position: target},
				},
			},
		},
		PlayerID: "p1",
	}
	if !q.Enqueue(req) {
		t.Fatal("failed to enqueue command")
	}

	core.processTick()
	core.processTick()

	resp, err := core.Replay(model.ReplayRequest{
		FromTick: 1,
		ToTick:   2,
		Verify:   true,
	})
	if err != nil {
		t.Fatalf("replay error: %v", err)
	}
	if resp.DriftDetected {
		t.Fatalf("expected no drift, got drift with notes: %v", resp.Notes)
	}
	if resp.SnapshotDigest == nil {
		t.Fatalf("expected snapshot digest for verification")
	}
}

func findMoveTarget(ws *model.WorldState, pos model.Position) *model.Position {
	dirs := []model.Position{
		{X: 1, Y: 0},
		{X: -1, Y: 0},
		{X: 0, Y: 1},
		{X: 0, Y: -1},
	}
	for _, d := range dirs {
		x := pos.X + d.X
		y := pos.Y + d.Y
		if !ws.InBounds(x, y) {
			continue
		}
		key := model.TileKey(x, y)
		if _, occupied := ws.TileBuilding[key]; occupied {
			continue
		}
		return &model.Position{X: x, Y: y}
	}
	return nil
}
