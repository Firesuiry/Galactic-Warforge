package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 3.6 A1：bot 军团——form_squad 编队、squad_order 四种军令、三档差异。

// botLegionScene 在 p2 基地旁造一个已编队军团（士兵 + 补给车），p1 无单位。
func botLegionScene(t *testing.T, difficulty string) (*GameCore, *model.WorldState, botTuning, *model.CombatSquad) {
	t.Helper()
	core, ws, tuning, _, _, _ := botRaidScene(t, difficulty)
	botQuietExecutor(ws, "p2")
	cmds := core.planBotCommands(ws, "p2", tuning)
	var form *model.Command
	for i := range cmds {
		if cmds[i].Type == model.CmdFormSquad {
			form = &cmds[i]
		}
	}
	if form == nil {
		t.Fatalf("bot did not form a legion: %+v", cmds)
	}
	botExec(core, ws, *form)
	if len(ws.CombatRuntime.Squads) != 1 {
		t.Fatalf("want 1 squad, got %d", len(ws.CombatRuntime.Squads))
	}
	for _, s := range ws.CombatRuntime.Squads {
		return core, ws, tuning, s
	}
	return nil, nil, tuning, nil
}

// botExec 绕过队列，按玩家同一入口直接执行 bot 命令。
func botExec(core *GameCore, ws *model.WorldState, cmd model.Command) {
	core.executeRequest(&model.QueuedRequest{
		Request:     model.CommandRequest{RequestID: "bot-test", IssuerType: "bot", IssuerID: "p2", Commands: []model.Command{cmd}},
		PlayerID:    "p2",
		EnqueueTick: ws.Tick,
	})
}

func botSquadCmd(cmds []model.Command) (model.Command, bool) {
	return botFirstCmd(cmds, model.CmdSquadOrder)
}

func TestBotFormsLegionWithTruck(t *testing.T) {
	for _, d := range []string{"easy", "normal", "hard"} {
		t.Run(d, func(t *testing.T) {
			_, ws, tuning, squad := botLegionScene(t, d)
			if len(squad.MemberIDs) != tuning.attackAt {
				t.Fatalf("members %d, want %d", len(squad.MemberIDs), tuning.attackAt)
			}
			truck := false
			for _, id := range squad.MemberIDs {
				if ws.Units[id].Type == model.UnitTypeSupplyTruck {
					truck = true
				}
			}
			if !truck {
				t.Fatal("legion needs its supply truck")
			}
		})
	}
}

