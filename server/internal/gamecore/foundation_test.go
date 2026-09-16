package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

func TestFoundationBuildsOnWaterAndDemolitionRestoresTerrain(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos := model.Position{X: 4, Y: 4}
	ws.Grid[pos.Y][pos.X].Terrain = terrain.TileWater
	ws.Players["p1"].Resources.Minerals = 100
	res, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild,
		Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeFoundation)}})
	if res.Status != model.StatusExecuted {
		t.Fatalf("foundation should queue on water: %s (%s)", res.Code, res.Message)
	}
	var task *model.ConstructionTask
	for _, candidate := range ws.Construction.Tasks {
		task = candidate
	}
	if _, err := core.completeConstructionTask(ws, task); err != nil {
		t.Fatalf("foundation completion failed: %v", err)
	}
	if ws.Grid[pos.Y][pos.X].Terrain != terrain.TileBuildable {
		t.Fatalf("foundation should convert water to buildable terrain")
	}
	var foundation *model.Building
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeFoundation {
			foundation = b
		}
	}
	if foundation == nil || len(foundation.FoundationTerrain) != 1 {
		t.Fatalf("foundation terrain provenance was not persisted: %+v", foundation)
	}
	demolishBuilding(ws, foundation, 0)
	if ws.Grid[pos.Y][pos.X].Terrain != terrain.TileWater {
		t.Fatalf("demolishing foundation should restore water terrain, got %s", ws.Grid[pos.Y][pos.X].Terrain)
	}
}

func TestFoundationDoesNotOccupyFilledTile(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos := model.Position{X: 4, Y: 4}
	ws.Grid[pos.Y][pos.X].Terrain = terrain.TileWater
	ws.Players["p1"].Resources.Minerals = 100
	res, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild,
		Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeFoundation)}})
	if res.Status != model.StatusExecuted {
		t.Fatalf("foundation should queue: %s", res.Message)
	}
	var foundationTask *model.ConstructionTask
	for _, task := range ws.Construction.Tasks {
		foundationTask = task
	}
	if _, err := core.completeConstructionTask(ws, foundationTask); err != nil {
		t.Fatal(err)
	}
	factory := &model.Building{ID: "factory", Type: model.BuildingTypeArcSmelter, OwnerID: "p1", Position: pos,
		Runtime: model.BuildingProfileFor(model.BuildingTypeArcSmelter, 1).Runtime}
	if err := ws.IndexBuilding(factory); err != nil {
		t.Fatalf("factory should be placeable on foundation terrain: %v", err)
	}
}

func TestFoundationInsufficientMaterialsDoesNotReserveWater(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos := model.Position{X: 5, Y: 5}
	ws.Grid[pos.Y][pos.X].Terrain = terrain.TileLava
	ws.Players["p1"].Resources.Minerals = 0
	res, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild,
		Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeFoundation)}})
	if res.Code != model.CodeInsufficientResource {
		t.Fatalf("expected insufficient resource, got %s (%s)", res.Code, res.Message)
	}
	if ws.Grid[pos.Y][pos.X].Terrain != terrain.TileLava || len(ws.Construction.Tasks) != 0 {
		t.Fatalf("failed foundation changed terrain or queue")
	}
}

