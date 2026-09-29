package gamecore

import (
	"siliconworld/internal/model"
)

// settleCombatTech 每 tick 把战斗科技幂等写回世界单位、建筑、小队和舰队。
// 数值从类型或蓝图基线乘 (1+bonus) 重建，不在当前值上叠乘。
// 执行体由 SyncMechaCapabilities 单独处理（含护盾），此处跳过。
func settleCombatTech(ws *model.WorldState, spaceRuntime *model.SpaceRuntimeState) {
	if ws == nil && spaceRuntime == nil {
		return
	}
	effectsByPlayer := make(map[string]model.CombatTechEffect)
	effFor := func(playerID string) model.CombatTechEffect {
		eff, ok := effectsByPlayer[playerID]
		if !ok {
			var player *model.PlayerState
			if ws != nil {
				player = ws.Players[playerID]
			}
			eff = model.CombatTechEffectsFor(player)
			effectsByPlayer[playerID] = eff
		}
		return eff
	}
	if ws != nil {
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
		settleCombatTechSquads(ws, effFor)
	}
	settleCombatTechFleets(ws, spaceRuntime, effFor)
}

func scaleCombatTechStat(base int, bonus float64) int {
	if base <= 0 {
		return base
	}
	return int(float64(base) * (1.0 + bonus))
}

// settleCombatTechSquads 用蓝图运行时档案作基线。没有档案的小队不改。
// 只抬 MaxHP 并夹紧，不回满已损失 HP；编制取 MaxHP/单员HP，避免减员后每 tick 缩编。
func settleCombatTechSquads(ws *model.WorldState, effFor func(string) model.CombatTechEffect) {
	if ws == nil || ws.CombatRuntime == nil {
		return
	}
	for _, squad := range ws.CombatRuntime.Squads {
		if squad == nil || squad.State == model.CombatSquadStateDestroyed {
			continue
		}
		profile, ok := resolveWarBlueprintRuntimeProfile(ws, squad.OwnerID, squad.BlueprintID)
		if !ok || profile.Squad == nil {
			continue
		}
		eff := effFor(squad.OwnerID)
		base := profile.Squad
		if base.Weapon.Damage > 0 {
			squad.Weapon.Damage = scaleCombatTechStat(base.Weapon.Damage, eff.DamageBonus)
		}
		if base.HP <= 0 {
			continue
		}
		memberMax := scaleCombatTechStat(base.HP, eff.HPBonus)
		if memberMax < 1 {
			continue
		}
		roster := squad.Count
		if roster < 1 {
			roster = 1
		}
		per := squad.MemberMaxHP
		if per <= 0 {
			per = base.HP
		}
		if squad.MaxHP >= per {
			if inferred := squad.MaxHP / per; inferred > roster {
				roster = inferred
			}
		}
		squad.MemberMaxHP = memberMax
		squad.MaxHP = memberMax * roster
		if squad.HP > squad.MaxHP {
			squad.HP = squad.MaxHP
		}
	}
}

// settleCombatTechFleets 把同一套加成写到交火火力与结构上限。没有舰队单位档案的实体不改。
func settleCombatTechFleets(ws *model.WorldState, spaceRuntime *model.SpaceRuntimeState, effFor func(string) model.CombatTechEffect) {
	if spaceRuntime == nil {
		return
	}
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			for _, fleet := range systemRuntime.Fleets {
				applyCombatTechToFleet(ws, fleet, effFor)
			}
		}
	}
}

func applyCombatTechToFleet(ws *model.WorldState, fleet *model.SpaceFleet, effFor func(string) model.CombatTechEffect) {
	if fleet == nil {
		return
	}
	agg := aggregateFleetStacks(ws, fleet.OwnerID, fleet.Units)
	if !agg.hasProfile {
		return
	}
	eff := effFor(fleet.OwnerID)
	damage, _, weapons, _, structure := finalizedFleetCombat(agg)
	// 点防与电子战不是 weapon_damage 的交火火力，保持档案基线。
	weapons.DirectFire = scaleCombatTechStat(agg.weapons.DirectFire, eff.DamageBonus)
	weapons.Missile = scaleCombatTechStat(agg.weapons.Missile, eff.DamageBonus)
	fleet.Weapons = weapons
	fleet.Weapon.Damage = scaleCombatTechStat(damage, eff.DamageBonus)
	if structure <= 0 {
		return
	}
	fleet.Structure.MaxLevel = scaleCombatTechStat(structure, eff.HPBonus)
	if fleet.Structure.Level > fleet.Structure.MaxLevel {
		fleet.Structure.Level = fleet.Structure.MaxLevel
	}
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
