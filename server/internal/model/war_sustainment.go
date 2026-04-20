package model

import "math"

// WarSupplyCondition describes the current sustainment health of a unit or task force.
type WarSupplyCondition string

const (
	WarSupplyConditionHealthy   WarSupplyCondition = "healthy"
	WarSupplyConditionStrained  WarSupplyCondition = "strained"
	WarSupplyConditionCritical  WarSupplyCondition = "critical"
	WarSupplyConditionCollapsed WarSupplyCondition = "collapsed"
)

// WarSupplySourceType identifies an authoritative military supply source.
type WarSupplySourceType string

const (
	WarSupplySourcePlanetaryLogisticsStation WarSupplySourceType = "planetary_logistics_station"
	WarSupplySourceInterstellarLogistics     WarSupplySourceType = "interstellar_logistics_station"
	WarSupplySourceOrbitalSupplyPort         WarSupplySourceType = "orbital_supply_port"
	WarSupplySourceSupplyShip                WarSupplySourceType = "supply_ship"
	WarSupplySourceFrontlineSupplyDrop       WarSupplySourceType = "frontline_supply_drop"
)

// WarRepairTier describes the current repair lane.
type WarRepairTier string

const (
	WarRepairTierField     WarRepairTier = "field_repair"
	WarRepairTierFrontline WarRepairTier = "frontline_repair_station"
	WarRepairTierOverhaul  WarRepairTier = "overhaul"
)

// WarSupplyStock stores the six military sustainment dimensions.
type WarSupplyStock struct {
	Ammo         int `json:"ammo,omitempty"`
	Missiles     int `json:"missiles,omitempty"`
	Fuel         int `json:"fuel,omitempty"`
	SpareParts   int `json:"spare_parts,omitempty"`
	ShieldCells  int `json:"shield_cells,omitempty"`
	RepairDrones int `json:"repair_drones,omitempty"`
}

// WarRepairState stores the current repair activity for a unit.
type WarRepairState struct {
	Tier              WarRepairTier `json:"tier,omitempty"`
	Active            bool          `json:"active,omitempty"`
	BlockedReason     string        `json:"blocked_reason,omitempty"`
	HPPerTick         int           `json:"hp_per_tick,omitempty"`
	ShieldPerTick     float64       `json:"shield_per_tick,omitempty"`
	RemainingDamage   int           `json:"remaining_damage,omitempty"`
	RemainingShield   float64       `json:"remaining_shield,omitempty"`
	RemainingTicks    int64         `json:"remaining_ticks,omitempty"`
	CompletedThisTick bool          `json:"completed_this_tick,omitempty"`
}

// WarSupplySourceRef records the last source set used by a unit.
type WarSupplySourceRef struct {
	SourceID   string              `json:"source_id"`
	SourceType WarSupplySourceType `json:"source_type"`
	Label      string              `json:"label,omitempty"`
	PlanetID   string              `json:"planet_id,omitempty"`
	SystemID   string              `json:"system_id,omitempty"`
	BuildingID string              `json:"building_id,omitempty"`
	UnitID     string              `json:"unit_id,omitempty"`
}

// WarSustainmentState is the authoritative runtime sustainment container for one unit.
type WarSustainmentState struct {
	Current             WarSupplyStock       `json:"current"`
	Capacity            WarSupplyStock       `json:"capacity"`
	Condition           WarSupplyCondition   `json:"condition"`
	Cohesion            float64              `json:"cohesion,omitempty"`
	DamagePenalty       float64              `json:"damage_penalty,omitempty"`
	ShieldPenalty       float64              `json:"shield_penalty,omitempty"`
	MobilityPenalty     float64              `json:"mobility_penalty,omitempty"`
	RepairBlocked       bool                 `json:"repair_blocked,omitempty"`
	RetreatRecommended  bool                 `json:"retreat_recommended,omitempty"`
	Shortages           []string             `json:"shortages,omitempty"`
	Sources             []WarSupplySourceRef `json:"sources,omitempty"`
	LastResupplyTick    int64                `json:"last_resupply_tick,omitempty"`
	LastConsumptionTick int64                `json:"last_consumption_tick,omitempty"`
	Repair              WarRepairState       `json:"repair"`
}

// WarSupplyNodeView exposes military stock held by a specific source node.
type WarSupplyNodeView struct {
	NodeID      string              `json:"node_id"`
	SourceType  WarSupplySourceType `json:"source_type"`
	Label       string              `json:"label,omitempty"`
	PlanetID    string              `json:"planet_id,omitempty"`
	SystemID    string              `json:"system_id,omitempty"`
	BuildingID  string              `json:"building_id,omitempty"`
	UnitID      string              `json:"unit_id,omitempty"`
	Inventory   WarSupplyStock      `json:"inventory"`
	UpdatedTick int64               `json:"updated_tick,omitempty"`
}

