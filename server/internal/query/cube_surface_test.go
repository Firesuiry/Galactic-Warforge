package query

import (
	"siliconworld/internal/model"
	"siliconworld/internal/surface"
	"testing"
)

func TestSceneSeamPatchesIncludeVisibleNeighbor(t *testing.T) {
	ql, ws, id := newPlanetQueryFixture(t, 16, 16)
	center := surface.Tile{X: 0, Y: 8}
	neighbor, _ := (surface.Grid{Size: 16}).Step(center, surface.West)
	ws.Buildings["radar"] = &model.Building{ID: "radar", OwnerID: "p1", Position: model.Position{X: center.X, Y: center.Y}, VisionRange: 2}
	ws.Units["enemy"] = &model.Unit{ID: "enemy", OwnerID: "p2", Position: model.Position{X: neighbor.X, Y: neighbor.Y}}
	view, ok := ql.PlanetScene(ws, "p1", id, PlanetSceneRequest{X: 0, Y: 7, Width: 3, Height: 3, NearX: 0, NearY: 8, Radius: 2})
	if !ok || view.Surface.Topology != "cube_sphere" || view.Surface.FaceSize != 16 {
		t.Fatalf("bad metadata: %+v", view)
	}
	if len(view.SurfacePatches) == 0 || view.Units["enemy"] == nil {
		t.Fatal("missing visible cross-seam unit/patch")
	}
	found := false
	for _, patch := range view.SurfacePatches {
		b := patch.Bounds
		if neighbor.X >= b.X && neighbor.X < b.X+b.Width && neighbor.Y >= b.Y && neighbor.Y < b.Y+b.Height {
			found = patch.Visible[neighbor.Y-b.Y][neighbor.X-b.X]
		}
	}
	if !found {
		t.Fatal("cross-seam visibility missing")
	}
}

func TestPlanetPathCrossesSeamAndRoutesIntoUnknown(t *testing.T) {
	ql, ws, _ := newPlanetQueryFixture(t, 16, 16)
	start := model.Position{X: 0, Y: 8}
	target, _ := ws.SurfaceStep(start, model.ConveyorWest)
	ws.Units["u"] = &model.Unit{ID: "u", OwnerID: "p1", Position: start, VisionRange: 3, MoveRange: 2}
	route, err := ql.PlanetPath(ws, "p1", "u", target, 0)
	if err != nil || !route.Reachable || route.Distance != 1 || len(route.Waypoints) != 1 || route.Waypoints[0] != target {
		t.Fatalf("bad seam path: %+v %v", route, err)
	}
	if !route.Explored {
		t.Fatal("adjacent target should be explored")
	}
	if _, err := ql.PlanetPath(ws, "p2", "u", target, 0); err == nil {
		t.Fatal("must reject foreign unit")
	}
	// 目标落在未探索区：服务端是权威，按真实地形照常给出路线（只回路线，
	// 不回未探索区的地形细节），并用 explored=false 告诉客户端终点未知。
	hidden := model.Position{X: 8, Y: 8}
	route, err = ql.PlanetPath(ws, "p1", "u", hidden, 0)
	if err != nil || !route.Reachable || len(route.Path) == 0 {
		t.Fatalf("unexplored target must still be routable: %+v %v", route, err)
	}
	if route.Explored {
		t.Fatal("unexplored target must report explored=false")
	}
	// 未探索区里的地形阻挡仍然生效（权威地形寻路）。
	ws.Grid[hidden.Y][hidden.X].Terrain = "blocked"
	route, err = ql.PlanetPath(ws, "p1", "u", hidden, 0)
	if err != nil || route.Reachable {
		t.Fatalf("blocked target cannot be routed: %+v %v", route, err)
	}
	ws.Grid[target.Y][target.X].Terrain = "blocked"
	route, err = ql.PlanetPath(ws, "p1", "u", target, 0)
	if err != nil || route.Reachable {
		t.Fatal("blocked target cannot be routed")
	}
}

func TestOverviewBucketsDoNotCrossFaceSeams(t *testing.T) {
	ql, ws, id := newPlanetQueryFixture(t, 16, 16)
	view, ok := ql.PlanetOverview(ws, "p1", id, PlanetOverviewRequest{Step: 7})
	if !ok || view.Step != 4 || view.CellsWidth != 12 || view.CellsHeight != 8 {
		t.Fatalf("misaligned face buckets: %+v", view)
	}
}

func TestPlanetPathRespectsNonAnchorFootprintAcrossSeam(t *testing.T) {
	ql, ws, _ := newPlanetQueryFixture(t, 16, 16)
	anchor := model.Position{X: 15, Y: 8}
	target, _ := ws.SurfaceStep(anchor, model.ConveyorEast)
	start, _ := ws.SurfaceStep(target, model.ConveyorSouth)
	ws.Units["u"] = &model.Unit{ID: "u", OwnerID: "p1", Position: start, VisionRange: 4, MoveRange: 4}
	building := &model.Building{ID: "wide", Type: "wind_turbine", OwnerID: "p1", Position: anchor}
	building.Runtime.Params.Footprint = model.Footprint{Width: 2, Height: 1}
	ws.Buildings[building.ID] = building
	route, err := ql.PlanetPath(ws, "p1", "u", target, 0)
	if err != nil || route.Reachable {
		t.Fatalf("route must not enter non-anchor occupied cell: %+v %v", route, err)
	}
}
