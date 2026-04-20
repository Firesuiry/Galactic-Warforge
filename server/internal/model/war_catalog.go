package model

// WarComponentCategory describes the major component families used by public war blueprints.
type WarComponentCategory string

const (
	WarComponentCategoryPower      WarComponentCategory = "power"
	WarComponentCategoryPropulsion WarComponentCategory = "propulsion"
	WarComponentCategoryDefense    WarComponentCategory = "defense"
	WarComponentCategorySensor     WarComponentCategory = "sensor"
	WarComponentCategoryWeapon     WarComponentCategory = "weapon"
	WarComponentCategoryUtility    WarComponentCategory = "utility"
)

// WarBlueprintSource describes where a blueprint comes from.
type WarBlueprintSource string

const (
	WarBlueprintSourcePreset WarBlueprintSource = "preset"
	WarBlueprintSourcePlayer WarBlueprintSource = "player"
)

// BaseFrameCatalogEntry describes a public designable ground or air frame.
type BaseFrameCatalogEntry struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Domain        UnitDomain `json:"domain"`
	Public        bool       `json:"public"`
	VisibleTechID string     `json:"visible_tech_id,omitempty"`
	SizeClass     string     `json:"size_class,omitempty"`
	Roles         []string   `json:"roles,omitempty"`
}

// BaseHullCatalogEntry describes a public designable orbital or space hull.
type BaseHullCatalogEntry struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Domain        UnitDomain `json:"domain"`
	Public        bool       `json:"public"`
	VisibleTechID string     `json:"visible_tech_id,omitempty"`
	SizeClass     string     `json:"size_class,omitempty"`
	Roles         []string   `json:"roles,omitempty"`
}

// WarComponentCatalogEntry describes one authoritative war component option.
type WarComponentCatalogEntry struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	Category      WarComponentCategory `json:"category"`
	Public        bool                 `json:"public"`
	Domains       []UnitDomain         `json:"domains,omitempty"`
	SlotType      string               `json:"slot_type,omitempty"`
	VisibleTechID string               `json:"visible_tech_id,omitempty"`
	Tags          []string             `json:"tags,omitempty"`
}

// PublicBlueprintCatalogEntry describes one public war blueprint.
type PublicBlueprintCatalogEntry struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	Domain          UnitDomain         `json:"domain"`
	RuntimeClass    UnitRuntimeClass   `json:"runtime_class"`
	Public          bool               `json:"public"`
	Source          WarBlueprintSource `json:"source"`
	VisibleTechID   string             `json:"visible_tech_id,omitempty"`
	BaseFrameID     string             `json:"base_frame_id,omitempty"`
	BaseHullID      string             `json:"base_hull_id,omitempty"`
	OutputItemID    string             `json:"output_item_id,omitempty"`
	ProducerRecipes []string           `json:"producer_recipes,omitempty"`
	DeployCommand   string             `json:"deploy_command,omitempty"`
	QueryScopes     []string           `json:"query_scopes,omitempty"`
	Commands        []string           `json:"commands,omitempty"`
	ComponentIDs    []string           `json:"component_ids,omitempty"`
	Summary         string             `json:"summary,omitempty"`
}

// WarBlueprintRuntimeProfile holds the authoritative runtime profile for a public blueprint.
type WarBlueprintRuntimeProfile struct {
	SquadBaseHP              int
	SquadWeapon              WeaponState
	SquadShield              ShieldState
	FleetWeaponType          WeaponType
	FleetWeaponDamage        int
	FleetWeaponFireRate      int
	FleetWeaponRange         float64
	FleetShield              float64
	FleetShieldRechargeRate  float64
	FleetShieldRechargeDelay int
}

var baseFrameCatalogEntries = []BaseFrameCatalogEntry{
	{
		ID:            "light_frame",
		Name:          "Light Frame",
		Domain:        UnitDomainGround,
		Public:        true,
		VisibleTechID: "prototype",
		SizeClass:     "light",
		Roles:         []string{"line", "assault"},
	},
	{
		ID:            "aerial_frame",
		Name:          "Aerial Drone Frame",
		Domain:        UnitDomainAir,
		Public:        true,
		VisibleTechID: "precision_drone",
		SizeClass:     "light",
		Roles:         []string{"air_support", "skirmish"},
	},
}

