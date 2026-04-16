package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

func TestRollbackRestoresState(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "rollback-seed",
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
	target1 := findMoveTarget(ws, exec.Position)
	ws.RUnlock()
	if target1 == nil {
		t.Fatal("no available move target found")
	}

	req1 := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  "req-rollback-1",
			IssuerType: "player",
			IssuerID:   "p1",
			Commands: []model.Command{
				{
					Type:   model.CmdMove,
					Target: model.CommandTarget{EntityID: execID, Position: target1},
				},
			},
		},
		PlayerID: "p1",
	}
	if !q.Enqueue(req1) {
		t.Fatal("failed to enqueue first command")
	}

	core.processTick()

	ws.RLock()
	posAfterTick1 := ws.Units[execID].Position
	ws.RUnlock()

	ws.RLock()
	target2 := findMoveTarget(ws, posAfterTick1)
	ws.RUnlock()
	if target2 == nil {
		t.Fatal("no second move target found")
	}

	req2 := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  "req-rollback-2",
			IssuerType: "player",
			IssuerID:   "p1",
			Commands: []model.Command{
				{
					Type:   model.CmdMove,
					Target: model.CommandTarget{EntityID: execID, Position: target2},
				},
			},
		},
		PlayerID: "p1",
	}
	if !q.Enqueue(req2) {
		t.Fatal("failed to enqueue second command")
	}

	core.processTick()

	ws.RLock()
	posAfterTick2 := ws.Units[execID].Position
	ws.RUnlock()
	if posAfterTick1 == posAfterTick2 {
		t.Fatal("expected executor to move on second command")
	}

	resp, err := core.Rollback(model.RollbackRequest{ToTick: 1})
	if err != nil {
		t.Fatalf("rollback error: %v", err)
	}
	if resp.ToTick != 1 || resp.FromTick != 2 {
		t.Fatalf("unexpected rollback response ticks: %+v", resp)
	}

	ws.RLock()
	if ws.Tick != 1 {
		ws.RUnlock()
		t.Fatalf("expected world tick 1 after rollback, got %d", ws.Tick)
	}
	posAfterRollback := ws.Units[execID].Position
	ws.RUnlock()

	if posAfterRollback != posAfterTick1 {
		t.Fatalf("expected position %v after rollback, got %v", posAfterTick1, posAfterRollback)
	}

	for _, entry := range core.GetCommandLog().All() {
		if entry.Tick > 1 {
			t.Fatalf("command log contains entry after rollback tick: %d", entry.Tick)
		}
	}
	if snap := store.SnapshotAt(2); snap != nil {
		t.Fatalf("expected snapshot at tick 2 trimmed")
	}
}

func TestRollbackRestoresProductionStateBetweenSnapshots(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "rollback-production-seed",
			MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
		},
		Server: config.ServerConfig{
			Port:                   9999,
			RateLimit:              100,
			SnapshotIntervalTicks:  10,
			SnapshotRetentionCount: 16,
			SnapshotRetentionTicks: 200,
		},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)

	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  10,
		RetentionCount: 16,
		RetentionTicks: 200,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	core := New(cfg, maps, queue.New(), NewEventBus(), store)
	ws := core.World()

	assembler := newProductionTestBuilding("assembler-rollback", model.BuildingTypeAssemblingMachineMk1, model.Position{X: 3, Y: 3}, "gear")
	assembler.Storage.InputBuffer = model.ItemInventory{model.ItemIronIngot: 1}
	attachBuilding(ws, assembler)
	store.SaveSnapshot(snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime))

	for i := 0; i < 30; i++ {
		core.processTick()
	}

	if got := assembler.Storage.OutputQuantity(model.ItemGear); got != 1 {
		t.Fatalf("expected one gear before rollback, got %d", got)
	}
	if snap := store.SnapshotAt(20); snap == nil {
		t.Fatal("expected snapshot at tick 20 for replay-based rollback")
	}
	if snap := store.SnapshotAt(25); snap != nil {
		t.Fatal("expected no direct snapshot at tick 25")
	}

	resp, err := core.Rollback(model.RollbackRequest{ToTick: 25})
	if err != nil {
		t.Fatalf("rollback error: %v", err)
	}
	if resp.ToTick != 25 {
		t.Fatalf("expected rollback target tick 25, got %+v", resp)
	}
	if got := assembler.Storage.OutputQuantity(model.ItemGear); got != 1 {
		t.Fatalf("expected gear output restored after rollback replay, got %d", got)
	}
}
