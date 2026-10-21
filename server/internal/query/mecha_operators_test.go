package query

import (
	"testing"

	"siliconworld/internal/model"
)

// 第 22 轮契约 §5：3D 行星场景要给机甲单位画 operator 名牌。
// 服务端在 /scene 里下发 mecha_operators（unit ID → operator，只含非空项），
// 且只暴露请求玩家自己的机甲档案（别人的绑定关系不对外）。
func TestPlanetSceneExposesMechaOperators(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 16, 16)

	// 两台本方机甲：一台绑给 agent，一台空闲；另有一台别人的机甲。
	mine := &model.Unit{
		ID: "u-1", Type: model.UnitTypeExecutor, OwnerID: "p1",
		Position: model.Position{X: 4, Y: 4}, HP: 100, MaxHP: 100, VisionRange: 8,
	}
	idle := &model.Unit{
		ID: "u-2", Type: model.UnitTypeExecutor, OwnerID: "p1",
		Position: model.Position{X: 5, Y: 4}, HP: 100, MaxHP: 100, VisionRange: 8,
	}
	foreign := &model.Unit{
		ID: "u-3", Type: model.UnitTypeExecutor, OwnerID: "p2",
		Position: model.Position{X: 6, Y: 4}, HP: 100, MaxHP: 100, VisionRange: 8,
	}
	for _, unit := range []*model.Unit{mine, idle, foreign} {
		ws.Units[unit.ID] = unit
		ws.TileUnits[model.TileKey(unit.Position.X, unit.Position.Y)] = []string{unit.ID}
	}
	ws.Players["p1"] = &model.PlayerState{
		PlayerID: "p1", IsAlive: true,
		Mechas: map[string]*model.MechaRecord{
			"u-1": {UnitID: "u-1", PlanetID: planetID, Operator: "builder-a"},
			"u-2": {UnitID: "u-2", PlanetID: planetID},
		},
	}
	ws.Players["p1"].SetPermissions([]string{"*"})

	view, ok := ql.PlanetScene(ws, "p1", planetID, PlanetSceneRequest{X: 0, Y: 0, Width: 16, Height: 16})
	if !ok {
		t.Fatal("expected planet scene view")
	}
	if got := view.MechaOperators["u-1"]; got != "builder-a" {
		t.Fatalf("bound mecha operator = %q, want builder-a", got)
	}
	if _, ok := view.MechaOperators["u-2"]; ok {
		t.Fatalf("idle mecha must not get a name plate, got %+v", view.MechaOperators)
	}
	if _, ok := view.MechaOperators["u-3"]; ok {
		t.Fatalf("another player's mecha must not leak its operator, got %+v", view.MechaOperators)
	}
}
