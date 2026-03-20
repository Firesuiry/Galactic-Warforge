package model

import "testing"

func TestPipelineNodeCapacityAndAvailable(t *testing.T) {
	t.Run("segment max capacity", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {ID: "n1", Position: Position{X: 0, Y: 0}},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {ID: "s1", From: "n1", To: "n2", Params: PipelineSegmentParams{Capacity: 3}},
				"s2": {ID: "s2", From: "n2", To: "n1", Params: PipelineSegmentParams{Capacity: 5}},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		if got := PipelineNodeCapacity(state, graph, "n1"); got != 5 {
			t.Fatalf("expected capacity 5, got %d", got)
		}
		if got := PipelineAvailable(5, 2); got != 3 {
			t.Fatalf("expected available 3, got %d", got)
		}
		if got := PipelineAvailable(0, 2); got != maxPipelineCapacity {
			t.Fatalf("expected available %d, got %d", maxPipelineCapacity, got)
		}
	})

	t.Run("segment unlimited capacity", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {ID: "n1", Position: Position{X: 1, Y: 0}},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {ID: "s1", From: "n1", To: "n2", Params: PipelineSegmentParams{Capacity: 0}},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		if got := PipelineNodeCapacity(state, graph, "n1"); got != 0 {
			t.Fatalf("expected unlimited capacity, got %d", got)
		}
	})

	t.Run("endpoint capacity fallback", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {ID: "n1", Position: Position{X: 2, Y: 2}},
			},
			Segments: map[string]*PipelineSegment{},
		}
		endpoints := []PipelineEndpoint{
			{
				ID:         PipelineEndpointID("b1", "in-0"),
				BuildingID: "b1",
				PortID:     "in-0",
				Direction:  PortInput,
				Position:   Position{X: 2, Y: 2},
				Capacity:   4,
			},
		}
		graph := BuildPipelineGraph(state, endpoints)
		if got := PipelineNodeCapacity(state, graph, "n1"); got != 4 {
			t.Fatalf("expected endpoint capacity 4, got %d", got)
		}

		endpoints[0].Capacity = 0
		graph = BuildPipelineGraph(state, endpoints)
		if got := PipelineNodeCapacity(state, graph, "n1"); got != 0 {
			t.Fatalf("expected unlimited endpoint capacity, got %d", got)
		}
	})
}

