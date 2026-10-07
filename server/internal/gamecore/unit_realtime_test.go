package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// 实时战斗核心（R1–R5）验收测试：移动寻路、自动交战、指令集、小队实体化与 PvP。

func newRTTWorld(twoPlayers bool) *model.WorldState {
	ws := model.NewWorldState("rtt", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	if twoPlayers {
		ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	}
	return ws
}

func advanceRTT(ws *model.WorldState, ticks int) []*model.GameEvent {
	var events []*model.GameEvent
	for i := 0; i < ticks; i++ {
		ws.Tick++
		events = append(events, settleUnitMovement(ws)...)
		events = append(events, settleUnitCombat(ws)...)
	}
	return events
}

func damageEventsFor(events []*model.GameEvent, targetID string) int {
	count := 0
	for _, evt := range events {
		if evt.EventType != model.EvtDamageApplied {
			continue
		}
		if id, _ := evt.Payload["target_id"].(string); id == targetID {
			count++
		}
	}
	return count
}

// R1：单位按速度沿路径逐 tick 推进，到达后转 idle 并发到达事件。
func TestR1UnitMovesAlongPathInRealTime(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	dest := model.Position{X: 6, Y: 2}

	res, events := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: unit.ID, Position: &dest}})
	if res.Code != model.CodeOK {
		t.Fatalf("move order rejected: %+v", res)
	}
	if unit.Position == dest {
		t.Fatal("move teleported: position changed in the same tick")
	}
	if len(events) == 0 || events[0].Payload["path"] == nil {
		t.Fatalf("move order must emit path event for client interpolation: %+v", events)
	}

	// 士兵 0.25 格/tick：4 格需要 16 tick；中途不得瞬移。
	advanceRTT(ws, 4)
	if unit.Position == dest {
		t.Fatal("unit moved too fast: arrived after 4 ticks")
	}
	arrived := advanceRTT(ws, 16)
	if unit.Position != dest {
		t.Fatalf("unit did not arrive after enough ticks: %+v", unit.Position)
	}
	if unit.Stance != model.UnitStanceIdle {
		t.Fatalf("stance after arrival = %s, want idle", unit.Stance)
	}
	foundArrival := false
	for _, evt := range arrived {
		if evt.EventType == model.EvtEntityMoved && evt.Payload["arrived"] == true {
			foundArrival = true
		}
	}
	if !foundArrival {
		t.Fatal("missing arrival event")
	}
}

// R1：移动中可改命令（打断原路径）；多单位不重叠。
func TestR1MoveInterruptAndNoOverlap(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 5})
	far := model.Position{X: 10, Y: 2}
	if res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: a.ID, Position: &far}}); res.Code != model.CodeOK {
		t.Fatalf("move rejected: %+v", res)
	}
	advanceRTT(ws, 4)
	// 打断：新目的地反向。
	other := model.Position{X: 2, Y: 10}
	if res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: a.ID, Position: &other}}); res.Code != model.CodeOK {
		t.Fatalf("interrupt move rejected: %+v", res)
	}
	if a.Stance != model.UnitStanceMoving || a.OrderPos != nil {
		t.Fatalf("interrupt must keep moving stance, got %+v", a)
	}
	// b 去 a 原来的方向，二者路径交叉：任何 tick 都不得同格。
	if res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: b.ID, Position: &far}}); res.Code != model.CodeOK {
		t.Fatalf("second move rejected: %+v", res)
	}
	for i := 0; i < 120; i++ {
		advanceRTT(ws, 1)
		if a.Position == b.Position {
			t.Fatalf("units overlapped at %+v", a.Position)
		}
		if !a.HasPath() && !b.HasPath() {
			break
		}
	}
}

// R2：两支敌对部队相遇自动开火、被打会反击、单位阵亡移除。
func TestR2AutoEngageCounterattackAndDeath(t *testing.T) {
	ws := newRTTWorld(true)
	attacker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	defender := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 4, Y: 3})

	events := advanceRTT(ws, 1)
	// 双方 idle 自动索敌（距离 1 ≤ 射程 2）：都开了火。
	if damageEventsFor(events, defender.ID) == 0 {
		t.Fatal("idle unit did not auto-acquire and fire")
	}
	if damageEventsFor(events, attacker.ID) == 0 {
		t.Fatal("defender did not counterattack in the same engagement")
	}

	// 冷却：士兵冷却 10 tick，连续 5 tick 内不得重复开火。
	events = advanceRTT(ws, 5)
	if got := damageEventsFor(events, defender.ID); got > 1 {
		t.Fatalf("cooldown violated: %d shots in 5 ticks", got)
	}

	// 打到底：攻击 15 对防御 5，每发 10 伤，100 HP = 10 发 ≈ 100 tick。
	events = advanceRTT(ws, 220)
	if ws.Units[defender.ID] != nil && ws.Units[attacker.ID] != nil {
		t.Fatal("prolonged engagement left both sides alive")
	}
	deathSeen := false
	for _, evt := range events {
		if evt.EventType == model.EvtEntityDestroyed && evt.Payload["entity_kind"] == "unit" {
			deathSeen = true
		}
	}
	if !deathSeen {
		t.Fatal("missing unit destroyed event")
	}
}

