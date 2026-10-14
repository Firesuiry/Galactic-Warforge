package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1015 §6-1 回归：bot 首攻门槛（BotFirstAttackTick）必须拦住**所有**进攻
// 路径，而不只是军团。
//
// 背景：旧实现里 botLegion 的 SquadOrderAttack 看门槛（bot_legion.go），
// 但散兵的 attack_move（botMilitary → botRecallIDs）只看 defendRadius。实测
// （1015 A 段，skirmish 30000 门槛）bot 在 tick 30019 就编队出击、30251 开始
// 拆玩家的制造台——首攻门槛对散兵路径形同虚设，与 1014 的
// bug-1014-lost-first-attack 是同一根因面。
//
// 修复：抽出门控 botMayAdvanceTo（门槛开 = 放行；未开 = 只允许防区内的防守
// 反击），散兵与军团共用；同时门槛未开时由 applyBotOffenseGate 把
// botSurvey.enemyPlayers 清空，让「远征目标」根本不存在（botAttackObjective
// 与袭扰补给线都从这里取目标）。
//
// 本文件是这组修复的定向回归：门槛前不离开防区、不碰玩家建筑；门槛后正常进攻。

// botGateTestCore 小图 bot 局，首攻门槛压到可观测的 tick。
func botGateTestCore(t *testing.T, gate int64) (*GameCore, *model.WorldState, botTuning) {
	t.Helper()
	core := newBotTestCore(t, "easy")
	core.cfg.Battlefield.BotFirstAttackTick = gate
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	return core, ws, botTuningFor("easy")
}

// botP1BuildingHP p1 全部建筑的当前血量快照（判定「有没有被拆」）。
func botP1BuildingHP(ws *model.WorldState) map[string]int {
	hp := map[string]int{}
	for id, b := range ws.Buildings {
		if b != nil && b.OwnerID == "p1" {
			hp[id] = b.HP
		}
	}
	return hp
}

// TestBotFirstAttackGateBlocksLooseAttackMove 门槛前：散兵不得对防区外目标
// 下发 attack_move（旧的散兵路径 bug 就死在这里）。
func TestBotFirstAttackGateBlocksLooseAttackMove(t *testing.T) {
	core, ws, tuning := botGateTestCore(t, 100000)
	home := botPlayerHome(t, ws, "p2")
	// 敌军（p1 单位）放在防区外：旧实现会照样下发 attack_move 追出去。
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", botTileAtDistance(t, ws, home, tuning.defendRadius+24))
	// 己方散兵放得更远，确保「不在目标附近」这一条成立（否则 botRecallIDs 不会召回）。
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", botTileAtDistance(t, ws, home, 72))
	ws.Tick = 100 // 远低于门槛

	cmds := core.planBotCommands(ws, "p2", tuning)
	if cmd, ok := botFirstCmd(cmds, model.CmdUnitOrder); ok {
		t.Fatalf("首攻门槛前散兵不该对防区外目标下 unit_order: %+v", cmd)
	}
	// 军团路径同样被拦：门槛前不能出现 attack 军令，也不能编队（编队必然跟着进攻）。
	if cmd, ok := botSquadCmd(cmds); ok && cmd.Payload["order"] == "attack" {
		t.Fatalf("首攻门槛前不该下 attack 军令: %+v", cmd)
	}
	if _, ok := botFirstCmd(cmds, model.CmdFormSquad); ok {
		t.Fatal("首攻门槛前不该编军团（编队即准备远征）")
	}
}

// TestBotFirstAttackGateAllowsDefendInsideRadius 门槛前：敌人进防区时仍要防守
// 反击（门槛是「不主动进攻」，不是「挨打不还手」）。
func TestBotFirstAttackGateAllowsDefendInsideRadius(t *testing.T) {
	core, ws, tuning := botGateTestCore(t, 100000)
	home := botPlayerHome(t, ws, "p2")
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", botTileAtDistance(t, ws, home, 6))
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", botTileAtDistance(t, ws, home, 48))
	ws.Tick = 100

	cmds := core.planBotCommands(ws, "p2", tuning)
	cmd, ok := botFirstCmd(cmds, model.CmdUnitOrder)
	if !ok || cmd.Payload["order"] != "attack_move" || cmd.Target.Position == nil {
		t.Fatalf("防区内的来袭者必须触发防守反击: %+v", cmds)
	}
	if ws.SurfaceDistance(*cmd.Target.Position, enemy.Position) != 0 {
		t.Fatalf("防守反击目标 = %+v，应为来袭者 %+v", *cmd.Target.Position, enemy.Position)
	}
}