// WarSupplyStatusView summarizes sustainment at query level.
type WarSupplyStatusView struct {
	Current            WarSupplyStock     `json:"current"`
	Capacity           WarSupplyStock     `json:"capacity"`
	Condition          WarSupplyCondition `json:"condition"`
	Cohesion           float64            `json:"cohesion,omitempty"`
	DamagePenalty      float64            `json:"damage_penalty,omitempty"`
	ShieldPenalty      float64            `json:"shield_penalty,omitempty"`
	MobilityPenalty    float64            `json:"mobility_penalty,omitempty"`
	RetreatRecommended bool               `json:"retreat_recommended,omitempty"`
	Shortages          []string           `json:"shortages,omitempty"`
}

func (stock WarSupplyStock) total() int {
	return stock.Ammo + stock.Missiles + stock.Fuel + stock.SpareParts + stock.ShieldCells + stock.RepairDrones
}

func (stock WarSupplyStock) clone() WarSupplyStock {
	return stock
}

func (stock *WarSupplyStock) add(other WarSupplyStock) {
	if stock == nil {
		return
	}
	stock.Ammo += other.Ammo
	stock.Missiles += other.Missiles
	stock.Fuel += other.Fuel
	stock.SpareParts += other.SpareParts
	stock.ShieldCells += other.ShieldCells
	stock.RepairDrones += other.RepairDrones
}

func (stock *WarSupplyStock) clampTo(capacity WarSupplyStock) {
	if stock == nil {
		return
	}
	stock.Ammo = clampInt(stock.Ammo, 0, capacity.Ammo)
	stock.Missiles = clampInt(stock.Missiles, 0, capacity.Missiles)
	stock.Fuel = clampInt(stock.Fuel, 0, capacity.Fuel)
	stock.SpareParts = clampInt(stock.SpareParts, 0, capacity.SpareParts)
	stock.ShieldCells = clampInt(stock.ShieldCells, 0, capacity.ShieldCells)
	stock.RepairDrones = clampInt(stock.RepairDrones, 0, capacity.RepairDrones)
}

// Clone returns a deep copy of the sustainment state.
func (state WarSustainmentState) Clone() WarSustainmentState {
	state.Shortages = append([]string(nil), state.Shortages...)
	state.Sources = append([]WarSupplySourceRef(nil), state.Sources...)
	return state
}

// StatusView builds the query-facing supply summary.
func (state WarSustainmentState) StatusView() WarSupplyStatusView {
	return WarSupplyStatusView{
		Current:            state.Current.clone(),
		Capacity:           state.Capacity.clone(),
		Condition:          state.Condition,
		Cohesion:           state.Cohesion,
		DamagePenalty:      state.DamagePenalty,
		ShieldPenalty:      state.ShieldPenalty,
		MobilityPenalty:    state.MobilityPenalty,
		RetreatRecommended: state.RetreatRecommended,
		Shortages:          append([]string(nil), state.Shortages...),
	}
}

// Normalize clamps values and fills defaults after mutations.
func (state *WarSustainmentState) Normalize() {
	if state == nil {
		return
	}
	state.Current.clampTo(state.Capacity)
	if state.Cohesion <= 0 {
		state.Cohesion = 1
	}
	if state.Cohesion > 1 {
		state.Cohesion = 1
	}
	if state.Condition == "" {
		state.Condition = WarSupplyConditionHealthy
	}
}

// InitWarSustainmentState creates a fully stocked sustainment state for a freshly deployed unit.
func InitWarSustainmentState(blueprint WarBlueprint, profile WarBlueprintRuntimeProfile, count int) WarSustainmentState {
	if count <= 0 {
		count = 1
	}
	capacity := warSupplyCapacityForBlueprint(blueprint, profile, count)
	state := WarSustainmentState{
		Current:   capacity,
		Capacity:  capacity,
		Condition: WarSupplyConditionHealthy,
		Cohesion:  1,
	}
	state.Normalize()
	return state
}

// RefillForAddedCapacity keeps current stock for existing units and fully stocks newly added capacity.
func RefillForAddedCapacity(current, oldCapacity, newCapacity WarSupplyStock) WarSupplyStock {
	out := current
	out.Ammo += warMaxInt(0, newCapacity.Ammo-oldCapacity.Ammo)
	out.Missiles += warMaxInt(0, newCapacity.Missiles-oldCapacity.Missiles)
	out.Fuel += warMaxInt(0, newCapacity.Fuel-oldCapacity.Fuel)
	out.SpareParts += warMaxInt(0, newCapacity.SpareParts-oldCapacity.SpareParts)
	out.ShieldCells += warMaxInt(0, newCapacity.ShieldCells-oldCapacity.ShieldCells)
	out.RepairDrones += warMaxInt(0, newCapacity.RepairDrones-oldCapacity.RepairDrones)
	out.clampTo(newCapacity)
	return out
}

