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

// UnitProductionCost 单位生产造价。
type UnitProductionCost struct {
	Minerals int `yaml:"minerals,omitempty"`
	Energy   int `yaml:"energy,omitempty"`
}

// UnitDefinition 世界单位定义（units.yaml 的一个条目）：战斗数值、造价与对外目录信息。
type UnitDefinition struct {
	ID                  UnitType           `yaml:"id"`
	Name                string             `yaml:"name"`
	MaxHP               int                `yaml:"max_hp,omitempty"`
	Attack              int                `yaml:"attack,omitempty"`
	Defense             int                `yaml:"defense,omitempty"`
	AttackRange         int                `yaml:"attack_range,omitempty"`
	MoveRange           int                `yaml:"move_range,omitempty"`
	VisionRange         int                `yaml:"vision_range,omitempty"`
	MoveSpeed           float64            `yaml:"move_speed,omitempty"`
	AttackCooldownTicks int64              `yaml:"attack_cooldown_ticks,omitempty"`
	ArmorClass          ArmorClass         `yaml:"armor_class,omitempty"`
	WeaponClass         WeaponType         `yaml:"weapon_class,omitempty"`
	Cost                UnitProductionCost `yaml:"cost,omitempty"`
	// 以下为 /catalog world_units 对外信息；Public=false 的单位不进目录。
	Public         bool               `yaml:"public,omitempty"`
	Domain         UnitDomain         `yaml:"domain,omitempty"`
	RuntimeClass   UnitRuntimeClass   `yaml:"runtime_class,omitempty"`
	ProductionMode UnitProductionMode `yaml:"production_mode,omitempty"`
	QueryScopes    []string           `yaml:"query_scopes,omitempty"`
	Commands       []string           `yaml:"commands,omitempty"`
	HiddenReason   string             `yaml:"hidden_reason,omitempty"`
}

// unitStatsFromDefinition 由单位定义生成出厂状态。
func unitStatsFromDefinition(def UnitDefinition) Unit {
	u := Unit{
		Type:               def.ID,
		MaxHP:              def.MaxHP,
		HP:                 def.MaxHP,
		Attack:             def.Attack,
		Defense:            def.Defense,
		AttackRange:        def.AttackRange,
		MoveRange:          def.MoveRange,
		VisionRange:        def.VisionRange,
		MoveSpeed:          def.MoveSpeed,
		AttackCooldownTick: def.AttackCooldownTicks,
		AggroRange:         def.VisionRange,
		Stance:             UnitStanceIdle,
		ArmorClass:         def.ArmorClass,
		WeaponClass:        def.WeaponClass,
	}
	if def.ID == UnitTypeExecutor {
		u.Mecha = NewMechaState()
	}
	return u
}

// worldUnitCatalogEntryFromDefinition 生成对外目录条目（战斗数值同源于单位定义）。
func worldUnitCatalogEntryFromDefinition(def UnitDefinition) WorldUnitCatalogEntry {
	return WorldUnitCatalogEntry{
		ID:                 string(def.ID),
		Name:               def.Name,
		Domain:             def.Domain,
		RuntimeClass:       def.RuntimeClass,
		Public:             def.Public,
		ProductionMode:     def.ProductionMode,
		QueryScopes:        append([]string(nil), def.QueryScopes...),
		Commands:           append([]string(nil), def.Commands...),
		HiddenReason:       def.HiddenReason,
		ArmorClass:         def.ArmorClass,
		WeaponClass:        def.WeaponClass,
		Attack:             def.Attack,
		AttackRange:        def.AttackRange,
		AttackCooldownTick: def.AttackCooldownTicks,
		MoveSpeed:          def.MoveSpeed,
		MaxHP:              def.MaxHP,
	}
}