// TestBotFirstAttackGateBlocksLegionAttack 门槛前：botAttackObjective 拿不到
// 敌方建筑（enemyPlayers 被清空），军团不会出击——即使军团状态健康。
func TestBotFirstAttackGateBlocksLegionAttack(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "easy")
	ws.Tick = 100
	core.cfg.Battlefield.BotFirstAttackTick = 100000
	for _, id := range squad.MemberIDs {
		u := ws.Units[id]
		u.MaxHP, u.HP = 100, 100
		if u.Type != model.UnitTypeSupplyTruck {
			u.AmmoCapacity, u.Ammo = 100, 100
		}
	}
	squad.Order = model.SquadOrderIdle
	squad.Target = nil

	cmds := core.planBotCommands(ws, "p2", tuning)
	if cmd, ok := botSquadCmd(cmds); ok && cmd.Payload["order"] == "attack" {
		t.Fatalf("首攻门槛前军团不该出击: %+v", cmd)
	}
	if core.botOffenseGateOpen(ws) {
		t.Fatal("门槛未开时 botOffenseGateOpen 应为 false")
	}
	// 门控的第二层：门槛未开时 enemyPlayers 被清空，「远征目标」根本不存在——
	// 即使将来有别的路径去取目标也取不到。
	ctx := core.surveyBotWorld(ws, "p2")
	core.applyBotOffenseGate(ws, ctx)
	if target := core.botAttackObjective(ws, "p2", tuning, ctx); target != nil {
		t.Fatalf("门槛前 botAttackObjective 应为空，got %+v", *target)
	}
}

// TestBotFirstAttackGateBlocksSquadFormation 门槛前：散兵够 attackAt 也不编队
// （编队的下一步必然是军团 attack，等于提前开战；1015 §6-1 的 t30019 编队
// → t30251 拆家就是这么来的）。
func TestBotFirstAttackGateBlocksSquadFormation(t *testing.T) {
	core, ws, tuning := botGateTestCore(t, 100000)
	home := botPlayerHome(t, ws, "p2")
	for i := 0; i < tuning.attackAt; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", botTileAtDistance(t, ws, home, 6+i))
	}
	ws.Tick = 100
	cmds := core.planBotCommands(ws, "p2", tuning)
	if _, ok := botFirstCmd(cmds, model.CmdFormSquad); ok {
		t.Fatalf("首攻门槛前不该编队（编队即准备远征）: %+v", cmds)
	}
	// 门槛一开，同样的局面就该编队了。
	ws.Tick = 200000
	cmds = core.planBotCommands(ws, "p2", tuning)
	if _, ok := botFirstCmd(cmds, model.CmdFormSquad); !ok {
		t.Fatalf("门槛后散兵够 attackAt 就该编队: %+v", cmds)
	}
}

// TestBotFirstAttackGateOpensAfterTick 门槛后：进攻恢复正常（军团出击、散兵可
// 远征），否则修复会退化成「bot 永远不打」。
func TestBotFirstAttackGateOpensAfterTick(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "easy")
	for _, id := range squad.MemberIDs {
		u := ws.Units[id]
		u.MaxHP, u.HP = 100, 100
		if u.Type != model.UnitTypeSupplyTruck {
			u.AmmoCapacity, u.Ammo = 100, 100
		}
	}
	squad.Order = model.SquadOrderIdle
	squad.Target = nil
	ws.Tick = 50000
	core.cfg.Battlefield.BotFirstAttackTick = 100

	if !core.botOffenseGateOpen(ws) {
		t.Fatal("门槛后 botOffenseGateOpen 应为 true")
	}
	cmds := core.planBotCommands(ws, "p2", tuning)
	if cmd, ok := botSquadCmd(cmds); !ok || cmd.Payload["order"] != "attack" || cmd.Target.Position == nil {
		t.Fatalf("门槛后军团必须照常出击: %+v", cmds)
	}
}

