package model

import "testing"

func TestPowerGridGraphLineConnection(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	b1 := newTestBuilding("b1", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	b2 := newTestBuilding("b2", BuildingTypeWindTurbine, Position{X: 2, Y: 1})
	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2

	graph := BuildPowerGridGraph(ws)
	edge, ok := graph.Edges[b1.ID][b2.ID]
	if !ok {
		t.Fatalf("expected edge between %s and %s", b1.ID, b2.ID)
	}
	if edge.Kind != PowerLinkLine {
		t.Fatalf("expected line edge, got %s", edge.Kind)
	}
	if err := graph.Validate(); err != nil {
		t.Fatalf("validate graph: %v", err)
	}
}

func TestPowerGridGraphWirelessConnection(t *testing.T) {
	ws := NewWorldState("p1", 20, 20)
	b1 := newTestBuilding("b1", BuildingTypeWirelessPowerTower, Position{X: 1, Y: 1})
	b2 := newTestBuilding("b2", BuildingTypeWindTurbine, Position{X: 1 + DefaultWirelessPowerTowerRange - 1, Y: 1})
	b3 := newTestBuilding("b3", BuildingTypeWindTurbine, Position{X: 1 + DefaultWirelessPowerTowerRange + 1, Y: 1})
	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2
	ws.Buildings[b3.ID] = b3

	graph := BuildPowerGridGraph(ws)
	edge, ok := graph.Edges[b1.ID][b2.ID]
	if !ok {
		t.Fatalf("expected wireless edge between %s and %s", b1.ID, b2.ID)
	}
	if edge.Kind != PowerLinkWireless {
		t.Fatalf("expected wireless edge, got %s", edge.Kind)
	}
	if _, ok := graph.Edges[b1.ID][b3.ID]; ok {
		t.Fatalf("expected no edge between %s and %s", b1.ID, b3.ID)
	}
}

func TestPowerGridGraphRemoval(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	b1 := newTestBuilding("b1", BuildingTypeWindTurbine, Position{X: 3, Y: 3})
	b2 := newTestBuilding("b2", BuildingTypeWindTurbine, Position{X: 4, Y: 3})
	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2

	graph := BuildPowerGridGraph(ws)
	graph.RemoveBuilding(b2.ID)

	if graph.Nodes[b2.ID] != nil {
		t.Fatalf("expected node %s removed", b2.ID)
	}
	if len(graph.Edges[b1.ID]) != 0 {
		t.Fatalf("expected edges for %s cleared", b1.ID)
	}
	if err := graph.Validate(); err != nil {
		t.Fatalf("validate graph after removal: %v", err)
	}
}

func newTestBuilding(id string, btype BuildingType, pos Position) *Building {
	profile := BuildingProfileFor(btype, 1)
	return &Building{
		ID:       id,
		Type:     btype,
		OwnerID:  "player-1",
		Position: pos,
		Runtime:  profile.Runtime,
	}
}