func TestResolvePipelineFlowMergeRules(t *testing.T) {
	t.Run("priority", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {ID: "n1"},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {
					ID:   "s1",
					From: "a1",
					To:   "n1",
					Params: PipelineSegmentParams{
						Capacity: 10,
						Pressure: 2,
					},
					State: PipelineSegmentState{Buffer: 4, FluidID: "water"},
				},
				"s2": {
					ID:   "s2",
					From: "a2",
					To:   "n1",
					Params: PipelineSegmentParams{
						Capacity: 10,
						Pressure: 1,
					},
					State: PipelineSegmentState{Buffer: 2, FluidID: "water"},
				},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		result := ResolvePipelineFlow(state, graph, PipelineFlowOptions{MergeRule: PipelineFlowPriority})

		node := state.Nodes["n1"]
		if node.State.Buffer != 6 || node.State.FluidID != "water" {
			t.Fatalf("expected node buffer 6 water, got %d %s", node.State.Buffer, node.State.FluidID)
		}
		if result.NodeInflow["n1"] != 6 {
			t.Fatalf("expected node inflow 6, got %d", result.NodeInflow["n1"])
		}
		if result.SegmentOutflow["s1"] != 4 || result.SegmentOutflow["s2"] != 2 {
			t.Fatalf("unexpected segment outflow: %+v", result.SegmentOutflow)
		}
		if state.Segments["s1"].State.Buffer != 0 || state.Segments["s2"].State.Buffer != 0 {
			t.Fatalf("expected segment buffers cleared")
		}
	})

	t.Run("equal", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {ID: "n1"},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {
					ID:   "s1",
					From: "a1",
					To:   "n1",
					Params: PipelineSegmentParams{
						Capacity: 5,
					},
					State: PipelineSegmentState{Buffer: 4, FluidID: "water"},
				},
				"s2": {
					ID:   "s2",
					From: "a2",
					To:   "n1",
					Params: PipelineSegmentParams{
						Capacity: 5,
					},
					State: PipelineSegmentState{Buffer: 4, FluidID: "water"},
				},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		result := ResolvePipelineFlow(state, graph, PipelineFlowOptions{MergeRule: PipelineFlowEqual})

		node := state.Nodes["n1"]
		if node.State.Buffer != 5 || node.State.FluidID != "water" {
			t.Fatalf("expected node buffer 5 water, got %d %s", node.State.Buffer, node.State.FluidID)
		}
		if result.SegmentOutflow["s1"] != 3 || result.SegmentOutflow["s2"] != 2 {
			t.Fatalf("unexpected segment outflow: %+v", result.SegmentOutflow)
		}
		if state.Segments["s1"].State.Buffer != 1 || state.Segments["s2"].State.Buffer != 2 {
			t.Fatalf("unexpected segment buffers: s1=%d s2=%d", state.Segments["s1"].State.Buffer, state.Segments["s2"].State.Buffer)
		}
	})

	t.Run("overflow", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {ID: "n1"},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {
					ID:   "s1",
					From: "a1",
					To:   "n1",
					Params: PipelineSegmentParams{
						Capacity: 5,
						Pressure: 1,
					},
					State: PipelineSegmentState{Buffer: 4, FluidID: "water"},
				},
				"s2": {
					ID:   "s2",
					From: "a2",
					To:   "n1",
					Params: PipelineSegmentParams{
						Capacity: 5,
						Pressure: 2,
					},
					State: PipelineSegmentState{Buffer: 4, FluidID: "water"},
				},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		result := ResolvePipelineFlow(state, graph, PipelineFlowOptions{MergeRule: PipelineFlowOverflow})

		node := state.Nodes["n1"]
		if node.State.Buffer != 5 || node.State.FluidID != "water" {
			t.Fatalf("expected node buffer 5 water, got %d %s", node.State.Buffer, node.State.FluidID)
		}
		if result.SegmentOutflow["s2"] != 4 || result.SegmentOutflow["s1"] != 1 {
			t.Fatalf("unexpected segment outflow: %+v", result.SegmentOutflow)
		}
		if state.Segments["s1"].State.Buffer != 3 || state.Segments["s2"].State.Buffer != 0 {
			t.Fatalf("unexpected segment buffers: s1=%d s2=%d", state.Segments["s1"].State.Buffer, state.Segments["s2"].State.Buffer)
		}
	})
}

func TestResolvePipelineFlowSplitRules(t *testing.T) {
	t.Run("priority", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {
					ID: "n1",
					State: PipelineNodeState{
						Buffer:  5,
						FluidID: "water",
					},
				},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {
					ID:   "s1",
					From: "n1",
					To:   "n2",
					Params: PipelineSegmentParams{
						Capacity: 4,
						Pressure: 2,
					},
				},
				"s2": {
					ID:   "s2",
					From: "n1",
					To:   "n3",
					Params: PipelineSegmentParams{
						Capacity: 4,
						Pressure: 1,
					},
				},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		result := ResolvePipelineFlow(state, graph, PipelineFlowOptions{SplitRule: PipelineFlowPriority})

		node := state.Nodes["n1"]
		if node.State.Buffer != 0 || node.State.FluidID != "" {
			t.Fatalf("expected node buffer empty, got %d %s", node.State.Buffer, node.State.FluidID)
		}
		if result.NodeOutflow["n1"] != 5 {
			t.Fatalf("expected node outflow 5, got %d", result.NodeOutflow["n1"])
		}
		if state.Segments["s1"].State.Buffer != 4 || state.Segments["s2"].State.Buffer != 1 {
			t.Fatalf("unexpected segment buffers: s1=%d s2=%d", state.Segments["s1"].State.Buffer, state.Segments["s2"].State.Buffer)
		}
		if state.Segments["s1"].State.CurrentFlow != 4 || state.Segments["s2"].State.CurrentFlow != 1 {
			t.Fatalf("unexpected segment flow: s1=%d s2=%d", state.Segments["s1"].State.CurrentFlow, state.Segments["s2"].State.CurrentFlow)
		}
	})

	t.Run("equal", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {
					ID: "n1",
					State: PipelineNodeState{
						Buffer:  5,
						FluidID: "water",
					},
				},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {
					ID:   "s1",
					From: "n1",
					To:   "n2",
					Params: PipelineSegmentParams{
						Capacity: 4,
					},
				},
				"s2": {
					ID:   "s2",
					From: "n1",
					To:   "n3",
					Params: PipelineSegmentParams{
						Capacity: 4,
					},
				},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		ResolvePipelineFlow(state, graph, PipelineFlowOptions{SplitRule: PipelineFlowEqual})

		if state.Segments["s1"].State.Buffer != 3 || state.Segments["s2"].State.Buffer != 2 {
			t.Fatalf("unexpected segment buffers: s1=%d s2=%d", state.Segments["s1"].State.Buffer, state.Segments["s2"].State.Buffer)
		}
	})

	t.Run("overflow", func(t *testing.T) {
		state := &PipelineNetworkState{
			Nodes: map[string]*PipelineNode{
				"n1": {
					ID: "n1",
					State: PipelineNodeState{
						Buffer:  5,
						FluidID: "water",
					},
				},
			},
			Segments: map[string]*PipelineSegment{
				"s1": {
					ID:   "s1",
					From: "n1",
					To:   "n2",
					Params: PipelineSegmentParams{
						Capacity: 4,
						Pressure: 1,
					},
				},
				"s2": {
					ID:   "s2",
					From: "n1",
					To:   "n3",
					Params: PipelineSegmentParams{
						Capacity: 4,
						Pressure: 2,
					},
				},
			},
		}
		graph := BuildPipelineGraph(state, nil)
		ResolvePipelineFlow(state, graph, PipelineFlowOptions{SplitRule: PipelineFlowOverflow})

		if state.Segments["s2"].State.Buffer != 4 || state.Segments["s1"].State.Buffer != 1 {
			t.Fatalf("unexpected segment buffers: s1=%d s2=%d", state.Segments["s1"].State.Buffer, state.Segments["s2"].State.Buffer)
		}
	})
}

