package gamecore

import (
	"siliconworld/internal/model"
)

// settleCombatTech 每 tick 把主科技树的战斗科技效果结算到世界单位。
// 属性由"单位类型基线 + 玩家当前 CombatTechEffect"重建，幂等：
// 新完成的研究下一 tick 生效，快照恢复后保持一致；执行体由
// SyncMechaCapabilities 单独处理（含护盾），此处跳过。
func settleCombatTech(ws *model.WorldState) {
	if ws == nil {
		return
	}
	effectsByPlayer := make(map[string]model.CombatTechEffect)
	effFor := func(playerID string) model.CombatTechEffect {
		eff, ok := effectsByPlayer[playerID]
		if !ok {
			eff = model.CombatTechEffectsFor(ws.Players[playerID])
			effectsByPlayer[playerID] = eff
		}
		return eff
	}
	for _, unit := range ws.Units {
		if unit == nil || unit.Mecha != nil {
			continue
		}
		eff := effFor(unit.OwnerID)
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
	settleCombatTechBuildings(ws, effectsByPlayer)
}

// settleCombatTechBuildings 战斗科技作用于防御建筑与全部建筑结构（U6）。
// 属性同样由"档案基线 + 科技加成"幂等重建。
func settleCombatTechBuildings(ws *model.WorldState, effectsByPlayer map[string]model.CombatTechEffect) {
	effFor := func(playerID string) model.CombatTechEffect {
		eff, ok := effectsByPlayer[playerID]
		if !ok {
			eff = model.CombatTechEffectsFor(ws.Players[playerID])
			effectsByPlayer[playerID] = eff
		}
		return eff
	}
	for _, b := range ws.Buildings {
		if b == nil || b.HP <= 0 || b.OwnerID == "" {
			continue
		}
		eff := effFor(b.OwnerID)
		if eff.DamageBonus == 0 && eff.HPBonus == 0 {
			continue
		}
		profile := model.BuildingProfileFor(b.Type, b.Level)
		if eff.DamageBonus != 0 && b.Runtime.Functions.Combat != nil && profile.Runtime.Functions.Combat != nil {
			baseAttack := profile.Runtime.Functions.Combat.Attack
			if baseAttack > 0 {
				b.Runtime.Functions.Combat.Attack = int(float64(baseAttack) * (1.0 + eff.DamageBonus))
			}
			if profile.Runtime.Functions.Combat.AltAmmoAttack > 0 {
				b.Runtime.Functions.Combat.AltAmmoAttack = int(float64(profile.Runtime.Functions.Combat.AltAmmoAttack) * (1.0 + eff.DamageBonus))
			}
		}
		if eff.HPBonus != 0 && profile.MaxHP > 0 {
			b.MaxHP = int(float64(profile.MaxHP) * (1.0 + eff.HPBonus))
			if b.HP > b.MaxHP {
				b.HP = b.MaxHP
			}
		}
	}
}
