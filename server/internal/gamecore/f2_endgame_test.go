package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// eliminatePlayerForTest 清空玩家在在场判定中的实体（HQ 与机甲），
// 使下一次 resolveVictory 将其淘汰。仅测试用。
func eliminatePlayerForTest(ws *model.WorldState, playerID string) {
	for id, b := range ws.Buildings {
		if b.OwnerID == playerID {
			delete(ws.Buildings, id)
			ws.UnindexBuilding(b)
		}
	}
	for id, u := range ws.Units {
		if u.OwnerID == playerID {
			delete(ws.Units, id)
		}
	}
}

func f2CommandRequest(playerID string) *model.QueuedRequest {
	return &model.QueuedRequest{
		PlayerID: playerID,
		Request: model.CommandRequest{
			RequestID:  "f2-req-1",
			IssuerType: "player",
			IssuerID:   playerID,
			Commands: []model.Command{{
				Type:   model.CmdMove,
				Target: model.CommandTarget{Position: &model.Position{X: 1, Y: 1}},
			}},
		},
	}
}

// TestF2CommandsRejectedAfterFinished 淘汰胜利宣判后：对局进入 finished，
// 执行阶段统一以 GAME_FINISHED 拒绝常规游戏命令，并冻结结算报告。
func TestF2CommandsRejectedAfterFinished(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	// 宣判前命令正常受理（走权限/路由等常规校验，不是 GAME_FINISHED）。
	res, _ := core.executeRequest(f2CommandRequest("p1"))
	if len(res) != 1 || res[0].Code == model.CodeGameFinished {
		t.Fatalf("pre-victory command must not hit GAME_FINISHED, got %+v", res)
	}

	eliminatePlayerForTest(ws, "p2")
	core.processTick()

	if !core.Finished() {
		t.Fatal("game must be finished after elimination victory")
	}
	victory := core.Victory()
	if victory.WinnerID != "p1" || victory.Reason != model.VictoryReasonElimination {
		t.Fatalf("unexpected victory: %+v", victory)
	}
	if victory.DeclaredTick != ws.Tick {
		t.Fatalf("declared tick mismatch: victory=%d world=%d", victory.DeclaredTick, ws.Tick)
	}

	res, _ = core.executeRequest(f2CommandRequest("p1"))
	if len(res) != 1 || res[0].Status != model.StatusRejected || res[0].Code != model.CodeGameFinished {
		t.Fatalf("post-victory command must be rejected GAME_FINISHED, got %+v", res)
	}

	// 再推进 tick：finished 保持，world 继续模拟但不接受命令。
	core.processTick()
	res, _ = core.executeRequest(f2CommandRequest("p2"))
	if len(res) != 1 || res[0].Code != model.CodeGameFinished {
		t.Fatalf("finished must keep rejecting, got %+v", res)
	}
}

