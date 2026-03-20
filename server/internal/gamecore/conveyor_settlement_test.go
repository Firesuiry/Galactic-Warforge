package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestConveyorSettlementMovesItems(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	profile := model.BuildingProfileFor(model.BuildingTypeConveyorBeltMk1, 1)

	b1 := &model.Building{
		ID:          "b1",
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 0, Y: 0},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b1)
	b1.Conveyor.Throughput = 2
	b1.Conveyor.MaxStack = 5

	b2 := &model.Building{
		ID:          "b2",
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 1, Y: 0},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b2)
	b2.Conveyor.Throughput = 2
	b2.Conveyor.MaxStack = 5

	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2
	ws.TileBuilding[model.TileKey(0, 0)] = b1.ID
	ws.TileBuilding[model.TileKey(1, 0)] = b2.ID
	ws.Grid[0][0].BuildingID = b1.ID
	ws.Grid[0][1].BuildingID = b2.ID

	if _, _, err := b1.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleConveyors(ws)

	if got := b1.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected b1 items 1, got %d", got)
	}
	if got := b2.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected b2 items 2, got %d", got)
	}
}

func TestConveyorSettlementBlockedByCapacity(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	profile := model.BuildingProfileFor(model.BuildingTypeConveyorBeltMk1, 1)

	b1 := &model.Building{
		ID:          "b1",
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 0, Y: 0},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b1)
	b1.Conveyor.Throughput = 2
	b1.Conveyor.MaxStack = 5

	b2 := &model.Building{
		ID:          "b2",
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    model.Position{X: 1, Y: 0},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b2)
	b2.Conveyor.Throughput = 2
	b2.Conveyor.MaxStack = 1

	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2
	ws.TileBuilding[model.TileKey(0, 0)] = b1.ID
	ws.TileBuilding[model.TileKey(1, 0)] = b2.ID
	ws.Grid[0][0].BuildingID = b1.ID
	ws.Grid[0][1].BuildingID = b2.ID

	if _, _, err := b1.Conveyor.Insert(model.ItemIronOre, 2); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}
	if _, _, err := b2.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into belt: %v", err)
	}

	settleConveyors(ws)

	if got := b1.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected b1 items 2, got %d", got)
	}
	if got := b2.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected b2 items 1, got %d", got)
	}
}

func TestConveyorSettlementMergeFromMultipleInputs(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	target := newConveyorBuilding("target", model.Position{X: 1, Y: 1}, model.ConveyorEast)
	target.Conveyor.Throughput = 5
	target.Conveyor.MaxStack = 5

	north := newConveyorBuilding("north", model.Position{X: 1, Y: 0}, model.ConveyorSouth)
	north.Conveyor.Throughput = 1
	west := newConveyorBuilding("west", model.Position{X: 0, Y: 1}, model.ConveyorEast)
	west.Conveyor.Throughput = 1

	attachBuilding(ws, target)
	attachBuilding(ws, north)
	attachBuilding(ws, west)

	if _, _, err := north.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into north belt: %v", err)
	}
	if _, _, err := west.Conveyor.Insert(model.ItemIronOre, 1); err != nil {
		t.Fatalf("insert into west belt: %v", err)
	}

	settleConveyors(ws)

	if got := target.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("expected target items 2, got %d", got)
	}
	if got := north.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected north items 0, got %d", got)
	}
	if got := west.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected west items 0, got %d", got)
	}
}

func TestConveyorSettlementSplitAndTurnPriority(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 3)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	source := newConveyorBuilding("source", model.Position{X: 1, Y: 1}, model.ConveyorAuto)
	source.Conveyor.Throughput = 2
	source.Conveyor.MaxStack = 5

	inbound := newConveyorBuilding("inbound", model.Position{X: 0, Y: 1}, model.ConveyorEast)

	east := newConveyorBuilding("east", model.Position{X: 2, Y: 1}, model.ConveyorEast)
	east.Conveyor.MaxStack = 1
	north := newConveyorBuilding("north", model.Position{X: 1, Y: 0}, model.ConveyorNorth)
	north.Conveyor.MaxStack = 1

	attachBuilding(ws, source)
	attachBuilding(ws, inbound)
	attachBuilding(ws, east)
	attachBuilding(ws, north)

	if _, _, err := source.Conveyor.Insert(model.ItemIronOre, 2); err != nil {
		t.Fatalf("insert into source belt: %v", err)
	}

	settleConveyors(ws)

	if got := east.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected east items 1, got %d", got)
	}
	if got := north.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("expected north items 1, got %d", got)
	}
	if got := source.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("expected source items 0, got %d", got)
	}
}
