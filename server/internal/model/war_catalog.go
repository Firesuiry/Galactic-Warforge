package model

// WarComponentCategory is the authoritative component taxonomy for warfare blueprints.
type WarComponentCategory string

const (
	WarComponentCategoryPower      WarComponentCategory = "power"
	WarComponentCategoryPropulsion WarComponentCategory = "propulsion"
	WarComponentCategoryDefense    WarComponentCategory = "defense"
	WarComponentCategorySensor     WarComponentCategory = "sensor"
	WarComponentCategoryWeapon     WarComponentCategory = "weapon"
	WarComponentCategoryUtility    WarComponentCategory = "utility"
)

// WarBlueprintSource describes where a blueprint came from.
type WarBlueprintSource string

const (
	WarBlueprintSourcePreset WarBlueprintSource = "preset"
	WarBlueprintSourcePlayer WarBlueprintSource = "player"
)

// WarBudgetProfile records high-level chassis limits for future validation work.
type WarBudgetProfile struct {
	PowerOutput      int `json:"power_output,omitempty"`
	SustainedDraw    int `json:"sustained_draw,omitempty"`
	PeakDraw         int `json:"peak_draw,omitempty"`
	VolumeCapacity   int `json:"volume_capacity,omitempty"`
	MassCapacity     int `json:"mass_capacity,omitempty"`
	RigidityCapacity int `json:"rigidity_capacity,omitempty"`
	HeatCapacity     int `json:"heat_capacity,omitempty"`
	MaintenanceLimit int `json:"maintenance_limit,omitempty"`
}

// WarSlotSpec describes one chassis slot that can accept a component.
type WarSlotSpec struct {
	ID       string               `json:"id"`
	Category WarComponentCategory `json:"category"`
	Size     string               `json:"size,omitempty"`
	Required bool                 `json:"required,omitempty"`
	Notes    string               `json:"notes,omitempty"`
}

// WarBaseFrameCatalogEntry describes a designable ground/air frame.
type WarBaseFrameCatalogEntry struct {
	ID               string           `json:"id"`
	Name             string           `json:"name"`
	Role             string           `json:"role,omitempty"`
	Description      string           `json:"description,omitempty"`
	SupportedDomains []UnitDomain     `json:"supported_domains,omitempty"`
	VisibleTechID    string           `json:"visible_tech_id,omitempty"`
	Budgets          WarBudgetProfile `json:"budgets,omitempty"`
	Slots            []WarSlotSpec    `json:"slots,omitempty"`
}

// WarBaseHullCatalogEntry describes a designable orbital/space hull.
type WarBaseHullCatalogEntry struct {
	ID               string           `json:"id"`
	Name             string           `json:"name"`
	Role             string           `json:"role,omitempty"`
	Description      string           `json:"description,omitempty"`
	SupportedDomains []UnitDomain     `json:"supported_domains,omitempty"`
	VisibleTechID    string           `json:"visible_tech_id,omitempty"`
	Budgets          WarBudgetProfile `json:"budgets,omitempty"`
	Slots            []WarSlotSpec    `json:"slots,omitempty"`
}

// WarComponentCatalogEntry describes one authoritative warfare component.
type WarComponentCatalogEntry struct {
	ID               string               `json:"id"`
	Name             string               `json:"name"`
	Category         WarComponentCategory `json:"category"`
	SlotKind         string               `json:"slot_kind,omitempty"`
	SupportedDomains []UnitDomain         `json:"supported_domains,omitempty"`
	PowerOutput      int                  `json:"power_output,omitempty"`
	PowerDraw        int                  `json:"power_draw,omitempty"`
	Volume           int                  `json:"volume,omitempty"`
	Mass             int                  `json:"mass,omitempty"`
	RigidityLoad     int                  `json:"rigidity_load,omitempty"`
	HeatLoad         int                  `json:"heat_load,omitempty"`
	Maintenance      int                  `json:"maintenance,omitempty"`
	Tags             []string             `json:"tags,omitempty"`
}

// WarBlueprintComponentSlot records one installed component in a blueprint.
type WarBlueprintComponentSlot struct {
	SlotID      string `json:"slot_id"`
	ComponentID string `json:"component_id"`
}

