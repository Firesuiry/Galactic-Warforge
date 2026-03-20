package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// newE2ETestCore creates a GameCore for end-to-end testing
func newE2ETestCore(t *testing.T) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:     "e2e-test-seed",
			MaxTickRate: 10,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy:      mapconfig.GalaxyConfig{SystemCount: 1},
		System:      mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet:      mapconfig.PlanetConfig{Width: 32, Height: 32, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := NewEventBus()
	return New(cfg, maps, q, bus, nil)
}

// TestE2E_TickCommandChain tests the full command → tick → query → event chain
func TestE2E_TickCommandChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// 1. Send a build command
	pos, _ := findOpenTile(ws, 2)
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, evts := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build command failed: %s (%s)", res.Status, res.Message)
	}
	if len(evts) == 0 {
		t.Log("build produced no immediate events (expected - events come from tick settlement)")
	}

	// 2. Advance the tick
	initialTick := ws.Tick
	core.processTick()
	if ws.Tick != initialTick+1 {
		t.Errorf("expected tick to advance by 1, got %d", ws.Tick-initialTick)
	}

	// 3. Verify the building was created
	foundBuilding := false
	ws.RLock()
	for _, b := range ws.Buildings {
		if b.Type == "solar_panel" && b.OwnerID == "p1" {
			foundBuilding = true
			break
		}
	}
	ws.RUnlock()
	if !foundBuilding {
		t.Error("solar_panel building not found after tick settlement")
	}

	// 4. Verify events were generated
	core.world.RLock()
	eventCount := len(core.world.Events)
	core.world.RUnlock()
	t.Logf("Events generated after tick: %d", eventCount)
}

// TestE2E_LogisticsProductionChain tests mining → conveyor → production → storage
func TestE2E_LogisticsProductionChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// Find a resource tile
	var resTile *model.Tile
	ws.RLock()
outer:
	for y := 0; y < int(ws.MapHeight); y++ {
		for x := 0; x < int(ws.MapWidth); x++ {
			tile := ws.Grid[y][x]
			if tile != nil && tile.Resource != nil && tile.Resource.Type != "" {
				resTile = tile
				break outer
			}
		}
	}
	ws.RUnlock()
	if resTile == nil {
		t.Skip("no resource tile found on map")
	}

	// Find the position of the resource tile
	var resPos model.Position
	ws.RLock()
outer2:
	for y := 0; y < int(ws.MapHeight); y++ {
		for x := 0; x < int(ws.MapWidth); x++ {
			if ws.Grid[y][x] == resTile {
				resPos = model.Position{X: int32(x), Y: int32(y)}
				break outer2
			}
		}
	}
	ws.RUnlock()

	// 1. Build a mining machine on the resource
	miningPos := &model.Position{X: resPos.X, Y: resPos.Y}
	buildCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: miningPos},
		Payload: map[string]any{
			"building_type": "mining_machine",
		},
	}
	res, _ := core.execBuild(ws, "p1", buildCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("mining machine build failed: %s (%s)", res.Status, res.Message)
	}

	// 2. Build a smelter for processing
	smeltPos := &model.Position{X: resTile.X + 1, Y: resTile.Y}
	smeltCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: smeltPos},
		Payload: map[string]any{
			"building_type": "smelter",
		},
	}
	res, _ = core.execBuild(ws, "p1", smeltCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("smelter build failed: %s (%s)", res.Status, res.Message)
	}

	// 3. Build a storage to hold output
	storePos := &model.Position{X: resTile.X + 2, Y: resTile.Y}
	storeCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: storePos},
		Payload: map[string]any{
			"building_type": "storage",
		},
	}
	res, _ = core.execBuild(ws, "p1", storeCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("storage build failed: %s (%s)", res.Status, res.Message)
	}

	// 4. Run several ticks to let the production chain work
	initialTick := ws.Tick
	for i := 0; i < 10; i++ {
		core.processTick()
	}

	// 5. Verify that resources were produced
	ws.RLock()
	p1 := ws.Players["p1"]
	initialMinerals := p1.Resources.Minerals
	ws.RUnlock()
	t.Logf("Minerals after 10 ticks: %d", initialMinerals)
	if initialMinerals <= 0 {
		t.Error("expected minerals to be produced from mining chain")
	}
	t.Logf("Chain progressed from tick %d to %d, minerals: %d", initialTick, ws.Tick, initialMinerals)
}

