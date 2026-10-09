package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// 试玩报告 C：军团攻击是一条一次性指令，成员走到阵型位后姿态被切成 idle，
// 而 idle 的自动索敌不含建筑——军团停在玩家基地旁再也不开火，且因为
// (order,target) 没变，bot 永远不重下发。修复：僵住的军团按 botLegionRefreshTicks 重下发。
func TestBotLegionReordersStalledAttackSquad(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "normal")
	// botRaidScene 里 p1 的基地就在旁边，先清掉一切威胁/其它军团，保证计划里
	// 只有这一条攻击令。
	for _, u := range ws.Units {
		if u != nil && u.OwnerID == "p1" {
			u.HP = 0
		}
	}
	for id := range ws.CombatRuntime.Squads {
		if id != squad.ID {
			delete(ws.CombatRuntime.Squads, id)
		}
	}
	plan := func() (model.Command, bool) { return botSquadCmd(core.planBotCommands(ws, "p2", tuning)) }
	stall := func() {
		for _, id := range squad.MemberIDs {
			u := ws.Units[id]
			u.ClearMovement()
			u.ClearEngagement()
			u.Stance = model.UnitStanceIdle
			u.SquadOrderActive = true
		}
	}

	// 第一次计划：军团是 idle，应下攻击令。执行它（走真实命令入口）后成员
	// 有了阵型路径，于是"到位僵住"需要重新清空移动状态来模拟。
	first, ok := plan()
	if !ok || first.Payload["order"] != "attack" {
		t.Fatalf("bot must order an attack, got %+v (ok=%v)", first, ok)
	}
	botExec(core, ws, first)
	stall()

	// 同一 (order,target) 且僵住但还在刷新窗口内：不重复下发。
	if cmd, ok := plan(); ok {
		t.Fatalf("must not spam orders inside the refresh window, got %+v", cmd)
	}
	// 僵住超过刷新窗口：重下发（让成员重新寻路并恢复攻击移动姿态）。
	ws.Tick = squad.LastOrderTick + botLegionRefreshTicks
	cmd, ok := plan()
	if !ok || cmd.Payload["order"] != "attack" {
		t.Fatalf("stalled legion must be re-ordered after the refresh window, got %+v (ok=%v)", cmd, ok)
	}
	botExec(core, ws, cmd)

	// 还在推进（有人有路径）时不重下发。
	lead := ws.Units[squad.MemberIDs[0]]
	lead.Path = []model.Position{lead.Position, ws.SurfaceOffset(lead.Position, 1, 0)}
	lead.PathIndex = 1
	lead.Stance = model.UnitStanceAttackMove
	ws.Tick = squad.LastOrderTick + botLegionRefreshTicks
	if cmd, ok := plan(); ok {
		t.Fatalf("advancing legion must not be re-ordered, got %+v", cmd)
	}
}

// 试玩报告 C/G2：目标不可达（玩家在孤岛上）时 bot 不再下令攻击，也不会无限重复。
func TestBotSkipsUnreachableAttackObjective(t *testing.T) {
	core, ws, _, _, _, _ := botRaidScene(t, "normal")
	home := botPlayerHome(t, ws, "p2")
	// 目标点四周封水（孤岛），并确保它离基地足够远、不在基地的邻格上。
	target := model.Position{X: home.X + 40, Y: home.Y + 20}
	for _, tile := range ws.SurfaceDisc(target, 2) {
		if ws.SurfaceDistance(tile, target) > 2 {
			continue
		}
		if tile == target {
			continue
		}
		ws.Grid[tile.Y][tile.X].Terrain = terrain.TileWater
	}
	if core.botTargetReachable(ws, home, target, nil) {
		t.Fatalf("isolated target %+v must be reported unreachable from %+v", target, home)
	}
	// 可达的空地仍判为可达（对照）。
	near := ws.SurfaceOffset(home, 3, 0)
	if !core.botTargetReachable(ws, home, near, nil) {
		t.Fatalf("adjacent open tile %+v must be reachable", near)
	}
}
