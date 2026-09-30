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
	PowerOutput      int `json:"power_output,omitempty" yaml:"power_output,omitempty"`
	SustainedDraw    int `json:"sustained_draw,omitempty" yaml:"sustained_draw,omitempty"`
	PeakDraw         int `json:"peak_draw,omitempty" yaml:"peak_draw,omitempty"`
	VolumeCapacity   int `json:"volume_capacity,omitempty" yaml:"volume_capacity,omitempty"`
	MassCapacity     int `json:"mass_capacity,omitempty" yaml:"mass_capacity,omitempty"`
	RigidityCapacity int `json:"rigidity_capacity,omitempty" yaml:"rigidity_capacity,omitempty"`
	HeatCapacity     int `json:"heat_capacity,omitempty" yaml:"heat_capacity,omitempty"`
	MaintenanceLimit int `json:"maintenance_limit,omitempty" yaml:"maintenance_limit,omitempty"`
	SignalCapacity   int `json:"signal_capacity,omitempty" yaml:"signal_capacity,omitempty"`
}

// WarSlotSpec describes one chassis slot that can accept a component.
type WarSlotSpec struct {
	ID       string               `json:"id" yaml:"id"`
	Category WarComponentCategory `json:"category" yaml:"category,omitempty"`
	Size     string               `json:"size,omitempty" yaml:"size,omitempty"`
	Required bool                 `json:"required,omitempty" yaml:"required,omitempty"`
	Notes    string               `json:"notes,omitempty" yaml:"notes,omitempty"`
}

// WarBaseFrameCatalogEntry describes a designable ground/air frame.
type WarBaseFrameCatalogEntry struct {
	ID               string           `json:"id" yaml:"id"`
	Name             string           `json:"name" yaml:"name"`
	Role             string           `json:"role,omitempty" yaml:"role,omitempty"`
	Description      string           `json:"description,omitempty" yaml:"description,omitempty"`
	SupportedDomains []UnitDomain     `json:"supported_domains,omitempty" yaml:"supported_domains,omitempty"`
	VisibleTechID    string           `json:"visible_tech_id,omitempty" yaml:"visible_tech_id,omitempty"`
	Budgets          WarBudgetProfile `json:"budgets,omitempty" yaml:"budgets,omitempty"`
	Slots            []WarSlotSpec    `json:"slots,omitempty" yaml:"slots,omitempty"`
}

// WarBaseHullCatalogEntry describes a designable orbital/space hull.
type WarBaseHullCatalogEntry struct {
	ID               string           `json:"id" yaml:"id"`
	Name             string           `json:"name" yaml:"name"`
	Role             string           `json:"role,omitempty" yaml:"role,omitempty"`
	Description      string           `json:"description,omitempty" yaml:"description,omitempty"`
	SupportedDomains []UnitDomain     `json:"supported_domains,omitempty" yaml:"supported_domains,omitempty"`
	VisibleTechID    string           `json:"visible_tech_id,omitempty" yaml:"visible_tech_id,omitempty"`
	Budgets          WarBudgetProfile `json:"budgets,omitempty" yaml:"budgets,omitempty"`
	Slots            []WarSlotSpec    `json:"slots,omitempty" yaml:"slots,omitempty"`
}

// WarComponentCatalogEntry describes one authoritative warfare component.
type WarComponentCatalogEntry struct {
	ID               string               `json:"id" yaml:"id"`
	Name             string               `json:"name" yaml:"name"`
	Category         WarComponentCategory `json:"category" yaml:"category,omitempty"`
	SlotKind         string               `json:"slot_kind,omitempty" yaml:"slot_kind,omitempty"`
	SupportedDomains []UnitDomain         `json:"supported_domains,omitempty" yaml:"supported_domains,omitempty"`
	PowerOutput      int                  `json:"power_output,omitempty" yaml:"power_output,omitempty"`
	PowerDraw        int                  `json:"power_draw,omitempty" yaml:"power_draw,omitempty"`
	Volume           int                  `json:"volume,omitempty" yaml:"volume,omitempty"`
	Mass             int                  `json:"mass,omitempty" yaml:"mass,omitempty"`
	RigidityLoad     int                  `json:"rigidity_load,omitempty" yaml:"rigidity_load,omitempty"`
	HeatLoad         int                  `json:"heat_load,omitempty" yaml:"heat_load,omitempty"`
	Maintenance      int                  `json:"maintenance,omitempty" yaml:"maintenance,omitempty"`
	SignalLoad       int                  `json:"signal_load,omitempty" yaml:"signal_load,omitempty"`
	StealthRating    int                  `json:"stealth_rating,omitempty" yaml:"stealth_rating,omitempty"`
	Tags             []string             `json:"tags,omitempty" yaml:"tags,omitempty"`
}

// WarBlueprintComponentSlot records one installed component in a blueprint.
type WarBlueprintComponentSlot struct {
	SlotID      string `json:"slot_id" yaml:"slot_id,omitempty"`
	ComponentID string `json:"component_id" yaml:"component_id,omitempty"`
}