func TestBotLegionOrdersFollowState(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "normal")
	plan := func() (model.Command, bool) { return botSquadCmd(core.planBotCommands(ws, "p2", tuning)) }
	setAll := func(hp, ammo float64) {
		for _, id := range squad.MemberIDs {
			u := ws.Units[id]
			u.MaxHP = 100
			u.HP = int(hp * 100)
			if u.Type != model.UnitTypeSupplyTruck {
				u.AmmoCapacity = 100
				u.Ammo = int(ammo * 100)
			}
		}
	}
	// 健康：进攻敌方补给站；已下令后不重复。
	setAll(1, 1)
	cmd, ok := plan()
	if !ok || cmd.Payload["order"] != "attack" || cmd.Target.Position == nil {
		t.Fatalf("healthy legion must attack: %+v", cmd)
	}
	if ws.SurfaceDistance(*cmd.Target.Position, ws.Buildings["enemy-supply"].Position) > 1 {
		t.Fatal("attack must aim at the enemy supply station")
	}
	squad.Order, squad.Target = model.SquadOrderAttack, cmd.Target.Position
	if _, ok := plan(); ok {
		t.Fatal("unchanged order must not be reissued")
	}
	// 缺弹：有己方补给站则 resupply，没有则退回基地。
	setAll(1, 0.1)
	if cmd, ok = plan(); !ok || cmd.Payload["order"] != "retreat" {
		t.Fatalf("no friendly supply station: must fall back home: %+v", cmd)
	}
	addSupplyStation(ws, "own-supply", "p2", botTileAtDistance(t, ws, botPlayerHome(t, ws, "p2"), 4), model.ItemInventory{model.ItemAmmoBullet: 500})
	setAll(1, 0.1)
	cmd, ok = plan()
	if !ok || cmd.Payload["order"] != "resupply" {
		t.Fatalf("low ammo must resupply: %+v", cmd)
	}
	// 被打残：撤退回家（优先于补给）。
	setAll(0.2, 0.1)
	cmd, ok = plan()
	home := botPlayerHome(t, ws, "p2")
	if !ok || cmd.Payload["order"] != "retreat" || cmd.Target.Position == nil || *cmd.Target.Position != home {
		t.Fatalf("crippled legion must retreat home: %+v", cmd)
	}
	// 撤退滞回：血量略高于阈值仍不出击。
	squad.Order, squad.Target = model.SquadOrderRetreat, &home
	setAll(0.5, 1)
	if _, ok := plan(); ok {
		t.Fatal("retreating legion must recover well past the threshold before re-engaging")
	}
	setAll(1, 1)
	cmd, ok = plan()
	if !ok || cmd.Payload["order"] != "attack" {
		t.Fatalf("recovered legion attacks again: %+v", cmd)
	}
	// 家门口来敌：defend。
	squad.Order, squad.Target = model.SquadOrderAttack, cmd.Target.Position
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", botTileAtDistance(t, ws, home, 3))
	cmd, ok = plan()
	if !ok || cmd.Payload["order"] != "defend" || *cmd.Target.Position != enemy.Position {
		t.Fatalf("incoming enemy must trigger defend: %+v", cmd)
	}
}

func TestBotLegionOrdersExecuteThroughPlayerInterface(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "hard")
	cmd, ok := botSquadCmd(core.planBotCommands(ws, "p2", tuning))
	if !ok {
		t.Fatal("no squad order")
	}
	botExec(core, ws, cmd)
	if squad.Order != model.SquadOrderAttack {
		t.Fatalf("server rejected the bot's order, squad order=%s", squad.Order)
	}
}

func TestBotLegionDifficultyThresholds(t *testing.T) {
	easy, normal, hard := botTuningFor("easy"), botTuningFor("normal"), botTuningFor("hard")
	if !(easy.retreatBelowHP < normal.retreatBelowHP && normal.retreatBelowHP < hard.retreatBelowHP) {
		t.Fatal("retreat threshold must rise with difficulty")
	}
	if !(easy.resupplyBelowAmmo < normal.resupplyBelowAmmo && normal.resupplyBelowAmmo < hard.resupplyBelowAmmo) {
		t.Fatal("resupply threshold must rise with difficulty")
	}
	// 同一 30% 血量、同一世界：easy 继续打，normal/hard 撤退。
	for name, wantRetreat := range map[string]bool{"easy": false, "normal": true, "hard": true} {
		core, ws, tuning, squad := botLegionScene(t, name)
		for _, id := range squad.MemberIDs {
			ws.Units[id].MaxHP, ws.Units[id].HP = 100, 30
		}
		cmd, ok := botSquadCmd(core.planBotCommands(ws, "p2", tuning))
		got := ok && cmd.Payload["order"] == "retreat"
		if got != wantRetreat {
			t.Errorf("%s: retreat=%v want %v (%+v)", name, got, wantRetreat, cmd)
		}
	}
}

func TestBotLegionDeterministic(t *testing.T) {
	core, ws, tuning, _ := botLegionScene(t, "hard")
	a := core.planBotCommands(ws, "p2", tuning)
	b := core.planBotCommands(ws, "p2", tuning)
	if len(a) != len(b) {
		t.Fatalf("non-deterministic: %v vs %v", a, b)
	}
	for i := range a {
		if a[i].Type != b[i].Type || botHashCmd(a[i]) != botHashCmd(b[i]) {
			t.Fatalf("non-deterministic cmd %d", i)
		}
	}
}
