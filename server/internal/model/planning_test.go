package model

import "testing"

func TestPlanFootprintRotation(t *testing.T) {
	item := PlanItem{
		ID:           "p1",
		Kind:         PlanKindBuilding,
		BuildingType: BuildingTypeArcSmelter,
		Position:     Position{X: 10, Y: 10},
		Rotation:     PlanRotation90,
		Footprint:    Footprint{Width: 2, Height: 3},
	}
	tiles, err := itemOccupiedTiles(item)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(tiles) != 6 {
		t.Fatalf("expected 6 tiles, got %d", len(tiles))
	}
	minX, maxX := tiles[0].X, tiles[0].X
	minY, maxY := tiles[0].Y, tiles[0].Y
	for _, pos := range tiles[1:] {
		if pos.X < minX {
			minX = pos.X
		}
		if pos.X > maxX {
			maxX = pos.X
		}
		if pos.Y < minY {
			minY = pos.Y
		}
		if pos.Y > maxY {
			maxY = pos.Y
		}
	}
	if maxX-minX+1 != 3 {
		t.Fatalf("expected rotated width 3, got span %d", maxX-minX+1)
	}
	if maxY-minY+1 != 2 {
		t.Fatalf("expected rotated height 2, got span %d", maxY-minY+1)
	}
}

func TestEvaluatePlanBatchFirstWins(t *testing.T) {
	ws := NewWorldState("planet-1", 5, 5)

	bProfile := BuildingProfileFor(BuildingTypeArcSmelter, 1)
	b := &Building{ID: "b1", Type: BuildingTypeArcSmelter, OwnerID: "p1", Position: Position{X: 1, Y: 1}, Runtime: bProfile.Runtime}
	ws.Buildings[b.ID] = b
	ws.TileBuilding[TileKey(1, 1)] = b.ID
	ws.Grid[1][1].BuildingID = b.ID

	cProfile := BuildingProfileFor(BuildingTypeConveyorBeltMk1, 1)
	c := &Building{ID: "c1", Type: BuildingTypeConveyorBeltMk1, OwnerID: "p1", Position: Position{X: 3, Y: 3}, Runtime: cProfile.Runtime}
	ws.Buildings[c.ID] = c
	ws.TileBuilding[TileKey(3, 3)] = c.ID
	ws.Grid[3][3].BuildingID = c.ID

	ws.Pipelines = &PipelineNetworkState{
		Nodes: map[string]*PipelineNode{
			"n1": {ID: "n1", Position: Position{X: 2, Y: 2}},
			"n2": {ID: "n2", Position: Position{X: 2, Y: 3}},
		},
		Segments: map[string]*PipelineSegment{
			"s1": {ID: "s1", From: "n1", To: "n2"},
		},
	}

	blocked := map[string]struct{}{TileKey(4, 4): {}}
	items := []PlanItem{
		{ID: "ok", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 0, Y: 0}},
		{ID: "building", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 1, Y: 1}},
		{ID: "pipeline", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 2, Y: 2}},
		{ID: "conveyor", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 3, Y: 3}},
		{ID: "blocked", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 4, Y: 4}},
		{ID: "overlap", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 0, Y: 0}},
		{ID: "oob", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 5, Y: 0}},
	}

	res := EvaluatePlanBatch(ws, PlanBatchRequest{BatchID: "batch-1", Items: items, BlockedTiles: blocked, UseCache: false})
	if len(res.Results) != len(items) {
		t.Fatalf("expected %d results, got %d", len(items), len(res.Results))
	}

	expectCodes := map[string]PlanResultCode{
		"ok":       PlanOK,
		"building": PlanOccupiedBuilding,
		"pipeline": PlanOccupiedPipeline,
		"conveyor": PlanOccupiedConveyor,
		"blocked":  PlanNoBuildZone,
		"overlap":  PlanBatchConflict,
		"oob":      PlanOutOfBounds,
	}

	for _, r := range res.Results {
		if r.Code != expectCodes[r.ItemID] {
			t.Fatalf("item %s expected code %s, got %s", r.ItemID, expectCodes[r.ItemID], r.Code)
		}
	}
}

func TestEvaluatePlanBatchMutualFail(t *testing.T) {
	ws := NewWorldState("planet-1", 3, 3)
	items := []PlanItem{
		{ID: "a", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 1, Y: 1}},
		{ID: "b", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 1, Y: 1}},
	}

	res := EvaluatePlanBatch(ws, PlanBatchRequest{BatchID: "batch-2", Items: items, Policy: PlanBatchPolicy{Mode: PlanBatchMutualFail}})
	if len(res.Rejected) != 2 {
		t.Fatalf("expected 2 rejected items, got %d", len(res.Rejected))
	}
	for _, r := range res.Results {
		if r.Code != PlanBatchConflict {
			t.Fatalf("item %s expected batch conflict, got %s", r.ItemID, r.Code)
		}
	}
}

func TestPlanReservedTiles(t *testing.T) {
	ws := NewWorldState("planet-1", 3, 3)
	state := NewPlanState()
	state.ReserveTiles("reserved", "batch-0", []Position{{X: 1, Y: 1}})
	items := []PlanItem{
		{ID: "new", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: Position{X: 1, Y: 1}},
	}
	res := EvaluatePlanBatch(ws, PlanBatchRequest{BatchID: "batch-3", Items: items, State: state})
	if res.Results[0].Code != PlanReservedTile {
		t.Fatalf("expected reserved tile conflict, got %s", res.Results[0].Code)
	}
}
