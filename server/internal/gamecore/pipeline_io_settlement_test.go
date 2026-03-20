package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestPipelineIOInputToBuilding(t *testing.T) {
	ws := model.NewWorldState("planet-1", 2, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 0, Y: 0})
	allowFluidPorts(depot, model.ItemWater)
	attachBuilding(ws, depot)

	ws.Pipelines = &model.PipelineNetworkState{
		Nodes: map[string]*model.PipelineNode{
			"n1": {
				ID:       "n1",
				Position: model.Position{X: 0, Y: 0},
				State: model.PipelineNodeState{
					Buffer:  3,
					FluidID: model.ItemWater,
				},
			},
		},
		Segments: map[string]*model.PipelineSegment{},
	}

	settlePipelineIO(ws)

	if got := depot.Storage.UsedInputBuffer(); got != 2 {
		t.Fatalf("expected input buffer 2, got %d", got)
	}
	node := ws.Pipelines.Nodes["n1"]
	if node.State.Buffer != 1 {
		t.Fatalf("expected node buffer 1, got %d", node.State.Buffer)
	}
}

func TestPipelineIOOutputFromBuilding(t *testing.T) {
	ws := model.NewWorldState("planet-1", 2, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 0, Y: 0})
	allowFluidPorts(depot, model.ItemWater)
	attachBuilding(ws, depot)

	ws.Pipelines = &model.PipelineNetworkState{
		Nodes: map[string]*model.PipelineNode{
			"n1": {
				ID:       "n1",
				Position: model.Position{X: 0, Y: 0},
			},
		},
		Segments: map[string]*model.PipelineSegment{},
	}

	if _, _, err := depot.Storage.Receive(model.ItemWater, 3); err != nil {
		t.Fatalf("receive error: %v", err)
	}
	depot.Storage.Tick()

	before := totalStorageItems(depot.Storage)
	settlePipelineIO(ws)
	after := totalStorageItems(depot.Storage)

	node := ws.Pipelines.Nodes["n1"]
	if node.State.Buffer != 2 {
		t.Fatalf("expected node buffer 2, got %d", node.State.Buffer)
	}
	if before-after != 2 {
		t.Fatalf("expected storage decrease 2, got %d", before-after)
	}
}

func allowFluidPorts(building *model.Building, fluidID string) {
	if building == nil {
		return
	}
	for i, port := range building.Runtime.Params.IOPorts {
		switch port.ID {
		case "in-0", "out-0":
			port.AllowedItems = []string{fluidID}
			building.Runtime.Params.IOPorts[i] = port
		}
	}
}
