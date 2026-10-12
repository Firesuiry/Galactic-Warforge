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
	// 细分网格：视野是距离类数值，已整体 ×3（机甲基础视野 6→18）。
	if unit.VisionRange != 18 {
		t.Fatalf("base vision should be 18, got %d", unit.VisionRange)
	}
	// 距执行体 19 格：基础视野 18 外、宇宙探索 2 级（每级 +3，18+6=24）内。
	target := model.Position{X: 29, Y: 10}
	if eng.IsVisible(ws, "p1", target) {
		t.Fatal("tile at distance 19 must be fogged with base vision 18")
	}

	player.Tech.CompletedTechs["universe_exploration"] = 2
	model.SyncMechaCapabilities(unit, player)
	if unit.VisionRange != 24 {
		t.Fatalf("universe_exploration L2 should raise vision to 24, got %d", unit.VisionRange)
	}
	ws.Tick++ // the engine diffs vision sources per tick
	if !eng.IsVisible(ws, "p1", target) {
		t.Fatal("tile at distance 19 must become visible after universe_exploration L2")
	}
	fog := eng.FogState(ws, "p1")
	if !fog.Visible[10][29] || !fog.Explored[10][29] {
		t.Fatal("fog grids must mark the newly covered tile visible and explored")
	}

	// Losing sight of the source (unit destroyed) collapses coverage again.
	delete(ws.Units, "exec")
	ws.Tick++
	if eng.IsVisible(ws, "p1", target) {
		t.Fatal("tile must return to fog once the executor is gone")
	}
	if !eng.FogState(ws, "p1").Explored[10][29] {
		t.Fatal("explored memory must persist after the executor is gone")
	}
}
