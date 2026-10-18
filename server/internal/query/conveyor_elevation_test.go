package query

import (
	"testing"

	"siliconworld/internal/model"
)

// 查询层（第 19 轮契约 §3.4）：
//  1. /scene 里高架带必须照常下发（带 conveyor.elevation），且同一格的地面建筑
//     不能被高架带顶掉——高架带不在 TileBuilding 里，两者互不覆盖。
//  2. runtime 视图的施工任务带 elevation，前端本地预检据此判定高架层是否可放。
//
// 这两条都是「该显示的显示」的下界：高架带若被漏掉，客户端根本画不出立体交叉。
func TestQueryExposesElevatedConveyorAndGroundBuilding(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 16, 16)

	// 同一格 (4,4)：地面分拣器 + 1 层高架带。
	ground := &model.Building{
		ID:       "b-sorter-ground",
		Type:     model.BuildingTypeSorterMk1,
		OwnerID:  "p1",
		Position: model.Position{X: 4, Y: 4},
	}
	elevated := &model.Building{
		ID:       "b-belt-elevated",
		Type:     model.BuildingTypeConveyorBeltMk1,
		OwnerID:  "p1",
		Position: model.Position{X: 4, Y: 4},
		Conveyor: &model.ConveyorState{Output: model.ConveyorEast, Elevation: 1},
	}
	ws.Buildings[ground.ID] = ground
	ws.Buildings[elevated.ID] = elevated
	// 高架带不进地面索引；地面分拣器占地面格。
	if err := ws.IndexBuilding(elevated); err != nil {
		t.Fatalf("index elevated belt: %v", err)
	}
	ws.TileBuilding[model.TileKey(4, 4)] = ground.ID

	view, ok := ql.PlanetScene(ws, "p1", planetID, PlanetSceneRequest{X: 0, Y: 0, Width: 16, Height: 16})
	if !ok {
		t.Fatal("expected planet scene view")
	}
	sceneBelt := view.Buildings[elevated.ID]
	if sceneBelt == nil {
		t.Fatal("elevated belt missing from scene buildings")
	}
	if sceneBelt.Conveyor == nil || sceneBelt.Conveyor.Elevation != 1 {
		t.Fatalf("scene belt elevation not exposed: %+v", sceneBelt.Conveyor)
	}
	if view.Buildings[ground.ID] == nil {
		t.Fatal("ground building at the same tile must still be visible")
	}
	// 高架带不能写进地面索引（外面 else 会遮住地面建筑）。
	if id := ws.TileBuilding[model.TileKey(4, 4)]; id != ground.ID {
		t.Fatalf("elevated belt leaked into TileBuilding: %q", id)
	}
	// 地面带（elevation 缺省 0）不带 elevation 字段（omitempty）。
	plain := &model.Building{
		ID: "b-belt-ground", Type: model.BuildingTypeConveyorBeltMk1, OwnerID: "p1",
		Position: model.Position{X: 5, Y: 5},
		Conveyor: &model.ConveyorState{Output: model.ConveyorEast},
	}
	ws.Buildings[plain.ID] = plain
	view2, _ := ql.PlanetScene(ws, "p1", planetID, PlanetSceneRequest{X: 0, Y: 0, Width: 16, Height: 16})
	if got := view2.Buildings[plain.ID]; got == nil || got.Conveyor == nil || got.Conveyor.Elevation != 0 {
		t.Fatalf("ground belt should report elevation 0: %+v", got)
	}
}

func TestQueryConstructionTaskCarriesElevation(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 16, 16)

	elevatedTask := &model.ConstructionTask{
		ID: "c-elevated", PlayerID: "p1", RegionID: "r-1",
		BuildingType: model.BuildingTypeConveyorBeltMk1,
		Position:     model.Position{X: 6, Y: 6},
		State:        model.ConstructionPending,
		Elevation:    2,
	}
	groundTask := &model.ConstructionTask{
		ID: "c-ground", PlayerID: "p1", RegionID: "r-1",
		BuildingType: model.BuildingTypeConveyorBeltMk1,
		Position:     model.Position{X: 7, Y: 6},
		State:        model.ConstructionPending,
	}
	ws.Construction.Tasks[elevatedTask.ID] = elevatedTask
	ws.Construction.Tasks[groundTask.ID] = groundTask
	ws.Construction.Order = []string{elevatedTask.ID, groundTask.ID}

	view, ok := ql.PlanetRuntime(ws, "p1", planetID, planetID)
	if !ok {
		t.Fatal("expected planet runtime view")
	}
	byID := map[string]ConstructionTaskView{}
	for _, task := range view.ConstructionTasks {
		byID[task.ID] = task
	}
	got, ok := byID["c-elevated"]
	if !ok {
		t.Fatalf("elevated construction task missing: %+v", view.ConstructionTasks)
	}
	if got.Elevation != 2 {
		t.Fatalf("construction task elevation not exposed: %+v", got)
	}
	if byID["c-ground"].Elevation != 0 {
		t.Fatalf("ground construction task elevation should be 0: %+v", byID["c-ground"])
	}
}
