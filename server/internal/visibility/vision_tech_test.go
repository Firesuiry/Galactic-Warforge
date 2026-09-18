package visibility_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/visibility"
)

// The executor's vision circle must grow when universe_exploration research
// completes: SyncMechaCapabilities raises Unit.VisionRange and the fog engine
// picks the new radius up on the next tick.
func TestExecutorVisionExpandsWithUniverseExploration(t *testing.T) {
	ws := model.NewWorldState("planet-vision-tech", 16)
	player := &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Tech:     &model.PlayerTechState{PlayerID: "p1", CompletedTechs: map[string]int{}},
	}
	ws.Players["p1"] = player
	unit := &model.Unit{ID: "exec", Type: model.UnitTypeExecutor, OwnerID: "p1", HP: 120, Position: model.Position{X: 10, Y: 10}}
	ws.Units["exec"] = unit

	eng := visibility.New()
	model.SyncMechaCapabilities(unit, player)
	if unit.VisionRange != 6 {
		t.Fatalf("base vision should be 6, got %d", unit.VisionRange)
	}
	// Seven tiles east: outside radius 6, inside radius 8.
	target := model.Position{X: 17, Y: 10}
	if eng.IsVisible(ws, "p1", target) {
		t.Fatal("tile at distance 7 must be fogged with base vision 6")
	}

	player.Tech.CompletedTechs["universe_exploration"] = 2
	model.SyncMechaCapabilities(unit, player)
	if unit.VisionRange != 8 {
		t.Fatalf("universe_exploration L2 should raise vision to 8, got %d", unit.VisionRange)
	}
	ws.Tick++ // the engine diffs vision sources per tick
	if !eng.IsVisible(ws, "p1", target) {
		t.Fatal("tile at distance 7 must become visible after universe_exploration L2")
	}
	fog := eng.FogState(ws, "p1")
	if !fog.Visible[10][17] || !fog.Explored[10][17] {
		t.Fatal("fog grids must mark the newly covered tile visible and explored")
	}

	// Losing sight of the source (unit destroyed) collapses coverage again.
	delete(ws.Units, "exec")
	ws.Tick++
	if eng.IsVisible(ws, "p1", target) {
		t.Fatal("tile must return to fog once the executor is gone")
	}
	if !eng.FogState(ws, "p1").Explored[10][17] {
		t.Fatal("explored memory must persist after the executor is gone")
	}
}