// TestF2MissionCompleteFinishesGame mission_complete 宣判路径同样进入 finished 并拒令。
func TestF2MissionCompleteFinishesGame(t *testing.T) {
	core := newSaveStateHarness(t)
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleMissionComplete
	ws := core.World()

	grantTechs(ws, "p1", "universe_matrix")
	lab := newBuilding("lab-f2", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research.ResearchPerTick = 10
	if _, _, err := lab.Storage.Load(model.ItemUniverseMatrix, 1); err != nil {
		t.Fatalf("load universe matrix: %v", err)
	}
	placeBuilding(ws, lab)

	ws.Players["p1"].Tech.CurrentResearch = &model.PlayerResearch{
		TechID:       "mission_complete",
		State:        model.ResearchInProgress,
		TotalCost:    1,
		RequiredCost: []model.ItemAmount{{ItemID: model.ItemUniverseMatrix, Quantity: 1}},
		ConsumedCost: map[string]int{},
	}

	core.processTick()

	victory := core.Victory()
	if victory.WinnerID != "p1" || victory.Reason != model.VictoryReasonGameWin || victory.TechID != "mission_complete" {
		t.Fatalf("unexpected mission victory: %+v", victory)
	}
	if !core.Finished() {
		t.Fatal("mission_complete victory must finish the game")
	}
	if victory.DeclaredTick != ws.Tick {
		t.Fatalf("declared tick mismatch: victory=%d world=%d", victory.DeclaredTick, ws.Tick)
	}

	res, _ := core.executeRequest(f2CommandRequest("p1"))
	if len(res) != 1 || res[0].Code != model.CodeGameFinished {
		t.Fatalf("mission_complete path must also reject commands, got %+v", res)
	}

	report := core.Settlement()
	if report == nil {
		t.Fatal("settlement report must be frozen at declaration")
	}
	if report.Reason != model.VictoryReasonGameWin || report.VictoryRule != model.VictoryRuleMissionComplete || report.TechID != "mission_complete" {
		t.Fatalf("unexpected settlement payload: %+v", report)
	}
}

// TestF2SandboxNeverFinishes sandbox 规则永不宣判、永不 finished。
func TestF2SandboxNeverFinishes(t *testing.T) {
	core := newE2ETestCore(t)
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()

	eliminatePlayerForTest(ws, "p2")
	core.processTick()
	core.processTick()

	if core.Finished() || core.Victory().Declared() {
		t.Fatalf("sandbox must never declare victory, got %+v", core.Victory())
	}
	if core.Settlement() != nil {
		t.Fatal("sandbox must not produce a settlement report")
	}
}

// TestF2BilateralCombatStats 覆盖单位/建筑/小队/黑雾四条击杀路径的双边计数口径：
//   - 玩家单位互杀：击杀方 units_killed++，受害方 units_lost++；
//   - 玩家单位拆建筑：击杀方 buildings_destroyed++，受害方 buildings_lost++；
//   - 小队整编被毁：计 1 个单位击杀/损失；
//   - 黑雾击杀玩家单位：只计受害方 losses，不进任何玩家 kills；
//   - 玩家击杀黑雾单位：计击杀方 kills。
func TestF2BilateralCombatStats(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	provokeDarkFogFor(ws, "p1", "p2") // 玩家已与黑雾交战

	addUnit := func(id, owner string, pos model.Position, hp int) *model.Unit {
		u := model.UnitStats(model.UnitTypeSoldier)
		u.ID, u.OwnerID = id, owner
		u.Position = pos
		u.HP, u.MaxHP = hp, hp
		ws.Units[id] = &u
		key := model.TileKey(pos.X, pos.Y)
		ws.TileUnits[key] = append(ws.TileUnits[key], id)
		return &u
	}
	combatStats := func(pid string) model.CombatStats {
		return ws.Players[pid].Stats.CombatStats
	}

	// 1) 单位互杀（settleUnitCombat 端到端）：p1 士兵一枪击毙 1HP 的 p2 士兵。
	attacker := addUnit("att-1", "p1", model.Position{X: 3, Y: 3}, 100)
	victim := addUnit("vic-1", "p2", model.Position{X: 4, Y: 3}, 1)
	settleUnitCombat(ws)
	if _, ok := ws.Units[victim.ID]; ok {
		t.Fatal("victim unit must be removed after lethal hit")
	}
	if got := combatStats("p1").UnitsKilled; got != 1 {
		t.Fatalf("p1 units_killed = %d, want 1", got)
	}
	if got := combatStats("p2").UnitsLost; got != 1 {
		t.Fatalf("p2 units_lost = %d, want 1", got)
	}
	if got := combatStats("p1").UnitsLost; got != 0 {
		t.Fatalf("p1 units_lost = %d, want 0", got)
	}

	// 2) 单位拆建筑（settleUnitCombat 端到端）：p1 士兵摧毁 p2 的 1HP 建筑。
	building := newBuilding("bld-vic", model.BuildingTypeSolarPanel, "p2", model.Position{X: 4, Y: 4})
	building.HP = 1
	placeBuilding(ws, building)
	attacker.AttackTarget = building.ID
	attacker.Stance = model.UnitStanceHold
	settleUnitCombat(ws)
	if _, ok := ws.Buildings[building.ID]; ok {
		t.Fatal("victim building must be removed after lethal hit")
	}
	if got := combatStats("p1").BuildingsDestroyed; got != 1 {
		t.Fatalf("p1 buildings_destroyed = %d, want 1", got)
	}
	if got := combatStats("p2").BuildingsLost; got != 1 {
		t.Fatalf("p2 buildings_lost = %d, want 1", got)
	}

	// 3) 黑雾反击击杀玩家单位：只计受害方 losses。
	// 反击冷却为 10 tick（LastAttackTick=0），推进世界 tick 绕过节流。
	ws.Tick += 100
	dfVictim := addUnit("vic-df", "p2", model.Position{X: 10, Y: 10}, 1)
	ws.EnemyForces = &model.EnemyForceState{
		Forces: []model.EnemyForce{{
			ID:       "hive-f2",
			Position: model.Position{X: 10, Y: 10},
			Strength: 400,
		}},
	}
	settleEnemyForceRetaliation(ws)
	if _, ok := ws.Units[dfVictim.ID]; ok {
		t.Fatal("dark fog retaliation must kill the 1HP victim")
	}
	if got := combatStats("p2").UnitsLost; got != 2 {
		t.Fatalf("p2 units_lost = %d, want 2 (dark fog kill counts victim side only)", got)
	}
	if got := combatStats("p1").UnitsKilled; got != 1 {
		t.Fatalf("p1 units_killed must stay 1, got %d", got)
	}

	// 4) 玩家击杀黑雾单位：计击杀方 kills（结算击杀包含黑雾）。
	dfUnit := addUnit("df-unit", model.DarkFogOwnerID, model.Position{X: 3, Y: 3}, 1)
	attacker.AttackTarget = dfUnit.ID
	attacker.LastAttackTick = 0
	settleUnitCombat(ws)
	if _, ok := ws.Units[dfUnit.ID]; ok {
		t.Fatal("dark fog unit must be removed after lethal hit")
	}
	if got := combatStats("p1").UnitsKilled; got != 2 {
		t.Fatalf("killing dark fog must credit p1, got %d", got)
	}
	if got := combatStats("p2").UnitsLost; got != 2 {
		t.Fatalf("p2 units_lost must stay 2, got %d", got)
	}
}

// TestF2StatsSurviveSaveRestore 战损计数、finished 状态与结算报告随存档往返一致。
func TestF2StatsSurviveSaveRestore(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()

	// 直接经统一入口制造战损：p1 杀 p2 单位 + 拆 p2 建筑；黑雾杀 p1 单位。
	victim := model.UnitStats(model.UnitTypeSoldier)
	victim.ID, victim.OwnerID = "vic-save", "p2"
	victim.Position = model.Position{X: 2, Y: 2}
	ws.Units[victim.ID] = &victim
	killUnit(ws, &victim, "killer-1", "p1", "unit")

	building := newBuilding("bld-save", model.BuildingTypeSolarPanel, "p2", model.Position{X: 3, Y: 3})
	placeBuilding(ws, building)
	destroyBuildingCombat(ws, building, "killer-1", "p1", "unit")

	p1Victim := model.UnitStats(model.UnitTypeSoldier)
	p1Victim.ID, p1Victim.OwnerID = "vic-save-p1", "p1"
	p1Victim.Position = model.Position{X: 4, Y: 4}
	ws.Units[p1Victim.ID] = &p1Victim
	killUnit(ws, &p1Victim, "hive-1", model.DarkFogOwnerID, "enemy_force")

	// 宣判胜利（淘汰路径），冻结结算报告。
	eliminatePlayerForTest(ws, "p2")
	core.processTick()
	if !core.Finished() {
		t.Fatal("game must be finished before save")
	}
	wantReport := core.Settlement()
	if wantReport == nil {
		t.Fatal("settlement must exist after declaration")
	}

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	if save.RuntimeState.VictoryDeclaredTick != core.Victory().DeclaredTick {
		t.Fatalf("runtime state declared tick mismatch: %+v", save.RuntimeState)
	}
	if save.RuntimeState.Settlement == nil || save.RuntimeState.Settlement.WinnerID != "p1" {
		t.Fatalf("runtime state must carry settlement: %+v", save.RuntimeState.Settlement)
	}

	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	restored, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !restored.Finished() {
		t.Fatal("restored core must stay finished")
	}
	rv := restored.Victory()
	if rv.WinnerID != "p1" || rv.DeclaredTick != core.Victory().DeclaredTick {
		t.Fatalf("restored victory mismatch: %+v", rv)
	}
	gotReport := restored.Settlement()
	if gotReport == nil {
		t.Fatal("restored settlement missing")
	}
	if gotReport.WinnerID != wantReport.WinnerID ||
		gotReport.DeclaredTick != wantReport.DeclaredTick ||
		gotReport.DurationTicks != wantReport.DurationTicks ||
		len(gotReport.Players) != len(wantReport.Players) {
		t.Fatalf("restored settlement mismatch: got %+v want %+v", gotReport, wantReport)
	}
	for i := range wantReport.Players {
		if gotReport.Players[i] != wantReport.Players[i] {
			t.Fatalf("settlement player %d mismatch: got %+v want %+v", i, gotReport.Players[i], wantReport.Players[i])
		}
	}

	// 恢复后的玩家统计本身（live 计数器）也要与存档前一致。
	rws := restored.World()
	if got := rws.Players["p1"].Stats.CombatStats.UnitsKilled; got != 1 {
		t.Fatalf("restored p1 units_killed = %d, want 1", got)
	}
	if got := rws.Players["p1"].Stats.CombatStats.UnitsLost; got != 1 {
		t.Fatalf("restored p1 units_lost = %d, want 1 (dark fog kill)", got)
	}
	if got := rws.Players["p2"].Stats.CombatStats.UnitsLost; got != 1 {
		t.Fatalf("restored p2 units_lost = %d, want 1", got)
	}
	if got := rws.Players["p2"].Stats.CombatStats.BuildingsLost; got != 1 {
		t.Fatalf("restored p2 buildings_lost = %d, want 1", got)
	}
	if got := rws.Players["p1"].Stats.CombatStats.BuildingsDestroyed; got != 1 {
		t.Fatalf("restored p1 buildings_destroyed = %d, want 1", got)
	}
}

// TestF2SettlementReportFrozenAtDeclaration 结算报告在宣判时刻冻结：
// 终局后世界继续模拟产生的伤亡不再进入报告，但 live 计数器继续累积。
func TestF2SettlementReportFrozenAtDeclaration(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()

	// 宣判前 p1 杀一个 p2 单位。
	victim := model.UnitStats(model.UnitTypeSoldier)
	victim.ID, victim.OwnerID = "vic-freeze", "p2"
	victim.Position = model.Position{X: 2, Y: 2}
	ws.Units[victim.ID] = &victim
	killUnit(ws, &victim, "killer-1", "p1", "unit")

	eliminatePlayerForTest(ws, "p2")
	declareTick := ws.Tick + 1
	core.processTick()

	report := core.Settlement()
	if report == nil {
		t.Fatal("settlement must exist")
	}
	if report.DeclaredTick != declareTick || report.StartTick != 0 || report.DurationTicks != declareTick {
		t.Fatalf("timeline mismatch: %+v", report)
	}
	var p1Entry, p2Entry *model.SettlementPlayerStats
	for i := range report.Players {
		switch report.Players[i].PlayerID {
		case "p1":
			p1Entry = &report.Players[i]
		case "p2":
			p2Entry = &report.Players[i]
		}
	}
	if p1Entry == nil || p2Entry == nil {
		t.Fatalf("report must cover both players: %+v", report.Players)
	}
	if !p1Entry.Winner || p1Entry.UnitsKilled != 1 || p1Entry.UnitsLost != 0 {
		t.Fatalf("p1 settlement entry mismatch: %+v", p1Entry)
	}
	if p2Entry.Winner || p2Entry.IsAlive || p2Entry.UnitsLost != 1 {
		t.Fatalf("p2 settlement entry mismatch: %+v", p2Entry)
	}

	// 终局后黑雾再杀一个 p1 单位：live 计数 +1，报告保持冻结。
	later := model.UnitStats(model.UnitTypeSoldier)
	later.ID, later.OwnerID = "vic-after", "p1"
	later.Position = model.Position{X: 3, Y: 3}
	ws.Units[later.ID] = &later
	killUnit(ws, &later, "hive-2", model.DarkFogOwnerID, "enemy_force")

	if got := ws.Players["p1"].Stats.CombatStats.UnitsLost; got != 1 {
		t.Fatalf("live p1 units_lost = %d, want 1", got)
	}
	frozen := core.Settlement()
	for i := range frozen.Players {
		if frozen.Players[i].PlayerID == "p1" && frozen.Players[i].UnitsLost != 0 {
			t.Fatalf("settlement must stay frozen at declaration, got %+v", frozen.Players[i])
		}
	}
}

// TestF2RollbackRestoresStatsAndFinished 回滚到宣判前：战损计数随玩家快照恢复，
// finished 与结算报告一起清除；世界继续推进不携带旧终局状态。
func TestF2RollbackRestoresStatsAndFinished(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()

	// tick 1：快照基线（无战损、未宣判）。
	core.processTick()

	// tick 2 前制造战损，tick 2 宣判胜利。
	victim := model.UnitStats(model.UnitTypeSoldier)
	victim.ID, victim.OwnerID = "vic-rb", "p2"
	victim.Position = model.Position{X: 2, Y: 2}
	ws.Units[victim.ID] = &victim
	killUnit(ws, &victim, "killer-1", "p1", "unit")
	eliminatePlayerForTest(ws, "p2")
	core.processTick()
	if !core.Finished() {
		t.Fatal("game must be finished at tick 2")
	}
	if got := ws.Players["p1"].Stats.CombatStats.UnitsKilled; got != 1 {
		t.Fatalf("p1 units_killed = %d, want 1", got)
	}
	core.processTick() // tick 3：finished 继续

	if _, err := core.Rollback(model.RollbackRequest{ToTick: 1}); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	if core.Finished() {
		t.Fatalf("rollback to pre-declaration tick must clear finished, got %+v", core.Victory())
	}
	if core.Settlement() != nil {
		t.Fatal("rollback to pre-declaration tick must clear settlement")
	}
	rws := core.World()
	if got := rws.Players["p1"].Stats.CombatStats.UnitsKilled; got != 0 {
		t.Fatalf("rolled back p1 units_killed = %d, want 0", got)
	}
	if got := rws.Players["p2"].Stats.CombatStats.UnitsLost; got != 0 {
		t.Fatalf("rolled back p2 units_lost = %d, want 0", got)
	}
	// 回滚后 p2 的实体回来了（快照恢复），继续推进不再宣判。
	if !rws.Players["p2"].IsAlive {
		t.Fatal("p2 must be alive again after rollback")
	}
	core.processTick()
	if core.Finished() {
		t.Fatal("no re-declaration expected while both players present")
	}
}
