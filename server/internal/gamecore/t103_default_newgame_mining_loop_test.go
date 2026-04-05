package gamecore

import (
	"path/filepath"
	"sort"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func TestT103DefaultNewGameCanKeepFirstLabAndStartFirstMiningIncome(t *testing.T) {
	core := newConfigDevTestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	base := findOwnedBuildingByType(ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
	if base == nil {
		t.Fatal("expected p1 base building")
	}

	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		t.Fatal("expected active executor state")
	}
	execUnit := ws.Units[execState.UnitID]
	if execUnit == nil {
		t.Fatalf("expected executor unit %s", execState.UnitID)
	}

	windPos, err := findAdjacentOpenTile(ws, base.Position)
	if err != nil {
		t.Fatalf("find wind tile: %v", err)
	}
	if windPos == nil {
		t.Fatal("expected adjacent wind tile")
	}
	t103BuildAndSettle(t, core, ws, "p1", *windPos, model.BuildingTypeWindTurbine)

	labPos, err := findAdjacentOpenTile(ws, base.Position)
	if err != nil {
		t.Fatalf("find lab tile: %v", err)
	}
	if labPos == nil {
		t.Fatal("expected adjacent lab tile")
	}
	t103BuildAndSettle(t, core, ws, "p1", *labPos, model.BuildingTypeMatrixLab)

	lab := findOwnedBuildingByType(ws, "p1", model.BuildingTypeMatrixLab)
	if lab == nil {
		t.Fatal("expected first matrix_lab")
	}
	if lab.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected first matrix_lab to be powered before research, got %s (%s)", lab.Runtime.State, lab.Runtime.StateReason)
	}

	transferRes, _ := core.execTransferItem(ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": lab.ID,
			"item_id":     model.ItemElectromagneticMatrix,
			"quantity":    10,
		},
	})
	if transferRes.Code != model.CodeOK {
		t.Fatalf("transfer starter matrices: %s (%s)", transferRes.Code, transferRes.Message)
	}

	startRes, _ := core.execStartResearch(ws, "p1", model.Command{
		Type: model.CmdStartResearch,
		Payload: map[string]any{
			"tech_id": "electromagnetism",
		},
	})
	if startRes.Code != model.CodeOK {
		t.Fatalf("start electromagnetism: %s (%s)", startRes.Code, startRes.Message)
	}
	waitForCompletedResearch(t, core, "p1", "electromagnetism")

	wind := findOwnedBuildingByType(ws, "p1", model.BuildingTypeWindTurbine)
	if wind == nil {
		t.Fatal("expected first wind_turbine")
	}

	towerPos, minePos, ok := findReachableStarterMiningRoute(ws, execUnit.Position, execState.OperateRange, wind.Position)
	if !ok {
		t.Fatalf("expected reachable mining route near executor=%+v wind=%+v", execUnit.Position, wind.Position)
	}

	t103BuildAndSettle(t, core, ws, "p1", towerPos, model.BuildingTypeTeslaTower)
	t103BuildAndSettle(t, core, ws, "p1", minePos, model.BuildingTypeMiningMachine)

	miner := findOwnedBuildingByType(ws, "p1", model.BuildingTypeMiningMachine)
	if miner == nil {
		t.Fatal("expected first mining_machine")
	}

	itemID := collectorOutputItemID(ws, miner)
	if itemID == "" {
		t.Fatalf("expected mining machine on a real resource node, got %+v", miner.Position)
	}

	for i := 0; i < 64; i++ {
		core.processTick()
		lab = findOwnedBuildingByType(ws, "p1", model.BuildingTypeMatrixLab)
		miner = findOwnedBuildingByType(ws, "p1", model.BuildingTypeMiningMachine)
		if lab == nil || miner == nil {
			continue
		}
		if miner.Runtime.State == model.BuildingWorkRunning &&
			miner.Runtime.StateReason != "power_out_of_range" &&
			(miner.Storage.OutputQuantity(itemID) > 0 || player.Stats.ProductionStats.ByItem[itemID] > 0 || player.Stats.ProductionStats.TotalOutput > 0) {
			break
		}
	}

	lab = findOwnedBuildingByType(ws, "p1", model.BuildingTypeMatrixLab)
	if lab == nil {
		t.Fatal("expected first matrix_lab to remain after mining route")
	}
	if lab.Runtime.Functions.Research == nil {
		t.Fatalf("expected first matrix_lab to keep research semantics, got %+v", lab.Runtime.Functions)
	}
	if lab.Production == nil || lab.Production.RecipeID != "" {
		t.Fatalf("expected first matrix_lab to stay in research mode, got %+v", lab.Production)
	}

	miner = findOwnedBuildingByType(ws, "p1", model.BuildingTypeMiningMachine)
	if miner == nil {
		t.Fatal("expected first mining_machine after route")
	}
	if miner.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected mining machine running, got %s (%s)", miner.Runtime.State, miner.Runtime.StateReason)
	}
	if miner.Runtime.StateReason == "power_out_of_range" {
		t.Fatalf("expected mining machine not stuck out of range, got %s", miner.Runtime.StateReason)
	}
	if miner.Storage.OutputQuantity(itemID) == 0 && totalStorageItems(miner.Storage) == 0 {
		t.Fatalf("expected mining machine storage to start filling, got %+v", miner.Storage)
	}
	if player.Stats == nil || player.Stats.ProductionStats.TotalOutput == 0 {
		t.Fatalf("expected player production stats to start growing, got %+v", player.Stats)
	}
}