// WarPublicBlueprintCatalogEntry describes a public preset blueprint ready for deployment.
type WarPublicBlueprintCatalogEntry struct {
	ID              string                      `json:"id"`
	Name            string                      `json:"name"`
	Domain          UnitDomain                  `json:"domain"`
	Source          WarBlueprintSource          `json:"source"`
	BaseFrameID     string                      `json:"base_frame_id,omitempty"`
	BaseHullID      string                      `json:"base_hull_id,omitempty"`
	VisibleTechID   string                      `json:"visible_tech_id,omitempty"`
	RuntimeClass    UnitRuntimeClass            `json:"runtime_class"`
	ProductionMode  UnitProductionMode          `json:"production_mode"`
	ProducerRecipes []string                    `json:"producer_recipes,omitempty"`
	DeployCommand   string                      `json:"deploy_command,omitempty"`
	QueryScopes     []string                    `json:"query_scopes,omitempty"`
	Commands        []string                    `json:"commands,omitempty"`
	Components      []WarBlueprintComponentSlot `json:"components,omitempty"`
}

// WarfareCatalogView exposes the public authoritative warfare catalog.
type WarfareCatalogView struct {
	BaseFrames       []WarBaseFrameCatalogEntry       `json:"base_frames,omitempty"`
	BaseHulls        []WarBaseHullCatalogEntry        `json:"base_hulls,omitempty"`
	Components       []WarComponentCatalogEntry       `json:"components,omitempty"`
	PublicBlueprints []WarPublicBlueprintCatalogEntry `json:"public_blueprints,omitempty"`
}

// WarStackRuntimeProfile holds the runtime combat profile for one deployed blueprint stack.
type WarStackRuntimeProfile struct {
	HP     int         `json:"hp"`
	Weapon WeaponState `json:"weapon"`
	Shield ShieldState `json:"shield"`
}

// WarBlueprintRuntimeProfile bridges authoritative blueprint ids to current runtime settlement stats.
type WarBlueprintRuntimeProfile struct {
	Squad     *WarStackRuntimeProfile `json:"squad,omitempty"`
	FleetUnit *WarStackRuntimeProfile `json:"fleet_unit,omitempty"`
}

