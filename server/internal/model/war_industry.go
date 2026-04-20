package model

import (
	"fmt"
	"sort"
)

// MilitaryProductionStage captures the current authoritative stage of military production.
type MilitaryProductionStage string

const (
	MilitaryProductionStageComponent MilitaryProductionStage = "component_fabrication"
	MilitaryProductionStageAssembly  MilitaryProductionStage = "final_assembly"
)

// MilitaryOrderStatus captures the state of a queued production/refit order.
type MilitaryOrderStatus string

const (
	MilitaryOrderStatusQueued    MilitaryOrderStatus = "queued"
	MilitaryOrderStatusRunning   MilitaryOrderStatus = "running"
	MilitaryOrderStatusPaused    MilitaryOrderStatus = "paused"
	MilitaryOrderStatusCompleted MilitaryOrderStatus = "completed"
)

// MilitaryProductionOrder is one queued, authoritative military production job.
type MilitaryProductionOrder struct {
	ID                     string                  `json:"id"`
	BlueprintID            string                  `json:"blueprint_id"`
	BlueprintName          string                  `json:"blueprint_name,omitempty"`
	BaseID                 string                  `json:"base_id,omitempty"`
	Domain                 UnitDomain              `json:"domain"`
	RuntimeClass           UnitRuntimeClass        `json:"runtime_class"`
	Stage                  MilitaryProductionStage `json:"stage"`
	Status                 MilitaryOrderStatus     `json:"status"`
	ComponentTicksTotal    int                     `json:"component_ticks_total"`
	ComponentTicksRemaining int                    `json:"component_ticks_remaining"`
	AssemblyTicksTotal     int                     `json:"assembly_ticks_total"`
	AssemblyTicksRemaining int                     `json:"assembly_ticks_remaining"`
	RetoolTicksTotal       int                     `json:"retool_ticks_total"`
	RetoolTicksRemaining   int                     `json:"retool_ticks_remaining"`
	SeriesBonusRatio       float64                 `json:"series_bonus_ratio,omitempty"`
	QueuedTick             int64                   `json:"queued_tick,omitempty"`
	LastUpdateTick         int64                   `json:"last_update_tick,omitempty"`
	ComponentCost          []ItemAmount            `json:"component_cost,omitempty"`
	AssemblyCost           []ItemAmount            `json:"assembly_cost,omitempty"`
}

// Clone returns a deep copy of a production order.
func (o *MilitaryProductionOrder) Clone() *MilitaryProductionOrder {
	if o == nil {
		return nil
	}
	out := *o
	out.ComponentCost = append([]ItemAmount(nil), o.ComponentCost...)
	out.AssemblyCost = append([]ItemAmount(nil), o.AssemblyCost...)
	return &out
}

// MilitaryRefitOrder is one queued, authoritative runtime refit order.
type MilitaryRefitOrder struct {
	ID                string              `json:"id"`
	UnitID            string              `json:"unit_id"`
	SourceBlueprintID string              `json:"source_blueprint_id"`
	TargetBlueprintID string              `json:"target_blueprint_id"`
	TargetName        string              `json:"target_name,omitempty"`
	BaseID            string              `json:"base_id,omitempty"`
	Domain            UnitDomain          `json:"domain"`
	RuntimeClass      UnitRuntimeClass    `json:"runtime_class"`
	Count             int                 `json:"count"`
	Status            MilitaryOrderStatus `json:"status"`
	QueuedTick        int64               `json:"queued_tick,omitempty"`
	LastUpdateTick    int64               `json:"last_update_tick,omitempty"`
	TotalTicks        int                 `json:"total_ticks"`
	RemainingTicks    int                 `json:"remaining_ticks"`
	RefitCost         []ItemAmount        `json:"refit_cost,omitempty"`
	SourceBuildingID  string              `json:"source_building_id,omitempty"`
	ReturnPlanetID    string              `json:"return_planet_id,omitempty"`
	ReturnSystemID    string              `json:"return_system_id,omitempty"`
}

// Clone returns a deep copy of a refit order.
func (o *MilitaryRefitOrder) Clone() *MilitaryRefitOrder {
	if o == nil {
		return nil
	}
	out := *o
	out.RefitCost = append([]ItemAmount(nil), o.RefitCost...)
	return &out
}

// DeploymentHubLineState captures reusable efficiency state for one deployment hub line.
type DeploymentHubLineState struct {
	LastBlueprintID string `json:"last_blueprint_id,omitempty"`
	SeriesStreak    int    `json:"series_streak,omitempty"`
}

