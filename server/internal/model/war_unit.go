package model

// WarBlueprintUnit materializes one ground/air war blueprint payload as a world
// unit. Mobility, vision and magazine size come from the platform template
// (drone → attack_drone, vehicle → scout, otherwise mecha); HP and weapon come
// from the blueprint runtime profile; armor/weapon classes match the warfare
// catalog. Blueprint shields have no world-unit counterpart and are dropped.
func WarBlueprintUnit(blueprint WarBlueprint, profile WarStackRuntimeProfile) Unit {
	u := UnitStats(warBlueprintUnitTemplate(blueprint))
	u.Domain = blueprint.Domain
	u.MaxHP, u.HP = profile.HP, profile.HP
	u.Attack = profile.Weapon.Damage
	u.AttackRange = max(1, int(profile.Weapon.Range))
	u.MinAttackRange = 0
	u.AttackCooldownTick = int64(max(1, profile.Weapon.FireRate))
	u.AggroRange = max(u.VisionRange, u.AttackRange)
	u.WeaponClass = profile.Weapon.Type
	u.ArmorClass = blueprintArmorClass(UnitRuntimeClassCombatSquad, blueprint.Domain)
	u.AmmoClass = WeaponSupplyClass(profile.Weapon.Type)
	u.AmmoItem = DefaultAmmunition(u.AmmoClass)
	return u
}

func warBlueprintUnitTemplate(blueprint WarBlueprint) UnitType {
	if blueprint.Domain == UnitDomainAir {
		return UnitTypeAttackDrone
	}
	index := PublicWarBlueprintCatalogIndex()
	for _, slot := range blueprint.Components {
		component, ok := index.ComponentByID(slot.ComponentID)
		if !ok {
			continue
		}
		for _, tag := range component.Tags {
			if tag == "vehicle" || tag == "tracked" || tag == "hover" {
				return UnitTypeScout
			}
		}
	}
	return UnitTypeMecha
}