func newConfigDevTestCore(t *testing.T) *GameCore {
	t.Helper()

	cfgPath := filepath.Join("..", "..", "config-dev.yaml")
	mapCfgPath := filepath.Join("..", "..", "map.yaml")

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config-dev: %v", err)
	}
	cfg.Server.DataDir = t.TempDir()

	mapCfg, err := mapconfig.Load(mapCfgPath)
	if err != nil {
		t.Fatalf("load map config: %v", err)
	}

	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	return New(cfg, maps, queue.New(), NewEventBus(), nil)
}

func t103BuildAndSettle(t *testing.T, core *GameCore, ws *model.WorldState, playerID string, pos model.Position, btype model.BuildingType) {
	t.Helper()

	res, _ := core.execBuild(ws, playerID, model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &pos},
		Payload: map[string]any{
			"building_type": string(btype),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("build %s at %+v: %s (%s)", btype, pos, res.Code, res.Message)
	}
	t103ProcessTicks(core, 8)
}

func t103ProcessTicks(core *GameCore, ticks int) {
	for i := 0; i < ticks; i++ {
		core.processTick()
	}
}

func findReachableStarterMiningRoute(ws *model.WorldState, executorPos model.Position, operateRange int, sourcePos model.Position) (model.Position, model.Position, bool) {
	if ws == nil {
		return model.Position{}, model.Position{}, false
	}

	resourceIDs := make([]string, 0, len(ws.Resources))
	for resourceID, node := range ws.Resources {
		if node == nil {
			continue
		}
		resourceIDs = append(resourceIDs, resourceID)
	}
	sort.Strings(resourceIDs)

	ws.RLock()
	defer ws.RUnlock()

	for _, resourceID := range resourceIDs {
		node := ws.Resources[resourceID]
		if node == nil {
			continue
		}
		minePos := node.Position
		if !ws.InBounds(minePos.X, minePos.Y) {
			continue
		}
		mineTile := ws.Grid[minePos.Y][minePos.X]
		if !mineTile.Terrain.Buildable() {
			continue
		}
		if operateRange > 0 && model.ManhattanDist(executorPos, minePos) > operateRange {
			continue
		}
		if _, occupied := ws.TileBuilding[model.TileKey(minePos.X, minePos.Y)]; occupied {
			continue
		}

		for y := 0; y < ws.MapHeight; y++ {
			for x := 0; x < ws.MapWidth; x++ {
				towerPos := model.Position{X: x, Y: y}
				if !t103IsOpenBuildTile(ws, towerPos) {
					continue
				}
				if operateRange > 0 && model.ManhattanDist(executorPos, towerPos) > operateRange {
					continue
				}
				if model.ManhattanDist(sourcePos, towerPos) > model.DefaultTeslaTowerRange {
					continue
				}
				if model.ManhattanDist(towerPos, minePos) > model.DefaultTeslaTowerRange {
					continue
				}
				return towerPos, minePos, true
			}
		}
	}

	return model.Position{}, model.Position{}, false
}

func t103IsOpenBuildTile(ws *model.WorldState, pos model.Position) bool {
	if ws == nil || !ws.InBounds(pos.X, pos.Y) {
		return false
	}
	tile := ws.Grid[pos.Y][pos.X]
	if !tile.Terrain.Buildable() || tile.ResourceNodeID != "" {
		return false
	}
	_, occupied := ws.TileBuilding[model.TileKey(pos.X, pos.Y)]
	return !occupied
}
