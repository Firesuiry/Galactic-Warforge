package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 撤退滞回必须有时限（试玩报告 B）：单位不回血，平均 HP 0.55 的军团在 hard
// （retreatBelowHP 0.5，滞回再 +0.3）下会永远留在撤退分支、到家后一动不动。
// 滞回只在 botRetreatHoldTicks 内有效，之后阈值回落，残部一定有机会重新出击。
func TestBotLegionRetreatHysteresisExpires(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "hard")
	home := botPlayerHome(t, ws, "p2")

	// 全军团 55% 血：高于基础阈值 0.5、低于滞回后的 0.8。
	for _, id := range squad.MemberIDs {
		u := ws.Units[id]
		u.MaxHP, u.HP = 100, 55
		if u.Type != model.UnitTypeSupplyTruck {
			u.Ammo = u.AmmoCapacity
		}
	}
	squad.Order = model.SquadOrderRetreat
	squad.Target = &home
	squad.LastOrderTick = ws.Tick

	// 滞回期内：不下新令（保持撤退，不再重复下令）。
	if cmd, ok := botSquadCmd(core.planBotCommands(ws, "p2", tuning)); ok {
		t.Fatalf("retreating legion must hold during the hysteresis window, got %+v", cmd)
	}

	// 到家整补超过滞回时限：阈值回落，残部重新出击。
	ws.Tick = squad.LastOrderTick + botRetreatHoldTicks
	cmd, ok := botSquadCmd(core.planBotCommands(ws, "p2", tuning))
	if !ok || cmd.Payload["order"] != "attack" {
		t.Fatalf("hysteresis must expire and the remnant must attack again, got %+v (ok=%v)", cmd, ok)
	}
}

// 滞回窗口内被打残（低于基础阈值）仍然继续撤退，不被时限掩盖。
func TestBotLegionRetreatHoldsWhenStillBelowBaseThreshold(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "hard")
	home := botPlayerHome(t, ws, "p2")
	for _, id := range squad.MemberIDs {
		u := ws.Units[id]
		u.MaxHP, u.HP = 100, 20
		if u.Type != model.UnitTypeSupplyTruck {
			u.Ammo = u.AmmoCapacity
		}
	}
	squad.Order = model.SquadOrderRetreat
	squad.Target = &home
	squad.LastOrderTick = 0

	ws.Tick = botRetreatHoldTicks * 10
	if cmd, ok := botSquadCmd(core.planBotCommands(ws, "p2", tuning)); ok && cmd.Payload["order"] != "retreat" {
		t.Fatalf("crippled legion must keep retreating after the hold window, got %+v", cmd)
	}
}
