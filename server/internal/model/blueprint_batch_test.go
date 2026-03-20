package model

import "testing"

func TestBuildBlueprintBatchCommandsSkipInvalid(t *testing.T) {
	ws := NewWorldState("planet-1", 5, 5)
	blocker := newBatchTestBuilding("b1", BuildingTypeAssemblingMachineMk1, Position{X: 1, Y: 1}, "p1")
	attachBatchTestBuilding(ws, blocker)

	placement := BlueprintPlacementResult{
		Items: []BlueprintPlacementItem{
			{BuildingType: BuildingTypeAssemblingMachineMk1, Params: BlueprintParams{}, Position: Position{X: 1, Y: 1}},
			{BuildingType: BuildingTypeAssemblingMachineMk1, Params: BlueprintParams{}, Position: Position{X: 2, Y: 2}},
		},
	}

	res := BuildBlueprintBatchBuildCommands(ws, placement, BlueprintBatchPolicy{FailureMode: BatchSkipInvalid})
	if len(res.Commands) != 1 {
		t.Fatalf("expected 1 command, got %d", len(res.Commands))
	}
	if res.SuccessCount != 1 {
		t.Fatalf("expected success count 1, got %d", res.SuccessCount)
	}
	if len(res.Issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(res.Issues))
	}
	if res.Issues[0].Code != BatchOccupiedBuilding {
		t.Fatalf("expected occupied building issue, got %s", res.Issues[0].Code)
	}
}

func TestBuildBlueprintBatchCommandsRollback(t *testing.T) {
	ws := NewWorldState("planet-1", 5, 5)
	blocker := newBatchTestBuilding("b1", BuildingTypeAssemblingMachineMk1, Position{X: 1, Y: 1}, "p1")
	attachBatchTestBuilding(ws, blocker)

	placement := BlueprintPlacementResult{
		Items: []BlueprintPlacementItem{
			{BuildingType: BuildingTypeAssemblingMachineMk1, Params: BlueprintParams{}, Position: Position{X: 1, Y: 1}},
			{BuildingType: BuildingTypeAssemblingMachineMk1, Params: BlueprintParams{}, Position: Position{X: 2, Y: 2}},
		},
	}

	res := BuildBlueprintBatchBuildCommands(ws, placement, BlueprintBatchPolicy{FailureMode: BatchRollbackAll})
	if len(res.Commands) != 0 {
		t.Fatalf("expected 0 commands, got %d", len(res.Commands))
	}
	if !res.RolledBack {
		t.Fatalf("expected rollback true")
	}
	if len(res.Issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(res.Issues))
	}
}

func TestBuildBlueprintBatchCommandsResourceNode(t *testing.T) {
	ws := NewWorldState("planet-1", 3, 3)
	placement := BlueprintPlacementResult{
		Items: []BlueprintPlacementItem{
			{BuildingType: BuildingTypeMiningMachine, Params: BlueprintParams{}, Position: Position{X: 1, Y: 1}},
		},
	}

	res := BuildBlueprintBatchBuildCommands(ws, placement, BlueprintBatchPolicy{FailureMode: BatchSkipInvalid})
	if len(res.Commands) != 0 {
		t.Fatalf("expected 0 commands, got %d", len(res.Commands))
	}
	if len(res.Issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(res.Issues))
	}
	if res.Issues[0].Code != BatchRequiresResourceNode {
		t.Fatalf("expected resource node issue, got %s", res.Issues[0].Code)
	}
}

func TestBuildBlueprintBatchDemolishSkipInvalid(t *testing.T) {
	ws := NewWorldState("planet-1", 5, 5)
	own := newBatchTestBuilding("b1", BuildingTypeAssemblingMachineMk1, Position{X: 1, Y: 1}, "p1")
	other := newBatchTestBuilding("b2", BuildingTypeAssemblingMachineMk1, Position{X: 2, Y: 1}, "p2")
	attachBatchTestBuilding(ws, own)
	attachBatchTestBuilding(ws, other)

	bounds := BlueprintBounds{MinX: 1, MinY: 1, MaxX: 2, MaxY: 1}
	res := BuildBlueprintBatchDemolishCommands(ws, bounds, "p1", BlueprintBatchPolicy{FailureMode: BatchSkipInvalid})
	if len(res.Commands) != 1 {
		t.Fatalf("expected 1 command, got %d", len(res.Commands))
	}
	if len(res.Issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(res.Issues))
	}
	if res.Issues[0].Code != BatchPermissionDenied {
		t.Fatalf("expected permission issue, got %s", res.Issues[0].Code)
	}
}

func TestBuildBlueprintBatchDemolishRollback(t *testing.T) {
	ws := NewWorldState("planet-1", 5, 5)
	own := newBatchTestBuilding("b1", BuildingTypeAssemblingMachineMk1, Position{X: 1, Y: 1}, "p1")
	other := newBatchTestBuilding("b2", BuildingTypeAssemblingMachineMk1, Position{X: 2, Y: 1}, "p2")
	attachBatchTestBuilding(ws, own)
	attachBatchTestBuilding(ws, other)

	bounds := BlueprintBounds{MinX: 1, MinY: 1, MaxX: 2, MaxY: 1}
	res := BuildBlueprintBatchDemolishCommands(ws, bounds, "p1", BlueprintBatchPolicy{FailureMode: BatchRollbackAll})
	if len(res.Commands) != 0 {
		t.Fatalf("expected 0 commands, got %d", len(res.Commands))
	}
	if !res.RolledBack {
		t.Fatalf("expected rollback true")
	}
}

func newBatchTestBuilding(id string, btype BuildingType, pos Position, owner string) *Building {
	profile := BuildingProfileFor(btype, 1)
	return &Building{
		ID:          id,
		Type:        btype,
		OwnerID:     owner,
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
}

func attachBatchTestBuilding(ws *WorldState, b *Building) {
	ws.Buildings[b.ID] = b
	key := TileKey(b.Position.X, b.Position.Y)
	ws.TileBuilding[key] = b.ID
	ws.Grid[b.Position.Y][b.Position.X].BuildingID = b.ID
}