var baseHullCatalogEntries = []BaseHullCatalogEntry{
	{
		ID:            "corvette_hull",
		Name:          "Corvette Hull",
		Domain:        UnitDomainSpace,
		Public:        true,
		VisibleTechID: "corvette",
		SizeClass:     "escort",
		Roles:         []string{"escort", "intercept"},
	},
	{
		ID:            "destroyer_hull",
		Name:          "Destroyer Hull",
		Domain:        UnitDomainSpace,
		Public:        true,
		VisibleTechID: "destroyer",
		SizeClass:     "line",
		Roles:         []string{"line", "screen"},
	},
}

var warComponentCatalogEntries = []WarComponentCatalogEntry{
	{
		ID:            "compact_reactor",
		Name:          "Compact Reactor",
		Category:      WarComponentCategoryPower,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainGround, UnitDomainAir},
		SlotType:      "power_core",
		VisibleTechID: "prototype",
		Tags:          []string{"starter", "sustained"},
	},
	{
		ID:            "micro_fusion_core",
		Name:          "Micro Fusion Core",
		Category:      WarComponentCategoryPower,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainSpace},
		SlotType:      "power_core",
		VisibleTechID: "corvette",
		Tags:          []string{"naval", "fusion"},
	},
	{
		ID:            "servo_actuator_pack",
		Name:          "Servo Actuator Pack",
		Category:      WarComponentCategoryPropulsion,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainGround},
		SlotType:      "mobility",
		VisibleTechID: "prototype",
		Tags:          []string{"ground", "walker"},
	},
	{
		ID:            "vector_thruster_pack",
		Name:          "Vector Thruster Pack",
		Category:      WarComponentCategoryPropulsion,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainAir},
		SlotType:      "mobility",
		VisibleTechID: "precision_drone",
		Tags:          []string{"air", "hover"},
	},
	{
		ID:            "ion_drive_cluster",
		Name:          "Ion Drive Cluster",
		Category:      WarComponentCategoryPropulsion,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainSpace},
		SlotType:      "engine",
		VisibleTechID: "corvette",
		Tags:          []string{"naval", "space"},
	},
	{
		ID:            "composite_armor_plating",
		Name:          "Composite Armor Plating",
		Category:      WarComponentCategoryDefense,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainGround, UnitDomainSpace},
		SlotType:      "armor",
		VisibleTechID: "prototype",
		Tags:          []string{"armor", "durability"},
	},
	{
		ID:            "deflector_shield_array",
		Name:          "Deflector Shield Array",
		Category:      WarComponentCategoryDefense,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainAir, UnitDomainSpace},
		SlotType:      "shield",
		VisibleTechID: "precision_drone",
		Tags:          []string{"shield", "screen"},
	},
	{
		ID:            "battlefield_sensor_suite",
		Name:          "Battlefield Sensor Suite",
		Category:      WarComponentCategorySensor,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainGround, UnitDomainAir},
		SlotType:      "sensor",
		VisibleTechID: "prototype",
		Tags:          []string{"targeting", "scouting"},
	},
	{
		ID:            "deep_space_radar",
		Name:          "Deep Space Radar",
		Category:      WarComponentCategorySensor,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainSpace},
		SlotType:      "sensor",
		VisibleTechID: "corvette",
		Tags:          []string{"radar", "tracking"},
	},
	{
		ID:            "pulse_laser_mount",
		Name:          "Pulse Laser Mount",
		Category:      WarComponentCategoryWeapon,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainGround, UnitDomainSpace},
		SlotType:      "primary_weapon",
		VisibleTechID: "prototype",
		Tags:          []string{"laser", "direct_fire"},
	},
	{
		ID:            "micro_missile_rack",
		Name:          "Micro Missile Rack",
		Category:      WarComponentCategoryWeapon,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainAir},
		SlotType:      "primary_weapon",
		VisibleTechID: "precision_drone",
		Tags:          []string{"missile", "strike"},
	},
	{
		ID:            "coilgun_battery",
		Name:          "Coilgun Battery",
		Category:      WarComponentCategoryWeapon,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainSpace},
		SlotType:      "primary_weapon",
		VisibleTechID: "destroyer",
		Tags:          []string{"kinetic", "line"},
	},
	{
		ID:            "command_uplink",
		Name:          "Command Uplink",
		Category:      WarComponentCategoryUtility,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainGround, UnitDomainAir},
		SlotType:      "utility",
		VisibleTechID: "prototype",
		Tags:          []string{"coordination", "uplink"},
	},
	{
		ID:            "repair_drone_bay",
		Name:          "Repair Drone Bay",
		Category:      WarComponentCategoryUtility,
		Public:        true,
		Domains:       []UnitDomain{UnitDomainSpace},
		SlotType:      "utility",
		VisibleTechID: "corvette",
		Tags:          []string{"support", "maintenance"},
	},
}

