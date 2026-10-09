package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/model"
)

// 试玩 1009：288×192 地图上 bot 军团朝被建筑围住的玩家基地下令，
// planSquadFormation 对每个成员×每个候选格各跑一次整片洪泛，单 tick 卡 6–12 秒。
// 现在每个成员只洪泛一次，整条 squad_order 必须在宽松上限内完成。
const squadOrderPerfLimit = 500 * time.Millisecond

func newSquadPerfWorld(t *testing.T) (*model.WorldState, *model.CombatSquad) {
	t.Helper()
	ws := model.NewWorldState("perf", 96) // 288×192
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	units := make([]*model.Unit, 0, 20)
	for i := 0; i < 20; i++ {
		units = append(units, spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 30 + i%5, Y: 40 + i/5}))
	}
	return ws, formTestSquad(t, ws, units...)
}

// wallRing 在目标外 radius 处围一圈建筑占位。
func wallRing(ws *model.WorldState, center model.Position, radius int) {
	inner := make(map[model.Position]bool)
	for _, p := range ws.SurfaceDisc(center, radius-1) {
		inner[p] = true
	}
	for _, p := range ws.SurfaceDisc(center, radius) {
		if !inner[p] {
			ws.Grid[p.Y][p.X].BuildingID = "b-wall"
		}
	}
}

func timedSquadOrder(t *testing.T, ws *model.WorldState, squad *model.CombatSquad, target model.Position) model.CommandResult {
	t.Helper()
	start := time.Now()
	res := squadOrder(ws, squad.ID, string(model.SquadOrderAttack), &target)
	if elapsed := time.Since(start); elapsed > squadOrderPerfLimit {
		t.Fatalf("squad_order took %v, want <= %v", elapsed, squadOrderPerfLimit)
	}
	return res
}

func TestSquadOrderFastWhenTargetCoreWalledIn(t *testing.T) {
	ws, squad := newSquadPerfWorld(t)
	target := model.Position{X: 144, Y: 48}
	// 目标核心被围住：得分最好的候选格（贴近目标）全都不可达，外圈候选格可达。
	wallRing(ws, target, 3)

	res := timedSquadOrder(t, ws, squad, target)
	if res.Code != model.CodeOK {
		t.Fatalf("squad_order: %+v", res)
	}
	for _, u := range squad.Members(ws) {
		if u.OrderPos == nil || len(u.Path) < 2 {
			t.Fatalf("%s got no path", u.ID)
		}
		if d := ws.SurfaceDistance(*u.OrderPos, target); d < 3 {
			t.Fatalf("%s assigned unreachable tile %v inside the wall", u.ID, *u.OrderPos)
		}
		last := u.Path[len(u.Path)-1]
		if last != *u.OrderPos {
			t.Fatalf("%s path ends at %v, want %v", u.ID, last, *u.OrderPos)
		}
	}
}

func TestSquadOrderFastWhenWholeTargetAreaSealed(t *testing.T) {
	ws, squad := newSquadPerfWorld(t)
	target := model.Position{X: 144, Y: 48}
	// 整个候选圆都在墙内：没有任何成员到得了，命令应快速失败而不是挨个洪泛。
	wallRing(ws, target, 20)

	if res := timedSquadOrder(t, ws, squad, target); res.Code == model.CodeOK {
		t.Fatalf("sealed target should be rejected: %+v", res)
	}
}
