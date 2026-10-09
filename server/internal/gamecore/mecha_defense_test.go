package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// mechaCraftDefenseWorld 一台正在手搓的 p1 机甲 + 一个 p2 敌兵场景。
func mechaCraftDefenseWorld(t *testing.T, enemyDist int) (*model.WorldState, *model.Unit, *model.Unit) {
	t.Helper()
	ws, mecha := mechaTestWorld()
	ws.Players["p1"].Tech = model.NewPlayerTechState("p1")
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	grantItems(ws, "p1", model.ItemAmount{ItemID: model.ItemIronOre, Quantity: 20})
	core := &GameCore{}
	res, _ := execCommand(core, model.CmdCraftItem, ws, "p1", model.Command{
		Target:  model.CommandTarget{EntityID: mecha.ID},
		Payload: map[string]any{"recipe_id": "smelt_iron", "quantity": 5},
	})
	if res.Code != model.CodeOK || mecha.Mecha.Job == nil {
		t.Fatalf("craft must start: %+v", res)
	}
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", ws.SurfaceOffset(mecha.Position, enemyDist, 0))
	enemy.Stance = model.UnitStanceHold
	enemy.Attack = 0
	enemy.MaxHP, enemy.HP = 400, 400
	return ws, mecha, enemy
}

// 试玩报告 E：手搓中的机甲被 aggro 范围内的敌人打断，靠近并还手，威胁消失后恢复手搓。
// 敌人保持在 5 格外不动（射程 4 外、aggro 6 内）——旧实现整局不还手。
func TestMechaCraftIsInterruptedByAggroAndResumesAfter(t *testing.T) {
	ws, mecha, enemy := mechaCraftDefenseWorld(t, 5)
	start := mecha.Position
	everPaused := false
	for i := 0; i < 60; i++ {
		advanceRTT(ws, 1)
		if mecha.Mecha.Job != nil && mecha.Mecha.Job.Paused {
			everPaused = true
		}
	}

	if !everPaused {
		t.Fatalf("crafting mecha must pause its job when an enemy enters aggro range, job=%+v", mecha.Mecha.Job)
	}
	if enemy.HP >= enemy.MaxHP {
		t.Fatalf("crafting mecha must return fire: enemy hp=%d/%d mecha=%+v", enemy.HP, enemy.MaxHP, mecha.Position)
	}
	if mecha.Position == start {
		t.Fatalf("crafting mecha must close in on the attacker, still at %+v", mecha.Position)
	}
	if mecha.Mecha.Job == nil || mecha.Mecha.Job.CompletedBatches != 0 {
		t.Fatalf("paused craft must not lose its progress: %+v", mecha.Mecha.Job)
	}

	// 威胁消失：恢复手搓（进度与预留原料保留，路径与锚点清空）。
	ws.Units[enemy.ID].HP = 0
	advanceRTT(ws, 20)
	if mecha.Mecha.Job == nil {
		t.Fatal("job must survive the defensive interruption")
	}
	if mecha.Mecha.Job.Paused || mecha.Mecha.Job.State != "running" {
		t.Fatalf("craft must resume once the threat is gone: %+v", mecha.Mecha.Job)
	}
	if mecha.HasPath() || mecha.CombatAnchor != nil {
		t.Fatalf("resumed craft must drop the chase path/anchor: path=%v anchor=%v", mecha.Path, mecha.CombatAnchor)
	}
}

// 能量耗尽时不会卡在"暂停手搓 + 不还手"的死状态：机甲收工恢复手搓（回能后续做）。
func TestMechaCraftDefenseNeverDeadlocksOnEmptyEnergy(t *testing.T) {
	ws, mecha, enemy := mechaCraftDefenseWorld(t, 5)
	enemy.MaxHP, enemy.HP = 100000, 100000 // 打不死，持续消耗机甲能量
	advanceRTT(ws, 4000)
	if mecha.Mecha.Job == nil {
		t.Fatalf("job must not be cancelled by defense: %+v", mecha.Mecha)
	}
	if mecha.Mecha.Job.Paused {
		t.Fatalf("craft must not stay paused forever with no energy: %+v", mecha.Mecha.Job)
	}
}

// 空闲机甲同样按 aggro 索敌（试玩报告 E）：敌人在射程外、aggro 内拆家时，
// 机甲要靠近到射程内开火，而不是站着不动。
func TestIdleMechaEngagesWithinAggroRange(t *testing.T) {
	ws, mecha := mechaTestWorld()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", ws.SurfaceOffset(mecha.Position, 5, 0))
	enemy.Stance = model.UnitStanceHold
	enemy.Attack = 0
	enemy.MaxHP, enemy.HP = 4000, 4000
	start := mecha.Position
	minDist := ws.SurfaceDistance(start, enemy.Position)
	damaged := false
	for i := 0; i < 200; i++ {
		events := advanceRTT(ws, 1)
		// 先记录距离再判断伤害：机甲进入射程的那一 tick 就会开火，
		// 先判断会漏掉它刚好走到射程内的位置（试玩报告 1011 C 后机甲边走边打）。
		if d := ws.SurfaceDistance(mecha.Position, enemy.Position); d < minDist {
			minDist = d
		}
		if damageEventsFor(events, enemy.ID) > 0 {
			damaged = true
			break
		}
	}
	if !damaged {
		t.Fatalf("idle mecha must engage a target inside aggro range: pos=%+v minDist=%d enemyHP=%d", mecha.Position, minDist, enemy.HP)
	}
	if minDist > mecha.AttackRange {
		t.Fatalf("idle mecha must close to its attack range, closest was %d (range %d)", minDist, mecha.AttackRange)
	}
}