// R2：守位（hold）不追击；停火条件正确（目标死亡后停火）。
func TestR2HoldDoesNotChaseAndCeasefire(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	holder := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 8, Y: 3})
	enemy.Stance = model.UnitStanceHold // 敌方同样坚守，排除其主动逼近干扰

	if res, _ := execCommand(gc, model.CmdUnitOrder, ws, "p1", model.Command{Type: model.CmdUnitOrder, Target: model.CommandTarget{EntityID: holder.ID}, Payload: map[string]any{"order": "hold"}}); res.Code != model.CodeOK {
		t.Fatalf("hold order rejected: %+v", res)
	}
	// 显式指定射程外目标：hold 不追击、不开火、不移动。
	if res, _ := execCommand(gc, model.CmdAttack, ws, "p1", model.Command{Type: model.CmdAttack, Target: model.CommandTarget{EntityID: holder.ID}, Payload: map[string]any{"target_entity_id": enemy.ID}}); res.Code != model.CodeOK {
		t.Fatalf("attack order rejected: %+v", res)
	}
	events := advanceRTT(ws, 30)
	if holder.Position != (model.Position{X: 3, Y: 3}) {
		t.Fatalf("hold unit moved: %+v", holder.Position)
	}
	if damageEventsFor(events, enemy.ID) != 0 {
		t.Fatal("hold unit fired at out-of-range target")
	}

	// 敌人走进射程：hold 开火；敌人死亡后停火清空目标。
	enemy.Position = model.Position{X: 4, Y: 3}
	events = advanceRTT(ws, 200)
	if ws.Units[enemy.ID] != nil {
		t.Fatal("hold unit failed to destroy in-range enemy")
	}
	if holder.AttackTarget != "" {
		t.Fatal("target not cleared after kill")
	}
}

// R5：攻击移动沿途索敌，清敌后继续赶路并最终到达。
func TestR5AttackMoveEngagesThenContinues(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 5, Y: 2})
	enemy.HP = 20 // 尽快击杀，验证继续赶路
	dest := model.Position{X: 9, Y: 2}

	res, _ := execCommand(gc, model.CmdUnitOrder, ws, "p1", model.Command{Type: model.CmdUnitOrder, Target: model.CommandTarget{EntityID: unit.ID, Position: &dest}, Payload: map[string]any{"order": "attack_move"}})
	if res.Code != model.CodeOK {
		t.Fatalf("attack_move rejected: %+v", res)
	}
	killed := false
	for i := 0; i < 300 && unit.Position != dest; i++ {
		advanceRTT(ws, 1)
		if ws.Units[enemy.ID] == nil {
			killed = true
		}
	}
	if !killed {
		t.Fatal("attack_move did not engage the enemy en route")
	}
	if unit.Position != dest {
		t.Fatalf("attack_move did not resume and arrive: %+v", unit.Position)
	}
	if unit.Stance != model.UnitStanceIdle {
		t.Fatalf("stance after attack_move arrival = %s", unit.Stance)
	}
}

// R5：巡逻在两端之间往返；撤退不还击。
func TestR5PatrolBouncesAndRetreatDoesNotFight(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	patroller := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 8})
	dest := model.Position{X: 6, Y: 8}
	if res, _ := execCommand(gc, model.CmdUnitOrder, ws, "p1", model.Command{Type: model.CmdUnitOrder, Target: model.CommandTarget{EntityID: patroller.ID, Position: &dest}, Payload: map[string]any{"order": "patrol"}}); res.Code != model.CodeOK {
		t.Fatalf("patrol rejected: %+v", res)
	}
	seenX := map[int]bool{}
	for i := 0; i < 200; i++ {
		advanceRTT(ws, 1)
		seenX[patroller.Position.X] = true
	}
	if patroller.Stance != model.UnitStancePatrol {
		t.Fatalf("patrol stance lost: %s", patroller.Stance)
	}
	if !seenX[2] || !seenX[6] {
		t.Fatalf("patrol did not bounce between ends: %+v", seenX)
	}

	// 撤退：被打不还击，到达后转 idle。
	retreater := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 12, Y: 12})
	retreater.MoveSpeed = 0.5 // 加速脱离，保证追击者跟不上
	shooter := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 12, Y: 13})
	home := model.Position{X: 15, Y: 15}
	if res, _ := execCommand(gc, model.CmdUnitOrder, ws, "p1", model.Command{Type: model.CmdUnitOrder, Target: model.CommandTarget{EntityID: retreater.ID, Position: &home}, Payload: map[string]any{"order": "retreat"}}); res.Code != model.CodeOK {
		t.Fatalf("retreat rejected: %+v", res)
	}
	retaliationDuringRetreat := 0
	for i := 0; i < 200 && retreater.Stance == model.UnitStanceRetreat; i++ {
		for _, evt := range advanceRTT(ws, 1) {
			if evt.EventType == model.EvtDamageApplied {
				if id, _ := evt.Payload["target_id"].(string); id == shooter.ID {
					retaliationDuringRetreat++
				}
			}
		}
	}
	if retaliationDuringRetreat != 0 {
		t.Fatal("retreating unit fought back")
	}
	if ws.Units[retreater.ID] == nil {
		t.Fatal("retreater died en route")
	}
	if retreater.Position != home || retreater.Stance != model.UnitStanceIdle {
		t.Fatalf("retreat arrival state wrong: pos=%+v stance=%s", retreater.Position, retreater.Stance)
	}
}

