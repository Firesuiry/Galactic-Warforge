package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func newConstructionTestCore(t *testing.T, playerLimit, regionLimit int) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:                           "construction-test",
			MaxTickRate:                       10,
			ConstructionRegionConcurrentLimit: regionLimit,
		},
		Players: []config.PlayerConfig{
			{
				PlayerID: "p1",
				Key:      "key1",
				Executor: config.ExecutorConfig{ConcurrentTasks: playerLimit, OperateRange: 100},
			},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := NewEventBus()
	return New(cfg, maps, q, bus, nil)
}

func TestConstructionQueueReservesTiles(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world

	pos1, _ := findTwoOpenTiles(ws)
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected first build to execute, got %s (%s)", res.Status, res.Message)
	}

	res2, _ := core.execBuild(ws, "p1", cmd)
	if res2.Code != model.CodePositionOccupied {
		t.Fatalf("expected reserved tile to return POSITION_OCCUPIED, got %s (%s)", res2.Code, res2.Message)
	}
}

func TestConstructionQueueRespectsRegionLimit(t *testing.T) {
	core := newConstructionTestCore(t, 2, 1)
	ws := core.world

	pos1, pos2 := findTwoOpenTiles(ws)
	cmd1 := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	cmd2 := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos2.X, Y: pos2.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}

	if res, _ := core.execBuild(ws, "p1", cmd1); res.Status != model.StatusExecuted {
		t.Fatalf("expected cmd1 to execute, got %s (%s)", res.Status, res.Message)
	}
	if res, _ := core.execBuild(ws, "p1", cmd2); res.Status != model.StatusExecuted {
		t.Fatalf("expected cmd2 to execute, got %s (%s)", res.Status, res.Message)
	}

	if ws.Construction == nil || len(ws.Construction.Order) != 2 {
		t.Fatalf("expected 2 construction tasks queued")
	}
	firstID := ws.Construction.Order[0]
	secondID := ws.Construction.Order[1]

	core.processTick() // start first task
	if ws.Construction.Tasks[firstID].State != model.ConstructionInProgress {
		t.Fatalf("expected first task in progress")
	}
	if ws.Construction.Tasks[secondID].State != model.ConstructionPending {
		t.Fatalf("expected second task pending due to region limit")
	}

	core.processTick() // complete first task
	if _, ok := ws.TileBuilding[model.TileKey(pos1.X, pos1.Y)]; !ok {
		t.Fatalf("expected first construction to create building")
	}
	if _, ok := ws.TileBuilding[model.TileKey(pos2.X, pos2.Y)]; ok {
		t.Fatalf("expected second construction not yet built")
	}
}

func findTwoOpenTiles(ws *model.WorldState) (model.Position, model.Position) {
	if ws == nil {
		return model.Position{}, model.Position{}
	}
	var first *model.Position
	for y := 0; y < ws.MapHeight; y++ {
		for x := 0; x < ws.MapWidth; x++ {
			if !ws.Grid[y][x].Terrain.Buildable() {
				continue
			}
			if _, occupied := ws.TileBuilding[model.TileKey(x, y)]; occupied {
				continue
			}
			pos := model.Position{X: x, Y: y}
			if first == nil {
				first = &pos
				continue
			}
			if pos.X != first.X || pos.Y != first.Y {
				return *first, pos
			}
		}
	}
	if first == nil {
		return model.Position{}, model.Position{}
	}
	return *first, *first
}