// 追击有上限：目标跑出 aggro+leash 之外，机甲放弃追击并走回接战锚点。
func TestIdleMechaChaseIsLeashed(t *testing.T) {
	ws, mecha := mechaTestWorld()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", ws.SurfaceOffset(mecha.Position, 5, 0))
	enemy.Stance = model.UnitStanceHold
	enemy.Attack = 0
	enemy.MaxHP, enemy.HP = 100000, 100000
	start := mecha.Position
	for i := 0; i < 20 && mecha.CombatAnchor == nil; i++ {
		advanceRTT(ws, 1)
	}
	if mecha.CombatAnchor == nil {
		t.Fatalf("idle mecha must set an engagement anchor when it starts chasing: %+v", mecha)
	}
	// 把敌人挪到锚点外（模拟被一路钓走）：机甲必须放弃追击并走回锚点。
	far := ws.SurfaceDisc(*mecha.CombatAnchor, 64)[0]
	for _, p := range ws.SurfaceDisc(*mecha.CombatAnchor, 64) {
		if ws.SurfaceDistance(p, *mecha.CombatAnchor) > ws.SurfaceDistance(far, *mecha.CombatAnchor) {
			far = p
		}
	}
	if ws.SurfaceDistance(far, *mecha.CombatAnchor) <= mecha.AggroRange+leashSlack {
		t.Fatalf("test world too small: no tile beyond the leash (max %d)", ws.SurfaceDistance(far, *mecha.CombatAnchor))
	}
	teleportUnitForTest(ws, enemy, far)
	for i := 0; i < 400; i++ {
		advanceRTT(ws, 1)
		if !mecha.HasPath() && ws.SurfaceDistance(mecha.Position, start) <= 1 {
			break
		}
	}
	if d := ws.SurfaceDistance(mecha.Position, start); d > 2 {
		t.Fatalf("idle mecha must walk back to its engagement anchor: %+v (start %+v, d=%d)", mecha.Position, start, d)
	}
}

// 采集作业不因敌人出现而打断（离开矿点作业即失效），但机甲仍会在射程内还手。
func TestMechaMiningJobIsNotPausedByDefense(t *testing.T) {
	ws, mecha := mechaTestWorld()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	node := addManualCoal(ws, 5)
	node.Position = mecha.Position
	core := &GameCore{}
	if res, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(5)); res.Code != model.CodeOK {
		t.Fatalf("mine: %+v", res)
	}
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", ws.SurfaceOffset(mecha.Position, 3, 0))
	enemy.Stance = model.UnitStanceHold
	enemy.Attack = 0
	enemy.MaxHP, enemy.HP = 400, 400
	advanceRTT(ws, 200)
	if mecha.Mecha.Job == nil || mecha.Mecha.Job.Paused {
		t.Fatalf("mining must not be paused by defense: %+v", mecha.Mecha.Job)
	}
	if enemy.HP >= enemy.MaxHP {
		t.Fatalf("mining mecha must still return fire in range: hp=%d", enemy.HP)
	}
}

// 手搓中的机甲不会被敌人一路钓走：追击超出防御锚点范围就放弃、回到手搓。
func TestMechaDefenseLeashReturnsToCraft(t *testing.T) {
	ws, mecha, enemy := mechaCraftDefenseWorld(t, 5)
	for i := 0; i < 30 && (mecha.Mecha.Job == nil || !mecha.Mecha.Job.Paused); i++ {
		advanceRTT(ws, 1) // 进入防御：暂停手搓、建立锚点
	}
	if mecha.CombatAnchor == nil || mecha.Mecha.Job == nil || !mecha.Mecha.Job.Paused {
		t.Fatalf("mecha should be defending: anchor=%v job=%+v", mecha.CombatAnchor, mecha.Mecha.Job)
	}
	// 把机甲挪到锚点外（模拟已被引离手搓点）：即使敌人还在 aggro 内也必须放弃追击。
	var far model.Position
	for _, p := range ws.SurfaceDisc(*mecha.CombatAnchor, 20) {
		if ws.SurfaceDistance(p, *mecha.CombatAnchor) > mecha.AggroRange+leashSlack {
			far = p
			break
		}
	}
	mecha.Position = far
	advanceRTT(ws, 5)
	if mecha.HasPath() {
		t.Fatalf("mecha must abandon an over-extended chase: path=%d", len(mecha.Path))
	}
	if mecha.Mecha.Job == nil || mecha.Mecha.Job.Paused {
		t.Fatalf("mecha must be back on its craft after the leash breaks: %+v", mecha.Mecha.Job)
	}
	_ = enemy
}
