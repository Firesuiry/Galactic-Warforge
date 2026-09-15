package model

import (
	"siliconworld/internal/terrain"
	"testing"
	"time"
)

func TestSurfaceFootprintCrossesFaceSeam(t *testing.T) {
	ws := NewWorldState("test", 8)
	pos := Position{X: 7, Y: 4}
	item := PlanItem{ID: "wide", Kind: PlanKindBuilding, BuildingType: BuildingTypeArcSmelter, Position: pos, Footprint: Footprint{Width: 2, Height: 2}}
	result := EvaluatePlanBatch(ws, PlanBatchRequest{Items: []PlanItem{item}})
	if len(result.Allowed) != 1 {
		t.Fatalf("seam footprint rejected: %+v", result)
	}
	if len(result.Allowed[0].Occupied) != 4 {
		t.Fatal("footprint did not reserve all four tiles")
	}
	next, _ := ws.SurfaceStep(pos, ConveyorEast)
	found := false
	for _, p := range result.Allowed[0].Occupied {
		if p == next {
			found = true
		}
	}
	if !found {
		t.Fatal("footprint missing neighboring face")
	}
}

func TestSurfacePathDetoursAndBlocksTerrain(t *testing.T) {
	ws := NewWorldState("test", 8)
	start, target := Position{X: 2, Y: 2}, Position{X: 4, Y: 2}
	ws.Grid[2][3].Terrain = terrain.TileBlocked
	if _, ok := ws.SurfacePath(start, target, 2); ok {
		t.Fatal("path ignored blocked terrain")
	}
	path, ok := ws.SurfacePath(start, target, 4)
	if !ok || len(path) != 5 {
		t.Fatalf("expected four-step detour, got %v", path)
	}
	for i := 1; i < len(path); i++ {
		if !ws.SurfaceWithin(path[i-1], path[i], 1) {
			t.Fatal("path contains disconnected tiles")
		}
	}
}

func TestBlueprintSelectionRejectsAtlasCuts(t *testing.T) {
	ws := NewWorldState("test", 8)
	_, err := CaptureBlueprint(ws, BlueprintBounds{MinX: 7, MinY: 2, MaxX: 8, MaxY: 3}, "p1", time.Now())
	if err == nil {
		t.Fatal("blueprint selection crossed cube face")
	}
}

func TestSurfaceBuildingIndexesFullFootprintAndRejectsOverlap(t *testing.T) {
	ws := NewWorldState("test", 8)
	p := BuildingProfileFor(BuildingTypeArcSmelter, 1)
	b := &Building{ID: "wide", Type: BuildingTypeArcSmelter, Position: Position{X: 7, Y: 4}, Runtime: p.Runtime}
	b.Runtime.Params.Footprint = Footprint{Width: 2, Height: 2}
	if err := ws.IndexBuilding(b); err != nil {
		t.Fatal(err)
	}
	if len(ws.TileBuilding) != 4 {
		t.Fatalf("occupied only %d tiles", len(ws.TileBuilding))
	}
	neighbor, _ := ws.SurfaceStep(b.Position, ConveyorEast)
	overlap := &Building{ID: "overlap", Type: BuildingTypeArcSmelter, Position: neighbor, Runtime: p.Runtime}
	if err := ws.IndexBuilding(overlap); err == nil {
		t.Fatal("accepted overlapping footprint on neighboring face")
	}
	ws.UnindexBuilding(b)
	if len(ws.TileBuilding) != 0 {
		t.Fatal("demolition left occupied footprint")
	}
	for _, row := range ws.Grid {
		for _, tile := range row {
			if tile.BuildingID != "" {
				t.Fatal("grid kept removed building")
			}
		}
	}
	if _, err := ws.FootprintTiles(b.Position, Footprint{Width: 9, Height: 1}); err == nil {
		t.Fatal("accepted footprint larger than face")
	}
}

func TestSurfaceFootprintRejectsCubeCornerSelfOverlap(t *testing.T) {
	ws := NewWorldState("test", 8)
	if _, err := ws.FootprintTiles(Position{X: 7, Y: 7}, Footprint{Width: 2, Height: 2}); err == nil {
		t.Fatal("accepted a rectangle folding onto itself at a cube corner")
	}
}