func TestResolvePipelineFlowAttenuation(t *testing.T) {
	state := &PipelineNetworkState{
		Nodes: map[string]*PipelineNode{
			"n1": {ID: "n1"},
		},
		Segments: map[string]*PipelineSegment{
			"s1": {
				ID:   "s1",
				From: "a1",
				To:   "n1",
				Params: PipelineSegmentParams{
					Capacity:    10,
					Attenuation: 0.25,
				},
				State: PipelineSegmentState{Buffer: 10, FluidID: "gas"},
			},
		},
	}
	graph := BuildPipelineGraph(state, nil)
	result := ResolvePipelineFlow(state, graph, PipelineFlowOptions{EnableAttenuation: true})

	node := state.Nodes["n1"]
	if node.State.Buffer != 7 {
		t.Fatalf("expected node buffer 7, got %d", node.State.Buffer)
	}
	if result.SegmentOutflow["s1"] != 10 {
		t.Fatalf("expected segment outflow 10, got %d", result.SegmentOutflow["s1"])
	}
	if result.SegmentLoss["s1"] != 3 {
		t.Fatalf("expected segment loss 3, got %d", result.SegmentLoss["s1"])
	}
}

func TestResolvePipelineFlowStabilityAndEdges(t *testing.T) {
	result := ResolvePipelineFlow(nil, nil, PipelineFlowOptions{})
	if result.NodeInflow == nil || result.SegmentOutflow == nil {
		t.Fatalf("expected non-nil result maps")
	}

	state := &PipelineNetworkState{
		Nodes: map[string]*PipelineNode{
			"n1": {ID: "n1", State: PipelineNodeState{Buffer: -1, FluidID: "water"}},
		},
		Segments: map[string]*PipelineSegment{
			"s1": {ID: "s1", From: "n1", To: "n2", State: PipelineSegmentState{Buffer: -2, FluidID: "water"}},
		},
	}
	graph := BuildPipelineGraph(state, nil)
	ResolvePipelineFlow(state, graph, PipelineFlowOptions{})

	node := state.Nodes["n1"]
	if node.State.Buffer != 0 || node.State.FluidID != "" {
		t.Fatalf("expected cleared node state, got %d %s", node.State.Buffer, node.State.FluidID)
	}
	seg := state.Segments["s1"]
	if seg.State.Buffer != 0 || seg.State.FluidID != "" {
		t.Fatalf("expected cleared segment state, got %d %s", seg.State.Buffer, seg.State.FluidID)
	}
}
