package model

// UnitDomain describes the space a unit or blueprint lives in.
type UnitDomain string

const (
	UnitDomainGround  UnitDomain = "ground"
	UnitDomainAir     UnitDomain = "air"
	UnitDomainOrbital UnitDomain = "orbital"
	UnitDomainSpace   UnitDomain = "space"
)

// UnitRuntimeClass describes which authoritative runtime owns the unit.
type UnitRuntimeClass string

const (
	UnitRuntimeClassWorld       UnitRuntimeClass = "world_unit"
	UnitRuntimeClassCombatSquad UnitRuntimeClass = "combat_squad"
	UnitRuntimeClassFleet       UnitRuntimeClass = "fleet_unit"
)

// UnitProductionMode describes how a unit enters the world.
type UnitProductionMode string

const (
	UnitProductionModeWorldProduce  UnitProductionMode = "world_produce"
	UnitProductionModeFactoryRecipe UnitProductionMode = "factory_recipe"
	UnitProductionModeInternal      UnitProductionMode = "internal"
)

// WorldUnitCatalogEntry is the authoritative public-facing catalog entry for non-blueprint world units.
//
// 战斗数值（armor_class/weapon_class/attack/attack_range/attack_cooldown_tick/
// move_speed/max_hp）不在本表中重复登记：对外输出时统一从 UnitStats 派生（R6），
// 保证 catalog 与运行时结算共用单一数据源。
type WorldUnitCatalogEntry struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	Domain         UnitDomain         `json:"domain"`
	RuntimeClass   UnitRuntimeClass   `json:"runtime_class"`
	Public         bool               `json:"public"`
	ProductionMode UnitProductionMode `json:"production_mode"`
	QueryScopes    []string           `json:"query_scopes,omitempty"`
	Commands       []string           `json:"commands,omitempty"`
	HiddenReason   string             `json:"hidden_reason,omitempty"`

	// R6 战斗数值（派生自 UnitStats）。
	ArmorClass         ArmorClass `json:"armor_class,omitempty"`
	WeaponClass        WeaponType `json:"weapon_class,omitempty"`
	Attack             int        `json:"attack"`
	AttackRange        int        `json:"attack_range"`
	AttackCooldownTick int64      `json:"attack_cooldown_tick"`
	MoveSpeed          float64    `json:"move_speed"`
	MaxHP              int        `json:"max_hp"`
}

var worldUnitCatalogEntries = []WorldUnitCatalogEntry{
	{
		ID:             string(UnitTypeWorker),
		Name:           "Worker",
		Domain:         UnitDomainGround,
		RuntimeClass:   UnitRuntimeClassWorld,
		Public:         true,
		ProductionMode: UnitProductionModeWorldProduce,
		QueryScopes:    []string{"planet"},
		Commands:       []string{"move"},
	},
	{
		ID:             string(UnitTypeSoldier),
		Name:           "Soldier",
		Domain:         UnitDomainGround,
		RuntimeClass:   UnitRuntimeClassWorld,
		Public:         true,
		ProductionMode: UnitProductionModeWorldProduce,
		QueryScopes:    []string{"planet"},
		Commands:       []string{"move", "attack"},
	},
	{
		ID:             string(UnitTypeMecha),
		Name:           "Mecha",
		Domain:         UnitDomainGround,
		RuntimeClass:   UnitRuntimeClassWorld,
		Public:         true,
		ProductionMode: UnitProductionModeWorldProduce,
		QueryScopes:    []string{"planet"},
		Commands:       []string{"move", "attack"},
	},
}

// withDerivedCombatStats 从 UnitStats 派生战斗数值（R6 单一数据源）。
func (entry WorldUnitCatalogEntry) withDerivedCombatStats() WorldUnitCatalogEntry {
	stats := UnitStats(UnitType(entry.ID))
	entry.ArmorClass = stats.ArmorClass
	entry.WeaponClass = stats.WeaponClass
	entry.Attack = stats.Attack
	entry.AttackRange = stats.AttackRange
	entry.AttackCooldownTick = stats.AttackCooldownTick
	entry.MoveSpeed = stats.MoveSpeed
	entry.MaxHP = stats.MaxHP
	return entry
}

// PublicWorldUnitCatalogEntries returns the public world-unit catalog snapshot.
func PublicWorldUnitCatalogEntries() []WorldUnitCatalogEntry {
	out := make([]WorldUnitCatalogEntry, 0, len(worldUnitCatalogEntries))
	for _, entry := range worldUnitCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, cloneWorldUnitCatalogEntry(entry).withDerivedCombatStats())
	}
	return out
}

// PublicWorldUnitByID returns one public-facing world-unit entry.
func PublicWorldUnitByID(id string) (WorldUnitCatalogEntry, bool) {
	for _, entry := range worldUnitCatalogEntries {
		if entry.ID != id || !entry.Public {
			continue
		}
		return cloneWorldUnitCatalogEntry(entry).withDerivedCombatStats(), true
	}
	return WorldUnitCatalogEntry{}, false
}

// PublicWorldProduceUnitByID returns the authoritative world-produce entry.
func PublicWorldProduceUnitByID(id string) (WorldUnitCatalogEntry, bool) {
	entry, ok := PublicWorldUnitByID(id)
	if !ok || entry.ProductionMode != UnitProductionModeWorldProduce || entry.RuntimeClass != UnitRuntimeClassWorld {
		return WorldUnitCatalogEntry{}, false
	}
	return entry, true
}

func cloneWorldUnitCatalogEntry(entry WorldUnitCatalogEntry) WorldUnitCatalogEntry {
	entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
	entry.Commands = append([]string(nil), entry.Commands...)
	return entry
}