var publicBlueprintCatalogEntries = []PublicBlueprintCatalogEntry{
	{
		ID:              ItemPrototype,
		Name:            "Prototype Standard Pattern",
		Domain:          UnitDomainGround,
		RuntimeClass:    UnitRuntimeClassCombatSquad,
		Public:          true,
		Source:          WarBlueprintSourcePreset,
		VisibleTechID:   "prototype",
		BaseFrameID:     "light_frame",
		OutputItemID:    ItemPrototype,
		ProducerRecipes: []string{ItemPrototype},
		DeployCommand:   "deploy_squad",
		QueryScopes:     []string{"planet_runtime"},
		Commands:        []string{"deploy_squad"},
		ComponentIDs: []string{
			"compact_reactor",
			"servo_actuator_pack",
			"composite_armor_plating",
			"battlefield_sensor_suite",
			"pulse_laser_mount",
			"command_uplink",
		},
		Summary: "Starter frontline mech frame for direct deployment.",
	},
	{
		ID:              ItemPrecisionDrone,
		Name:            "Precision Drone Strike Pattern",
		Domain:          UnitDomainAir,
		RuntimeClass:    UnitRuntimeClassCombatSquad,
		Public:          true,
		Source:          WarBlueprintSourcePreset,
		VisibleTechID:   "precision_drone",
		BaseFrameID:     "aerial_frame",
		OutputItemID:    ItemPrecisionDrone,
		ProducerRecipes: []string{ItemPrecisionDrone},
		DeployCommand:   "deploy_squad",
		QueryScopes:     []string{"planet_runtime"},
		Commands:        []string{"deploy_squad"},
		ComponentIDs: []string{
			"compact_reactor",
			"vector_thruster_pack",
			"deflector_shield_array",
			"battlefield_sensor_suite",
			"micro_missile_rack",
			"command_uplink",
		},
		Summary: "Fast air support blueprint focused on missile pressure.",
	},
	{
		ID:              ItemCorvette,
		Name:            "Corvette Escort Pattern",
		Domain:          UnitDomainSpace,
		RuntimeClass:    UnitRuntimeClassFleet,
		Public:          true,
		Source:          WarBlueprintSourcePreset,
		VisibleTechID:   "corvette",
		BaseHullID:      "corvette_hull",
		OutputItemID:    ItemCorvette,
		ProducerRecipes: []string{ItemCorvette},
		DeployCommand:   "commission_fleet",
		QueryScopes:     []string{"system_runtime", "fleet"},
		Commands:        []string{"commission_fleet", "fleet_assign", "fleet_attack", "fleet_disband"},
		ComponentIDs: []string{
			"micro_fusion_core",
			"ion_drive_cluster",
			"deflector_shield_array",
			"deep_space_radar",
			"pulse_laser_mount",
			"repair_drone_bay",
		},
		Summary: "Escort hull for screening and intercept duties.",
	},
	{
		ID:              ItemDestroyer,
		Name:            "Destroyer Line Pattern",
		Domain:          UnitDomainSpace,
		RuntimeClass:    UnitRuntimeClassFleet,
		Public:          true,
		Source:          WarBlueprintSourcePreset,
		VisibleTechID:   "destroyer",
		BaseHullID:      "destroyer_hull",
		OutputItemID:    ItemDestroyer,
		ProducerRecipes: []string{ItemDestroyer},
		DeployCommand:   "commission_fleet",
		QueryScopes:     []string{"system_runtime", "fleet"},
		Commands:        []string{"commission_fleet", "fleet_assign", "fleet_attack", "fleet_disband"},
		ComponentIDs: []string{
			"micro_fusion_core",
			"ion_drive_cluster",
			"composite_armor_plating",
			"deep_space_radar",
			"coilgun_battery",
			"repair_drone_bay",
		},
		Summary: "Line hull for heavier screening and sustained fire.",
	},
}

