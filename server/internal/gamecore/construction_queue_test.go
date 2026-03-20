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

func TestConstructionMaterialReservation(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world

	// Give player some resources
	player := ws.Players["p1"]
	player.Resources.Minerals = 1000
	player.Resources.Energy = 500

	pos1, _ := findTwoOpenTiles(ws)

	// Build a solar_panel (costs minerals and energy)
	def, ok := model.BuildingDefinitionByID("solar_panel")
	if !ok {
		t.Fatalf("solar_panel building definition not found")
	}
	mCost := def.BuildCost.Minerals
	eCost := def.BuildCost.Energy

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected build to execute, got %s (%s)", res.Status, res.Message)
	}

	// Verify resources were deducted
	if player.Resources.Minerals != 1000-mCost {
		t.Fatalf("expected minerals %d after build, got %d", 1000-mCost, player.Resources.Minerals)
	}
	if player.Resources.Energy != 500-eCost {
		t.Fatalf("expected energy %d after build, got %d", 500-eCost, player.Resources.Energy)
	}

	// Verify material reservation was created
	taskID := ws.Construction.Order[0]
	if ws.Construction.MaterialRes == nil {
		t.Fatalf("expected material reservation tracker to exist")
	}
	reservation := ws.Construction.MaterialRes.GetReservation(taskID)
	if reservation == nil {
		t.Fatalf("expected material reservation for task %s", taskID)
	}
	if reservation.Minerals != mCost {
		t.Fatalf("expected reservation minerals %d, got %d", mCost, reservation.Minerals)
	}
	if reservation.Source.Type != model.MaterialSourceLocal {
		t.Fatalf("expected source type LOCAL, got %v", reservation.Source.Type)
	}
}

func TestConstructionMaterialRefundOnCancel(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world

	// Give player some resources
	player := ws.Players["p1"]
	player.Resources.Minerals = 1000
	player.Resources.Energy = 500

	pos1, _ := findTwoOpenTiles(ws)

	def, ok := model.BuildingDefinitionByID("solar_panel")
	if !ok {
		t.Fatalf("solar_panel building definition not found")
	}
	mCost := def.BuildCost.Minerals
	eCost := def.BuildCost.Energy

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected build to execute, got %s (%s)", res.Status, res.Message)
	}

	taskID := ws.Construction.Order[0]
	mineralsBeforeCancel := player.Resources.Minerals
	energyBeforeCancel := player.Resources.Energy

	// Cancel the construction
	cancelCmd := model.Command{
		Type: model.CmdCancelConstruction,
		Payload: map[string]any{
			"task_id": taskID,
		},
	}
	cancelRes, _ := core.execCancelConstruction(ws, "p1", cancelCmd)
	if cancelRes.Status != model.StatusExecuted {
		t.Fatalf("expected cancel to execute, got %s (%s)", cancelRes.Status, cancelRes.Message)
	}

	// For pending (not started) tasks, full refund is expected
	if player.Resources.Minerals != mineralsBeforeCancel+mCost {
		t.Fatalf("expected minerals %d after cancel, got %d", mineralsBeforeCancel+mCost, player.Resources.Minerals)
	}
	if player.Resources.Energy != energyBeforeCancel+eCost {
		t.Fatalf("expected energy %d after cancel, got %d", energyBeforeCancel+eCost, player.Resources.Energy)
	}

	// Verify reservation was removed
	if ws.Construction.MaterialRes.GetReservation(taskID) != nil {
		t.Fatalf("expected reservation to be removed after cancel")
	}
}

func TestConstructionMaterialReReservationOnRestore(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world

	// Give player some resources
	player := ws.Players["p1"]
	player.Resources.Minerals = 1000
	player.Resources.Energy = 500

	pos1, _ := findTwoOpenTiles(ws)

	def, ok := model.BuildingDefinitionByID("solar_panel")
	if !ok {
		t.Fatalf("solar_panel building definition not found")
	}
	mCost := def.BuildCost.Minerals
	eCost := def.BuildCost.Energy

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected build to execute, got %s (%s)", res.Status, res.Message)
	}

	taskID := ws.Construction.Order[0]

	// Cancel the construction
	cancelCmd := model.Command{
		Type: model.CmdCancelConstruction,
		Payload: map[string]any{
			"task_id": taskID,
		},
	}
	cancelRes, _ := core.execCancelConstruction(ws, "p1", cancelCmd)
	if cancelRes.Status != model.StatusExecuted {
		t.Fatalf("expected cancel to execute, got %s (%s)", cancelRes.Status, cancelRes.Message)
	}

	// After cancel, resources should be refunded
	mineralsAfterCancel := player.Resources.Minerals
	energyAfterCancel := player.Resources.Energy

	// Restore the construction
	restoreCmd := model.Command{
		Type: model.CmdRestoreConstruction,
		Payload: map[string]any{
			"task_id": taskID,
		},
	}
	restoreRes, _ := core.execRestoreConstruction(ws, "p1", restoreCmd)
	if restoreRes.Status != model.StatusExecuted {
		t.Fatalf("expected restore to execute, got %s (%s)", restoreRes.Status, restoreRes.Message)
	}

	// After restore, resources should be re-deducted
	if player.Resources.Minerals != mineralsAfterCancel-mCost {
		t.Fatalf("expected minerals %d after restore, got %d", mineralsAfterCancel-mCost, player.Resources.Minerals)
	}
	if player.Resources.Energy != energyAfterCancel-eCost {
		t.Fatalf("expected energy %d after restore, got %d", energyAfterCancel-eCost, player.Resources.Energy)
	}

	// Verify reservation was re-created
	reservation := ws.Construction.MaterialRes.GetReservation(taskID)
	if reservation == nil {
		t.Fatalf("expected material reservation to be re-created after restore")
	}
}
