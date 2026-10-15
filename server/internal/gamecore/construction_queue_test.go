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
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := NewEventBus()
	core := New(cfg, maps, q, bus, nil)
	grantAllTechs(core.world, "p1")
	grantAllItems(core.world, "p1", 500)
	return core
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
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected first build to execute, got %s (%s)", res.Status, res.Message)
	}

	res2, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res2.Code != model.CodePositionOccupied {
		t.Fatalf("expected reserved tile to return POSITION_OCCUPIED, got %s (%s)", res2.Code, res2.Message)
	}
}

func TestConstructionQueueRespectsRegionLimit(t *testing.T) {
	core := newConstructionTestCore(t, 2, 1)
	ws := core.world
	// mass_construction tech levels raise the region limit; pin it to the
	// configured baseline so this test isolates the config behavior.
	delete(ws.Players["p1"].Tech.CompletedTechs, "mass_construction")

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

	if res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd1); res.Status != model.StatusExecuted {
		t.Fatalf("expected cmd1 to execute, got %s (%s)", res.Status, res.Message)
	}
	if res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd2); res.Status != model.StatusExecuted {
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

// findTwoOpenTiles 返回两个互不重叠、且整块 5×5 占地都能落位的建造原点。
// 细分网格下"一个空格空着"不再等于"放得下"（建筑占地最大 5×5），两处必须
// 相距足够远，否则第二个建筑会压到第一个的占地（POSITION_OCCUPIED）。
func findTwoOpenTiles(ws *model.WorldState) (model.Position, model.Position) {
	if ws == nil {
		return model.Position{}, model.Position{}
	}
	fp := model.Footprint{Width: 5, Height: 5}
	var first *model.Position
	for y := 0; y < ws.MapHeight; y++ {
		for x := 0; x < ws.MapWidth; x++ {
			origin := model.Position{X: x, Y: y}
			if !ws.FootprintFits(origin, fp, model.BuildingTypeArcSmelter, "") {
				continue
			}
			if first == nil {
				c := origin
				first = &c
				continue
			}
			if ws.SurfaceDistance(origin, *first) <= 6 {
				continue
			}
			return *first, origin
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
	grantAllItems(ws, "p1", 100)

	pos1, _ := findTwoOpenTiles(ws)

	// Build a solar_panel（第 16 轮起成本只有物品）。
	def, ok := model.BuildingDefinitionByID("solar_panel")
	if !ok {
		t.Fatalf("solar_panel building definition not found")
	}
	wantItems := def.BuildCost.Items

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected build to execute, got %s (%s)", res.Status, res.Message)
	}

	// T078: With deduct-at-completion, resources are NOT deducted at enqueue time.
	// They are only deducted when construction completes (via settleConstructionQueue).
	// The reservation is created to lock the materials, but player keeps them until completion.
	if !player.HasItems(wantItems) {
		t.Fatalf("expected items untouched after build (no deduction yet), got %+v", player.Inventory)
	}

	// Verify material reservation was created (locks the materials but doesn't deduct)
	taskID := ws.Construction.Order[0]
	if ws.Construction.MaterialRes == nil {
		t.Fatalf("expected material reservation tracker to exist")
	}
	reservation := ws.Construction.MaterialRes.GetReservation(taskID)
	if reservation == nil {
		t.Fatalf("expected material reservation for task %s", taskID)
	}
	if len(reservation.Items) != len(wantItems) {
		t.Fatalf("expected reservation items %+v, got %+v", wantItems, reservation.Items)
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
	grantAllItems(ws, "p1", 100)

	pos1, _ := findTwoOpenTiles(ws)

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected build to execute, got %s (%s)", res.Status, res.Message)
	}

	taskID := ws.Construction.Order[0]
	invBeforeCancel := player.Inventory.Clone()

	// Cancel the construction
	cancelCmd := model.Command{
		Type: model.CmdCancelConstruction,
		Payload: map[string]any{
			"task_id": taskID,
		},
	}
	cancelRes, _ := execCommand(core, model.CmdCancelConstruction, ws, "p1", cancelCmd)
	if cancelRes.Status != model.StatusExecuted {
		t.Fatalf("expected cancel to execute, got %s (%s)", cancelRes.Status, cancelRes.Message)
	}

	// T078: With deduct-at-completion, resources are NOT deducted at enqueue time.
	// When a pending task is cancelled, there are no resources to refund because
	// they were never deducted - they were just locked.
	if len(player.Inventory) != len(invBeforeCancel) {
		t.Fatalf("expected inventory %+v after cancel (no deduction happened), got %+v", invBeforeCancel, player.Inventory)
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
	grantAllItems(ws, "p1", 100)

	pos1, _ := findTwoOpenTiles(ws)

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
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
	cancelRes, _ := execCommand(core, model.CmdCancelConstruction, ws, "p1", cancelCmd)
	if cancelRes.Status != model.StatusExecuted {
		t.Fatalf("expected cancel to execute, got %s (%s)", cancelRes.Status, cancelRes.Message)
	}

	// T078: With deduct-at-completion, after cancel the items are still there
	// (no deduction happened, so no refund)
	invAfterCancel := player.Inventory.Clone()
	if !player.HasItems(ws.Construction.Tasks[taskID].Cost.Items) {
		t.Fatalf("expected items untouched after cancel, got %+v", player.Inventory)
	}

	// Restore the construction
	restoreCmd := model.Command{
		Type: model.CmdRestoreConstruction,
		Payload: map[string]any{
			"task_id": taskID,
		},
	}
	restoreRes, _ := execCommand(core, model.CmdRestoreConstruction, ws, "p1", restoreCmd)
	if restoreRes.Status != model.StatusExecuted {
		t.Fatalf("expected restore to execute, got %s (%s)", restoreRes.Status, restoreRes.Message)
	}

	// T078: With deduct-at-completion, restore only re-creates the reservation.
	// Resources are still not deducted (deduction happens at completion).
	if len(player.Inventory) != len(invAfterCancel) {
		t.Fatalf("expected inventory %+v after restore (no deduction), got %+v", invAfterCancel, player.Inventory)
	}

	// Verify reservation was re-created
	reservation := ws.Construction.MaterialRes.GetReservation(taskID)
	if reservation == nil {
		t.Fatalf("expected material reservation to be re-created after restore")
	}
}

// T079: Test that pending task doesn't start when materials are insufficient
func TestConstructionPendingSkipsWhenMaterialsUnavailable(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world

	// 给足建造物品，好让 enqueue 时的预留检查通过。
	player := ws.Players["p1"]
	grantAllItems(ws, "p1", 100)

	pos1, _ := findTwoOpenTiles(ws)

	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos1.X, Y: pos1.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected build to execute, got %s (%s)", res.Status, res.Message)
	}

	taskID := ws.Construction.Order[0]
	task := ws.Construction.Tasks[taskID]

	// Verify task is pending
	if task.State != model.ConstructionPending {
		t.Fatalf("expected task to be pending, got %s", task.State)
	}

	// 现在把背包清空，让材料在 tick 之前变得不足。
	player.Inventory = model.ItemInventory{}

	// Process a tick - task should NOT start because materials are insufficient
	core.processTick()

	// Task should still be pending (skipped due to insufficient materials)
	if task.State != model.ConstructionPending {
		t.Fatalf("expected task to remain pending when materials unavailable, got %s", task.State)
	}
}
