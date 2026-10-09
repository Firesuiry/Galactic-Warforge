package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

// 试玩报告 1010 阻断 C：黑雾巢穴要在网页上可见可打。
// 玩家把机甲开到巢穴视野内 → enemy_forces 出现巢穴 → attack 被接受 →
// 黑雾对该玩家敌对 → 一段时间不打恢复中立。
func TestPlayerUnitVisionRevealsDarkFogNest(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.DarkFogCalmTicks = 200
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	nestPos := model.Position{X: 40, Y: 40}
	spawnE4Nest(ws, "nest-c", 1, 200, nestPos)

	mecha := findExecutorUnit(t, ws)
	teleportUnitForTest(ws, mecha, ws.SurfaceOffset(nestPos, 3, 0))
	// 只留这一台机甲当传感器：基地的雷达/视野不该替我们"看到"巢穴
	// （否则测不到"单位视野也能探测"这件事）。基地离巢穴很远，这里再把
	// 己方建筑的运行状态置为非 running，确保传感器源只有单位。
	for _, b := range ws.Buildings {
		if b.OwnerID == "p1" {
			b.Runtime.State = model.BuildingWorkIdle
		}
	}

	driveBlackFogTicks(core, ws, 1)

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	view, ok := ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected planet runtime view")
	}
	if len(view.EnemyForces) != 1 || view.EnemyForces[0].ID != "nest-c" {
		t.Fatalf("unit vision must reveal the nest in enemy_forces, got %+v", view.EnemyForces)
	}

	// 攻击被接受，黑雾被激怒。
	res, _ := execCommand(core, model.CmdAttack, ws, "p1", model.Command{
		Type:   model.CmdAttack,
		Target: model.CommandTarget{EntityID: mecha.ID},
		Payload: map[string]any{
			"target_entity_id": "nest-c",
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("attack on a revealed nest must be accepted, got %s (%s)", res.Code, res.Message)
	}
	if !ws.Players["p1"].DarkFog.Hostile {
		t.Fatal("attacking the nest must provoke the dark fog")
	}
	if ws.EnemyForces.Forces[0].Strength >= 200 {
		t.Fatalf("nest must take damage, strength=%d", ws.EnemyForces.Forces[0].Strength)
	}

	// 停止攻击（把机甲挪走，别让它继续自动开火）：冷静期后恢复中立
	// （关系层，不依赖巢穴是否还活着）。
	teleportUnitForTest(ws, mecha, ws.SurfaceOffset(nestPos, 40, 0))
	for i := 0; i < 400; i++ {
		driveBlackFogTicks(core, ws, 1)
		settleDarkFogCalm(ws.Players, ws.Tick)
	}
	if ws.Players["p1"].DarkFog.Hostile {
		t.Fatalf("dark fog must calm down after %d ticks of no attacks: %+v", ws.DarkFogCalmTicks, ws.Players["p1"].DarkFog)
	}
}
