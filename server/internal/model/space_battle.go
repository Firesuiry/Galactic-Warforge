package model

// DurabilityLayerState tracks one non-regenerating durability layer.
type DurabilityLayerState struct {
	Level    int `json:"level"`
	MaxLevel int `json:"max_level"`
}

// SpaceWeaponMix summarizes fleet firepower composition.
type SpaceWeaponMix struct {
	DirectFire        int `json:"direct_fire,omitempty"`
	Missile           int `json:"missile,omitempty"`
	PointDefense      int `json:"point_defense,omitempty"`
	ElectronicWarfare int `json:"electronic_warfare,omitempty"`
}

// SpaceFleetSubsystemStateType describes current subsystem readiness.
type SpaceFleetSubsystemStateType string

const (
	SpaceFleetSubsystemOperational SpaceFleetSubsystemStateType = "operational"
	SpaceFleetSubsystemDegraded    SpaceFleetSubsystemStateType = "degraded"
	SpaceFleetSubsystemDisabled    SpaceFleetSubsystemStateType = "disabled"
)

// SpaceFleetSubsystemStatus tracks one combat subsystem.
type SpaceFleetSubsystemStatus struct {
	Integrity float64                      `json:"integrity"`
	State     SpaceFleetSubsystemStateType `json:"state"`
	Effect    string                       `json:"effect,omitempty"`
}

// SpaceFleetSubsystemState exposes key combat subsystems.
type SpaceFleetSubsystemState struct {
	Engine       SpaceFleetSubsystemStatus `json:"engine"`
	FireControl  SpaceFleetSubsystemStatus `json:"fire_control"`
	Sensors      SpaceFleetSubsystemStatus `json:"sensors"`
	PointDefense SpaceFleetSubsystemStatus `json:"point_defense"`
}

// SpaceMissileSalvoReport summarizes one side's missile exchange.
type SpaceMissileSalvoReport struct {
	Fired       int `json:"fired,omitempty"`
	Intercepted int `json:"intercepted,omitempty"`
	Penetrated  int `json:"penetrated,omitempty"`
	Drifted     int `json:"drifted,omitempty"`
	Damage      int `json:"damage,omitempty"`
}

// SpaceBattleDamageSummary records layered incoming damage.
type SpaceBattleDamageSummary struct {
	Shield    float64 `json:"shield,omitempty"`
	Armor     int     `json:"armor,omitempty"`
	Structure int     `json:"structure,omitempty"`
	Subsystem int     `json:"subsystem,omitempty"`
}

// SpaceBattleSubsystemHit describes one subsystem outcome from the battle.
type SpaceBattleSubsystemHit struct {
	Subsystem string                       `json:"subsystem"`
	State     SpaceFleetSubsystemStateType `json:"state"`
	Effect    string                       `json:"effect,omitempty"`
}

// SpaceBattleReport stores one authoritative fleet battle summary.
type SpaceBattleReport struct {
	BattleID           string                    `json:"battle_id"`
	Tick               int64                     `json:"tick"`
	SystemID           string                    `json:"system_id"`
	PlanetID           string                    `json:"planet_id,omitempty"`
	FleetID            string                    `json:"fleet_id"`
	OwnerID            string                    `json:"owner_id"`
	TargetID           string                    `json:"target_id,omitempty"`
	TargetType         string                    `json:"target_type,omitempty"`
	FleetFirepower     SpaceWeaponMix            `json:"fleet_firepower"`
	EnemyFirepower     SpaceWeaponMix            `json:"enemy_firepower"`
	FleetMissileSalvo  SpaceMissileSalvoReport   `json:"fleet_missile_salvo,omitempty"`
	EnemyMissileSalvo  SpaceMissileSalvoReport   `json:"enemy_missile_salvo,omitempty"`
	FleetDamage        SpaceBattleDamageSummary  `json:"fleet_damage,omitempty"`
	TargetStrengthLoss int                       `json:"target_strength_loss,omitempty"`
	SubsystemHits      []SpaceBattleSubsystemHit `json:"subsystem_hits,omitempty"`
	RetreatTriggered   bool                      `json:"retreat_triggered,omitempty"`
	TargetDestroyed    bool                      `json:"target_destroyed,omitempty"`
	LockQuality        float64                   `json:"lock_quality,omitempty"`
	JammingPenalty     float64                   `json:"jamming_penalty,omitempty"`
}

