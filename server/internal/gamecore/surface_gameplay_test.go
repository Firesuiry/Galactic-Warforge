package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"testing"
)

func surfaceTestBuilding(ws *model.WorldState, id string, kind model.BuildingType, pos model.Position) *model.Building {
	p := model.BuildingProfileFor(kind, 1)
	b := &model.Building{ID: id, Type: kind, OwnerID: "p1", Position: pos, Runtime: p.Runtime, HP: p.MaxHP, MaxHP: p.MaxHP, Level: 1}
	ws.Buildings[id] = b
	ws.TileBuilding[model.TileKey(pos.X, pos.Y)] = id
	ws.Grid[pos.Y][pos.X].BuildingID = id
	return b
}

// Exercise every directed cube seam, including turns where the target's
// local input direction is not simply the source direction's opposite.
func TestSurfaceConveyorsAllFaceSeams(t *testing.T) {
	const size = 8
	dirs := []model.ConveyorDirection{model.ConveyorNorth, model.ConveyorEast, model.ConveyorSouth, model.ConveyorWest}
	for f := 0; f < 6; f++ {
		for d, dir := range dirs {
			t.Run(fmt.Sprintf("face%d-dir%d", f, d), func(t *testing.T) {
				ws := model.NewWorldState("test", size)
				x, y := size/2, size/2
				switch d {
				case 0:
					y = 0
				case 1:
					x = size - 1
				case 2:
					y = size - 1
				case 3:
					x = 0
				}
				origin := model.Position{X: (f%3)*size + x, Y: (f/3)*size + y}
				target, forward := ws.SurfaceStep(origin, dir)
				source := surfaceTestBuilding(ws, "source", model.BuildingTypeConveyorBeltMk1, origin)
				sink := surfaceTestBuilding(ws, "sink", model.BuildingTypeConveyorBeltMk1, target)
				model.InitBuildingConveyor(source)
				model.InitBuildingConveyor(sink)
				source.Conveyor.Output = dir
				source.Conveyor.Input = dir.Opposite()
				sink.Conveyor.Output = forward
				sink.Conveyor.Input = forward.Opposite()
				if _, _, err := source.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
					t.Fatal(err)
				}
				settleConveyors(ws)
				if sink.Conveyor.TotalItems() != 1 || source.Conveyor.TotalItems() != 0 {
					t.Fatalf("seam transfer failed %v -> %v forward %s", origin, target, forward)
				}
			})
		}
	}
}

func TestSurfaceStorageAndPowerAcrossSeam(t *testing.T) {
	ws := model.NewWorldState("test", 16)
	pos := model.Position{X: 0, Y: 8}
	next, _ := ws.SurfaceStep(pos, model.ConveyorWest)
	a := surfaceTestBuilding(ws, "a", model.BuildingTypeDepotMk1, pos)
	b := surfaceTestBuilding(ws, "b", model.BuildingTypeDepotMk1, next)
	model.InitBuildingStorage(a)
	model.InitBuildingStorage(b)
	if got := len(storageNetworkFor(ws, "a").Nodes); got != 2 {
		t.Fatalf("storage nodes=%d", got)
	}
	a.Runtime.Params.ConnectionPoints = []model.ConnectionPoint{{Kind: model.ConnectionPower}}
	b.Runtime.Params.ConnectionPoints = []model.ConnectionPoint{{Kind: model.ConnectionPower}}
	model.RebuildPowerGrid(ws)
	if _, ok := ws.PowerGrid.Edges[a.ID][b.ID]; !ok {
		t.Fatal("power line missing across face seam")
	}
	// An atlas-adjacent cell on face 3 is not the south neighbor of face 0.
	fake := model.Position{X: 8, Y: 16}
	edge := model.Position{X: 8, Y: 15}
	if ws.SurfaceWithin(fake, edge, 1) {
		t.Fatal("atlas cut incorrectly connected")
	}
}

func TestSurfaceMoveCrossesSeamAndRespectsObstacles(t *testing.T) {
	ws := model.NewWorldState("test", 8)
	start := model.Position{X: 0, Y: 4}
	target, _ := ws.SurfaceStep(start, model.ConveyorWest)
	unit := &model.Unit{ID: "u", OwnerID: "p1", Position: start, MoveRange: 1}
	ws.Units[unit.ID] = unit
	gc := &GameCore{}
	cmd := model.Command{Type: "move", Target: model.CommandTarget{EntityID: unit.ID, Position: &target}}
	result, _ := gc.execMove(ws, "p1", cmd)
	if result.Status != model.StatusExecuted || unit.Position != target {
		t.Fatalf("cross seam move failed: %+v", result)
	}
	for _, n := range ws.SurfaceNeighbors(target) {
		surfaceTestBuilding(ws, fmt.Sprintf("block-%d-%d", n.X, n.Y), model.BuildingTypeDepotMk1, n)
	}
	far, _ := ws.SurfaceStep(start, model.ConveyorEast)
	unit.MoveRange = 4
	cmd.Target.Position = &far
	result, _ = gc.execMove(ws, "p1", cmd)
	if result.Status == model.StatusExecuted {
		t.Fatal("unit escaped enclosed surface cell")
	}
	if unit.Position != target {
		t.Fatal("failed move changed position")
	}
}

