package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// 让路回归（第六轮整局回归 seed pt1009-g2）：bot 机甲赶路时被自家一个待命步兵
// 堵在一格宽的窄口里，绕路无解，机甲 6000+ tick 原地不动、整局只打了一波。
// 修复后：挡路的自家待命单位会侧移让开，没有侧移空间就与赶路者互换位置。

// corridorWorld 一条 y=8、x∈[3,12] 的一格宽走廊，两侧是不可通行地形。
func corridorWorld() *model.WorldState {
	ws := newRTTWorld(true)
	for x := 3; x <= 12; x++ {
		ws.Grid[7][x].Terrain = terrain.TileBlocked
		ws.Grid[9][x].Terrain = terrain.TileBlocked
	}
	return ws
}

func moveTo(t *testing.T, ws *model.WorldState, unit *model.Unit, dest model.Position) {
	t.Helper()
	res, _ := execCommand(&GameCore{}, model.CmdMove, ws, unit.OwnerID, model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: unit.ID, Position: &dest},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("move rejected: %+v", res)
	}
}

func assertNoStacking(t *testing.T, ws *model.WorldState) {
	t.Helper()
	for key, ids := range ws.TileUnits {
		alive := 0
		for _, id := range ids {
			if u := ws.Units[id]; u != nil && u.HP > 0 {
				alive++
			}
		}
		if alive > 1 {
			t.Fatalf("tile %s holds %d units", key, alive)
		}
	}
}

func TestIdleFriendlySwapsPlacesInsideOneTileCorridor(t *testing.T) {
	ws := corridorWorld()
	walker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 8})
	idle := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 7, Y: 8})
	dest := model.Position{X: 12, Y: 8}
	moveTo(t, ws, walker, dest)
	for i := 0; i < 200 && walker.Position != dest; i++ {
		advanceRTT(ws, 1)
		assertNoStacking(t, ws)
	}
	if walker.Position != dest {
		t.Fatalf("walker stuck behind an idle friendly in the corridor: walker=%+v idle=%+v", walker.Position, idle.Position)
	}
}

func TestIdleFriendlySidestepsWhenThereIsRoom(t *testing.T) {
	ws := corridorWorld()
	// 走廊中段开一个侧袋：待命兵应侧移进去，而不是被推着倒退。
	ws.Grid[9][7].Terrain = terrain.TileBuildable
	walker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 8})
	idle := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 7, Y: 8})
	dest := model.Position{X: 12, Y: 8}
	moveTo(t, ws, walker, dest)
	for i := 0; i < 200 && walker.Position != dest; i++ {
		advanceRTT(ws, 1)
		assertNoStacking(t, ws)
	}
	if walker.Position != dest {
		t.Fatalf("walker did not pass: walker=%+v idle=%+v", walker.Position, idle.Position)
	}
	if idle.Position != (model.Position{X: 7, Y: 9}) {
		t.Fatalf("idle friendly should have stepped into the side pocket, got %+v", idle.Position)
	}
}

func TestEnemyAndHoldingUnitsDoNotYield(t *testing.T) {
	for _, tc := range []struct {
		name  string
		owner string
		hold  bool
	}{{"enemy", "p2", false}, {"holding friendly", "p1", true}} {
		t.Run(tc.name, func(t *testing.T) {
			ws := corridorWorld()
			walker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 6, Y: 8})
			blocker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, tc.owner, model.Position{X: 7, Y: 8})
			if tc.hold {
				blocker.Stance = model.UnitStanceHold
			}
			moveTo(t, ws, walker, model.Position{X: 12, Y: 8})
			// 直接问让路判定（交战结算会让敌兵自己动起来，不能用整段推进来断言）。
			if yieldIdleBlocker(ws, walker, model.Position{X: 7, Y: 8}) {
				t.Fatalf("%s must not be shoved aside", tc.name)
			}
			if blocker.Position != (model.Position{X: 7, Y: 8}) {
				t.Fatalf("%s moved to %+v", tc.name, blocker.Position)
			}
		})
	}
}
