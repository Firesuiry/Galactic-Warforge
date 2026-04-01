package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

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
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 32, Height: 32, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := NewEventBus()
	return New(cfg, maps, q, bus, nil)
}

func TestE2E_TickCommandChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_collection")

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}

	res, _ := core.execBuild(ws, "p1", cmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build command failed: %s (%s)", res.Status, res.Message)
	}

	for i := 0; i < 3; i++ {
		core.processTick()
	}

	foundBuilding := false
	ws.RLock()
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeSolarPanel && b.OwnerID == "p1" {
			foundBuilding = true
			break
		}
	}
	ws.RUnlock()
	if !foundBuilding {
		t.Fatal("solar_panel building not found after construction tick")
	}
}

func TestE2E_ResearchUnlockBuildChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	startCmd := model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "electromagnetism",
		},
	}
	res, _ := core.execStartResearch(ws, "p1", startCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("start research failed: %s (%s)", res.Status, res.Message)
	}

	for i := 0; i < 50; i++ {
		core.processTick()
	}

	player := ws.Players["p1"]
	if player == nil || player.Tech == nil || player.Tech.CompletedTechs["electromagnetism"] == 0 {
		t.Fatal("electromagnetism should be completed after research ticks")
	}

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	buildCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "wind_turbine",
		},
	}
	buildRes, _ := core.execBuild(ws, "p1", buildCmd)
	if buildRes.Status != model.StatusExecuted {
		t.Fatalf("build unlocked wind_turbine failed: %s (%s)", buildRes.Status, buildRes.Message)
	}
}

func TestE2E_CollectorsRequireResourceNodes(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "fluid_storage", "plasma_refining")

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}

	for _, btype := range []string{"water_pump", "oil_extractor"} {
		buildCmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: pos},
			Payload: map[string]any{
				"building_type": btype,
			},
		}
		res, _ := core.execBuild(ws, "p1", buildCmd)
		if res.Status != model.StatusFailed {
			t.Fatalf("%s should fail on non-resource tile, got %s", btype, res.Status)
		}
		if res.Code != model.CodeInvalidTarget {
			t.Fatalf("%s should return INVALID_TARGET, got %s", btype, res.Code)
		}
	}
}

func TestE2E_ProductionChain(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "basic_assembling_processes", "solar_collection")

	player := ws.Players["p1"]
	player.Resources.Energy = 1000

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	powerPos, err := findAdjacentOpenTile(ws, *pos)
	if err != nil {
		t.Fatalf("find adjacent power tile: %v", err)
	}
	buildCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "assembling_machine_mk1",
			"recipe_id":     "gear",
		},
	}
	res, _ := core.execBuild(ws, "p1", buildCmd)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build assembler failed: %s (%s)", res.Status, res.Message)
	}

	powerCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: powerPos},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	powerRes, _ := core.execBuild(ws, "p1", powerCmd)
	if powerRes.Status != model.StatusExecuted {
		t.Fatalf("build solar panel failed: %s (%s)", powerRes.Status, powerRes.Message)
	}

	for i := 0; i < 5; i++ {
		core.processTick()
	}

	var assembler *model.Building
	ws.RLock()
	for _, b := range ws.Buildings {
		if b.OwnerID == "p1" && b.Type == model.BuildingTypeAssemblingMachineMk1 {
			assembler = b
			break
		}
	}
	ws.RUnlock()
	if assembler == nil || assembler.Storage == nil || assembler.Production == nil {
		t.Fatal("assembler should be constructed with storage and production state")
	}
	if assembler.Production.RecipeID != "gear" {
		t.Fatalf("expected assembler recipe gear, got %q", assembler.Production.RecipeID)
	}

	accepted, remaining, err := assembler.Storage.Receive(model.ItemIronIngot, 1)
	if err != nil {
		t.Fatalf("prime assembler input: %v", err)
	}
	if accepted != 1 || remaining != 0 {
		t.Fatalf("expected to insert 1 iron_ingot, accepted=%d remaining=%d", accepted, remaining)
	}

	for i := 0; i < 25; i++ {
		core.processTick()
	}

	if got := assembler.Storage.OutputQuantity(model.ItemGear); got <= 0 {
		t.Fatalf("expected produced gear in assembler storage, got %d", got)
	}
}

func findOpenTile(ws *model.WorldState, margin int) (*model.Position, error) {
	if ws == nil {
		return nil, nil
	}
	ws.RLock()
	defer ws.RUnlock()

	for y := margin; y < ws.MapHeight-margin; y++ {
		for x := margin; x < ws.MapWidth-margin; x++ {
			if !ws.Grid[y][x].Terrain.Buildable() {
				continue
			}
			if ws.Grid[y][x].ResourceNodeID != "" {
				continue
			}
			if _, occupied := ws.TileBuilding[model.TileKey(x, y)]; occupied {
				continue
			}
			return &model.Position{X: x, Y: y}, nil
		}
	}
	return nil, nil
}

func findAdjacentOpenTile(ws *model.WorldState, origin model.Position) (*model.Position, error) {
	if ws == nil {
		return nil, nil
	}
	candidates := []model.Position{
		{X: origin.X + 1, Y: origin.Y},
		{X: origin.X - 1, Y: origin.Y},
		{X: origin.X, Y: origin.Y + 1},
		{X: origin.X, Y: origin.Y - 1},
	}
	ws.RLock()
	defer ws.RUnlock()
	for _, candidate := range candidates {
		if !ws.InBounds(candidate.X, candidate.Y) {
			continue
		}
		tile := ws.Grid[candidate.Y][candidate.X]
		if !tile.Terrain.Buildable() || tile.ResourceNodeID != "" {
			continue
		}
		if _, occupied := ws.TileBuilding[model.TileKey(candidate.X, candidate.Y)]; occupied {
			continue
		}
		pos := candidate
		return &pos, nil
	}
	return nil, nil
}
