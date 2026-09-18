package model

// CombatTechEffect aggregates the combat attribute bonuses a player has
// unlocked through the main research tree (start_research → CompletedTechs).
// Each field is derived per tick from tech definitions via TechEffectValue,
// so the values never accumulate twice after a snapshot restore.
type CombatTechEffect struct {
	DamageBonus float64 `json:"damage_bonus"` // 武器伤害加成（比例，0.1 = +10%）
	HPBonus     float64 `json:"hp_bonus"`     // 结构耐久加成（比例）
	ShieldBonus float64 `json:"shield_bonus"` // 护盾上限加成（固定值）
}

// Combat tech effect types consumed from TechDefinition.Effects:
//   - "weapon_damage": fraction added to CombatUnit weapon damage per level
//     (df_kinetic/energy/explosive_weapon_damage, df_em_weapon_strength)
//   - "structure_hp": fraction added to CombatUnit max HP per level
//     (df_enhanced_structure)
//   - "shield_capacity": flat shield capacity per level (df_energy_shield);
//     also feeds the mecha shield via SyncMechaCapabilities.

// CombatTechEffectsFor derives the player's aggregate combat bonuses from the
// completed levels of the main tech tree. This replaces the former parallel
// combat-tech research track: combat upgrades are researched through
// start_research like every other tech.
func CombatTechEffectsFor(player *PlayerState) CombatTechEffect {
	return CombatTechEffect{
		DamageBonus: TechEffectValue(player, "weapon_damage"),
		HPBonus:     TechEffectValue(player, "structure_hp"),
		ShieldBonus: TechEffectValue(player, "shield_capacity"),
	}
}

// ApplyCombatTechEffects recomputes a combat unit's derived stats from its
// type baseline plus the player's current tech bonuses. It is idempotent:
// stats are always rebuilt from DefaultCombatUnitStats, never multiplied onto
// themselves, so running it every tick (or after a snapshot restore) is safe.
// Current HP/shield are preserved up to the new maxima.
func ApplyCombatTechEffects(unit *CombatUnit, eff CombatTechEffect) {
	if unit == nil {
		return
	}
	base := DefaultCombatUnitStats(unit.Type)
	if eff.HPBonus != 0 {
		unit.MaxHP = int(float64(base.MaxHP) * (1.0 + eff.HPBonus))
	} else {
		unit.MaxHP = base.MaxHP
	}
	if unit.HP > unit.MaxHP {
		unit.HP = unit.MaxHP
	}
	if eff.DamageBonus != 0 {
		unit.Weapon.Damage = int(float64(base.Weapon.Damage) * (1.0 + eff.DamageBonus))
	} else {
		unit.Weapon.Damage = base.Weapon.Damage
	}
	unit.Shield.MaxLevel = base.Shield.MaxLevel + eff.ShieldBonus
	if unit.Shield.Level > unit.Shield.MaxLevel {
		unit.Shield.Level = unit.Shield.MaxLevel
	}
}