// WarPublicBlueprintCatalogEntry describes a public preset blueprint ready for deployment.
type WarPublicBlueprintCatalogEntry struct {
	ID             string                      `json:"id" yaml:"id"`
	Name           string                      `json:"name" yaml:"name"`
	Domain         UnitDomain                  `json:"domain" yaml:"domain,omitempty"`
	Source         WarBlueprintSource          `json:"source" yaml:"source,omitempty"`
	BaseFrameID    string                      `json:"base_frame_id,omitempty" yaml:"base_frame_id,omitempty"`
	BaseHullID     string                      `json:"base_hull_id,omitempty" yaml:"base_hull_id,omitempty"`
	VisibleTechID  string                      `json:"visible_tech_id,omitempty" yaml:"visible_tech_id,omitempty"`
	RuntimeClass   UnitRuntimeClass            `json:"runtime_class" yaml:"runtime_class,omitempty"`
	ProductionMode UnitProductionMode          `json:"production_mode" yaml:"production_mode,omitempty"`
	DeployCommand  string                      `json:"deploy_command,omitempty" yaml:"deploy_command,omitempty"`
	QueryScopes    []string                    `json:"query_scopes,omitempty" yaml:"query_scopes,omitempty"`
	Commands       []string                    `json:"commands,omitempty" yaml:"commands,omitempty"`
	Components     []WarBlueprintComponentSlot `json:"components,omitempty" yaml:"components,omitempty"`
	// 输出时填充，与结算同源：护甲见 BlueprintCombatClasses，数值取运行时档案。
	ArmorClass  ArmorClass `json:"armor_class,omitempty" yaml:"-"`
	WeaponClass WeaponType `json:"weapon_class,omitempty" yaml:"-"`
	Attack      int        `json:"attack,omitempty" yaml:"-"`
	Range       float64    `json:"range,omitempty" yaml:"-"`
	MaxHP       int        `json:"max_hp,omitempty" yaml:"-"`
}

// WarfareCatalogView exposes the public authoritative warfare catalog.
type WarfareCatalogView struct {
	BaseFrames       []WarBaseFrameCatalogEntry       `json:"base_frames,omitempty" yaml:"base_frames,omitempty"`
	BaseHulls        []WarBaseHullCatalogEntry        `json:"base_hulls,omitempty" yaml:"base_hulls,omitempty"`
	Components       []WarComponentCatalogEntry       `json:"components,omitempty" yaml:"components,omitempty"`
	PublicBlueprints []WarPublicBlueprintCatalogEntry `json:"public_blueprints,omitempty" yaml:"public_blueprints,omitempty"`
}

// WarStackRuntimeProfile holds the runtime combat profile for one deployed blueprint stack.
type WarStackRuntimeProfile struct {
	HP     int         `json:"hp" yaml:"hp,omitempty"`
	Weapon WeaponState `json:"weapon" yaml:"weapon,omitempty"`
	Shield ShieldState `json:"shield" yaml:"shield,omitempty"`
}

// WarBlueprintRuntimeProfile bridges authoritative blueprint ids to current runtime settlement stats.
type WarBlueprintRuntimeProfile struct {
	Squad     *WarStackRuntimeProfile `json:"squad,omitempty" yaml:"squad,omitempty"`
	FleetUnit *WarStackRuntimeProfile `json:"fleet_unit,omitempty" yaml:"fleet_unit,omitempty"`
}

// BlueprintCombatClasses 推导蓝图护甲，并在有档案时返回武器类型。
// combat_squad：空中域或 drone 平台为 air，否则 heavy。fleet_unit：ship。
// 无档案时 weapon 为空，目录省略。
func BlueprintCombatClasses(runtimeClass UnitRuntimeClass, domain UnitDomain, platformClass, blueprintID string) (ArmorClass, WeaponType) {
	return blueprintArmorClass(runtimeClass, domain, platformClass), blueprintWeaponClass(runtimeClass, blueprintID)
}

func blueprintArmorClass(runtimeClass UnitRuntimeClass, domain UnitDomain, platformClass string) ArmorClass {
	switch runtimeClass {
	case UnitRuntimeClassFleet:
		return ArmorShip
	case UnitRuntimeClassCombatSquad:
		if domain == UnitDomainAir || platformClass == "drone" {
			return ArmorAir
		}
		return ArmorHeavy
	default:
		return ""
	}
}

func blueprintWeaponClass(runtimeClass UnitRuntimeClass, blueprintID string) WeaponType {
	stack := blueprintRuntimeStack(blueprintID, runtimeClass)
	if stack == nil {
		return ""
	}
	return stack.Weapon.Type
}

func blueprintRuntimeStack(blueprintID string, runtimeClass UnitRuntimeClass) *WarStackRuntimeProfile {
	profile, ok := warBlueprintRuntimeProfiles[blueprintID]
	if !ok {
		return nil
	}
	switch runtimeClass {
	case UnitRuntimeClassFleet:
		return profile.FleetUnit
	case UnitRuntimeClassCombatSquad:
		return profile.Squad
	default:
		return nil
	}
}

func (entry WarPublicBlueprintCatalogEntry) withDerivedCombatStats() WarPublicBlueprintCatalogEntry {
	entry.ArmorClass, entry.WeaponClass = BlueprintCombatClasses(entry.RuntimeClass, entry.Domain, "", entry.ID)
	if stack := blueprintRuntimeStack(entry.ID, entry.RuntimeClass); stack != nil {
		entry.Attack = stack.Weapon.Damage
		entry.Range = stack.Weapon.Range
		entry.MaxHP = stack.HP
	}
	return entry
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
	entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
	entry.Commands = append([]string(nil), entry.Commands...)
	entry.Components = append([]WarBlueprintComponentSlot(nil), entry.Components...)
	return entry.withDerivedCombatStats()
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