func warSupplyCapacityForBlueprint(blueprint WarBlueprint, profile WarBlueprintRuntimeProfile, count int) WarSupplyStock {
	index := PublicWarBlueprintCatalogIndex()
	components := blueprint.ComponentsBySlot()
	weapon := WeaponState{}
	shield := ShieldState{}
	switch {
	case profile.Squad != nil:
		weapon = profile.Squad.Weapon
		shield = profile.Squad.Shield
	case profile.FleetUnit != nil:
		weapon = profile.FleetUnit.Weapon
		shield = profile.FleetUnit.Shield
	}

	stock := WarSupplyStock{
		Ammo:       warMaxInt(4, count*warMaxInt(1, weapon.AmmoCost+2)),
		SpareParts: warMaxInt(2, count*3),
	}
	switch blueprint.Domain {
	case UnitDomainGround:
		stock.Fuel = 8 * count
	case UnitDomainAir, UnitDomainOrbital:
		stock.Fuel = 10 * count
	default:
		stock.Fuel = 12 * count
	}
	if shield.MaxLevel > 0 {
		stock.ShieldCells = warMaxInt(2, count*3)
	}
	for _, componentID := range components {
		component, ok := index.ComponentByID(componentID)
		if !ok {
			continue
		}
		switch {
		case warHasString(component.Tags, "missile"):
			stock.Missiles += 6 * count
		case warHasString(component.Tags, "repair"):
			stock.RepairDrones += 2 * count
			stock.SpareParts += count
		case warHasString(component.Tags, "shield"):
			stock.ShieldCells += count
		}
	}
	if stock.RepairDrones == 0 {
		stock.RepairDrones = warMaxInt(1, count)
	}
	return stock
}

// MilitarySupplyFromInventory converts generic item inventory into war sustainment stock.
func MilitarySupplyFromInventory(inv ItemInventory) WarSupplyStock {
	return WarSupplyStock{
		Ammo:         warInventoryQty(inv, []string{ItemAmmoBullet}),
		Missiles:     warInventoryQty(inv, []string{ItemAmmoMissile, ItemGravityMissile}),
		Fuel:         warInventoryQty(inv, []string{ItemHydrogenFuelRod, ItemDeuteriumFuelRod, ItemAntimatterFuelRod}),
		SpareParts:   warInventoryQty(inv, []string{ItemGear, ItemMotor, ItemFrameMaterial}),
		ShieldCells:  warInventoryQty(inv, []string{ItemPhotonCombiner, ItemCriticalPhoton, ItemParticleContainer}),
		RepairDrones: warInventoryQty(inv, []string{ItemPrecisionDrone}),
	}
}

// ConsumeMilitarySupply removes the requested stock from a generic inventory and returns what was actually consumed.
func ConsumeMilitarySupply(inv ItemInventory, requested WarSupplyStock) WarSupplyStock {
	if len(inv) == 0 {
		return WarSupplyStock{}
	}
	return WarSupplyStock{
		Ammo:         warConsumeInventory(inv, []string{ItemAmmoBullet}, requested.Ammo),
		Missiles:     warConsumeInventory(inv, []string{ItemAmmoMissile, ItemGravityMissile}, requested.Missiles),
		Fuel:         warConsumeInventory(inv, []string{ItemHydrogenFuelRod, ItemDeuteriumFuelRod, ItemAntimatterFuelRod}, requested.Fuel),
		SpareParts:   warConsumeInventory(inv, []string{ItemGear, ItemMotor, ItemFrameMaterial}, requested.SpareParts),
		ShieldCells:  warConsumeInventory(inv, []string{ItemPhotonCombiner, ItemCriticalPhoton, ItemParticleContainer}, requested.ShieldCells),
		RepairDrones: warConsumeInventory(inv, []string{ItemPrecisionDrone}, requested.RepairDrones),
	}
}

func warInventoryQty(inv ItemInventory, itemIDs []string) int {
	total := 0
	for _, itemID := range itemIDs {
		if inv != nil {
			total += inv[itemID]
		}
	}
	return total
}

func warConsumeInventory(inv ItemInventory, itemIDs []string, qty int) int {
	if qty <= 0 {
		return 0
	}
	remaining := qty
	consumed := 0
	for _, itemID := range itemIDs {
		take := removeFromInventory(inv, itemID, remaining)
		consumed += take
		remaining -= take
		if remaining <= 0 {
			break
		}
	}
	return consumed
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func warMaxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func roundWarFloat(value float64) float64 {
	return math.Round(value*100) / 100
}

func warHasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
