package model

import "testing"

func TestPipelineGraphBuildAndQueries(t *testing.T) {
	state := &PipelineNetworkState{
		Nodes: map[string]*PipelineNode{
			"n1": {ID: "n1", Position: Position{X: 0, Y: 0}},
			"n2": {ID: "n2", Position: Position{X: 1, Y: 0}},
			"n3": {ID: "n3", Position: Position{X: 2, Y: 0}},
		},
		Segments: map[string]*PipelineSegment{
			"s1": {ID: "s1", From: "n1", To: "n2"},
			"s2": {ID: "s2", From: "n2", To: "n3"},
		},
	}
	endpoints := []PipelineEndpoint{
		{BuildingID: "b1", PortID: "out-0", Direction: PortOutput, Position: Position{X: 0, Y: 0}},
		{BuildingID: "b2", PortID: "in-0", Direction: PortInput, Position: Position{X: 2, Y: 0}},
	}

	graph := BuildPipelineGraph(state, endpoints)
	if graph == nil {
		t.Fatalf("expected graph")
	}
	if err := graph.Validate(); err != nil {
		t.Fatalf("validate graph: %v", err)
	}

	if got := graph.Downstream("n1"); len(got) != 1 || got[0] != "n2" {
		t.Fatalf("downstream n1 mismatch: %v", got)
	}
	if got := graph.Upstream("n3"); len(got) != 1 || got[0] != "n2" {
		t.Fatalf("upstream n3 mismatch: %v", got)
	}
	if got := graph.Adjacent("n2"); len(got) != 2 || got[0] != "n1" || got[1] != "n3" {
		t.Fatalf("adjacent n2 mismatch: %v", got)
	}

	epID := PipelineEndpointID("b1", "out-0")
	nodeID, ok := graph.EndpointNode(epID)
	if !ok || nodeID != "n1" {
		t.Fatalf("expected endpoint %s on n1, got %s (ok=%v)", epID, nodeID, ok)
	}
}

func TestPipelineGraphEndpointFallbackNode(t *testing.T) {
	endpoints := []PipelineEndpoint{
		{BuildingID: "b1", PortID: "out-0", Direction: PortOutput, Position: Position{X: 3, Y: 4}},
	}
	graph := BuildPipelineGraph(nil, endpoints)
	if graph == nil {
		t.Fatalf("expected graph")
	}
	nodeID, ok := graph.EndpointNode(PipelineEndpointID("b1", "out-0"))
	if !ok {
		t.Fatalf("expected endpoint node")
	}
	if nodeID == "" {
		t.Fatalf("expected node id")
	}
	node := graph.Nodes[nodeID]
	if node == nil || !node.HasPosition || node.Position.X != 3 || node.Position.Y != 4 {
		t.Fatalf("expected node position (3,4), got %+v", node)
	}
}

func TestPipelineEndpointsFromWorld(t *testing.T) {
	ws := NewWorldState("p-1", 4, 4)
	ws.Buildings["b1"] = &Building{
		ID:       "b1",
		OwnerID:  "player-1",
		Position: Position{X: 1, Y: 1},
		Runtime: BuildingRuntime{
			Params: BuildingRuntimeParams{
				IOPorts: []IOPort{
					{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
					{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 1, Y: 0}, Capacity: 1},
				},
			},
		},
	}

	endpoints := PipelineEndpointsFromWorld(ws, func(building *Building, port IOPort) bool {
		return port.Direction == PortOutput
	})
	if len(endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(endpoints))
	}
	ep := endpoints[0]
	if ep.BuildingID != "b1" || ep.PortID != "out-0" {
		t.Fatalf("unexpected endpoint: %+v", ep)
	}
	if ep.Position.X != 2 || ep.Position.Y != 1 {
		t.Fatalf("unexpected endpoint position: %+v", ep.Position)
	}
	if ep.ID == "" {
		t.Fatalf("expected endpoint id")
	}
}
