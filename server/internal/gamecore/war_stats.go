package gamecore

import (
	"siliconworld/internal/model"
)

// 战损/战果双边计数（F2）。
//
// 口径（与 model.CombatStats 注释一致）：
//   - 受害方是玩家实体（单位/编组小队/建筑）→ 受害方 losses +1，与击杀方身份无关；
//   - 击杀方与受害方都是玩家且归属不同 → 击杀方 kills +1；
//   - dark_fog 不是玩家：黑雾击杀玩家只计受害方 losses；玩家击杀黑雾单位/巢穴
//     不产生任何计数（纯 PvE 不进双边战报）；
//   - 编组小队整编被毁计 1 个单位击杀/损失；
//   - 统一入口：killUnit / destroyBuildingCombat / destroySquad（单位/小队/炮塔/
//     舰队/黑雾反击所有路径都经此计数）；destroyEnemyForce 不计（受害方非玩家）。
//
// 计数挂在 PlayerState.Stats.CombatStats（玩家表跨世界共享），随快照
// clone/restore 持久化，读档/回放/回滚一致。

// recordCombatUnitKill 记录一次单位击杀（含编组小队整编）的双边计数。
func recordCombatUnitKill(ws *model.WorldState, victimOwnerID, killerOwnerID string) {
	recordCombatLoss(ws, victimOwnerID, killerOwnerID, func(stats *model.CombatStats) {
		stats.UnitsLost++
	}, func(stats *model.CombatStats) {
		stats.UnitsKilled++
	})
}

// recordCombatBuildingKill 记录一次建筑摧毁的双边计数。
func recordCombatBuildingKill(ws *model.WorldState, victimOwnerID, killerOwnerID string) {
	recordCombatLoss(ws, victimOwnerID, killerOwnerID, func(stats *model.CombatStats) {
		stats.BuildingsLost++
	}, func(stats *model.CombatStats) {
		stats.BuildingsDestroyed++
	})
}

func recordCombatLoss(ws *model.WorldState, victimOwnerID, killerOwnerID string, victimFn, killerFn func(*model.CombatStats)) {
	if ws == nil {
		return
	}
	victim := combatStatsOf(ws, victimOwnerID)
	killer := combatStatsOf(ws, killerOwnerID)
	if victim == nil {
		// 受害方非玩家（黑雾）：不进双边统计。
		return
	}
	victimFn(victim)
	// 击杀方必须是玩家且与受害方不同归属才计 kills（友军/自我误伤只计损失）。
	if killer != nil && killerOwnerID != victimOwnerID {
		killerFn(killer)
	}
}

func combatStatsOf(ws *model.WorldState, ownerID string) *model.CombatStats {
	if ownerID == "" {
		return nil
	}
	player := ws.Players[ownerID]
	if player == nil {
		return nil
	}
	if player.Stats == nil {
		player.Stats = model.NewPlayerStats(ownerID)
	}
	return &player.Stats.CombatStats
}