// WarSpaceUnitCombatProfile derives stable combat-facing stats for one blueprint stack.
type WarSpaceUnitCombatProfile struct {
	Structure int            `json:"structure"`
	Armor     int            `json:"armor"`
	Weapons   SpaceWeaponMix `json:"weapons"`
}

// DefaultSpaceFleetSubsystemState returns a fully operational subsystem block.
func DefaultSpaceFleetSubsystemState() SpaceFleetSubsystemState {
	return SpaceFleetSubsystemState{
		Engine:       defaultSpaceFleetSubsystemStatus("normal thrust"),
		FireControl:  defaultSpaceFleetSubsystemStatus("stable firing solution"),
		Sensors:      defaultSpaceFleetSubsystemStatus("full lock resolution"),
		PointDefense: defaultSpaceFleetSubsystemStatus("intercept grid online"),
	}
}

func defaultSpaceFleetSubsystemStatus(effect string) SpaceFleetSubsystemStatus {
	return SpaceFleetSubsystemStatus{
		Integrity: 1,
		State:     SpaceFleetSubsystemOperational,
		Effect:    effect,
	}
}

// ResolveWarBlueprintSpaceCombatProfile derives layered durability and weapon mix from the authoritative blueprint.
func ResolveWarBlueprintSpaceCombatProfile(blueprint WarBlueprint) WarSpaceUnitCombatProfile {
	runtimeProfile := ResolveWarBlueprintRuntimeProfile(blueprint)
	profile := WarSpaceUnitCombatProfile{
		Structure: 90,
		Armor:     36,
	}
	if runtimeProfile.FleetUnit != nil && runtimeProfile.FleetUnit.HP > 0 {
		profile.Structure = runtimeProfile.FleetUnit.HP
		profile.Armor = runtimeProfile.FleetUnit.HP / 3
		switch runtimeProfile.FleetUnit.Weapon.Type {
		case WeaponTypeMissile:
			profile.Weapons.Missile += runtimeProfile.FleetUnit.Weapon.Damage
		default:
			profile.Weapons.DirectFire += runtimeProfile.FleetUnit.Weapon.Damage
		}
	}

	index := PublicWarBlueprintCatalogIndex()
	for _, slot := range blueprint.Components {
		component, ok := index.ComponentByID(slot.ComponentID)
		if !ok {
			continue
		}
		switch component.Category {
		case WarComponentCategoryDefense:
			if hasWarComponentTag(component, "pd") {
				profile.Weapons.PointDefense += 14 + component.PowerDraw/3 + component.SignalLoad
				continue
			}
			profile.Armor += 10 + component.Mass/2 + component.Volume/4
		case WarComponentCategoryWeapon:
			switch {
			case hasWarComponentTag(component, "missile"):
				profile.Weapons.Missile += 20 + component.PowerDraw/2 + component.HeatLoad
			default:
				profile.Weapons.DirectFire += 18 + component.PowerDraw/2 + component.RigidityLoad + component.HeatLoad/2
			}
		case WarComponentCategoryUtility:
			if hasWarComponentTag(component, "ecm") {
				profile.Weapons.ElectronicWarfare += 8 + component.PowerDraw/4 + component.StealthRating*2
			}
		case WarComponentCategorySensor:
			profile.Weapons.DirectFire += component.SignalLoad / 2
		}
	}

	if profile.Armor < profile.Structure/4 {
		profile.Armor = profile.Structure / 4
	}
	return profile
}

// CloneSpaceBattleReport deep-copies one report.
func CloneSpaceBattleReport(report *SpaceBattleReport) *SpaceBattleReport {
	if report == nil {
		return nil
	}
	copy := *report
	copy.SubsystemHits = append([]SpaceBattleSubsystemHit(nil), report.SubsystemHits...)
	return &copy
}

// CloneSpaceBattleReports deep-copies a report slice.
func CloneSpaceBattleReports(reports []*SpaceBattleReport) []*SpaceBattleReport {
	if len(reports) == 0 {
		return nil
	}
	out := make([]*SpaceBattleReport, 0, len(reports))
	for _, report := range reports {
		if clone := CloneSpaceBattleReport(report); clone != nil {
			out = append(out, clone)
		}
	}
	return out
}