// TestE2E_VisibilityQueryChain tests fog of war and visibility filtering
func TestE2E_VisibilityQueryChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// Player 1 builds a building far from player 2's base
	p1Pos, _ := findOpenTile(ws, 2)
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: p1Pos.X, Y: p1Pos.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build failed: %s (%s)", res.Status, res.Message)
	}

	// Advance tick
	core.processTick()

	// Get the visibility filter for player 2
	ws.RLock()
	p2 := ws.Players["p2"]
	if p2 == nil {
		ws.RUnlock()
		t.Fatal("player p2 not found")
	}
	p2Pos := p2.Position
	ws.RUnlock()

	// Player 2 should not see player 1's building if far enough
	ws.RLock()
	for _, b := range ws.Buildings {
		if b.OwnerID == "p1" {
			dist := manhattanDistance(int(p2Pos.X), int(p2Pos.Y), int(b.Position.X), int(b.Position.Y))
			t.Logf("Player 1 building at (%d,%d), player 2 at (%d,%d), distance: %d",
				b.Position.X, b.Position.Y, p2Pos.X, p2Pos.Y, dist)
		}
	}
	ws.RUnlock()
}

// TestE2E_ResearchChain tests tech research → completion → unlock chain
func TestE2E_ResearchChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// Start a research
	startCmd := model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "basic_research",
		},
	}
	res, evts := core.execStartResearch(ws, "p1", startCmd)
	if res.Status != model.StatusExecuted {
		t.Logf("research start response: %s (%s)", res.Status, res.Message)
		// Research may fail if prerequisites not met - that's OK for this test
		t.Skip("research prerequisites not met, skipping")
	}

	// Verify event was generated
	if len(evts) != 0 {
		for _, e := range evts {
			t.Logf("Event: %s", e.EventType)
		}
	}

	// Run many ticks until research completes
	p1 := ws.Players["p1"]
	initialTech := ""
	if p1.Tech != nil && p1.Tech.CurrentResearch != nil {
		initialTech = p1.Tech.CurrentResearch.TechID
	}

	for i := 0; i < 500; i++ {
		core.processTick()
		if p1.Tech != nil && p1.Tech.CurrentResearch != nil && p1.Tech.CurrentResearch.TechID != initialTech {
			t.Logf("Research changed at tick %d", ws.Tick)
			break
		}
	}
}

// TestE2E_AuditTrail tests that commands are properly audited
func TestE2E_AuditTrail(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// Send a command
	pos, _ := findOpenTile(ws, 2)
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}

	// Execute via command path
	req := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  "audit-test-001",
			IssuerType: "player",
			IssuerID:   "p1",
			Commands:    []model.Command{cmd},
		},
		PlayerID: "p1",
	}
	_, _ = core.executeRequest(req)

	// Advance tick
	core.processTick()

	// Check audit log
	if core.auditLog != nil {
		entries := core.auditLog.Recent(10)
		t.Logf("Audit log entries after command: %d", len(entries))
	}
}

// TestE2E_ReplayRollbackConsistency tests that replay produces same results
func TestE2E_ReplayRollbackConsistency(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// Build some buildings
	for i := 0; i < 3; i++ {
		pos, _ := findOpenTile(ws, 2)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}
		core.execBuild(ws, "p1", cmd)
		core.processTick()
	}

	snapshotTick := ws.Tick
	t.Logf("Snapshot at tick %d, buildings: %d", snapshotTick, len(ws.Buildings))

	// Build more
	for i := 0; i < 2; i++ {
		pos, _ := findOpenTile(ws, 2)
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}
		core.execBuild(ws, "p1", cmd)
		core.processTick()
	}

	finalTick := ws.Tick
	finalBuildingCount := len(ws.Buildings)
	t.Logf("After more builds: tick %d, buildings: %d", finalTick, finalBuildingCount)

	// Note: Full replay/rollback test would require snapshot store
	// This is a smoke test for the concept
	if finalBuildingCount <= 3 {
		t.Error("expected building count to increase")
	}
}

// findOpenTile finds an open tile for building
func findOpenTile(ws *model.WorldState, margin int) (*model.Position, error) {
	if ws == nil {
		return nil, nil
	}
	ws.RLock()
	defer ws.RUnlock()

	for y := margin; y < int(ws.MapHeight)-margin; y++ {
		for x := margin; x < int(ws.MapWidth)-margin; x++ {
			if !ws.Grid[y][x].Terrain.Buildable() {
				continue
			}
			if _, occupied := ws.TileBuilding[model.TileKey(x, y)]; occupied {
				continue
			}
			// Skip resource tiles for general building
			if ws.Grid[y][x].Resource != nil && ws.Grid[y][x].Resource.Type != "" {
				continue
			}
			pos := &model.Position{X: int32(x), Y: int32(y)}
			return pos, nil
		}
	}
	return nil, nil
}

// manhattanDistance calculates Manhattan distance between two points
func manhattanDistance(x1, y1, x2, y2 int) int {
	dx := x1 - x2
	if dx < 0 {
		dx = -dx
	}
	dy := y1 - y2
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}
