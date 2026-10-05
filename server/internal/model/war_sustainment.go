package model

import (
	"sort"
)

// WarSupplyCondition describes the current sustainment health of a unit or task force.
type WarSupplyCondition string

const (
	WarSupplyConditionHealthy   WarSupplyCondition = "healthy"
	WarSupplyConditionStrained  WarSupplyCondition = "strained"
	WarSupplyConditionCritical  WarSupplyCondition = "critical"
	WarSupplyConditionCollapsed WarSupplyCondition = "collapsed"
)

// WarSupplySourceType identifies an authoritative military supply source.
// Only supply stations and supply trucks resupply ammunition.
type WarSupplySourceType string

const (
	WarSupplySourceSupplyStation WarSupplySourceType = "supply_station"
	WarSupplySourceSupplyTruck   WarSupplySourceType = "supply_truck"
)

// WarRepairTier describes the current repair lane.
type WarRepairTier string

const (
	WarRepairTierField     WarRepairTier = "field_repair"
	WarRepairTierFrontline WarRepairTier = "frontline_repair_station"
	WarRepairTierOverhaul  WarRepairTier = "overhaul"
)

// WarSupplyStock stores the three ammunition classes: bullets, shells and missiles.
// Ammo is the bullet count; higher-tier ammunition of the same class counts toward it.
type WarSupplyStock struct {
	Ammo     int `json:"ammo,omitempty"`
	Shells   int `json:"shells,omitempty"`
	Missiles int `json:"missiles,omitempty"`
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
	RetreatRecommended  bool                 `json:"retreat_recommended,omitempty"`
	Shortages           []string             `json:"shortages,omitempty"`
	Sources             []WarSupplySourceRef `json:"sources,omitempty"`
	LastResupplyTick    int64                `json:"last_resupply_tick,omitempty"`
	LastConsumptionTick int64                `json:"last_consumption_tick,omitempty"`
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
	RetreatRecommended bool               `json:"retreat_recommended,omitempty"`
	Shortages          []string           `json:"shortages,omitempty"`
}

func (stock WarSupplyStock) clone() WarSupplyStock {
	return stock
}

func (stock *WarSupplyStock) add(other WarSupplyStock) {
	if stock == nil {
		return
	}
	stock.Ammo += other.Ammo
	stock.Shells += other.Shells
	stock.Missiles += other.Missiles
}

func (stock *WarSupplyStock) clampTo(capacity WarSupplyStock) {
	if stock == nil {
		return
	}
	stock.Ammo = clampInt(stock.Ammo, 0, capacity.Ammo)
	stock.Shells = clampInt(stock.Shells, 0, capacity.Shells)
	stock.Missiles = clampInt(stock.Missiles, 0, capacity.Missiles)
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
	out.Shells += warMaxInt(0, newCapacity.Shells-oldCapacity.Shells)
	out.Missiles += warMaxInt(0, newCapacity.Missiles-oldCapacity.Missiles)
	out.clampTo(newCapacity)
	return out
}

func warSupplyCapacityForBlueprint(blueprint WarBlueprint, profile WarBlueprintRuntimeProfile, count int) WarSupplyStock {
	index := PublicWarBlueprintCatalogIndex()
	weapon := WeaponState{}
	switch {
	case profile.Squad != nil:
		weapon = profile.Squad.Weapon
	case profile.FleetUnit != nil:
		weapon = profile.FleetUnit.Weapon
	}

	stock := WarSupplyStock{}
	primary := warMaxInt(4, count*warMaxInt(1, weapon.AmmoCost+2))
	switch WeaponSupplyClass(weapon.Type) {
	case AmmoClassShell:
		stock.Shells = primary
	case AmmoClassMissile:
		stock.Missiles = primary
	default:
		stock.Ammo = primary
	}
	for _, componentID := range blueprint.ComponentsBySlot() {
		component, ok := index.ComponentByID(componentID)
		if !ok {
			continue
		}
		if warHasString(component.Tags, "missile") {
			stock.Missiles += 6 * count
		}
	}
	return stock
}

// Ammunition classes used by the sustainment stock.
const (
	AmmoClassBullet  = "bullet"
	AmmoClassShell   = "shell"
	AmmoClassMissile = "missile"
)

// WeaponSupplyClass maps a weapon type to the ammunition class it consumes.
func WeaponSupplyClass(weaponType WeaponType) string {
	switch weaponType {
	case WeaponTypeCannon:
		return AmmoClassShell
	case WeaponTypeMissile:
		return AmmoClassMissile
	default:
		return AmmoClassBullet
	}
}

