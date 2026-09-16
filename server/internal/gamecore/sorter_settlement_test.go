package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestSorterMovesItemsWithinRangeAndSpeed(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	input := newConveyorBuilding("in", model.Position{X: 0, Y: 0}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 4, Y: 0}, model.ConveyorEast)
	sorter := newSorterBuilding("s1", model.Position{X: 2, Y: 0})
	sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorWest}
	sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
	sorter.Sorter.Speed = 2
	sorter.Sorter.Range = 2
	sorter.Sorter.Normalize()

	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)

	if _, _, err := input.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleSorters(ws)

	if got := input.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected input items 1, got %d", got)
	}
	if got := output.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected output items 2, got %d", got)
	}
}

func TestSorterFilterRespectsFrontStack(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	input := newConveyorBuilding("in", model.Position{X: 0, Y: 0}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 2, Y: 0}, model.ConveyorEast)
	sorter := newSorterBuilding("s1", model.Position{X: 1, Y: 0})
	sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorWest}
	sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
	sorter.Sorter.Speed = 3
	sorter.Sorter.Range = 1
	sorter.Sorter.Filter = model.SorterFilter{
		Mode:  model.SorterFilterAllow,
		Items: []string{model.ItemIronOre},
	}
	sorter.Sorter.Normalize()

	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)

	if _, _, err := input.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}
	if _, _, err := input.Conveyor.Insert(model.ItemCopperOre, 2); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleSorters(ws)

	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected output items 1, got %d", got)
	}
	if got := input.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected input items 2, got %d", got)
	}
}

func TestSorterPriorityOrder(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	inputNorth := newConveyorBuilding("in-n", model.Position{X: 1, Y: 0}, model.ConveyorSouth)
	inputWest := newConveyorBuilding("in-w", model.Position{X: 0, Y: 1}, model.ConveyorEast)
	outputEast := newConveyorBuilding("out-e", model.Position{X: 2, Y: 1}, model.ConveyorEast)
	outputSouth := newConveyorBuilding("out-s", model.Position{X: 1, Y: 2}, model.ConveyorSouth)
	sorter := newSorterBuilding("s1", model.Position{X: 1, Y: 1})
	sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorNorth, model.ConveyorWest}
	sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast, model.ConveyorSouth}
	sorter.Sorter.Speed = 1
	sorter.Sorter.Range = 1
	sorter.Sorter.Normalize()

	attachBuilding(ws, inputNorth)
	attachBuilding(ws, inputWest)
	attachBuilding(ws, outputEast)
	attachBuilding(ws, outputSouth)
	attachBuilding(ws, sorter)

	if _, _, err := inputNorth.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}
	if _, _, err := inputWest.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleSorters(ws)

	if got := outputEast.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected east output items 1, got %d", got)
	}
	if got := outputSouth.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected south output items 0, got %d", got)
	}
	if got := inputNorth.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected north input items 0, got %d", got)
	}
	if got := inputWest.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected west input items 1, got %d", got)
	}
}

func newConveyorBuilding(id string, pos model.Position, output model.ConveyorDirection) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeConveyorBeltMk1, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b)
	b.Conveyor.Output = output
	b.Conveyor.Input = output.Opposite()
	b.Conveyor.Throughput = 6
	b.Conveyor.MaxStack = 10
	return b
}

func newSorterBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeSorterMk1, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeSorterMk1,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingSorter(b)
	b.Runtime.State = model.BuildingWorkRunning
	return b
}

func attachBuilding(ws *model.WorldState, b *model.Building) {
	ws.Buildings[b.ID] = b
	model.RegisterPowerGridBuilding(ws, b)
	model.RegisterLogisticsStation(ws, b)
	key := model.TileKey(b.Position.X, b.Position.Y)
	ws.TileBuilding[key] = b.ID
	ws.Grid[b.Position.Y][b.Position.X].BuildingID = b.ID
}

func TestSorterTransferReflectsActualMovement(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5)
	ws.Tick = 12
	input := newConveyorBuilding("in", model.Position{X: 0, Y: 2}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 2, Y: 2}, model.ConveyorEast)
	sorter := newSorterBuilding("sorter", model.Position{X: 1, Y: 2})
	sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorWest}
	sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
	sorter.Sorter.Speed = 3
	output.Conveyor.MaxStack = 1
	for _, b := range []*model.Building{input, output, sorter} {
		attachBuilding(ws, b)
	}
	input.Conveyor.Insert(model.ItemIronOre, 3)
	settleSorters(ws)
	transfer := sorter.Sorter.LastTransfer
	if transfer == nil || transfer.Tick != 12 || transfer.Sequence != 1 || transfer.Quantity != 1 || transfer.ItemID != model.ItemIronOre {
		t.Fatalf("expected record of one actual item constrained by target capacity, got %+v", transfer)
	}
	if transfer.SourceID != input.ID || transfer.TargetID != output.ID || transfer.SourcePosition != input.Position || transfer.TargetPosition != output.Position {
		t.Fatalf("expected actual source and destination, got %+v", transfer)
	}
	if input.Conveyor.TotalItems() != 2 || output.Conveyor.TotalItems() != 1 {
		t.Fatal("transfer record must correspond to inventory movement")
	}
	ws.Tick++
	settleSorters(ws)
	if sorter.Sorter.LastTransfer != transfer {
		t.Fatal("blocked output must not refresh the transfer record")
	}
	output.Conveyor.Take(1)
	ws.Tick++
	settleSorters(ws)
	if got := sorter.Sorter.LastTransfer; got == transfer || got.Tick != 14 || got.Sequence != 2 || got.Quantity != 1 {
		t.Fatalf("expected next actual movement to advance sequence, got %+v", got)
	}
}

func TestSorterDoesNotReportOrMoveWhenInactive(t *testing.T) {
	for _, scenario := range []string{"paused", "no_power", "idle", "error", "empty", "wrong_source_direction", "wrong_target_direction", "filtered"} {
		t.Run(scenario, func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 5)
			ws.Tick = 20
			input := newConveyorBuilding("in", model.Position{X: 0, Y: 2}, model.ConveyorEast)
			output := newConveyorBuilding("out", model.Position{X: 2, Y: 2}, model.ConveyorEast)
			sorter := newSorterBuilding("sorter", model.Position{X: 1, Y: 2})
			sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorWest}
			sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
			for _, b := range []*model.Building{input, output, sorter} {
				attachBuilding(ws, b)
			}
			input.Conveyor.Insert(model.ItemIronOre, 2)
			switch scenario {
			case "paused", "no_power", "idle", "error":
				sorter.Runtime.State = model.BuildingWorkState(scenario)
			case "empty":
				input.Conveyor.Take(2)
			case "wrong_source_direction":
				input.Conveyor.Output = model.ConveyorWest
			case "wrong_target_direction":
				output.Conveyor.Output = model.ConveyorWest
			case "filtered":
				sorter.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: []string{model.ItemCopperOre}}
			}
			initialItems := input.Conveyor.TotalItems()
			settleSorters(ws)
			if input.Conveyor.TotalItems() != initialItems || output.Conveyor.TotalItems() != 0 || sorter.Sorter.LastTransfer != nil {
				t.Fatalf("inactive sorter moved or recorded items: %+v", sorter.Sorter.LastTransfer)
			}
			oldTransfer := &model.SorterTransfer{Tick: 3, Sequence: 1, Quantity: 1}
			sorter.Sorter.LastTransfer = oldTransfer
			settleSorters(ws)
			if sorter.Sorter.LastTransfer != oldTransfer {
				t.Fatal("inactive sorter must not refresh historical transfer")
			}
		})
	}
}
