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
// 由 units.yaml 的 UnitDefinition 生成，战斗数值与运行时结算（UnitStats）同源。
type WorldUnitCatalogEntry struct {
	AmmoClass       string       `json:"ammo_class,omitempty"`
	AmmoCapacity    int          `json:"ammo_capacity,omitempty"`
	MinAttackRange  int          `json:"min_attack_range,omitempty"`
	Producer        BuildingType `json:"producer,omitempty"`
	ProductionTicks int          `json:"production_ticks,omitempty"`
	SupplyRadius    int          `json:"supply_radius,omitempty"`
	SupplyRate      int          `json:"supply_rate,omitempty"`
	CargoCapacity   int          `json:"cargo_capacity,omitempty"`
	RepairRate      int          `json:"repair_rate,omitempty"`
	UnlockTech      string       `json:"unlock_tech,omitempty"`
	Cost            []ItemAmount `json:"cost"`

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

// PublicWorldUnitCatalogEntries returns the public world-unit catalog snapshot（units.yaml 顺序）。
func PublicWorldUnitCatalogEntries() []WorldUnitCatalogEntry {
	out := make([]WorldUnitCatalogEntry, 0, len(unitOrder))
	for _, id := range unitOrder {
		if def := unitDefinitions[id]; def.Public {
			out = append(out, worldUnitCatalogEntryFromDefinition(def))
		}
	}
	return out
}

// PublicWorldUnitByID returns one public-facing world-unit entry.
func PublicWorldUnitByID(id string) (WorldUnitCatalogEntry, bool) {
	def, ok := unitDefinitions[UnitType(id)]
	if !ok || !def.Public {
		return WorldUnitCatalogEntry{}, false
	}
	return worldUnitCatalogEntryFromDefinition(def), true
}

// PublicWorldProduceUnitByID returns the authoritative world-produce entry.
func PublicWorldProduceUnitByID(id string) (WorldUnitCatalogEntry, bool) {
	entry, ok := PublicWorldUnitByID(id)
	if !ok || entry.ProductionMode != UnitProductionModeWorldProduce || entry.RuntimeClass != UnitRuntimeClassWorld {
		return WorldUnitCatalogEntry{}, false
	}
	return entry, true
}

// MechaSpec 机甲（执行体）研究前的能量与背包基础值。
type MechaSpec struct {
	RespawnTicks        int64 `yaml:"respawn_ticks"`
	MaxEnergy           int   `yaml:"max_energy"`
	InventoryCapacity   int   `yaml:"inventory_capacity"`
	AttackEnergyCost    int   `yaml:"attack_energy_cost"`
	MoveEnergyCost      int   `yaml:"move_energy_cost"`
	ShieldRechargeDelay int64 `yaml:"shield_recharge_delay"`
	// EnergyRegenTicks 被动回能间隔：每多少 tick 自动回 1 点核心能量（0 = 不回能）。
	// 取 4 时约 0.25 点/tick，只有行军耗能（1 点/格、0.5 格/tick）的一半左右：
	// 长途行军不用反复回家补能，但煤（25 点/块）与电网充电仍是有效的补给手段。
	EnergyRegenTicks int `yaml:"energy_regen_ticks,omitempty"`
}

// UnitDefinition 世界单位定义（units.yaml 的一个条目）：战斗数值、造价与对外目录信息。
type UnitDefinition struct {
	AmmoClass       string       `yaml:"ammo_class,omitempty"`
	AmmoCapacity    int          `yaml:"ammo_capacity,omitempty"`
	MinAttackRange  int          `yaml:"min_attack_range,omitempty"`
	Producer        BuildingType `yaml:"producer,omitempty"`
	ProductionTicks int          `yaml:"production_ticks,omitempty"`
	SupplyRadius    int          `yaml:"supply_radius,omitempty"`
	SupplyRate      int          `yaml:"supply_rate,omitempty"`
	CargoCapacity   int          `yaml:"cargo_capacity,omitempty"`
	RepairRate      int          `yaml:"repair_rate,omitempty"`
	UnlockTech      string       `yaml:"unlock_tech,omitempty"`

	ID                  UnitType     `yaml:"id"`
	Name                string       `yaml:"name"`
	MaxHP               int          `yaml:"max_hp,omitempty"`
	Attack              int          `yaml:"attack,omitempty"`
	Defense             int          `yaml:"defense,omitempty"`
	AttackRange         int          `yaml:"attack_range,omitempty"`
	MoveRange           int          `yaml:"move_range,omitempty"`
	VisionRange         int          `yaml:"vision_range,omitempty"`
	MoveSpeed           float64      `yaml:"move_speed,omitempty"`
	AttackCooldownTicks int64        `yaml:"attack_cooldown_ticks,omitempty"`
	ArmorClass          ArmorClass   `yaml:"armor_class,omitempty"`
	WeaponClass         WeaponType   `yaml:"weapon_class,omitempty"`
	Cost                []ItemAmount `yaml:"cost,omitempty"`
	// Mecha 非空时单位出厂带机甲状态（执行体）。
	Mecha *MechaSpec `yaml:"mecha,omitempty"`
	// 以下为 /catalog world_units 对外信息；Public=false 的单位不进目录。
	Public         bool               `yaml:"public,omitempty"`
	Domain         UnitDomain         `yaml:"domain,omitempty"`
	RuntimeClass   UnitRuntimeClass   `yaml:"runtime_class,omitempty"`
	ProductionMode UnitProductionMode `yaml:"production_mode,omitempty"`
	QueryScopes    []string           `yaml:"query_scopes,omitempty"`
	Commands       []string           `yaml:"commands,omitempty"`
	HiddenReason   string             `yaml:"hidden_reason,omitempty"`
}

// ExecutorRespawnTicks is the configured recovery delay after the player mecha dies.
func ExecutorRespawnTicks() int64 { return unitDefinitions[UnitTypeExecutor].Mecha.RespawnTicks }

// MechaEnergyRegenTicks 执行体机甲的被动回能间隔（units.yaml executor.mecha.energy_regen_ticks）。
func MechaEnergyRegenTicks() int { return unitDefinitions[UnitTypeExecutor].Mecha.EnergyRegenTicks }

// unitStatsFromDefinition 由单位定义生成出厂状态。
func unitStatsFromDefinition(def UnitDefinition) Unit {
	u := Unit{
		Type:      def.ID,
		AmmoClass: def.AmmoClass, Ammo: def.AmmoCapacity, AmmoCapacity: def.AmmoCapacity, AmmoItem: DefaultAmmunition(def.AmmoClass), Domain: def.Domain, MinAttackRange: def.MinAttackRange,
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
	if def.CargoCapacity > 0 {
		u.Cargo = make(ItemInventory)
	}
	if def.Mecha != nil {
		u.Mecha = newMechaState(*def.Mecha)
	}
	return u
}

// worldUnitCatalogEntryFromDefinition 生成对外目录条目（战斗数值同源于单位定义）。
func worldUnitCatalogEntryFromDefinition(def UnitDefinition) WorldUnitCatalogEntry {
	return WorldUnitCatalogEntry{
		ID:                 string(def.ID),
		AmmoClass:          def.AmmoClass,
		AmmoCapacity:       def.AmmoCapacity,
		MinAttackRange:     def.MinAttackRange,
		Producer:           def.Producer,
		ProductionTicks:    def.ProductionTicks,
		SupplyRadius:       def.SupplyRadius,
		SupplyRate:         def.SupplyRate,
		CargoCapacity:      def.CargoCapacity,
		RepairRate:         def.RepairRate,
		UnlockTech:         def.UnlockTech,
		Cost:               append([]ItemAmount(nil), def.Cost...),
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

func UnitDefinitionByID(id UnitType) (UnitDefinition, bool) {
	d, ok := unitDefinitions[id]
	d.Cost = append([]ItemAmount(nil), d.Cost...)
	return d, ok
}