// DeploymentHubState stores authoritative military payload and queue state on a building.
type DeploymentHubState struct {
	PayloadInventory ItemInventory             `json:"payload_inventory,omitempty"`
	ProductionQueue  []*MilitaryProductionOrder `json:"production_queue,omitempty"`
	RefitQueue       []*MilitaryRefitOrder      `json:"refit_queue,omitempty"`
	LineState        DeploymentHubLineState     `json:"line_state,omitempty"`
}

// Clone returns a deep copy of the deployment hub state.
func (s *DeploymentHubState) Clone() *DeploymentHubState {
	if s == nil {
		return nil
	}
	out := &DeploymentHubState{
		PayloadInventory: s.PayloadInventory.Clone(),
		LineState:        s.LineState,
	}
	if len(s.ProductionQueue) > 0 {
		out.ProductionQueue = make([]*MilitaryProductionOrder, 0, len(s.ProductionQueue))
		for _, order := range s.ProductionQueue {
			out.ProductionQueue = append(out.ProductionQueue, order.Clone())
		}
	}
	if len(s.RefitQueue) > 0 {
		out.RefitQueue = make([]*MilitaryRefitOrder, 0, len(s.RefitQueue))
		for _, order := range s.RefitQueue {
			out.RefitQueue = append(out.RefitQueue, order.Clone())
		}
	}
	return out
}

// WarBlueprintManufacturingSpec captures derived authoritative production requirements for one blueprint.
type WarBlueprintManufacturingSpec struct {
	BlueprintID    string
	BlueprintName  string
	BaseID         string
	Domain         UnitDomain
	RuntimeClass   UnitRuntimeClass
	ComponentCost  []ItemAmount
	AssemblyCost   []ItemAmount
	ComponentTicks int
	AssemblyTicks  int
}

type warIndustryBaseSpec struct {
	ComponentCost []ItemAmount
	AssemblyCost  []ItemAmount
	ComponentTicks int
	AssemblyTicks  int
}

type warIndustryComponentSpec struct {
	Cost           []ItemAmount
	ComponentTicks int
}

var warIndustryBaseSpecs = map[string]warIndustryBaseSpec{
	"light_frame": {
		ComponentCost: []ItemAmount{{ItemID: ItemIronIngot, Quantity: 8}, {ItemID: ItemGear, Quantity: 4}},
		AssemblyCost:  []ItemAmount{{ItemID: ItemCircuitBoard, Quantity: 4}, {ItemID: ItemIronIngot, Quantity: 6}},
		ComponentTicks: 30,
		AssemblyTicks:  50,
	},
	"aerial_frame": {
		ComponentCost: []ItemAmount{{ItemID: ItemTitaniumIngot, Quantity: 8}, {ItemID: ItemCircuitBoard, Quantity: 4}},
		AssemblyCost:  []ItemAmount{{ItemID: ItemProcessor, Quantity: 2}, {ItemID: ItemTitaniumIngot, Quantity: 6}},
		ComponentTicks: 34,
		AssemblyTicks:  56,
	},
	"corvette_hull": {
		ComponentCost: []ItemAmount{{ItemID: ItemTitaniumAlloy, Quantity: 10}, {ItemID: ItemFrameMaterial, Quantity: 4}},
		AssemblyCost:  []ItemAmount{{ItemID: ItemProcessor, Quantity: 4}, {ItemID: ItemTitaniumAlloy, Quantity: 8}},
		ComponentTicks: 40,
		AssemblyTicks:  70,
	},
	"destroyer_hull": {
		ComponentCost: []ItemAmount{{ItemID: ItemTitaniumAlloy, Quantity: 16}, {ItemID: ItemFrameMaterial, Quantity: 8}},
		AssemblyCost:  []ItemAmount{{ItemID: ItemQuantumChip, Quantity: 4}, {ItemID: ItemTitaniumAlloy, Quantity: 10}},
		ComponentTicks: 48,
		AssemblyTicks:  84,
	},
}

