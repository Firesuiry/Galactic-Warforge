package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func newStorageTankBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeStorageTank, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeStorageTank,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b)
	return b
}

// G2: 储液罐 IOPort 未限定 AllowedItems 时仍作为管网流体节点接收流体。
func TestStorageTankReceivesFluidFromPipeline(t *testing.T) {
	ws := model.NewWorldState("planet-1", 2)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	tank := newStorageTankBuilding("tank", model.Position{X: 0, Y: 0})
	attachBuilding(ws, tank)

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

	if got := tank.Storage.UsedInputBuffer(); got != 2 {
		t.Fatalf("expected tank input buffer 2, got %d", got)
	}
	node := ws.Pipelines.Nodes["n1"]
	if node.State.Buffer != 1 {
		t.Fatalf("expected node buffer 1, got %d", node.State.Buffer)
	}
}

// G2: 储液罐中的流体可经管网输出，成为真实管线节点。
func TestStorageTankOutputsFluidToPipeline(t *testing.T) {
	ws := model.NewWorldState("planet-1", 2)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	tank := newStorageTankBuilding("tank", model.Position{X: 0, Y: 0})
	attachBuilding(ws, tank)

	ws.Pipelines = &model.PipelineNetworkState{
		Nodes: map[string]*model.PipelineNode{
			"n1": {
				ID:       "n1",
				Position: model.Position{X: 0, Y: 0},
			},
		},
		Segments: map[string]*model.PipelineSegment{},
	}

	if _, _, err := tank.Storage.Receive(model.ItemWater, 3); err != nil {
		t.Fatalf("receive error: %v", err)
	}
	tank.Storage.Tick()

	settlePipelineIO(ws)

	node := ws.Pipelines.Nodes["n1"]
	if node.State.Buffer != 2 {
		t.Fatalf("expected node buffer 2, got %d", node.State.Buffer)
	}
	if node.State.FluidID != model.ItemWater {
		t.Fatalf("expected node fluid water, got %q", node.State.FluidID)
	}
}

// G2: 普通非流体建筑（未限定 AllowedItems）不会被误判为管网节点。
func TestNonFluidBuildingIsNotPipelineEndpoint(t *testing.T) {
	ws := model.NewWorldState("planet-1", 2)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	depot := newDepotBuilding("depot", model.Position{X: 0, Y: 0})
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

	if got := depot.Storage.UsedInputBuffer(); got != 0 {
		t.Fatalf("expected depot untouched by pipeline, got input buffer %d", got)
	}
	if got := ws.Pipelines.Nodes["n1"].State.Buffer; got != 3 {
		t.Fatalf("expected node buffer unchanged, got %d", got)
	}
}
