package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestPipelineFlowToBuildingInput(t *testing.T) {
	ws := model.NewWorldState("planet-1", 3, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 1, Y: 0})
	allowFluidPorts(depot, model.ItemWater)
	attachBuilding(ws, depot)

	ws.Pipelines = &model.PipelineNetworkState{
		Nodes: map[string]*model.PipelineNode{
			"n0": {ID: "n0", Position: model.Position{X: 0, Y: 0}},
			"n1": {ID: "n1", Position: model.Position{X: 1, Y: 0}},
		},
		Segments: map[string]*model.PipelineSegment{
			"s1": {
				ID:   "s1",
				From: "n0",
				To:   "n1",
				Params: model.PipelineSegmentParams{
					Capacity: 3,
				},
				State: model.PipelineSegmentState{
					Buffer:  3,
					FluidID: model.ItemWater,
				},
			},
		},
	}

	settlePipelineFlow(ws)
	settlePipelineIO(ws)

	if got := depot.Storage.UsedInputBuffer(); got != 2 {
		t.Fatalf("expected input buffer 2, got %d", got)
	}
	node := ws.Pipelines.Nodes["n1"]
	if node.State.Buffer != 1 {
		t.Fatalf("expected node buffer 1, got %d", node.State.Buffer)
	}
	seg := ws.Pipelines.Segments["s1"]
	if seg.State.Buffer != 0 || seg.State.FluidID != "" {
		t.Fatalf("expected segment cleared, got buffer %d fluid %s", seg.State.Buffer, seg.State.FluidID)
	}
}
