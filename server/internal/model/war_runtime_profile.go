package model

// ResolveWarBlueprintRuntimeProfile returns preset combat data when present and
// otherwise derives a deterministic profile from the authoritative blueprint.
func ResolveWarBlueprintRuntimeProfile(blueprint WarBlueprint) WarBlueprintRuntimeProfile {
	if profile, ok := WarBlueprintRuntimeProfileByID(blueprint.ID); ok {
		return profile
	}

	index := PublicWarBlueprintCatalogIndex()
	budget := WarBudgetProfile{}
	switch {
	case blueprint.BaseHullID != "":
		if hull, ok := index.BaseHullByID(blueprint.BaseHullID); ok {
			budget = hull.Budgets
		}
	case blueprint.BaseFrameID != "":
		if frame, ok := index.BaseFrameByID(blueprint.BaseFrameID); ok {
			budget = frame.Budgets
		}
	}

	baseHP := 60 + budget.MassCapacity/2 + budget.VolumeCapacity/4
	weapon := WeaponState{Type: WeaponTypeLaser, Damage: 18, FireRate: 10, Range: 10, AmmoCost: 0}
	shield := ShieldState{Level: 12, MaxLevel: 12, RechargeRate: 1, RechargeDelay: 10}

	for _, slot := range blueprint.Components {
		component, ok := index.ComponentByID(slot.ComponentID)
		if !ok {
			continue
		}
		baseHP += component.Mass + component.Volume/2

		switch component.Category {
		case WarComponentCategoryDefense:
			baseHP += 8 + component.RigidityLoad
			if hasWarComponentTag(component, "shield") {
				shield.MaxLevel += 20 + float64(component.PowerDraw/2)
				shield.Level = shield.MaxLevel
				shield.RechargeRate += 1
			}
		case WarComponentCategoryPower:
			baseHP += component.PowerOutput / 10
		case WarComponentCategorySensor:
			weapon.Range += float64(component.SignalLoad) * 0.4
		case WarComponentCategoryWeapon:
			weapon = derivedWarWeapon(component)
		case WarComponentCategoryUtility:
			if hasWarComponentTag(component, "repair") {
				baseHP += 12
				shield.RechargeRate += 0.5
			}
			if hasWarComponentTag(component, "ecm") {
				weapon.Range += 2
			}
		}
	}

	if shield.MaxLevel <= 0 {
		shield = ShieldState{}
	} else if shield.Level == 0 {
		shield.Level = shield.MaxLevel
	}
	if baseHP < 60 {
		baseHP = 60
	}

	profile := WarBlueprintRuntimeProfile{}
	stack := &WarStackRuntimeProfile{
		HP:     baseHP,
		Weapon: weapon,
		Shield: shield,
	}
	switch blueprint.Domain {
	case UnitDomainGround, UnitDomainAir:
		profile.Squad = stack
	default:
		profile.FleetUnit = stack
	}
	return profile
}

func derivedWarWeapon(component WarComponentCatalogEntry) WeaponState {
	weapon := WeaponState{Type: WeaponTypeLaser, Damage: 24, FireRate: 10, Range: 12, AmmoCost: 0}
	switch {
	case hasWarComponentTag(component, "missile"):
		weapon.Type = WeaponTypeMissile
		weapon.Damage = 34
		weapon.FireRate = 14
		weapon.Range = 18
		weapon.AmmoCost = 1
	case hasWarComponentTag(component, "kinetic"):
		weapon.Type = WeaponTypeCannon
		weapon.Damage = 42
		weapon.FireRate = 16
		weapon.Range = 20
	case hasWarComponentTag(component, "direct_fire"):
		weapon.Type = WeaponTypeLaser
		weapon.Damage = 38
		weapon.FireRate = 11
		weapon.Range = 13
	default:
		weapon.Damage = 22 + component.PowerDraw/3
	}
	return weapon
}

func hasWarComponentTag(component WarComponentCatalogEntry, tag string) bool {
	for _, current := range component.Tags {
		if current == tag {
			return true
		}
	}
	return false
}