var warIndustryComponentSpecs = map[string]warIndustryComponentSpec{
	"compact_reactor":         {Cost: []ItemAmount{{ItemID: ItemCopperIngot, Quantity: 4}, {ItemID: ItemCircuitBoard, Quantity: 2}}, ComponentTicks: 8},
	"micro_fusion_core":       {Cost: []ItemAmount{{ItemID: ItemTitaniumAlloy, Quantity: 4}, {ItemID: ItemProcessor, Quantity: 2}}, ComponentTicks: 10},
	"servo_actuator_pack":     {Cost: []ItemAmount{{ItemID: ItemGear, Quantity: 4}, {ItemID: ItemIronIngot, Quantity: 4}}, ComponentTicks: 8},
	"vector_thruster_pack":    {Cost: []ItemAmount{{ItemID: ItemTitaniumIngot, Quantity: 4}, {ItemID: ItemProcessor, Quantity: 1}}, ComponentTicks: 8},
	"ion_drive_cluster":       {Cost: []ItemAmount{{ItemID: ItemTitaniumAlloy, Quantity: 5}, {ItemID: ItemProcessor, Quantity: 2}}, ComponentTicks: 11},
	"composite_armor_plating": {Cost: []ItemAmount{{ItemID: ItemIronIngot, Quantity: 6}, {ItemID: ItemTitaniumIngot, Quantity: 4}}, ComponentTicks: 8},
	"deflector_shield_array":  {Cost: []ItemAmount{{ItemID: ItemProcessor, Quantity: 2}, {ItemID: ItemCarbonNanotube, Quantity: 2}}, ComponentTicks: 10},
	"battlefield_sensor_suite": {Cost: []ItemAmount{{ItemID: ItemCircuitBoard, Quantity: 2}, {ItemID: ItemProcessor, Quantity: 1}}, ComponentTicks: 7},
	"deep_space_radar":        {Cost: []ItemAmount{{ItemID: ItemProcessor, Quantity: 2}, {ItemID: ItemQuantumChip, Quantity: 1}}, ComponentTicks: 9},
	"pulse_laser_mount":       {Cost: []ItemAmount{{ItemID: ItemCopperIngot, Quantity: 4}, {ItemID: ItemCircuitBoard, Quantity: 2}}, ComponentTicks: 9},
	"micro_missile_rack":      {Cost: []ItemAmount{{ItemID: ItemProcessor, Quantity: 2}, {ItemID: ItemTitaniumIngot, Quantity: 2}}, ComponentTicks: 9},
	"coilgun_battery":         {Cost: []ItemAmount{{ItemID: ItemTitaniumAlloy, Quantity: 4}, {ItemID: ItemProcessor, Quantity: 2}}, ComponentTicks: 11},
	"command_uplink":          {Cost: []ItemAmount{{ItemID: ItemCircuitBoard, Quantity: 2}, {ItemID: ItemProcessor, Quantity: 1}}, ComponentTicks: 6},
	"repair_drone_bay":        {Cost: []ItemAmount{{ItemID: ItemProcessor, Quantity: 2}, {ItemID: ItemFrameMaterial, Quantity: 2}}, ComponentTicks: 10},
}

// ResolveWarBlueprintDefinition returns either a player-owned blueprint or a public preset blueprint.
func ResolveWarBlueprintDefinition(player *PlayerState, blueprintID string) (WarBlueprintDefinition, bool) {
	if player != nil && player.WarBlueprints != nil {
		if blueprint := player.WarBlueprints[blueprintID]; blueprint != nil {
			return blueprint.Clone(), true
		}
	}
	return PublicWarBlueprintDefinitionByID(blueprintID)
}

// WarBlueprintProductionAllowed reports whether a blueprint may be queued for production.
func WarBlueprintProductionAllowed(bp WarBlueprintDefinition) bool {
	if bp.Source == WarBlueprintSourcePreset {
		return true
	}
	switch bp.Status {
	case WarBlueprintStatusPrototype, WarBlueprintStatusFieldTested, WarBlueprintStatusAdopted:
		return true
	default:
		return false
	}
}

