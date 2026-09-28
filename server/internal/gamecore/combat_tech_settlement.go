package gamecore

import (
	"siliconworld/internal/model"
)

// settleCombatTech 每 tick 把主科技树的战斗科技效果结算到世界单位。
// 属性由"单位类型基线 + 玩家当前 CombatTechEffect"重建，幂等：
// 新完成的研究下一 tick 生效，快照恢复后保持一致；执行体由
// SyncMechaCapabilities 单独处理（含护盾），此处跳过。
func settleCombatTech(ws *model.WorldState) {
	if ws == nil || len(ws.Units) == 0 {
		return
	}
	effectsByPlayer := make(map[string]model.CombatTechEffect)
	for _, unit := range ws.Units {
		if unit == nil || unit.Mecha != nil {
			continue
		}
		eff, ok := effectsByPlayer[unit.OwnerID]
		if !ok {
			eff = model.CombatTechEffectsFor(ws.Players[unit.OwnerID])
			effectsByPlayer[unit.OwnerID] = eff
		}
		if eff.DamageBonus == 0 && eff.HPBonus == 0 {
			continue
		}
		base := model.UnitStats(unit.Type)
		if eff.DamageBonus != 0 {
			unit.Attack = int(float64(base.Attack) * (1.0 + eff.DamageBonus))
		}
		if eff.HPBonus != 0 {
			unit.MaxHP = int(float64(base.MaxHP) * (1.0 + eff.HPBonus))
			if unit.HP > unit.MaxHP {
				unit.HP = unit.MaxHP
			}
		}
	}
}