var warBaseFrameEntries = []WarBaseFrameCatalogEntry{
	{
		ID:               "light_frame",
		Name:             "Light Frame",
		Role:             "recon_skirmish",
		Description:      "High mobility frame for scouts, drones and light frontline templates.",
		SupportedDomains: []UnitDomain{UnitDomainGround, UnitDomainAir},
		VisibleTechID:    "prototype",
		Budgets:          WarBudgetProfile{PowerOutput: 120, SustainedDraw: 90, PeakDraw: 120, VolumeCapacity: 96, MassCapacity: 80, RigidityCapacity: 72, HeatCapacity: 68, MaintenanceLimit: 3},
		Slots: []WarSlotSpec{
			{ID: "power_core", Category: WarComponentCategoryPower, Required: true},
			{ID: "mobility", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "utility", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "medium_frame",
		Name:             "Medium Frame",
		Role:             "frontline_generalist",
		Description:      "Balanced frame for sustained ground pushes and escort duties.",
		SupportedDomains: []UnitDomain{UnitDomainGround},
		Budgets:          WarBudgetProfile{PowerOutput: 180, SustainedDraw: 140, PeakDraw: 180, VolumeCapacity: 144, MassCapacity: 132, RigidityCapacity: 118, HeatCapacity: 110, MaintenanceLimit: 5},
		Slots: []WarSlotSpec{
			{ID: "power_core", Category: WarComponentCategoryPower, Required: true},
			{ID: "mobility", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "weapon_aux", Category: WarComponentCategoryWeapon},
			{ID: "utility", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "heavy_frame",
		Name:             "Heavy Frame",
		Role:             "breakthrough_guard",
		Description:      "Armor-heavy frame for defensive anchors and siege escorts.",
		SupportedDomains: []UnitDomain{UnitDomainGround},
		Budgets:          WarBudgetProfile{PowerOutput: 260, SustainedDraw: 210, PeakDraw: 280, VolumeCapacity: 220, MassCapacity: 220, RigidityCapacity: 180, HeatCapacity: 160, MaintenanceLimit: 8},
		Slots: []WarSlotSpec{
			{ID: "power_core", Category: WarComponentCategoryPower, Required: true},
			{ID: "mobility", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "weapon_aux", Category: WarComponentCategoryWeapon},
			{ID: "utility_0", Category: WarComponentCategoryUtility},
			{ID: "utility_1", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "assault_frame",
		Name:             "Assault Frame",
		Role:             "high_commitment_assault",
		Description:      "Oversized frame for shock assaults that require dedicated logistics.",
		SupportedDomains: []UnitDomain{UnitDomainGround},
		Budgets:          WarBudgetProfile{PowerOutput: 340, SustainedDraw: 270, PeakDraw: 360, VolumeCapacity: 280, MassCapacity: 300, RigidityCapacity: 240, HeatCapacity: 220, MaintenanceLimit: 11},
		Slots: []WarSlotSpec{
			{ID: "power_core", Category: WarComponentCategoryPower, Required: true},
			{ID: "mobility", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "weapon_aux", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "utility_0", Category: WarComponentCategoryUtility},
			{ID: "utility_1", Category: WarComponentCategoryUtility},
		},
	},
}

var warBaseHullEntries = []WarBaseHullCatalogEntry{
	{
		ID:               "corvette_hull",
		Name:             "Corvette Hull",
		Role:             "recon_intercept",
		Description:      "Fast response hull for patrol, harassment and screening.",
		SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace},
		VisibleTechID:    "corvette",
		Budgets:          WarBudgetProfile{PowerOutput: 320, SustainedDraw: 240, PeakDraw: 320, VolumeCapacity: 260, MassCapacity: 220, RigidityCapacity: 200, HeatCapacity: 180, MaintenanceLimit: 8},
		Slots: []WarSlotSpec{
			{ID: "reactor", Category: WarComponentCategoryPower, Required: true},
			{ID: "drive", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "utility", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "destroyer_hull",
		Name:             "Destroyer Hull",
		Role:             "escort_command",
		Description:      "Multi-role escort hull with stronger shields and point defense.",
		SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace},
		VisibleTechID:    "destroyer",
		Budgets:          WarBudgetProfile{PowerOutput: 460, SustainedDraw: 360, PeakDraw: 460, VolumeCapacity: 380, MassCapacity: 340, RigidityCapacity: 310, HeatCapacity: 260, MaintenanceLimit: 12},
		Slots: []WarSlotSpec{
			{ID: "reactor", Category: WarComponentCategoryPower, Required: true},
			{ID: "drive", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "weapon_aux", Category: WarComponentCategoryWeapon},
			{ID: "utility", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "cruiser_hull",
		Name:             "Cruiser Hull",
		Role:             "line_fire_support",
		Description:      "Long-range hull reserved for heavier fleet doctrines.",
		SupportedDomains: []UnitDomain{UnitDomainSpace},
		Budgets:          WarBudgetProfile{PowerOutput: 640, SustainedDraw: 500, PeakDraw: 680, VolumeCapacity: 560, MassCapacity: 520, RigidityCapacity: 430, HeatCapacity: 360, MaintenanceLimit: 16},
		Slots: []WarSlotSpec{
			{ID: "reactor", Category: WarComponentCategoryPower, Required: true},
			{ID: "drive", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "weapon_aux", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "utility", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "carrier_hull",
		Name:             "Carrier Hull",
		Role:             "drone_missile_platform",
		Description:      "Support hull built around hangars, datalinks and standoff fire.",
		SupportedDomains: []UnitDomain{UnitDomainSpace},
		Budgets:          WarBudgetProfile{PowerOutput: 620, SustainedDraw: 470, PeakDraw: 650, VolumeCapacity: 600, MassCapacity: 560, RigidityCapacity: 400, HeatCapacity: 340, MaintenanceLimit: 18},
		Slots: []WarSlotSpec{
			{ID: "reactor", Category: WarComponentCategoryPower, Required: true},
			{ID: "drive", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon},
			{ID: "utility_0", Category: WarComponentCategoryUtility},
			{ID: "utility_1", Category: WarComponentCategoryUtility},
		},
	},
	{
		ID:               "siege_hull",
		Name:             "Siege Hull",
		Role:             "orbital_pressure",
		Description:      "Slow heavy hull for orbital suppression and fortified pushes.",
		SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace},
		Budgets:          WarBudgetProfile{PowerOutput: 700, SustainedDraw: 560, PeakDraw: 760, VolumeCapacity: 660, MassCapacity: 680, RigidityCapacity: 520, HeatCapacity: 420, MaintenanceLimit: 22},
		Slots: []WarSlotSpec{
			{ID: "reactor", Category: WarComponentCategoryPower, Required: true},
			{ID: "drive", Category: WarComponentCategoryPropulsion, Required: true},
			{ID: "armor", Category: WarComponentCategoryDefense, Required: true},
			{ID: "sensor", Category: WarComponentCategorySensor, Required: true},
			{ID: "weapon_primary", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "weapon_aux", Category: WarComponentCategoryWeapon, Required: true},
			{ID: "utility", Category: WarComponentCategoryUtility},
		},
	},
}

var warComponentEntries = []WarComponentCatalogEntry{
	{ID: "micro_reactor", Name: "Micro Reactor", Category: WarComponentCategoryPower, SlotKind: "core", SupportedDomains: []UnitDomain{UnitDomainGround, UnitDomainAir}, PowerOutput: 140, Volume: 18, Mass: 14, HeatLoad: 8, Maintenance: 1, Tags: []string{"starter", "reactor"}},
	{ID: "naval_fission_core", Name: "Naval Fission Core", Category: WarComponentCategoryPower, SlotKind: "core", SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace}, PowerOutput: 380, Volume: 44, Mass: 36, HeatLoad: 18, Maintenance: 3, Tags: []string{"naval", "reactor"}},
	{ID: "servo_drive", Name: "Servo Drive", Category: WarComponentCategoryPropulsion, SlotKind: "mobility", SupportedDomains: []UnitDomain{UnitDomainGround}, PowerDraw: 28, Volume: 14, Mass: 10, RigidityLoad: 8, HeatLoad: 5, Maintenance: 1, Tags: []string{"ground"}},
	{ID: "vector_thrusters", Name: "Vector Thrusters", Category: WarComponentCategoryPropulsion, SlotKind: "drive", SupportedDomains: []UnitDomain{UnitDomainAir, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 54, Volume: 24, Mass: 18, RigidityLoad: 12, HeatLoad: 10, Maintenance: 2, Tags: []string{"flight", "naval"}},
	{ID: "reactive_armor", Name: "Reactive Armor", Category: WarComponentCategoryDefense, SlotKind: "armor", SupportedDomains: []UnitDomain{UnitDomainGround, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 8, Volume: 16, Mass: 20, RigidityLoad: 10, Maintenance: 1, Tags: []string{"armor"}},
	{ID: "escort_shield", Name: "Escort Shield", Category: WarComponentCategoryDefense, SlotKind: "shield", SupportedDomains: []UnitDomain{UnitDomainAir, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 36, Volume: 20, Mass: 14, HeatLoad: 8, Maintenance: 2, Tags: []string{"shield"}},
	{ID: "point_defense_grid", Name: "Point Defense Grid", Category: WarComponentCategoryDefense, SlotKind: "hardpoint", SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 22, Volume: 12, Mass: 8, HeatLoad: 6, Maintenance: 2, Tags: []string{"pd"}},
	{ID: "tactical_radar", Name: "Tactical Radar", Category: WarComponentCategorySensor, SlotKind: "sensor", SupportedDomains: []UnitDomain{UnitDomainGround, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 14, Volume: 8, Mass: 6, HeatLoad: 3, Maintenance: 1, Tags: []string{"active_sensor"}},
	{ID: "battle_link_array", Name: "Battle Link Array", Category: WarComponentCategorySensor, SlotKind: "sensor", SupportedDomains: []UnitDomain{UnitDomainAir, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 18, Volume: 10, Mass: 6, HeatLoad: 4, Maintenance: 1, Tags: []string{"datalink"}},
	{ID: "plasma_lance", Name: "Plasma Lance", Category: WarComponentCategoryWeapon, SlotKind: "weapon", SupportedDomains: []UnitDomain{UnitDomainGround, UnitDomainSpace}, PowerDraw: 42, Volume: 20, Mass: 16, RigidityLoad: 12, HeatLoad: 16, Maintenance: 2, Tags: []string{"direct_fire"}},
	{ID: "swarm_missile_pod", Name: "Swarm Missile Pod", Category: WarComponentCategoryWeapon, SlotKind: "weapon", SupportedDomains: []UnitDomain{UnitDomainAir, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 24, Volume: 16, Mass: 12, RigidityLoad: 6, HeatLoad: 8, Maintenance: 2, Tags: []string{"missile"}},
	{ID: "coilgun_battery", Name: "Coilgun Battery", Category: WarComponentCategoryWeapon, SlotKind: "weapon", SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 56, Volume: 26, Mass: 20, RigidityLoad: 16, HeatLoad: 14, Maintenance: 3, Tags: []string{"kinetic"}},
	{ID: "field_repair_pack", Name: "Field Repair Pack", Category: WarComponentCategoryUtility, SlotKind: "utility", SupportedDomains: []UnitDomain{UnitDomainGround}, PowerDraw: 10, Volume: 8, Mass: 6, Maintenance: 1, Tags: []string{"repair"}},
	{ID: "ecm_suite", Name: "ECM Suite", Category: WarComponentCategoryUtility, SlotKind: "utility", SupportedDomains: []UnitDomain{UnitDomainAir, UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 16, Volume: 10, Mass: 8, HeatLoad: 4, Maintenance: 1, Tags: []string{"ecm"}},
	{ID: "drone_bay", Name: "Drone Bay", Category: WarComponentCategoryUtility, SlotKind: "utility", SupportedDomains: []UnitDomain{UnitDomainOrbital, UnitDomainSpace}, PowerDraw: 20, Volume: 18, Mass: 14, HeatLoad: 6, Maintenance: 2, Tags: []string{"hangar"}},
}

var warPublicBlueprintEntries = []WarPublicBlueprintCatalogEntry{
	{
		ID:              ItemPrototype,
		Name:            "Prototype",
		Domain:          UnitDomainGround,
		Source:          WarBlueprintSourcePreset,
		BaseFrameID:     "light_frame",
		VisibleTechID:   "prototype",
		RuntimeClass:    UnitRuntimeClassCombatSquad,
		ProductionMode:  UnitProductionModeFactoryRecipe,
		ProducerRecipes: []string{"prototype"},
		DeployCommand:   "deploy_squad",
		QueryScopes:     []string{"planet_runtime"},
		Commands:        []string{"deploy_squad"},
		Components: []WarBlueprintComponentSlot{
			{SlotID: "power_core", ComponentID: "micro_reactor"},
			{SlotID: "mobility", ComponentID: "servo_drive"},
			{SlotID: "armor", ComponentID: "reactive_armor"},
			{SlotID: "sensor", ComponentID: "tactical_radar"},
			{SlotID: "weapon_primary", ComponentID: "plasma_lance"},
			{SlotID: "utility", ComponentID: "field_repair_pack"},
		},
	},
	{
		ID:              ItemPrecisionDrone,
		Name:            "Precision Drone",
		Domain:          UnitDomainAir,
		Source:          WarBlueprintSourcePreset,
		BaseFrameID:     "light_frame",
		VisibleTechID:   "precision_drone",
		RuntimeClass:    UnitRuntimeClassCombatSquad,
		ProductionMode:  UnitProductionModeFactoryRecipe,
		ProducerRecipes: []string{"precision_drone"},
		DeployCommand:   "deploy_squad",
		QueryScopes:     []string{"planet_runtime"},
		Commands:        []string{"deploy_squad"},
		Components: []WarBlueprintComponentSlot{
			{SlotID: "power_core", ComponentID: "micro_reactor"},
			{SlotID: "mobility", ComponentID: "vector_thrusters"},
			{SlotID: "armor", ComponentID: "escort_shield"},
			{SlotID: "sensor", ComponentID: "battle_link_array"},
			{SlotID: "weapon_primary", ComponentID: "swarm_missile_pod"},
			{SlotID: "utility", ComponentID: "ecm_suite"},
		},
	},
	{
		ID:              ItemCorvette,
		Name:            "Corvette",
		Domain:          UnitDomainSpace,
		Source:          WarBlueprintSourcePreset,
		BaseHullID:      "corvette_hull",
		VisibleTechID:   "corvette",
		RuntimeClass:    UnitRuntimeClassFleet,
		ProductionMode:  UnitProductionModeFactoryRecipe,
		ProducerRecipes: []string{"corvette"},
		DeployCommand:   "commission_fleet",
		QueryScopes:     []string{"system_runtime", "fleet"},
		Commands:        []string{"commission_fleet", "fleet_assign", "fleet_attack", "fleet_disband"},
		Components: []WarBlueprintComponentSlot{
			{SlotID: "reactor", ComponentID: "naval_fission_core"},
			{SlotID: "drive", ComponentID: "vector_thrusters"},
			{SlotID: "armor", ComponentID: "escort_shield"},
			{SlotID: "sensor", ComponentID: "tactical_radar"},
			{SlotID: "weapon_primary", ComponentID: "coilgun_battery"},
			{SlotID: "utility", ComponentID: "ecm_suite"},
		},
	},
	{
		ID:              ItemDestroyer,
		Name:            "Destroyer",
		Domain:          UnitDomainSpace,
		Source:          WarBlueprintSourcePreset,
		BaseHullID:      "destroyer_hull",
		VisibleTechID:   "destroyer",
		RuntimeClass:    UnitRuntimeClassFleet,
		ProductionMode:  UnitProductionModeFactoryRecipe,
		ProducerRecipes: []string{"destroyer"},
		DeployCommand:   "commission_fleet",
		QueryScopes:     []string{"system_runtime", "fleet"},
		Commands:        []string{"commission_fleet", "fleet_assign", "fleet_attack", "fleet_disband"},
		Components: []WarBlueprintComponentSlot{
			{SlotID: "reactor", ComponentID: "naval_fission_core"},
			{SlotID: "drive", ComponentID: "vector_thrusters"},
			{SlotID: "armor", ComponentID: "escort_shield"},
			{SlotID: "sensor", ComponentID: "battle_link_array"},
			{SlotID: "weapon_primary", ComponentID: "plasma_lance"},
			{SlotID: "weapon_aux", ComponentID: "point_defense_grid"},
			{SlotID: "utility", ComponentID: "drone_bay"},
		},
	},
}

var warBlueprintRuntimeProfiles = map[string]WarBlueprintRuntimeProfile{
	ItemPrototype: {
		Squad: &WarStackRuntimeProfile{
			HP:     80,
			Weapon: WeaponState{Type: WeaponTypeLaser, Damage: 20, FireRate: 10, Range: 8, AmmoCost: 0},
			Shield: ShieldState{Level: 20, MaxLevel: 20, RechargeRate: 1, RechargeDelay: 10},
		},
	},
	ItemPrecisionDrone: {
		Squad: &WarStackRuntimeProfile{
			HP:     60,
			Weapon: WeaponState{Type: WeaponTypeMissile, Damage: 35, FireRate: 8, Range: 12, AmmoCost: 0},
			Shield: ShieldState{Level: 30, MaxLevel: 30, RechargeRate: 1.5, RechargeDelay: 8},
		},
	},
	ItemCorvette: {
		FleetUnit: &WarStackRuntimeProfile{
			HP:     100,
			Weapon: WeaponState{Type: WeaponTypeLaser, Damage: 40, FireRate: 10, Range: 24, AmmoCost: 0},
			Shield: ShieldState{Level: 40, MaxLevel: 40, RechargeRate: 2, RechargeDelay: 10},
		},
	},
	ItemDestroyer: {
		FleetUnit: &WarStackRuntimeProfile{
			HP:     180,
			Weapon: WeaponState{Type: WeaponTypeLaser, Damage: 80, FireRate: 10, Range: 24, AmmoCost: 0},
			Shield: ShieldState{Level: 80, MaxLevel: 80, RechargeRate: 2, RechargeDelay: 10},
		},
	},
}

// PublicWarfareCatalog returns the immutable warfare-facing authoritative catalog snapshot.
func PublicWarfareCatalog() *WarfareCatalogView {
	return &WarfareCatalogView{
		BaseFrames:       cloneWarBaseFrameEntries(warBaseFrameEntries),
		BaseHulls:        cloneWarBaseHullEntries(warBaseHullEntries),
		Components:       cloneWarComponentEntries(warComponentEntries),
		PublicBlueprints: cloneWarPublicBlueprintEntries(warPublicBlueprintEntries),
	}
}

// PublicWarBlueprintByID returns one public preset blueprint entry.
func PublicWarBlueprintByID(id string) (WarPublicBlueprintCatalogEntry, bool) {
	for _, entry := range warPublicBlueprintEntries {
		if entry.ID != id {
			continue
		}
		return cloneWarPublicBlueprintEntry(entry), true
	}
	return WarPublicBlueprintCatalogEntry{}, false
}

// WarBlueprintRuntimeProfileByID returns the runtime combat profile for one blueprint id.
func WarBlueprintRuntimeProfileByID(id string) (WarBlueprintRuntimeProfile, bool) {
	profile, ok := warBlueprintRuntimeProfiles[id]
	if !ok {
		return WarBlueprintRuntimeProfile{}, false
	}
	return cloneWarBlueprintRuntimeProfile(profile), true
}

func cloneWarBaseFrameEntries(entries []WarBaseFrameCatalogEntry) []WarBaseFrameCatalogEntry {
	out := make([]WarBaseFrameCatalogEntry, 0, len(entries))
	for _, entry := range entries {
		clone := entry
		clone.SupportedDomains = append([]UnitDomain(nil), entry.SupportedDomains...)
		clone.Slots = append([]WarSlotSpec(nil), entry.Slots...)
		out = append(out, clone)
	}
	return out
}

func cloneWarBaseHullEntries(entries []WarBaseHullCatalogEntry) []WarBaseHullCatalogEntry {
	out := make([]WarBaseHullCatalogEntry, 0, len(entries))
	for _, entry := range entries {
		clone := entry
		clone.SupportedDomains = append([]UnitDomain(nil), entry.SupportedDomains...)
		clone.Slots = append([]WarSlotSpec(nil), entry.Slots...)
		out = append(out, clone)
	}
	return out
}

func cloneWarComponentEntries(entries []WarComponentCatalogEntry) []WarComponentCatalogEntry {
	out := make([]WarComponentCatalogEntry, 0, len(entries))
	for _, entry := range entries {
		clone := entry
		clone.SupportedDomains = append([]UnitDomain(nil), entry.SupportedDomains...)
		clone.Tags = append([]string(nil), entry.Tags...)
		out = append(out, clone)
	}
	return out
}

func cloneWarPublicBlueprintEntries(entries []WarPublicBlueprintCatalogEntry) []WarPublicBlueprintCatalogEntry {
	out := make([]WarPublicBlueprintCatalogEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, cloneWarPublicBlueprintEntry(entry))
	}
	return out
}

func cloneWarPublicBlueprintEntry(entry WarPublicBlueprintCatalogEntry) WarPublicBlueprintCatalogEntry {
	entry.ProducerRecipes = append([]string(nil), entry.ProducerRecipes...)
	entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
	entry.Commands = append([]string(nil), entry.Commands...)
	entry.Components = append([]WarBlueprintComponentSlot(nil), entry.Components...)
	return entry
}

func cloneWarBlueprintRuntimeProfile(profile WarBlueprintRuntimeProfile) WarBlueprintRuntimeProfile {
	out := profile
	if profile.Squad != nil {
		squadCopy := *profile.Squad
		out.Squad = &squadCopy
	}
	if profile.FleetUnit != nil {
		fleetCopy := *profile.FleetUnit
		out.FleetUnit = &fleetCopy
	}
	return out
}