var warBlueprintRuntimeProfiles = map[string]WarBlueprintRuntimeProfile{
	ItemPrototype: {
		SquadBaseHP: 80,
		SquadWeapon: WeaponState{Type: WeaponTypeLaser, Damage: 20, FireRate: 10, Range: 8, AmmoCost: 0},
		SquadShield: ShieldState{Level: 20, MaxLevel: 20, RechargeRate: 1, RechargeDelay: 10},
	},
	ItemPrecisionDrone: {
		SquadBaseHP: 60,
		SquadWeapon: WeaponState{Type: WeaponTypeMissile, Damage: 35, FireRate: 8, Range: 12, AmmoCost: 0},
		SquadShield: ShieldState{Level: 30, MaxLevel: 30, RechargeRate: 1.5, RechargeDelay: 8},
	},
	ItemCorvette: {
		FleetWeaponType:          WeaponTypeLaser,
		FleetWeaponDamage:        40,
		FleetWeaponFireRate:      10,
		FleetWeaponRange:         24,
		FleetShield:              40,
		FleetShieldRechargeRate:  2,
		FleetShieldRechargeDelay: 10,
	},
	ItemDestroyer: {
		FleetWeaponType:          WeaponTypeLaser,
		FleetWeaponDamage:        80,
		FleetWeaponFireRate:      10,
		FleetWeaponRange:         24,
		FleetShield:              80,
		FleetShieldRechargeRate:  2,
		FleetShieldRechargeDelay: 10,
	},
}

func PublicBaseFrameCatalogEntries() []BaseFrameCatalogEntry {
	out := make([]BaseFrameCatalogEntry, 0, len(baseFrameCatalogEntries))
	for _, entry := range baseFrameCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, cloneBaseFrameCatalogEntry(entry))
	}
	return out
}

func PublicBaseHullCatalogEntries() []BaseHullCatalogEntry {
	out := make([]BaseHullCatalogEntry, 0, len(baseHullCatalogEntries))
	for _, entry := range baseHullCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, cloneBaseHullCatalogEntry(entry))
	}
	return out
}

func PublicWarComponentCatalogEntries() []WarComponentCatalogEntry {
	out := make([]WarComponentCatalogEntry, 0, len(warComponentCatalogEntries))
	for _, entry := range warComponentCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, cloneWarComponentCatalogEntry(entry))
	}
	return out
}

func PublicWarBlueprintCatalogEntries() []PublicBlueprintCatalogEntry {
	out := make([]PublicBlueprintCatalogEntry, 0, len(publicBlueprintCatalogEntries))
	for _, entry := range publicBlueprintCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, clonePublicBlueprintCatalogEntry(entry))
	}
	return out
}

func PublicWarBlueprintByID(id string) (PublicBlueprintCatalogEntry, bool) {
	for _, entry := range publicBlueprintCatalogEntries {
		if entry.ID != id || !entry.Public {
			continue
		}
		return clonePublicBlueprintCatalogEntry(entry), true
	}
	return PublicBlueprintCatalogEntry{}, false
}

func WarBlueprintRuntimeProfileByID(id string) (WarBlueprintRuntimeProfile, bool) {
	profile, ok := warBlueprintRuntimeProfiles[id]
	if !ok {
		return WarBlueprintRuntimeProfile{}, false
	}
	return profile, true
}

func cloneBaseFrameCatalogEntry(entry BaseFrameCatalogEntry) BaseFrameCatalogEntry {
	entry.Roles = append([]string(nil), entry.Roles...)
	return entry
}

func cloneBaseHullCatalogEntry(entry BaseHullCatalogEntry) BaseHullCatalogEntry {
	entry.Roles = append([]string(nil), entry.Roles...)
	return entry
}

func cloneWarComponentCatalogEntry(entry WarComponentCatalogEntry) WarComponentCatalogEntry {
	entry.Domains = append([]UnitDomain(nil), entry.Domains...)
	entry.Tags = append([]string(nil), entry.Tags...)
	return entry
}

func clonePublicBlueprintCatalogEntry(entry PublicBlueprintCatalogEntry) PublicBlueprintCatalogEntry {
	entry.ProducerRecipes = append([]string(nil), entry.ProducerRecipes...)
	entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
	entry.Commands = append([]string(nil), entry.Commands...)
	entry.ComponentIDs = append([]string(nil), entry.ComponentIDs...)
	return entry
}