// WarBlueprintManufacturingSpecForDefinition derives military production requirements from a blueprint.
func WarBlueprintManufacturingSpecForDefinition(bp WarBlueprintDefinition) (WarBlueprintManufacturingSpec, error) {
	if !WarBlueprintProductionAllowed(bp) {
		return WarBlueprintManufacturingSpec{}, fmt.Errorf("blueprint %s is not finalized for military production", bp.ID)
	}
	baseSpec, ok := warIndustryBaseSpecs[bp.BaseID()]
	if !ok {
		return WarBlueprintManufacturingSpec{}, fmt.Errorf("blueprint base %s has no military production spec", bp.BaseID())
	}
	spec := WarBlueprintManufacturingSpec{
		BlueprintID:    bp.ID,
		BlueprintName:  bp.Name,
		BaseID:         bp.BaseID(),
		Domain:         bp.Domain,
		RuntimeClass:   bp.RuntimeClass,
		ComponentCost:  append([]ItemAmount(nil), baseSpec.ComponentCost...),
		AssemblyCost:   append([]ItemAmount(nil), baseSpec.AssemblyCost...),
		ComponentTicks: baseSpec.ComponentTicks,
		AssemblyTicks:  baseSpec.AssemblyTicks,
	}
	slotIDs := make([]string, 0, len(bp.SlotAssignments))
	for slotID := range bp.SlotAssignments {
		slotIDs = append(slotIDs, slotID)
	}
	sort.Strings(slotIDs)
	for _, slotID := range slotIDs {
		componentID := bp.SlotAssignments[slotID]
		componentSpec, ok := warIndustryComponentSpecs[componentID]
		if !ok {
			return WarBlueprintManufacturingSpec{}, fmt.Errorf("component %s has no military production spec", componentID)
		}
		spec.ComponentCost = append(spec.ComponentCost, componentSpec.Cost...)
		spec.ComponentTicks += componentSpec.ComponentTicks
	}
	spec.ComponentCost = normalizeItemAmounts(spec.ComponentCost)
	spec.AssemblyCost = normalizeItemAmounts(spec.AssemblyCost)
	return spec, nil
}

// WarBlueprintRefitCost derives the additive materials and time required to refit between two compatible blueprints.
func WarBlueprintRefitCost(source, target WarBlueprintDefinition) ([]ItemAmount, int, error) {
	if source.BaseID() == "" || target.BaseID() == "" || source.BaseID() != target.BaseID() {
		return nil, 0, fmt.Errorf("refit requires identical base chassis")
	}
	sourceSpec, err := WarBlueprintManufacturingSpecForDefinition(source)
	if err != nil {
		return nil, 0, err
	}
	targetSpec, err := WarBlueprintManufacturingSpecForDefinition(target)
	if err != nil {
		return nil, 0, err
	}
	sourceTotal := normalizeItemAmounts(append(append([]ItemAmount(nil), sourceSpec.ComponentCost...), sourceSpec.AssemblyCost...))
	targetTotal := normalizeItemAmounts(append(append([]ItemAmount(nil), targetSpec.ComponentCost...), targetSpec.AssemblyCost...))
	refitCost := positiveCostDelta(sourceTotal, targetTotal)
	switch target.Domain {
	case UnitDomainSpace:
		refitCost = append(refitCost, ItemAmount{ItemID: ItemFrameMaterial, Quantity: 1})
	default:
		refitCost = append(refitCost, ItemAmount{ItemID: ItemCircuitBoard, Quantity: 1})
	}
	refitCost = normalizeItemAmounts(refitCost)
	changedSlots := 0
	slotIDs := make(map[string]struct{}, len(source.SlotAssignments)+len(target.SlotAssignments))
	for slotID := range source.SlotAssignments {
		slotIDs[slotID] = struct{}{}
	}
	for slotID := range target.SlotAssignments {
		slotIDs[slotID] = struct{}{}
	}
	for slotID := range slotIDs {
		if source.SlotAssignments[slotID] != target.SlotAssignments[slotID] {
			changedSlots++
		}
	}
	refitTicks := 30 + changedSlots*12 + targetSpec.AssemblyTicks/2
	return refitCost, refitTicks, nil
}

