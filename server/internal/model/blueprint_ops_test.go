package model

import (
	"testing"
	"time"
)

func TestCaptureBlueprintBasic(t *testing.T) {
	ws := NewWorldState("planet-1", 6, 6)
	created := time.Date(2026, 3, 19, 12, 0, 0, 0, time.UTC)

	conveyor := newBlueprintTestBuilding("b1", BuildingTypeConveyorBeltMk1, Position{X: 1, Y: 1})
	InitBuildingConveyor(conveyor)
	conveyor.Conveyor.Output = ConveyorEast
	conveyor.Conveyor.Input = ConveyorWest

	sorter := newBlueprintTestBuilding("b2", BuildingTypeSorterMk1, Position{X: 3, Y: 2})
	InitBuildingSorter(sorter)
	sorter.Sorter.InputDirections = []ConveyorDirection{ConveyorNorth}
	sorter.Sorter.OutputDirections = []ConveyorDirection{ConveyorEast}

	attachBlueprintTestBuilding(ws, conveyor)
	attachBlueprintTestBuilding(ws, sorter)

	selection := BlueprintBounds{MinX: 1, MinY: 1, MaxX: 3, MaxY: 2}
	res, err := CaptureBlueprint(ws, selection, "tester", created)
	if err != nil {
		t.Fatalf("capture failed: %v", err)
	}
	if len(res.Issues) > 0 {
		t.Fatalf("unexpected issues: %#v", res.Issues)
	}
	if len(res.Blueprint.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(res.Blueprint.Items))
	}
	if res.Blueprint.Metadata.Bounds.MinX != 0 || res.Blueprint.Metadata.Bounds.MinY != 0 {
		t.Fatalf("expected normalized bounds, got %#v", res.Blueprint.Metadata.Bounds)
	}
	if res.Blueprint.Metadata.Size.Width != 3 || res.Blueprint.Metadata.Size.Height != 2 {
		t.Fatalf("expected size 3x2, got %#v", res.Blueprint.Metadata.Size)
	}
	if _, ok := res.Blueprint.Items[0].Params["conveyor"]; !ok {
		if _, ok := res.Blueprint.Items[1].Params["conveyor"]; !ok {
			t.Fatalf("expected conveyor params")
		}
	}
	if _, ok := res.Blueprint.Items[0].Params["sorter"]; !ok {
		if _, ok := res.Blueprint.Items[1].Params["sorter"]; !ok {
			t.Fatalf("expected sorter params")
		}
	}
}

func TestCaptureBlueprintPartialFootprint(t *testing.T) {
	ws := NewWorldState("planet-1", 6, 6)
	created := time.Date(2026, 3, 19, 12, 0, 0, 0, time.UTC)

	conveyor := newBlueprintTestBuilding("b1", BuildingTypeConveyorBeltMk1, Position{X: 1, Y: 1})
	InitBuildingConveyor(conveyor)
	attachBlueprintTestBuilding(ws, conveyor)

	partial := newBlueprintTestBuilding("b2", BuildingTypeConveyorBeltMk1, Position{X: 4, Y: 1})
	partial.Runtime.Params.Footprint = Footprint{Width: 2, Height: 1}
	attachBlueprintTestBuilding(ws, partial)

	selection := BlueprintBounds{MinX: 1, MinY: 1, MaxX: 4, MaxY: 1}
	res, err := CaptureBlueprint(ws, selection, "tester", created)
	if err != nil {
		t.Fatalf("capture failed: %v", err)
	}
	if len(res.Blueprint.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(res.Blueprint.Items))
	}
	found := false
	for _, issue := range res.Issues {
		if issue.Code == BlueprintIssuePartialFootprint && issue.BuildingID == "b2" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected partial footprint issue, got %#v", res.Issues)
	}
}

func TestPlaceBlueprintRotation(t *testing.T) {
	created := time.Date(2026, 3, 19, 12, 0, 0, 0, time.UTC)
	bp := Blueprint{
		Metadata: BlueprintMetadata{
			Version:   1,
			CreatedAt: created,
			Size:      Footprint{Width: 2, Height: 1},
			Bounds:    BlueprintBounds{MinX: 0, MinY: 0, MaxX: 1, MaxY: 0},
		},
		Items: []BlueprintItem{
			{
				BuildingType: BuildingTypeConveyorBeltMk1,
				Params: BlueprintParams{
					"conveyor": map[string]any{
						"input":  ConveyorWest,
						"output": ConveyorEast,
					},
				},
				Offset:   GridOffset{X: 0, Y: 0},
				Rotation: PlanRotation0,
			},
			{
				BuildingType: BuildingTypeConveyorBeltMk1,
				Params:       BlueprintParams{},
				Offset:       GridOffset{X: 1, Y: 0},
				Rotation:     PlanRotation90,
			},
		},
	}

	res, err := PlaceBlueprint(BlueprintPlacementRequest{
		Blueprint: bp,
		Origin:    Position{X: 10, Y: 10},
		Rotation:  PlanRotation90,
		MapWidth:  20,
		MapHeight: 20,
	})
	if err != nil {
		t.Fatalf("place failed: %v", err)
	}
	if len(res.Issues) > 0 {
		t.Fatalf("unexpected issues: %#v", res.Issues)
	}
	if res.Bounds.MinX != 10 || res.Bounds.MinY != 10 || res.Bounds.MaxX != 10 || res.Bounds.MaxY != 11 {
		t.Fatalf("unexpected bounds: %#v", res.Bounds)
	}
	if len(res.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(res.Items))
	}
	if res.Items[0].Position.X != 10 || res.Items[0].Position.Y != 10 {
		t.Fatalf("unexpected position for item0: %#v", res.Items[0].Position)
	}
	if res.Items[1].Position.X != 10 || res.Items[1].Position.Y != 11 {
		t.Fatalf("unexpected position for item1: %#v", res.Items[1].Position)
	}
	param, ok := res.Items[0].Params["conveyor"]
	if !ok {
		t.Fatalf("missing conveyor params")
	}
	m, ok := param.(map[string]any)
	if !ok {
		t.Fatalf("unexpected conveyor param type: %T", param)
	}
	outDir, ok := coerceConveyorDirection(m["output"])
	if !ok || outDir != ConveyorSouth {
		t.Fatalf("expected output south after rotation, got %v", m["output"])
	}
	if res.Items[1].Rotation != PlanRotation180 {
		t.Fatalf("expected combined rotation 180, got %s", res.Items[1].Rotation)
	}
}

func newBlueprintTestBuilding(id string, btype BuildingType, pos Position) *Building {
	profile := BuildingProfileFor(btype, 1)
	return &Building{
		ID:          id,
		Type:        btype,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
}

func attachBlueprintTestBuilding(ws *WorldState, b *Building) {
	ws.Buildings[b.ID] = b
	key := TileKey(b.Position.X, b.Position.Y)
	ws.TileBuilding[key] = b.ID
	ws.Grid[b.Position.Y][b.Position.X].BuildingID = b.ID
}