func TestFoundationRejectsDuplicateAndPreservesProvenance(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos := model.Position{X: 4, Y: 4}
	ws.Grid[4][4].Terrain = terrain.TileWater
	ws.Players["p1"].Resources.Minerals = 100
	command := model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": "foundation"}}
	res, _ := core.execBuild(ws, "p1", command)
	if res.Status != model.StatusExecuted {
		t.Fatal(res)
	}
	for _, task := range ws.Construction.Tasks {
		if _, err := core.completeConstructionTask(ws, task); err != nil {
			t.Fatal(err)
		}
		ws.Construction.Remove(task.ID)
	}
	foundation := ws.FoundationAt(pos)
	if foundation == nil {
		t.Fatal("missing foundation")
	}
	clone := foundation.Clone()
	clone.FoundationTerrain[0] = "lava"
	if foundation.FoundationTerrain[0] != "water" {
		t.Fatal("clone shares terrain provenance")
	}
	res, _ = core.execBuild(ws, "p1", command)
	if res.Status != model.StatusFailed {
		t.Fatal("duplicate foundation accepted")
	}
	if ws.FoundationAt(pos).FoundationTerrain[0] != "water" {
		t.Fatal("duplicate changed provenance")
	}
	ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)] = "pending-factory"
	res, _ = core.execDemolish(ws, "p1", model.Command{Type: model.CmdDemolish, Target: model.CommandTarget{EntityID: foundation.ID}})
	if res.Status != model.StatusFailed || res.Message != "cannot demolish foundation while construction is reserved on it" {
		t.Fatalf("foundation with pending factory demolition result: %+v", res)
	}
	delete(ws.Construction.ReservedTiles, model.TileKey(pos.X, pos.Y))
	factory := &model.Building{ID: "factory", OwnerID: "p1", Type: model.BuildingTypeWindTurbine, Position: pos, Runtime: model.BuildingProfileFor(model.BuildingTypeWindTurbine, 1).Runtime}
	ws.Buildings[factory.ID] = factory
	if err := ws.IndexBuilding(factory); err != nil {
		t.Fatal(err)
	}
	res, _ = core.execDemolish(ws, "p1", model.Command{Type: model.CmdDemolish, Target: model.CommandTarget{EntityID: foundation.ID}})
	if res.Status != model.StatusFailed {
		t.Fatal("occupied foundation can be demolished")
	}
	demolishBuilding(ws, factory, 0)
	if ws.Grid[4][4].Terrain != terrain.TileBuildable {
		t.Fatal("factory demolition removed filled ground")
	}
	demolishBuilding(ws, foundation, 0)
	if ws.Grid[4][4].Terrain != terrain.TileWater {
		t.Fatal("original terrain not restored")
	}
}

func TestFoundationDemolitionBlocksNewConstruction(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos := model.Position{X: 4, Y: 4}
	foundation := &model.Building{ID: "foundation", OwnerID: "p1", Type: model.BuildingTypeFoundation, Position: pos, Runtime: model.BuildingProfileFor(model.BuildingTypeFoundation, 1).Runtime, FoundationTerrain: []string{"water"}, Job: &model.BuildingJob{Type: model.BuildingJobDemolish}}
	ws.Buildings[foundation.ID] = foundation
	task := &model.ConstructionTask{ID: "factory-task", PlayerID: "p1", BuildingType: model.BuildingTypeWindTurbine, Position: pos}
	if err := ws.Construction.Enqueue(ws, task); err == nil {
		t.Fatal("queued construction on ground being removed")
	}
	if _, err := core.completeConstructionTask(ws, task); err == nil {
		t.Fatal("completed construction on ground being removed")
	}
}

func TestFoundationCancelledTasksCannotBypassLayerConstraints(t *testing.T) {
	for _, kind := range []model.BuildingType{model.BuildingTypeFoundation, model.BuildingTypeWindTurbine} {
		t.Run(string(kind), func(t *testing.T) {
			core := newConstructionTestCore(t, 2, 2)
			ws := core.world
			pos := model.Position{X: 4, Y: 4}
			foundation := &model.Building{ID: "foundation", OwnerID: "p1", Type: model.BuildingTypeFoundation, Position: pos, Runtime: model.BuildingProfileFor(model.BuildingTypeFoundation, 1).Runtime, FoundationTerrain: []string{"water"}}
			if kind != model.BuildingTypeFoundation {
				foundation.Job = &model.BuildingJob{Type: model.BuildingJobDemolish}
			}
			ws.Buildings[foundation.ID] = foundation
			task := &model.ConstructionTask{ID: "cancelled", PlayerID: "p1", BuildingType: kind, Position: pos, State: model.ConstructionCancelled, Cost: model.BuildCost{Minerals: 10}}
			ws.Construction.Tasks[task.ID] = task
			before := ws.Players["p1"].Resources.Minerals
			res, _ := core.execRestoreConstruction(ws, "p1", model.Command{Type: model.CmdRestoreConstruction, Payload: map[string]any{"task_id": task.ID}})
			if res.Code != model.CodePositionOccupied || task.State != model.ConstructionCancelled || ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)] != "" || ws.Players["p1"].Resources.Minerals != before {
				t.Fatalf("restore bypassed foundation constraints: %+v", res)
			}
		})
	}
}