// WarBlueprintRuntimeProfileForDefinition resolves the authoritative runtime profile for a blueprint.
func WarBlueprintRuntimeProfileForDefinition(bp WarBlueprintDefinition) (WarBlueprintRuntimeProfile, error) {
	if profile, ok := WarBlueprintRuntimeProfileByID(bp.ID); ok {
		return profile, nil
	}
	profile := WarBlueprintRuntimeProfile{}
	switch bp.BaseID() {
	case "light_frame":
		profile.SquadBaseHP = 78
		profile.SquadWeapon = WeaponState{Type: WeaponTypeLaser, Damage: 18, FireRate: 10, Range: 8}
		profile.SquadShield = ShieldState{Level: 14, MaxLevel: 14, RechargeRate: 1, RechargeDelay: 10}
	case "aerial_frame":
		profile.SquadBaseHP = 58
		profile.SquadWeapon = WeaponState{Type: WeaponTypeMissile, Damage: 28, FireRate: 8, Range: 11}
		profile.SquadShield = ShieldState{Level: 18, MaxLevel: 18, RechargeRate: 1.2, RechargeDelay: 8}
	case "corvette_hull":
		profile.FleetWeaponType = WeaponTypeLaser
		profile.FleetWeaponDamage = 36
		profile.FleetWeaponFireRate = 10
		profile.FleetWeaponRange = 24
		profile.FleetShield = 34
		profile.FleetShieldRechargeRate = 2
		profile.FleetShieldRechargeDelay = 10
	case "destroyer_hull":
		profile.FleetWeaponType = WeaponTypeLaser
		profile.FleetWeaponDamage = 68
		profile.FleetWeaponFireRate = 10
		profile.FleetWeaponRange = 26
		profile.FleetShield = 62
		profile.FleetShieldRechargeRate = 2
		profile.FleetShieldRechargeDelay = 10
	default:
		return WarBlueprintRuntimeProfile{}, fmt.Errorf("base %s has no runtime profile", bp.BaseID())
	}

	switch bp.SlotAssignments["defense"] {
	case "composite_armor_plating":
		if profile.SquadBaseHP > 0 {
			profile.SquadBaseHP += 12
		}
		if profile.FleetShield > 0 {
			profile.FleetShield += 8
		}
	case "deflector_shield_array":
		if profile.SquadShield.MaxLevel > 0 {
			profile.SquadShield.Level += 12
			profile.SquadShield.MaxLevel += 12
			profile.SquadShield.RechargeRate += 0.3
		}
		if profile.FleetShield > 0 {
			profile.FleetShield += 14
			profile.FleetShieldRechargeRate += 0.4
		}
	}

	switch bp.SlotAssignments["primary_weapon"] {
	case "pulse_laser_mount":
		if profile.SquadBaseHP > 0 {
			profile.SquadWeapon.Type = WeaponTypeLaser
			profile.SquadWeapon.Damage = 20
			profile.SquadWeapon.Range = 8
		}
		if profile.FleetWeaponDamage > 0 {
			profile.FleetWeaponType = WeaponTypeLaser
			profile.FleetWeaponDamage += 4
		}
	case "micro_missile_rack":
		if profile.SquadBaseHP > 0 {
			profile.SquadWeapon.Type = WeaponTypeMissile
			profile.SquadWeapon.Damage = 34
			profile.SquadWeapon.Range = 12
			profile.SquadWeapon.FireRate = 8
		}
	case "coilgun_battery":
		if profile.FleetWeaponDamage > 0 {
			profile.FleetWeaponType = WeaponTypeCannon
			profile.FleetWeaponDamage += 16
			profile.FleetWeaponRange = 28
		}
	}

	switch bp.SlotAssignments["utility"] {
	case "command_uplink":
		if profile.SquadWeapon.FireRate > 0 {
			profile.SquadWeapon.FireRate = maxWarIndustryInt(profile.SquadWeapon.FireRate-1, 6)
		}
		if profile.FleetWeaponFireRate > 0 {
			profile.FleetWeaponFireRate = maxWarIndustryInt(profile.FleetWeaponFireRate-1, 6)
		}
	case "repair_drone_bay":
		if profile.FleetShieldRechargeRate > 0 {
			profile.FleetShieldRechargeRate += 0.6
		}
	}

	return profile, nil
}

func normalizeItemAmounts(items []ItemAmount) []ItemAmount {
	if len(items) == 0 {
		return nil
	}
	combined := make(map[string]int, len(items))
	for _, item := range items {
		if item.ItemID == "" || item.Quantity <= 0 {
			continue
		}
		combined[item.ItemID] += item.Quantity
	}
	if len(combined) == 0 {
		return nil
	}
	ids := make([]string, 0, len(combined))
	for itemID := range combined {
		ids = append(ids, itemID)
	}
	sort.Strings(ids)
	out := make([]ItemAmount, 0, len(ids))
	for _, itemID := range ids {
		out = append(out, ItemAmount{ItemID: itemID, Quantity: combined[itemID]})
	}
	return out
}

// NormalizeWarIndustryCost returns a deterministic, merged copy of item costs.
func NormalizeWarIndustryCost(items []ItemAmount) []ItemAmount {
	return normalizeItemAmounts(items)
}

func positiveCostDelta(source, target []ItemAmount) []ItemAmount {
	src := make(map[string]int, len(source))
	for _, item := range source {
		src[item.ItemID] += item.Quantity
	}
	out := make([]ItemAmount, 0, len(target))
	for _, item := range target {
		delta := item.Quantity - src[item.ItemID]
		if delta > 0 {
			out = append(out, ItemAmount{ItemID: item.ItemID, Quantity: delta})
		}
	}
	return normalizeItemAmounts(out)
}

func maxWarIndustryInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
