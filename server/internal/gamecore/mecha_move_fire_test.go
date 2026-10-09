package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩报告 1011 新问题 C（阻断）：有移动路径的机甲完全不还手。
// 旧实现 `settleMechaAutoFire` 在 `unit.HasPath()` 时直接 return nil，
// 于是「正在执行 move/建造指令」的机甲被 8 个兵从 120 血打到 0、一次没开火。
//
// 这条测试钉住第一半行为：玩家显式 move 命令的路径边走边打——
// 射程内出现敌兵时照常开火、扣能量，位置继续沿路径推进、不停下。

// mechaMoveFireWorld 一台收到长 move 命令的 p1 机甲 + 一个挡在路上的 p2 敌兵。
func mechaMoveFireWorld(t *testing.T, destX int) (*model.WorldState, *model.Unit, *model.Unit) {
	t.Helper()
	ws, mecha := mechaTestWorld()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	core := &GameCore{}
	dest := model.Position{X: destX, Y: 1}
	res, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: mecha.ID, Position: &dest},
	})
	if res.Code != model.CodeOK || !mecha.HasPath() {
		t.Fatalf("move order rejected: %+v", res)
	}
	if mecha.PathIntent != model.PathIntentOrder {
		t.Fatalf("player move must mark an order path, got %q", mecha.PathIntent)
	}
	// 敌兵站在机甲必经之路的射程内（3 格），但不还手（Attack=0）以免打死机甲。
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", ws.SurfaceOffset(mecha.Position, 3, 0))
	enemy.Stance = model.UnitStanceHold
	enemy.Attack = 0
	enemy.MaxHP, enemy.HP = 100000, 100000
	return ws, mecha, enemy
}

func TestMechaFiresWhileWalkingOrderedPath(t *testing.T) {
	ws, mecha, _ := mechaMoveFireWorld(t, 15)
	start := mecha.Position
	fired := 0
	movedWhileFiring := false
	for i := 0; i < 60; i++ {
		events := advanceRTT(ws, 1)
		for _, evt := range events {
			if evt.EventType != model.EvtDamageApplied {
				continue
			}
			if attacker, _ := evt.Payload["attacker_id"].(string); attacker == mecha.ID {
				fired++
				if mecha.Position != start && mecha.HasPath() {
					movedWhileFiring = true
				}
			}
		}
	}
	if fired == 0 {
		t.Fatalf("mecha with a move path must return fire: pos=%+v path=%v energy=%d",
			mecha.Position, mecha.Path, mecha.Mecha.Energy)
	}
	if !movedWhileFiring {
		t.Fatalf("mecha must keep walking while firing: start=%+v now=%+v pathIndex=%d/%d",
			start, mecha.Position, mecha.PathIndex, len(mecha.Path))
	}
	// 开火不能把玩家 move 命令的路径吃掉：射程内的每一次还击都必须发生在
	// 「仍在沿原路径推进」的状态下（movedWhileFiring 已覆盖），且机甲最终到达终点。
	if mecha.Position != (model.Position{X: 15, Y: 1}) {
		t.Fatalf("ordered move must still complete after firing back, at %+v", mecha.Position)
	}
}

// 第二半行为：作业/建造驱动的行走（施工自动靠近）被打断——
// 机甲暂停赶路去还手，威胁消失后重新规划施工路径、把建造做完。
func TestMechaBuildTaskWalkFiresBackAndResumesConstruction(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	mecha := findExecutorUnit(t, ws)
	home := botPlayerHQ(t, ws, "p1").Position

	// 选一个超出建造中心半径（24）但机甲能走到的施工点：触发 auto_approach 的作业行走。
	var target *model.Position
	for _, p := range ws.SurfaceDisc(home, 60) {
		if ws.SurfaceDistance(home, p) <= 26 || ws.SurfaceDistance(mecha.Position, p) < 8 {
			continue
		}
		if ws.TileBuilding[model.TileKey(p.X, p.Y)] != "" || !ws.Grid[p.Y][p.X].Terrain.Buildable() {
			continue
		}
		if _, path := planBuildApproach(ws, "p1", p); len(path) < 5 {
			continue
		}
		c := p
		target = &c
		break
	}
	if target == nil {
		t.Fatal("no reachable out-of-range build site")
	}

	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: target},
		Payload: map[string]any{"building_type": "wind_turbine", "auto_approach": true},
	})
	if res.Code != model.CodeOK || !mecha.HasPath() {
		t.Fatalf("build with auto_approach rejected: %+v path=%v", res, mecha.Path)
	}
	if mecha.PathIntent != model.PathIntentTask {
		t.Fatalf("construction approach must mark a task path, got %q", mecha.PathIntent)
	}
	walkStart := mecha.Position

	// 8 个敌兵贴上来打它（复现报告场景）：机甲血量拉高以保证测试可重复。
	mecha.MaxHP, mecha.HP = 5000, 5000
	var enemies []*model.Unit
	for _, offset := range ws.SurfaceDisc(mecha.Position, 3) {
		if len(enemies) >= 8 || ws.SurfaceDistance(mecha.Position, offset) == 0 {
			continue
		}
		if ws.TileBuilding[model.TileKey(offset.X, offset.Y)] != "" {
			continue
		}
		if ws.TileUnits[model.TileKey(offset.X, offset.Y)] != nil {
			continue
		}
		enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", offset)
		enemy.MaxHP, enemy.HP = 100000, 100000
		enemies = append(enemies, enemy)
	}
	if len(enemies) < 8 {
		t.Fatalf("could not place 8 attackers, got %d", len(enemies))
	}

	fired, tookDamage := 0, 0
	fromTick := ws.Tick
	for i := 0; i < 60; i++ {
		core.processTick()
	}
	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtDamageApplied}, "", fromTick, 0)
	for _, evt := range events {
		if attacker, _ := evt.Payload["attacker_id"].(string); attacker == mecha.ID {
			fired++
		}
		if victim, _ := evt.Payload["target_id"].(string); victim == mecha.ID {
			tookDamage++
		}
	}
	if fired == 0 {
		t.Fatalf("mecha interrupted mid-construction must return fire (report: 0 shots); pos=%+v intent=%q",
			mecha.Position, mecha.PathIntent)
	}
	if tookDamage == 0 {
		t.Fatal("fixture broken: the mecha was never attacked")
	}
	if mecha.Position != walkStart && ws.SurfaceDistance(mecha.Position, *target) < ws.SurfaceDistance(walkStart, *target) {
		t.Fatal("fixture broken: mecha already reached the site before the fight")
	}

	// 威胁消失：机甲重新规划施工路径、把建造做完。
	for _, enemy := range enemies {
		enemy.HP = 0
	}
	mecha.Mecha.Energy = mecha.Mecha.MaxEnergy
	built := false
	for i := 0; i < 4000 && !built; i++ {
		core.processTick()
		if ws.TileBuilding[model.TileKey(target.X, target.Y)] != "" {
			built = true
		}
	}
	if !built {
		t.Fatalf("construction must resume after the threat is gone: mecha=%+v target=%+v task=%+v",
			mecha.Position, *target, ws.Construction.Tasks)
	}
}
