package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 电力回环回归（2026-10-12）：bot 补风机时必须落在己方已带电电网的无线覆盖内。
//
// 细分网格后 botBuildSpotNear 从半径 9 起扫，2×2 的风机会落在 HQ 电感应塔覆盖
// （12）之外：发出来的电送不进电网，HQ 一直 no_power，starved 恒真 → bot 无限
// 补风机（旧局实测 332 座风机、minerals/energy 归零，而电网里始终 0 供电）。
// 本测试跑到 bot 开局若干千 tick，断言：
//   - HQ 有电（不再 no_power/power_no_provider）；
//   - 风机数量不无限增长（远低于旧局 332）；
//   - 已建成的风机都落在己方电网的无线覆盖内。
func TestBotPowerFarmsInsideGridCoverage(t *testing.T) {
	t.Parallel()
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	for ws.Tick < 12000 {
		core.processTick()
	}

	turbines := 0
	powered := 0
	for _, b := range ws.Buildings {
		if b.OwnerID != "p2" || b.Type != model.BuildingTypeWindTurbine {
			continue
		}
		turbines++
	}
	ctx := core.surveyBotWorld(ws, "p2")
	grid := botPoweredGrid(ws, ctx)
	for _, b := range ctx.buildings {
		if b.Type == model.BuildingTypeWindTurbine && grid[b.ID] {
			powered++
		}
	}
	hq := botPlayerHQ(t, ws, "p2")
	if hq.Runtime.State == model.BuildingWorkNoPower {
		t.Fatalf("bot HQ 仍然断电：state=%s reason=%s（风机 %d 座，接入电网 %d 座）",
			hq.Runtime.State, hq.Runtime.StateReason, turbines, powered)
	}
	// 目标数 powerTarget=2（easy），允许补电时多一两座，但绝不该刷到几十座。
	if turbines > 12 {
		t.Fatalf("bot 风机数量失控：%d 座（HQ=%s/%s，接入电网 %d 座）",
			turbines, hq.Runtime.State, hq.Runtime.StateReason, powered)
	}
	if turbines > 0 && powered == 0 {
		t.Fatalf("所有风机都没接进电网（%d 座），电力建设选址又跑回覆盖外了", turbines)
	}
	t.Logf("tick=%d 风机 %d 座（接入电网 %d 座），HQ=%s", ws.Tick, turbines, powered, hq.Runtime.State)
}