// TestBotFirstAttackGateEndToEnd 端到端：小图 bot 局里，门槛前 p2 不发出任何
// 防区外的进攻指令、玩家建筑一滴血不掉；门槛过后 bot 真的打过来（门槛没有被
// 写成「永久停战」）。
//
// 门槛取 9000：easy bot 在 tick ~8000 才攒出第一个兵，门槛前的窗口里必须有
// 部队存在，否则「不离开防区」的断言会因为「没有部队」而空转。
func TestBotFirstAttackGateEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("短模式跳过整局模拟")
	}
	core, ws, tuning := botGateTestCore(t, 9000)
	home := botPlayerHome(t, ws, "p2")
	gate := core.cfg.Battlefield.BotFirstAttackTick
	startHP := botP1BuildingHP(ws)
	preGateSoldiers := 0
	preGateOffensive := int64(-1)
	preGateDamage := int64(-1)
	postGateOrder := int64(-1)
	postGateOrderDist := 0
	for ws.Tick < gate+6000 {
		core.processTick()
		preGate := ws.Tick < gate
		if preGate {
			for _, u := range ws.Units {
				if u != nil && u.OwnerID == "p2" && u.HP > 0 && u.Mecha == nil && u.Domain == model.UnitDomainGround {
					preGateSoldiers++
					break
				}
			}
		}
		for id, hp := range startHP {
			b := ws.Buildings[id]
			if b == nil || b.HP >= hp {
				continue
			}
			if preGate && preGateDamage < 0 {
				preGateDamage = ws.Tick
			}
		}
		for _, entry := range core.GetCommandLog().All() {
			if entry.Tick != ws.Tick || entry.PlayerID != "p2" {
				continue
			}
			for _, cmd := range entry.Commands {
				if cmd.Target.Position == nil {
					continue
				}
				offensive := (cmd.Type == model.CmdUnitOrder && cmd.Payload["order"] == "attack_move") ||
					(cmd.Type == model.CmdSquadOrder && cmd.Payload["order"] == "attack")
				if !offensive {
					continue
				}
				d := ws.SurfaceDistance(*cmd.Target.Position, home)
				if d <= tuning.defendRadius {
					continue // 防区内的防守反击：门槛不拦
				}
				if preGate && preGateOffensive < 0 {
					preGateOffensive = ws.Tick
				}
				if !preGate && postGateOrder < 0 {
					postGateOrder, postGateOrderDist = ws.Tick, d
				}
			}
		}
	}
	t.Logf("gate=%d defendRadius=%d 门槛前有部队的 tick 数=%d 门槛前防区外进攻指令=%d 门槛前玩家建筑受损=%d 门槛后首次远征指令=%d（目标距基地 %d）",
		gate, tuning.defendRadius, preGateSoldiers, preGateOffensive, preGateDamage, postGateOrder, postGateOrderDist)
	if preGateSoldiers == 0 {
		t.Fatal("门槛前 bot 一个兵都没造出来：本测试的「不出防区」断言会空转")
	}
	if preGateOffensive >= 0 {
		t.Fatalf("首攻门槛前就下发了防区外的进攻指令（tick %d）：进攻路径绕过了门槛", preGateOffensive)
	}
	if preGateDamage >= 0 {
		t.Fatalf("首攻门槛前玩家建筑就挨打了（tick %d）：进攻路径绕过了门槛", preGateDamage)
	}
	if postGateOrder < 0 {
		t.Fatal("首攻门槛后 bot 再没发起过防区外的进攻：门槛把进攻写死了")
	}
	if postGateOrder < gate {
		t.Fatalf("远征指令 tick %d 早于门槛 %d", postGateOrder, gate)
	}
}

// TestBotFirstAttackGateAppliesToSkirmishPreset 遭遇战预设（config-skirmish +
// map-skirmish，门槛 60000）：跑满门槛窗口，p2 不得对 p1 建筑造成任何伤害，
// 也不得出现防区外的进攻指令。这是 1015 §6-1 现场（门槛 30000，tick 30251
// 制造台挨打）在真实预设上的复刻，跑得慢（~90s），短模式跳过。
func TestBotFirstAttackGateAppliesToSkirmishPreset(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战预设模拟")
	}
	core := newRealSkirmishCore(t)
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	gate := core.cfg.Battlefield.BotFirstAttackTick
	home := botPlayerHome(t, ws, "p2")
	startHP := botP1BuildingHP(ws)
	damaged := int64(-1)
	offensive := int64(-1)
	soldiers := 0
	for ws.Tick < gate {
		core.processTick()
		for id, hp := range startHP {
			if b := ws.Buildings[id]; b != nil && b.HP < hp && damaged < 0 {
				damaged = ws.Tick
			}
		}
		for _, entry := range core.GetCommandLog().All() {
			if entry.Tick != ws.Tick || entry.PlayerID != "p2" {
				continue
			}
			for _, cmd := range entry.Commands {
				if cmd.Target.Position == nil {
					continue
				}
				isAttack := (cmd.Type == model.CmdUnitOrder && cmd.Payload["order"] == "attack_move") ||
					(cmd.Type == model.CmdSquadOrder && cmd.Payload["order"] == "attack")
				if isAttack && ws.SurfaceDistance(*cmd.Target.Position, home) > 42 && offensive < 0 {
					offensive = ws.Tick
				}
			}
		}
		for _, u := range ws.Units {
			if u != nil && u.OwnerID == "p2" && u.HP > 0 && u.Mecha == nil && u.Domain == model.UnitDomainGround {
				soldiers++
				break
			}
		}
	}
	t.Logf("skirmish 门槛=%d 有部队的 tick 数=%d 门槛前防区外进攻指令=%d 门槛前 p1 建筑受损=%d", gate, soldiers, offensive, damaged)
	if soldiers == 0 {
		t.Fatal("门槛前 bot 一个兵都没造出来：断言会空转")
	}
	if offensive >= 0 {
		t.Fatalf("遭遇战预设下门槛前出现防区外进攻指令（tick %d）", offensive)
	}
	if damaged >= 0 {
		t.Fatalf("遭遇战预设下门槛前 p1 建筑就挨打了（tick %d）：正是 1015 §6-1 的现场", damaged)
	}
}