func TestSurfaceSorterAndIOAcrossRotatedSeam(t *testing.T) {
	ws := model.NewWorldState("test", 8)
	pos := model.Position{X: 20, Y: 0} // -Z north exits into +Y facing south.
	target, forward := ws.SurfaceStep(pos, model.ConveyorNorth)
	sorter := surfaceTestBuilding(ws, "sorter", model.BuildingTypeSorterMk1, pos)
	belt := surfaceTestBuilding(ws, "belt", model.BuildingTypeConveyorBeltMk1, target)
	model.InitBuildingConveyor(belt)
	belt.Conveyor.Output = forward
	belt.Conveyor.Input = forward.Opposite()
	id, ok := sorterFindConveyor(ws, sorter, model.ConveyorNorth, 1, false)
	if !ok || id != belt.ID {
		t.Fatal("sorter failed to insert across rotated seam")
	}
	belt.Conveyor.Output = forward.Opposite()
	id, ok = sorterFindConveyor(ws, sorter, model.ConveyorNorth, 1, true)
	if !ok || id != belt.ID {
		t.Fatal("sorter failed to take across rotated seam")
	}
	port := model.IOPort{Offset: model.GridOffset{X: 0, Y: -1}}
	if got := portWorldPosition(ws, sorter, port); got != target {
		t.Fatalf("IO offset %v != %v", got, target)
	}
}

func TestSurfaceMultiTileConstructionReservationAndDemolition(t *testing.T) {
	catalog := model.AllBuildingDefinitions()
	t.Cleanup(func() {
		if err := model.ReplaceBuildingCatalog(catalog); err != nil {
			t.Error(err)
		}
	})
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeArcSmelter)
	def.ID = "surface_test_wide_smelter"
	def.Footprint = model.Footprint{Width: 2, Height: 2}
	if err := model.RegisterBuildingDefinitions(def); err != nil {
		t.Fatal(err)
	}
	ws := model.NewWorldState("test", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1"}
	task := &model.ConstructionTask{ID: "wide", PlayerID: "p1", BuildingType: def.ID, Position: model.Position{X: 7, Y: 4}}
	if err := ws.Construction.Enqueue(ws, task); err != nil {
		t.Fatal(err)
	}
	if len(ws.Construction.ReservedTiles) != 4 {
		t.Fatalf("reserved only %d tiles", len(ws.Construction.ReservedTiles))
	}
	neighbor, _ := ws.SurfaceStep(task.Position, model.ConveyorEast)
	overlapping := &model.ConstructionTask{ID: "overlap", PlayerID: "p1", BuildingType: model.BuildingTypeArcSmelter, Position: neighbor}
	if err := ws.Construction.Enqueue(ws, overlapping); err == nil {
		t.Fatal("queued overlapping neighbor-face building")
	}
	gc := &GameCore{}
	if _, err := gc.completeConstructionTask(ws, task); err != nil {
		t.Fatal(err)
	}
	ws.Construction.Remove(task.ID)
	if len(ws.TileBuilding) != 4 || len(ws.Construction.ReservedTiles) != 0 {
		t.Fatal("completion lost footprint or kept reservations")
	}
	if _, ok := ws.SurfacePath(model.Position{X: 6, Y: 4}, neighbor, 2); ok {
		t.Fatal("path walked inside non-anchor footprint tile")
	}
	var building *model.Building
	for _, b := range ws.Buildings {
		building = b
	}
	demolishBuilding(ws, building, 0)
	if len(ws.TileBuilding) != 0 || len(ws.Buildings) != 0 {
		t.Fatal("demolition did not release full footprint")
	}
}

func TestSurfaceCombatDestructionClearsFullFootprint(t *testing.T) {
	ws := model.NewWorldState("test", 8)
	profile := model.BuildingProfileFor(model.BuildingTypeArcSmelter, 1)
	b := &model.Building{ID: "enemy-wide", Type: model.BuildingTypeArcSmelter, OwnerID: "p2", Position: model.Position{X: 7, Y: 4}, Runtime: profile.Runtime, HP: 1}
	b.Runtime.Params.Footprint = model.Footprint{Width: 2, Height: 2}
	ws.Buildings[b.ID] = b
	if err := ws.IndexBuilding(b); err != nil {
		t.Fatal(err)
	}
	unit := &model.Unit{ID: "attacker", OwnerID: "p1", Position: model.Position{X: 6, Y: 4}, Attack: 10, AttackRange: 2}
	ws.Units[unit.ID] = unit
	gc := &GameCore{}
	result, _ := gc.execAttack(ws, "p1", model.Command{Type: model.CmdAttack, Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"target_entity_id": b.ID}})
	if result.Status != model.StatusExecuted {
		t.Fatalf("attack failed: %+v", result)
	}
	if len(ws.TileBuilding) != 0 || len(ws.Buildings) != 0 {
		t.Fatal("destruction left occupied footprint")
	}
}
