package visibility_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/visibility"
)

func buildTestWorld() *model.WorldState {
	ws := model.NewWorldState("planet-1", 16, 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}

	// p1 base at (2,2), vision 5
	b1 := &model.Building{
		ID: "b1", Type: model.BuildingTypeBattlefieldAnalysisBase, OwnerID: "p1",
		Position: model.Position{X: 2, Y: 2}, VisionRange: 5, Runtime: model.BuildingRuntime{State: model.BuildingWorkRunning},
	}
	model.InitBuildingStorage(b1)
	ws.Buildings["b1"] = b1
	ws.TileBuilding[model.TileKey(2, 2)] = "b1"

	// p2 base at (14,14), vision 5
	b2 := &model.Building{
		ID: "b2", Type: model.BuildingTypeBattlefieldAnalysisBase, OwnerID: "p2",
		Position: model.Position{X: 14, Y: 14}, VisionRange: 5, Runtime: model.BuildingRuntime{State: model.BuildingWorkRunning},
	}
	model.InitBuildingStorage(b2)
	ws.Buildings["b2"] = b2
	ws.TileBuilding[model.TileKey(14, 14)] = "b2"

	// p1 unit at (4,4), vision 4
	ws.Units["u1"] = &model.Unit{
		ID: "u1", Type: model.UnitTypeSoldier, OwnerID: "p1",
		Position: model.Position{X: 4, Y: 4}, VisionRange: 4,
	}

	// p2 unit at (10,10), vision 4 (invisible to p1 from default positions)
	ws.Units["u2"] = &model.Unit{
		ID: "u2", Type: model.UnitTypeSoldier, OwnerID: "p2",
		Position: model.Position{X: 10, Y: 10}, VisionRange: 4,
	}

	return ws
}

func TestVisibleTileAtBase(t *testing.T) {
	eng := visibility.New()
	ws := buildTestWorld()
	ws.RLock()
	defer ws.RUnlock()

	if !eng.IsVisible(ws, "p1", model.Position{X: 2, Y: 2}) {
		t.Error("p1 base tile should be visible")
	}
}

func TestOwnEntitiesAlwaysVisible(t *testing.T) {
	eng := visibility.New()
	ws := buildTestWorld()
	ws.RLock()
	defer ws.RUnlock()

	buildings := eng.FilterBuildings(ws, "p1")
	if _, ok := buildings["b1"]; !ok {
		t.Error("p1 should always see own base (b1)")
	}
	if _, ok := buildings["b2"]; ok {
		t.Error("p1 should NOT see p2 base (b2) at far corner")
	}
}

func TestEnemyUnitHiddenByFog(t *testing.T) {
	eng := visibility.New()
	ws := buildTestWorld()
	ws.RLock()
	defer ws.RUnlock()

	// u2 is at (10,10), p1 sees from (2,2) with range 5 and (4,4) with range 4
	// max visible from (4,4) is about (8,8) in L∞, so (10,10) is hidden
	units := eng.FilterUnits(ws, "p1")
	if _, ok := units["u2"]; ok {
		t.Error("p1 should NOT see p2 unit at (10,10)")
	}
	if _, ok := units["u1"]; !ok {
		t.Error("p1 should see own unit u1")
	}
}

func TestFogMapDimensions(t *testing.T) {
	eng := visibility.New()
	ws := buildTestWorld()
	ws.RLock()
	defer ws.RUnlock()

	fog := eng.FogState(ws, "p1")
	if len(fog.Visible) != ws.MapHeight {
		t.Errorf("fog height %d != map height %d", len(fog.Visible), ws.MapHeight)
	}
	if len(fog.Visible[0]) != ws.MapWidth {
		t.Errorf("fog width %d != map width %d", len(fog.Visible[0]), ws.MapWidth)
	}
	if len(fog.Explored) != ws.MapHeight {
		t.Errorf("explored height %d != map height %d", len(fog.Explored), ws.MapHeight)
	}
	if len(fog.Explored[0]) != ws.MapWidth {
		t.Errorf("explored width %d != map width %d", len(fog.Explored[0]), ws.MapWidth)
	}
}

func TestFilterEvent(t *testing.T) {
	eng := visibility.New()

	evtAll := &model.GameEvent{VisibilityScope: "all"}
	evtP1 := &model.GameEvent{VisibilityScope: "p1"}
	evtP2 := &model.GameEvent{VisibilityScope: "p2"}

	if !eng.FilterEvent(evtAll, "p1") {
		t.Error("broadcast event should be visible to p1")
	}
	if !eng.FilterEvent(evtP1, "p1") {
		t.Error("p1 event should be visible to p1")
	}
	if eng.FilterEvent(evtP2, "p1") {
		t.Error("p2 event should NOT be visible to p1")
	}
}

func TestExploredPersistsAfterMove(t *testing.T) {
	eng := visibility.New()
	ws := buildTestWorld()

	ws.RLock()
	fog := eng.FogState(ws, "p1")
	ws.RUnlock()

	if !fog.Visible[4][7] {
		t.Fatal("tile (7,4) should be visible initially")
	}

	// Move unit away so tile (7,4) becomes unseen; bump tick to force update.
	ws.Lock()
	ws.Units["u1"].Position = model.Position{X: 12, Y: 12}
	ws.Tick++
	ws.Unlock()

	ws.RLock()
	fog = eng.FogState(ws, "p1")
	ws.RUnlock()

	if fog.Visible[4][7] {
		t.Error("tile (7,4) should no longer be visible after move")
	}
	if !fog.Explored[4][7] {
		t.Error("tile (7,4) should remain explored after losing visibility")
	}
}
