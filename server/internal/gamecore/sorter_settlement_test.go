package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestSorterMovesItemsWithinRangeAndSpeed(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5, 1)
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
	ws := model.NewWorldState("planet-1", 3, 1)
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
	ws := model.NewWorldState("planet-1", 3, 3)
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