func warClassItemIDs(class string) []string {
	defs := AmmunitionForClass(class)
	ids := make([]string, 0, len(defs))
	for _, def := range defs {
		ids = append(ids, def.ItemID)
	}
	return ids
}

// MilitarySupplyFromInventory converts generic item inventory into war sustainment stock.
func MilitarySupplyFromInventory(inv ItemInventory) WarSupplyStock {
	return WarSupplyStock{
		Ammo:     warInventoryQty(inv, warClassItemIDs(AmmoClassBullet)),
		Shells:   warInventoryQty(inv, warClassItemIDs(AmmoClassShell)),
		Missiles: warInventoryQty(inv, warClassItemIDs(AmmoClassMissile)),
	}
}

// ConsumeMilitarySupply removes the requested stock from a generic inventory and returns what was actually consumed.
// Higher-tier ammunition is consumed first.
func ConsumeMilitarySupply(inv ItemInventory, requested WarSupplyStock) WarSupplyStock {
	if len(inv) == 0 {
		return WarSupplyStock{}
	}
	return WarSupplyStock{
		Ammo:     warConsumeInventory(inv, warClassItemIDs(AmmoClassBullet), requested.Ammo),
		Shells:   warConsumeInventory(inv, warClassItemIDs(AmmoClassShell), requested.Shells),
		Missiles: warConsumeInventory(inv, warClassItemIDs(AmmoClassMissile), requested.Missiles),
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

func warHasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// WarSupplyNode is one live ammunition source together with its backing inventory.
type WarSupplyNode struct {
	View        WarSupplyNodeView
	Inventories []ItemInventory
}

// Stock sums the ammunition held across the node's inventories.
func (n *WarSupplyNode) Stock() WarSupplyStock {
	var total WarSupplyStock
	for _, inv := range n.Inventories {
		total.add(MilitarySupplyFromInventory(inv))
	}
	return total
}

// Consume takes the requested ammunition from the node and returns what was taken.
func (n *WarSupplyNode) Consume(requested WarSupplyStock) WarSupplyStock {
	var taken WarSupplyStock
	for _, inv := range n.Inventories {
		got := ConsumeMilitarySupply(inv, requested)
		taken.add(got)
		requested.Ammo -= got.Ammo
		requested.Shells -= got.Shells
		requested.Missiles -= got.Missiles
	}
	n.View.Inventory = n.Stock()
	return taken
}

// CollectWarSupplyNodes lists the supply stations and supply trucks a player owns on one planet.
func CollectWarSupplyNodes(ws *WorldState, playerID, systemID string, tick int64) []*WarSupplyNode {
	if ws == nil || playerID == "" {
		return nil
	}
	nodes := make([]*WarSupplyNode, 0)
	buildingIDs := make([]string, 0)
	for id, b := range ws.Buildings {
		if b != nil && b.Type == BuildingTypeSupplyStation && b.OwnerID == playerID && b.HP > 0 && b.Storage != nil {
			buildingIDs = append(buildingIDs, id)
		}
	}
	sort.Strings(buildingIDs)
	for _, id := range buildingIDs {
		storage := ws.Buildings[id].Storage
		node := &WarSupplyNode{
			View: WarSupplyNodeView{
				NodeID: "supply_station:" + id, SourceType: WarSupplySourceSupplyStation, Label: "Supply Station",
				PlanetID: ws.PlanetID, SystemID: systemID, BuildingID: id, UpdatedTick: tick,
			},
			Inventories: []ItemInventory{storage.InputBuffer, storage.Inventory, storage.OutputBuffer},
		}
		node.View.Inventory = node.Stock()
		nodes = append(nodes, node)
	}
	unitIDs := make([]string, 0)
	for id, u := range ws.Units {
		if u != nil && u.Type == UnitTypeSupplyTruck && u.OwnerID == playerID && u.HP > 0 {
			unitIDs = append(unitIDs, id)
		}
	}
	sort.Strings(unitIDs)
	for _, id := range unitIDs {
		u := ws.Units[id]
		node := &WarSupplyNode{
			View: WarSupplyNodeView{
				NodeID: "supply_truck:" + id, SourceType: WarSupplySourceSupplyTruck, Label: "Supply Truck",
				PlanetID: ws.PlanetID, SystemID: systemID, UnitID: id, UpdatedTick: tick,
			},
			Inventories: []ItemInventory{u.Cargo},
		}
		node.View.Inventory = node.Stock()
		nodes = append(nodes, node)
	}
	return nodes
}
