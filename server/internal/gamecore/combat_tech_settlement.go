package gamecore

import (
	"siliconworld/internal/model"
)

// settleCombatTech reapplies each combat unit's tech-derived stats every tick.
// Combat upgrades are researched through the main tech tree (start_research);
// this settlement is where their effects reach combat units. Stats are rebuilt
// from the unit-type baseline plus the owner's current CombatTechEffect, so
// newly completed research levels take effect on the next tick and snapshot
// restores stay consistent.
func (gc *GameCore) settleCombatTech() []*model.GameEvent {
	if gc == nil || gc.world == nil || gc.combatUnits == nil {
		return nil
	}

	effectsByPlayer := make(map[string]model.CombatTechEffect)
	for _, unit := range gc.combatUnits.Units {
		if unit == nil || unit.State == model.CombatUnitStateDead {
			continue
		}
		eff, ok := effectsByPlayer[unit.PlayerID]
		if !ok {
			eff = model.CombatTechEffectsFor(gc.world.Players[unit.PlayerID])
			effectsByPlayer[unit.PlayerID] = eff
		}
		model.ApplyCombatTechEffects(unit, eff)
	}
	return nil
}
