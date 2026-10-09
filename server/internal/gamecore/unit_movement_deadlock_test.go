package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 单位互堵回归（试玩报告新问题 #4）：bot 主力 11 个兵挤在 5 格内 4 万 tick 不动，
// path_index/move_progress 恒定。修复后：被单位阻挡持续 unitBlockedAbandonTicks
// 后必须放弃路径（停在原地，不再永久持有走不通的路径），并且不会互相重叠。

// 两个单位面对面换位、且各自的目的地只有穿过对方才可达时（A(8,8)→(8,10)、
// B(8,9)→(8,7)，两人路径互为对方的格子）：
// 修复前每次 repathUnitAvoidingIdle 都会"成功"得到同一条穿过占位单位的路并把
// BlockedTicks 清零，于是 path_index/move_progress 永远停在 1（试玩报告 #4 的
// 「4 万 tick 不动」形态）。修复后必须放弃路径，且不得瞬移/重叠。
func TestMutuallyBlockedUnitsNeverFreeze(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 8, Y: 8})
	b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 8, Y: 9})
	destA := model.Position{X: 8, Y: 10}
	destB := model.Position{X: 8, Y: 7}
	if res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: a.ID, Position: &destA}}); res.Code != model.CodeOK {
		t.Fatalf("A move rejected: %+v", res)
	}
	if res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: b.ID, Position: &destB}}); res.Code != model.CodeOK {
		t.Fatalf("B move rejected: %+v", res)
	}
	// 前提校验：两条路径都必须穿过对方，否则本用例没有构造出互堵。
	if len(a.Path) < 3 || a.Path[1] != b.Position {
		t.Fatalf("A path must step through B: %v (B at %+v)", a.Path, b.Position)
	}
	if len(b.Path) < 3 || b.Path[1] != a.Position {
		t.Fatalf("B path must step through A: %v (A at %+v)", b.Path, a.Position)
	}

	aborted := map[string]bool{}
	// BlockedTicks 只在"推进到下一格但被占位"时累加，重寻路会重置推进进度，
	// 因此真实 tick 数约是阈值的数倍；这里给足 10 倍余量。
	for tick := 0; tick < unitBlockedAbandonTicks*10; tick++ {
		ws.Tick++
		for _, evt := range settleUnitMovement(ws) {
			if evt.Payload["arrived"] == false && evt.Payload["reason"] == "blocked" {
				if id, _ := evt.Payload["entity_id"].(string); id != "" {
					aborted[id] = true
				}
			}
		}
	}
	if len(aborted) == 0 {
		t.Fatal("mutually blocked units must abandon their paths instead of looping forever")
	}
	for _, unit := range []*model.Unit{a, b} {
		if unit.HasPath() {
			t.Fatalf("unit %s still holds a path after the abandon threshold: pos=%+v path_index=%d progress=%.2f blocked=%d", unit.ID, unit.Position, unit.PathIndex, unit.MoveProgress, unit.BlockedTicks)
		}
	}
	if a.Position == b.Position {
		t.Fatalf("units overlapped at %+v", a.Position)
	}
}

// 一团单位挤成一堆朝同一目标移动：最终都要到达或稳定停下，不能永久卡住。
func TestClumpedUnitsReachOrSettleWithoutDeadlock(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	dest := model.Position{X: 20, Y: 10}

	var units []*model.Unit
	for i := 0; i < 9; i++ {
		pos := model.Position{X: 10 + i%3, Y: 10 + i/3}
		units = append(units, spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", pos))
	}
	for _, unit := range units {
		res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{
			Type:   model.CmdMove,
			Target: model.CommandTarget{EntityID: unit.ID, Position: &dest},
		})
		if res.Code != model.CodeOK {
			t.Fatalf("move order rejected: %+v", res)
		}
	}

	type snapshot struct {
		hasPath   bool
		pos       model.Position
		pathIndex int
		moveProg  float64
	}
	snap := make(map[string]snapshot, len(units))
	advanceRTT(ws, 3000)
	for _, unit := range units {
		snap[unit.ID] = snapshot{unit.HasPath(), unit.Position, unit.PathIndex, unit.MoveProgress}
	}
	advanceRTT(ws, 3000)
	for _, unit := range units {
		before := snap[unit.ID]
		if !before.hasPath {
			continue
		}
		// 3000 tick 前还持有路径的单位：要么已到达/放弃，要么确实在推进。
		if unit.HasPath() && unit.Position == before.pos && unit.PathIndex == before.pathIndex && unit.MoveProgress == before.moveProg {
			t.Fatalf("unit %s frozen at %+v (path_index=%d progress=%.2f) for 3000 ticks", unit.ID, unit.Position, unit.PathIndex, unit.MoveProgress)
		}
	}
	// 最终：所有单位都停下（不再持有路径），彼此不重叠，且都在目标附近。
	occupied := make(map[model.Position]string, len(units))
	for _, unit := range units {
		if unit.HasPath() {
			t.Fatalf("unit %s still holds a path after 6000 ticks: pos=%+v path_index=%d", unit.ID, unit.Position, unit.PathIndex)
		}
		if other, dup := occupied[unit.Position]; dup {
			t.Fatalf("units %s and %s overlap at %+v", other, unit.ID, unit.Position)
		}
		occupied[unit.Position] = unit.ID
		if d := ws.SurfaceDistance(unit.Position, dest); d > 6 {
			t.Fatalf("unit %s settled too far from the destination: %+v (distance %d)", unit.ID, unit.Position, d)
		}
	}
}