// R4：两名玩家的部队互相消灭，并能推掉对方基地建筑。
func TestR4PvPUnitsDestroyUnitsAndBase(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	squad1 := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 12})
	squad2 := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 13})
	defender := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 8, Y: 12})
	base := newBuilding("p2-base", model.BuildingTypeDepotMk1, "p2", model.Position{X: 9, Y: 12})
	base.HP = 60
	placeBuilding(ws, base)

	res, _ := execCommand(gc, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityIDs: []string{squad1.ID, squad2.ID}},
		Payload: map[string]any{"target_entity_id": defender.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("batch attack rejected: %+v", res)
	}
	advanceRTT(ws, 400)
	if ws.Units[defender.ID] != nil {
		t.Fatal("p2 defender survived focused attack")
	}

	// 推基地：集火建筑直至摧毁。
	res, _ = execCommand(gc, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityIDs: []string{squad1.ID, squad2.ID}},
		Payload: map[string]any{"target_entity_id": base.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("base attack rejected: %+v", res)
	}
	events := advanceRTT(ws, 600)
	if ws.Buildings[base.ID] != nil {
		t.Fatal("p2 base survived sustained attack")
	}
	baseDown := false
	for _, evt := range events {
		if evt.EventType == model.EvtEntityDestroyed && evt.Payload["entity_kind"] == "building" && evt.Payload["entity_type"] == string(base.Type) && evt.Payload["entity_id"] == base.ID {
			baseDown = true
		}
	}
	if !baseDown {
		t.Fatal("missing base destroyed event")
	}
}

// R5：批量指令与守卫跟随。
func TestR5BatchOrderAndGuardFollow(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	vip := spawnWorldTestUnit(ws, model.UnitTypeWorker, "p1", model.Position{X: 2, Y: 14})
	guard := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 6, Y: 14})

	res, _ := execCommand(gc, model.CmdUnitOrder, ws, "p1", model.Command{
		Type:    model.CmdUnitOrder,
		Target:  model.CommandTarget{EntityIDs: []string{guard.ID}},
		Payload: map[string]any{"order": "guard", "target_entity_id": vip.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("guard order rejected: %+v", res)
	}
	// 守卫贴近保护目标。
	advanceRTT(ws, 60)
	if d := ws.SurfaceDistance(guard.Position, vip.Position); d > 3 {
		t.Fatalf("guard did not close in on VIP: dist %d", d)
	}
	// 敌人接近 VIP：守卫自动接战。
	raider := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 3, Y: 14})
	advanceRTT(ws, 200)
	if ws.Units[raider.ID] != nil && ws.Units[guard.ID] == nil {
		t.Fatal("guard failed to defend VIP")
	}
}

// 记录项 B：被待命单位堵在唯一近路上时，绕开占位格重寻路，不再原地反复撞。
func TestBlockedUnitRepathsAroundIdleUnits(t *testing.T) {
	ws := newRTTWorld(false)
	// x=5 一列是墙，只在 y=5（被待命单位占住）和 y=11 留口。
	for y := 0; y < ws.MapHeight; y++ {
		if y != 5 && y != 11 && ws.InBounds(5, y) {
			ws.Grid[y][5].Terrain = terrain.TileBlocked
		}
	}
	blocker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 5, Y: 5})
	mover := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 5})
	dest := model.Position{X: 9, Y: 5}
	path, ok := computeUnitPath(ws, mover.Position, dest, mover.ID)
	if !ok {
		t.Fatal("no initial path")
	}
	mover.Path, mover.PathIndex, mover.Stance = path, 1, model.UnitStanceMoving
	advanceRTT(ws, 400)
	if ws.SurfaceDistance(mover.Position, dest) > 1 {
		t.Fatalf("mover stuck at %v behind idle unit %v (dest %v)", mover.Position, blocker.Position, dest)
	}
}
