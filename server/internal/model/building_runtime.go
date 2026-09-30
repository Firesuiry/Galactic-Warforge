package model

import (
	"fmt"
	"sort"
	"sync"

	modelpower "siliconworld/internal/model/power"
)

// BuildingWorkState captures the current operating state of a building.
type BuildingWorkState string

const (
	BuildingWorkIdle    BuildingWorkState = "idle"
	BuildingWorkRunning BuildingWorkState = "running"
	BuildingWorkPaused  BuildingWorkState = "paused"
	BuildingWorkNoPower BuildingWorkState = "no_power"
	BuildingWorkError   BuildingWorkState = "error"
)

// ConnectionKind describes the type of a connection point.
type ConnectionKind string

const (
	ConnectionPower     ConnectionKind = "power"
	ConnectionTransport ConnectionKind = "transport"
	ConnectionLogistics ConnectionKind = "logistics"
)

var validConnectionKinds = map[ConnectionKind]struct{}{
	ConnectionPower:     {},
	ConnectionTransport: {},
	ConnectionLogistics: {},
}

// PortDirection describes input/output direction for a port.
type PortDirection string

const (
	PortInput  PortDirection = "input"
	PortOutput PortDirection = "output"
	PortBoth   PortDirection = "both"
)

var validPortDirections = map[PortDirection]struct{}{
	PortInput:  {},
	PortOutput: {},
	PortBoth:   {},
}

// GridOffset represents a footprint-relative coordinate.
type GridOffset struct {
	X int `json:"x" yaml:"x,omitempty"`
	Y int `json:"y" yaml:"y,omitempty"`
}

// ConnectionPoint represents a generic attachment point for power/logistics networks.
type ConnectionPoint struct {
	ID       string         `json:"id" yaml:"id"`
	Kind     ConnectionKind `json:"kind" yaml:"kind,omitempty"`
	Offset   GridOffset     `json:"offset" yaml:"offset,omitempty"`
	Capacity int            `json:"capacity" yaml:"capacity,omitempty"`
}

// IOPort represents an input/output port for items or fluids.
type IOPort struct {
	ID           string        `json:"id" yaml:"id"`
	Direction    PortDirection `json:"direction" yaml:"direction,omitempty"`
	Offset       GridOffset    `json:"offset" yaml:"offset,omitempty"`
	Capacity     int           `json:"capacity" yaml:"capacity,omitempty"`
	AllowedItems []string      `json:"allowed_items,omitempty" yaml:"allowed_items,omitempty"`
}

// MaintenanceCost represents recurring upkeep costs per tick.
type MaintenanceCost struct {
	Minerals int `json:"minerals" yaml:"minerals,omitempty"`
	Energy   int `json:"energy" yaml:"energy,omitempty"`
}

// BuildingRuntimeParams defines shared runtime parameters for a building.
type BuildingRuntimeParams struct {
	EnergyConsume    int               `json:"energy_consume" yaml:"energy_consume,omitempty"`
	EnergyGenerate   int               `json:"energy_generate" yaml:"energy_generate,omitempty"`
	PowerPriority    int               `json:"power_priority" yaml:"power_priority,omitempty"`
	Capacity         int               `json:"capacity" yaml:"capacity,omitempty"`
	MaintenanceCost  MaintenanceCost   `json:"maintenance_cost" yaml:"maintenance_cost,omitempty"`
	Footprint        Footprint         `json:"footprint" yaml:"footprint,omitempty"`
	ConnectionPoints []ConnectionPoint `json:"connection_points,omitempty" yaml:"connection_points,omitempty"`
	IOPorts          []IOPort          `json:"io_ports,omitempty" yaml:"io_ports,omitempty"`
}

// BuildingRuntime captures the runtime parameters and state of a building instance.
type BuildingRuntime struct {
	Params      BuildingRuntimeParams   `json:"params"`
	Functions   BuildingFunctionModules `json:"functions,omitempty"`
	State       BuildingWorkState       `json:"state"`
	StateReason string                  `json:"state_reason,omitempty"`
}

// BuildingFunctionModules describes modular building capabilities.
type BuildingFunctionModules struct {
	Production      *ProductionModule        `json:"production,omitempty" yaml:"production,omitempty"`
	Collect         *CollectModule           `json:"collect,omitempty" yaml:"collect,omitempty"`
	Orbital         *OrbitalModule           `json:"orbital,omitempty" yaml:"orbital,omitempty"`
	Transport       *TransportModule         `json:"transport,omitempty" yaml:"transport,omitempty"`
	Sorter          *SorterModule            `json:"sorter,omitempty" yaml:"sorter,omitempty"`
	Spray           *SprayModule             `json:"spray,omitempty" yaml:"spray,omitempty"`
	Storage         *StorageModule           `json:"storage,omitempty" yaml:"storage,omitempty"`
	RayReceiver     *RayReceiverModule       `json:"ray_receiver,omitempty" yaml:"ray_receiver,omitempty"`
	EnergyExchanger *EnergyExchangerModule   `json:"energy_exchanger,omitempty" yaml:"energy_exchanger,omitempty"`
	EnergyStorage   *EnergyStorageModule     `json:"energy_storage,omitempty" yaml:"energy_storage,omitempty"`
	Energy          *modelpower.EnergyModule `json:"energy,omitempty" yaml:"energy,omitempty"`
	Research        *ResearchModule          `json:"research,omitempty" yaml:"research,omitempty"`
	Combat          *CombatModule            `json:"combat,omitempty" yaml:"combat,omitempty"`
	PowerGrid       *PowerGridModule         `json:"power_grid,omitempty" yaml:"power_grid,omitempty"`
	Shield          *ShieldModule            `json:"shield,omitempty" yaml:"shield,omitempty"`
	Launch          *LaunchModule            `json:"launch,omitempty" yaml:"launch,omitempty"`
	Deployment      *DeploymentModule        `json:"deployment,omitempty" yaml:"deployment,omitempty"`
}

// ProductionModule handles production throughput.
type ProductionModule struct {
	Throughput  int `json:"throughput" yaml:"throughput,omitempty"`
	RecipeSlots int `json:"recipe_slots" yaml:"recipe_slots,omitempty"`
}

// CollectModule handles resource extraction.
type CollectModule struct {
	AllowedResources []string `json:"allowed_resources,omitempty" yaml:"allowed_resources,omitempty"`
	ResourceKind     string   `json:"resource_kind,omitempty" yaml:"resource_kind,omitempty"`
	YieldPerTick     int      `json:"yield_per_tick" yaml:"yield_per_tick,omitempty"`
	// MineralsKickback is the amount of minerals credited to the owner's pool
	// per unit of mined resource stored in the building's local storage.
	// It keeps the minerals-based construction economy funded while the
	// mined items themselves flow into the item/logistics economy.
	MineralsKickback float64 `json:"minerals_kickback,omitempty" yaml:"minerals_kickback,omitempty"`
	// CoverageRadius 采集覆盖半径（切比雪夫距离，格）：0 只采所在格矿脉，>0 多脉同采。
	CoverageRadius int `json:"coverage_radius,omitempty" yaml:"coverage_radius,omitempty"`
}

// OrbitalModule handles orbital collection outputs per tick.
type OrbitalModule struct {
	Outputs      []ItemAmount `json:"outputs" yaml:"outputs,omitempty"`
	MaxInventory int          `json:"max_inventory" yaml:"max_inventory,omitempty"`
}

// TransportModule handles transport throughput.
type TransportModule struct {
	Throughput int `json:"throughput" yaml:"throughput,omitempty"`
	StackLimit int `json:"stack_limit" yaml:"stack_limit,omitempty"`
}

// SorterModule handles sorter throughput and range.
type SorterModule struct {
	Speed int `json:"speed" yaml:"speed,omitempty"`
	Range int `json:"range" yaml:"range,omitempty"`
}

// SprayModule handles spray coating throughput.
type SprayModule struct {
	Throughput int `json:"throughput" yaml:"throughput,omitempty"`
	MaxLevel   int `json:"max_level" yaml:"max_level,omitempty"`
}

// StorageModule handles storage capacity.
type StorageModule struct {
	Capacity       int `json:"capacity" yaml:"capacity,omitempty"`
	Slots          int `json:"slots,omitempty" yaml:"slots,omitempty"`
	Buffer         int `json:"buffer" yaml:"buffer,omitempty"`
	InputPriority  int `json:"input_priority" yaml:"input_priority,omitempty"`
	OutputPriority int `json:"output_priority" yaml:"output_priority,omitempty"`
}

// AccumulatorItemEnergy is the grid energy stored in one full accumulator
// item (ItemAccumulatorFull), aligned with the accumulator building's storage
// capacity.
const AccumulatorItemEnergy = 100

// EnergyExchangerMode selects the item-cycle behavior of an energy exchanger.
type EnergyExchangerMode string

const (
	// EnergyExchangerModeStandby leaves stored accumulator items untouched.
	EnergyExchangerModeStandby EnergyExchangerMode = "standby"
	// EnergyExchangerModeCharge converts empty accumulator items into full ones
	// using grid surplus power.
	EnergyExchangerModeCharge EnergyExchangerMode = "charge"
	// EnergyExchangerModeDischarge converts full accumulator items back into
	// empty ones, releasing energy into the grid.
	EnergyExchangerModeDischarge EnergyExchangerMode = "discharge"
)

// IsEnergyExchangerMode validates an exchanger mode value.
func IsEnergyExchangerMode(mode EnergyExchangerMode) bool {
	switch mode {
	case EnergyExchangerModeStandby, EnergyExchangerModeCharge, EnergyExchangerModeDischarge:
		return true
	}
	return false
}

// EnergyExchangerModule marks a building as a playable power-storage hub.
// Mode is per-instance runtime state (cloned per building); the remaining
// fields are definition parameters for the accumulator item cycle.
type EnergyExchangerModule struct {
	Hub bool `json:"hub" yaml:"hub,omitempty"`
	// Mode selects charge/discharge/standby behavior for the item cycle.
	Mode EnergyExchangerMode `json:"mode,omitempty" yaml:"mode,omitempty"`
	// EnergyPerItem is the grid energy consumed to charge one item, or
	// released when discharging one item.
	EnergyPerItem int `json:"energy_per_item" yaml:"energy_per_item,omitempty"`
	// ItemsPerTick caps item conversions per tick in either direction.
	ItemsPerTick int `json:"items_per_tick" yaml:"items_per_tick,omitempty"`
	// EmptyItemID is the discharged accumulator item consumed in charge mode.
	EmptyItemID string `json:"empty_item_id" yaml:"empty_item_id,omitempty"`
	// FullItemID is the charged accumulator item produced in charge mode and
	// consumed in discharge mode.
	FullItemID string `json:"full_item_id" yaml:"full_item_id,omitempty"`
}

// EnergyStorageModule handles power storage capacity and charge/discharge rules.
type EnergyStorageModule struct {
	Capacity            int     `json:"capacity" yaml:"capacity,omitempty"`
	ChargePerTick       int     `json:"charge_per_tick" yaml:"charge_per_tick,omitempty"`
	DischargePerTick    int     `json:"discharge_per_tick" yaml:"discharge_per_tick,omitempty"`
	ChargeEfficiency    float64 `json:"charge_efficiency" yaml:"charge_efficiency,omitempty"`
	DischargeEfficiency float64 `json:"discharge_efficiency" yaml:"discharge_efficiency,omitempty"`
	Priority            int     `json:"priority" yaml:"priority,omitempty"`
	InitialCharge       int     `json:"initial_charge" yaml:"initial_charge,omitempty"`
}

// ResearchModule handles research throughput.
type ResearchModule struct {
	ResearchPerTick int `json:"research_per_tick" yaml:"research_per_tick,omitempty"`
}

// CombatModule handles defensive or offensive stats.
type CombatModule struct {
	MinRange     int    `json:"min_range,omitempty" yaml:"min_range,omitempty"`
	AirOnly      bool   `json:"air_only,omitempty" yaml:"air_only,omitempty"`
	Attack       int    `json:"attack" yaml:"attack,omitempty"`
	Range        int    `json:"range" yaml:"range,omitempty"`
	FireRate     int    `json:"fire_rate,omitempty" yaml:"fire_rate,omitempty"`
	AmmoItem     string `json:"ammo_item,omitempty" yaml:"ammo_item,omitempty"`
	AmmoConsume  int    `json:"ammo_consume,omitempty" yaml:"ammo_consume,omitempty"`
	LastFireTick int64  `json:"last_fire_tick,omitempty" yaml:"-"`
}

// PowerGridModule handles wireless power transmission coverage.
type PowerGridModule struct {
	WirelessRange int `json:"wireless_range" yaml:"wireless_range,omitempty"`
}

// ShieldModule handles planetary shield charge and capacity.
type ShieldModule struct {
	Capacity      int `json:"capacity" yaml:"capacity,omitempty"`
	ChargePerTick int `json:"charge_per_tick" yaml:"charge_per_tick,omitempty"`
	CurrentCharge int `json:"current_charge" yaml:"current_charge,omitempty"`
}

// LaunchModule handles launch-related parameters for EM Rail Ejector and Vertical Launching Silo.
type LaunchModule struct {
	EnergyPerLaunch int     `json:"energy_per_launch" yaml:"energy_per_launch,omitempty"`     // energy consumed per launch
	SuccessRate     float64 `json:"success_rate" yaml:"success_rate,omitempty"`               // launch success probability (0-1)
	OrbitRadiusMin  float64 `json:"orbit_radius_min" yaml:"orbit_radius_min,omitempty"`       // minimum orbit radius in AU
	OrbitRadiusMax  float64 `json:"orbit_radius_max" yaml:"orbit_radius_max,omitempty"`       // maximum orbit radius in AU
	InclinationMax  float64 `json:"inclination_max" yaml:"inclination_max,omitempty"`         // maximum inclination in degrees
	LaunchInterval  int     `json:"launch_interval" yaml:"launch_interval,omitempty"`         // ticks between launches
	LaunchQueueSize int     `json:"launch_queue_size" yaml:"launch_queue_size,omitempty"`     // max launch queue size
	RocketItemID    string  `json:"rocket_item_id,omitempty" yaml:"rocket_item_id,omitempty"` // rocket type to launch (for silo)
	ProductionSpeed int     `json:"production_speed" yaml:"production_speed,omitempty"`       // rocket production speed (for silo)
}

// DeploymentModule marks a building as a squad/fleet deployment hub.
type DeploymentModule struct {
	SquadCapacity     int      `json:"squad_capacity" yaml:"squad_capacity,omitempty"`
	FleetCapacity     int      `json:"fleet_capacity" yaml:"fleet_capacity,omitempty"`
	AllowedBlueprints []string `json:"allowed_blueprints,omitempty" yaml:"allowed_blueprints,omitempty"`
}

// BuildingRuntimeDefinition defines runtime parameters for a building type.
type BuildingRuntimeDefinition struct {
	ID        BuildingType            `json:"id" yaml:"-"` // buildings.yaml 中取所属建筑 id
	Params    BuildingRuntimeParams   `json:"params" yaml:"params,omitempty"`
	Functions BuildingFunctionModules `json:"functions,omitempty" yaml:"functions,omitempty"`
}

var (
	buildingRuntimeMu sync.RWMutex
	buildingRuntime   map[BuildingType]BuildingRuntimeDefinition
)

// BuildingRuntimeDefinitionByID returns runtime definition for a building id.
func BuildingRuntimeDefinitionByID(id BuildingType) (BuildingRuntimeDefinition, bool) {
	buildingRuntimeMu.RLock()
	defer buildingRuntimeMu.RUnlock()
	def, ok := buildingRuntime[id]
	return def, ok
}

// AllBuildingRuntimeDefinitions returns a copy of runtime definitions.
func AllBuildingRuntimeDefinitions() []BuildingRuntimeDefinition {
	buildingRuntimeMu.RLock()
	defer buildingRuntimeMu.RUnlock()
	defs := make([]BuildingRuntimeDefinition, 0, len(buildingRuntime))
	for _, def := range buildingRuntime {
		defs = append(defs, def)
	}
	sort.Slice(defs, func(i, j int) bool {
		return defs[i].ID < defs[j].ID
	})
	return defs
}

// validateBuildingRuntimeDefinition 校验运行时定义；baseDef 为所属建筑定义，
// itemExists 用于校验模块内引用的物品 ID。
func validateBuildingRuntimeDefinition(def BuildingRuntimeDefinition, baseDef BuildingDefinition, itemExists func(string) bool) error {
	if def.ID == "" {
		return fmt.Errorf("building runtime id required")
	}
	if def.Params.Footprint.Width <= 0 || def.Params.Footprint.Height <= 0 {
		return fmt.Errorf("building runtime %s invalid footprint", def.ID)
	}
	if def.Params.Footprint != baseDef.Footprint {
		return fmt.Errorf("building runtime %s footprint mismatch", def.ID)
	}
	if def.Params.EnergyConsume < 0 || def.Params.EnergyGenerate < 0 || def.Params.Capacity < 0 {
		return fmt.Errorf("building runtime %s has negative params", def.ID)
	}
	if def.Params.PowerPriority < 0 {
		return fmt.Errorf("building runtime %s has negative power priority", def.ID)
	}
	if def.Params.MaintenanceCost.Minerals < 0 || def.Params.MaintenanceCost.Energy < 0 {
		return fmt.Errorf("building runtime %s has negative maintenance cost", def.ID)
	}
	seenConn := map[string]struct{}{}
	for _, conn := range def.Params.ConnectionPoints {
		if conn.ID == "" {
			return fmt.Errorf("building runtime %s connection point missing id", def.ID)
		}
		if _, ok := validConnectionKinds[conn.Kind]; !ok {
			return fmt.Errorf("building runtime %s connection point %s invalid kind", def.ID, conn.ID)
		}
		if conn.Capacity < 0 {
			return fmt.Errorf("building runtime %s connection point %s negative capacity", def.ID, conn.ID)
		}
		if conn.Offset.X < 0 || conn.Offset.Y < 0 {
			return fmt.Errorf("building runtime %s connection point %s invalid offset", def.ID, conn.ID)
		}
		if _, exists := seenConn[conn.ID]; exists {
			return fmt.Errorf("building runtime %s duplicate connection point %s", def.ID, conn.ID)
		}
		seenConn[conn.ID] = struct{}{}
	}
	seenPort := map[string]struct{}{}
	for _, port := range def.Params.IOPorts {
		if port.ID == "" {
			return fmt.Errorf("building runtime %s io port missing id", def.ID)
		}
		if _, ok := validPortDirections[port.Direction]; !ok {
			return fmt.Errorf("building runtime %s io port %s invalid direction", def.ID, port.ID)
		}
		if port.Capacity < 0 {
			return fmt.Errorf("building runtime %s io port %s negative capacity", def.ID, port.ID)
		}
		if port.Offset.X < 0 || port.Offset.Y < 0 {
			return fmt.Errorf("building runtime %s io port %s invalid offset", def.ID, port.ID)
		}
		if port.Offset.X >= def.Params.Footprint.Width || port.Offset.Y >= def.Params.Footprint.Height {
			return fmt.Errorf("building runtime %s io port %s offset out of footprint", def.ID, port.ID)
		}
		for _, itemID := range port.AllowedItems {
			if !itemExists(itemID) {
				return fmt.Errorf("building runtime %s io port %s unknown allowed item %s", def.ID, port.ID, itemID)
			}
		}
		if _, exists := seenPort[port.ID]; exists {
			return fmt.Errorf("building runtime %s duplicate io port %s", def.ID, port.ID)
		}
		seenPort[port.ID] = struct{}{}
	}
	if def.Functions.Production != nil {
		if def.Functions.Production.Throughput < 0 || def.Functions.Production.RecipeSlots < 0 {
			return fmt.Errorf("building runtime %s production module invalid", def.ID)
		}
	}
	if def.Functions.Collect != nil {
		for _, id := range def.Functions.Collect.AllowedResources {
			if !itemExists(id) {
				return fmt.Errorf("building runtime %s unknown resource %s", def.ID, id)
			}
		}
		if def.Functions.Collect.YieldPerTick < 0 || def.Functions.Collect.CoverageRadius < 0 {
			return fmt.Errorf("building runtime %s collect module invalid", def.ID)
		}
	}
	if def.Functions.Orbital != nil {
		if def.Functions.Orbital.MaxInventory < 0 {
			return fmt.Errorf("building runtime %s orbital module invalid", def.ID)
		}
		if len(def.Functions.Orbital.Outputs) == 0 {
			return fmt.Errorf("building runtime %s orbital module missing outputs", def.ID)
		}
		for _, out := range def.Functions.Orbital.Outputs {
			if out.ItemID == "" || out.Quantity <= 0 {
				return fmt.Errorf("building runtime %s orbital module invalid output", def.ID)
			}
			if !itemExists(out.ItemID) {
				return fmt.Errorf("building runtime %s orbital module unknown item %s", def.ID, out.ItemID)
			}
		}
	}
	if def.Functions.Transport != nil {
		if def.Functions.Transport.Throughput < 0 || def.Functions.Transport.StackLimit < 0 {
			return fmt.Errorf("building runtime %s transport module invalid", def.ID)
		}
	}
	if def.Functions.Sorter != nil {
		if def.Functions.Sorter.Speed < 0 || def.Functions.Sorter.Range < 0 {
			return fmt.Errorf("building runtime %s sorter module invalid", def.ID)
		}
	}
	if def.Functions.Spray != nil {
		if def.Functions.Spray.Throughput < 0 || def.Functions.Spray.MaxLevel < 0 {
			return fmt.Errorf("building runtime %s spray module invalid", def.ID)
		}
	}
	if def.Functions.Storage != nil {
		if def.Functions.Storage.Capacity < 0 || def.Functions.Storage.Slots < 0 {
			return fmt.Errorf("building runtime %s storage module invalid", def.ID)
		}
		if def.Functions.Storage.Buffer < 0 || def.Functions.Storage.InputPriority < 0 || def.Functions.Storage.OutputPriority < 0 {
			return fmt.Errorf("building runtime %s storage module invalid", def.ID)
		}
	}
	if def.Functions.EnergyExchanger != nil {
		module := def.Functions.EnergyExchanger
		if !module.Hub {
			return fmt.Errorf("building runtime %s energy exchanger module invalid", def.ID)
		}
		if module.Mode != "" && !IsEnergyExchangerMode(module.Mode) {
			return fmt.Errorf("building runtime %s energy exchanger mode invalid", def.ID)
		}
		if module.EnergyPerItem <= 0 || module.ItemsPerTick <= 0 {
			return fmt.Errorf("building runtime %s energy exchanger item cycle params invalid", def.ID)
		}
		if module.EmptyItemID == "" || module.FullItemID == "" {
			return fmt.Errorf("building runtime %s energy exchanger item ids required", def.ID)
		}
		if !itemExists(module.EmptyItemID) || !itemExists(module.FullItemID) {
			return fmt.Errorf("building runtime %s energy exchanger unknown item", def.ID)
		}
	}
	if def.Functions.RayReceiver != nil {
		module := def.Functions.RayReceiver
		if module.InputPerTick < 0 || module.PowerOutputPerTick < 0 || module.PhotonOutputPerTick < 0 {
			return fmt.Errorf("building runtime %s ray receiver module invalid", def.ID)
		}
		if module.ReceiveEfficiency <= 0 || module.ReceiveEfficiency > 1 {
			return fmt.Errorf("building runtime %s ray receiver receive efficiency invalid", def.ID)
		}
		if module.PowerEfficiency <= 0 || module.PowerEfficiency > 1 {
			return fmt.Errorf("building runtime %s ray receiver power efficiency invalid", def.ID)
		}
		if module.PhotonOutputPerTick > 0 {
			if module.PhotonEnergyCost <= 0 {
				return fmt.Errorf("building runtime %s ray receiver photon energy cost invalid", def.ID)
			}
			if module.PhotonEfficiency <= 0 || module.PhotonEfficiency > 1 {
				return fmt.Errorf("building runtime %s ray receiver photon efficiency invalid", def.ID)
			}
			photonItem := module.PhotonItemID
			if photonItem == "" {
				photonItem = ItemCriticalPhoton
			}
			if !itemExists(photonItem) {
				return fmt.Errorf("building runtime %s ray receiver photon item unknown", def.ID)
			}
		}
		if module.Mode != "" && !IsRayReceiverMode(module.Mode) {
			return fmt.Errorf("building runtime %s ray receiver mode invalid", def.ID)
		}
	}
	if def.Functions.EnergyStorage != nil {
		module := def.Functions.EnergyStorage
		if module.Capacity < 0 || module.ChargePerTick < 0 || module.DischargePerTick < 0 || module.Priority < 0 || module.InitialCharge < 0 {
			return fmt.Errorf("building runtime %s energy storage module invalid", def.ID)
		}
		if module.Capacity == 0 {
			return fmt.Errorf("building runtime %s energy storage module missing capacity", def.ID)
		}
		if module.InitialCharge > module.Capacity {
			return fmt.Errorf("building runtime %s energy storage initial charge exceeds capacity", def.ID)
		}
		if module.ChargeEfficiency < 0 || module.ChargeEfficiency > 1 {
			return fmt.Errorf("building runtime %s energy storage charge efficiency invalid", def.ID)
		}
		if module.DischargeEfficiency < 0 || module.DischargeEfficiency > 1 {
			return fmt.Errorf("building runtime %s energy storage discharge efficiency invalid", def.ID)
		}
	}
	if def.Functions.Energy != nil {
		if def.Functions.Energy.OutputPerTick < 0 || def.Functions.Energy.ConsumePerTick < 0 || def.Functions.Energy.Buffer < 0 {
			return fmt.Errorf("building runtime %s energy module invalid", def.ID)
		}
		if def.Functions.Energy.SourceKind != "" && !modelpower.IsPowerSourceKind(def.Functions.Energy.SourceKind) {
			return fmt.Errorf("building runtime %s invalid power source %s", def.ID, def.Functions.Energy.SourceKind)
		}
		if def.Functions.Energy.SourceKind != "" && modelpower.IsFuelBasedPowerSource(def.Functions.Energy.SourceKind) && len(def.Functions.Energy.FuelRules) == 0 {
			return fmt.Errorf("building runtime %s power source %s missing fuel rules", def.ID, def.Functions.Energy.SourceKind)
		}
		for _, rule := range def.Functions.Energy.FuelRules {
			if rule.ItemID == "" || rule.ConsumePerTick <= 0 || rule.OutputMultiplier <= 0 {
				return fmt.Errorf("building runtime %s invalid fuel rule", def.ID)
			}
			if !itemExists(rule.ItemID) {
				return fmt.Errorf("building runtime %s fuel rule unknown item %s", def.ID, rule.ItemID)
			}
		}
	}
	if def.Functions.Research != nil && def.Functions.Research.ResearchPerTick < 0 {
		return fmt.Errorf("building runtime %s research module invalid", def.ID)
	}
	if def.Functions.Combat != nil {
		combat := def.Functions.Combat
		if combat.Attack < 0 || combat.Range < 0 {
			return fmt.Errorf("building runtime %s combat module invalid", def.ID)
		}
		for _, ammo := range []string{combat.AmmoItem} {
			if ammo != "" && !itemExists(ammo) {
				return fmt.Errorf("building runtime %s combat module unknown ammo item %s", def.ID, ammo)
			}
		}
	}
	if def.Functions.PowerGrid != nil && def.Functions.PowerGrid.WirelessRange < 0 {
		return fmt.Errorf("building runtime %s power grid module invalid", def.ID)
	}
	if def.Functions.Shield != nil {
		module := def.Functions.Shield
		if module.Capacity <= 0 || module.ChargePerTick <= 0 {
			return fmt.Errorf("building runtime %s shield module invalid", def.ID)
		}
		if module.CurrentCharge < 0 || module.CurrentCharge > module.Capacity {
			return fmt.Errorf("building runtime %s shield module charge invalid", def.ID)
		}
	}
	if def.Functions.Launch != nil {
		lm := def.Functions.Launch
		if lm.EnergyPerLaunch < 0 {
			return fmt.Errorf("building runtime %s launch module energy_per_launch invalid", def.ID)
		}
		if lm.SuccessRate < 0 || lm.SuccessRate > 1 {
			return fmt.Errorf("building runtime %s launch module success_rate must be between 0 and 1", def.ID)
		}
		if lm.OrbitRadiusMin < 0 || lm.OrbitRadiusMax < 0 || lm.OrbitRadiusMin > lm.OrbitRadiusMax {
			return fmt.Errorf("building runtime %s launch module orbit radius invalid", def.ID)
		}
		if lm.InclinationMax < 0 || lm.InclinationMax > 180 {
			return fmt.Errorf("building runtime %s launch module inclination_max must be between 0 and 180", def.ID)
		}
		if lm.LaunchInterval < 0 {
			return fmt.Errorf("building runtime %s launch module launch_interval invalid", def.ID)
		}
		if lm.LaunchQueueSize < 0 {
			return fmt.Errorf("building runtime %s launch module launch_queue_size invalid", def.ID)
		}
		if lm.ProductionSpeed < 0 {
			return fmt.Errorf("building runtime %s launch module production_speed invalid", def.ID)
		}
		if lm.RocketItemID != "" && !itemExists(lm.RocketItemID) {
			return fmt.Errorf("building runtime %s launch module unknown rocket item %s", def.ID, lm.RocketItemID)
		}
	}
	return nil
}

func (p BuildingRuntimeParams) clone() BuildingRuntimeParams {
	out := p
	if len(p.ConnectionPoints) > 0 {
		out.ConnectionPoints = make([]ConnectionPoint, len(p.ConnectionPoints))
		copy(out.ConnectionPoints, p.ConnectionPoints)
	}
	if len(p.IOPorts) > 0 {
		out.IOPorts = make([]IOPort, len(p.IOPorts))
		for i, port := range p.IOPorts {
			out.IOPorts[i] = port
			if len(port.AllowedItems) > 0 {
				out.IOPorts[i].AllowedItems = append([]string(nil), port.AllowedItems...)
			}
		}
	}
	return out
}

func (m BuildingFunctionModules) clone() BuildingFunctionModules {
	out := m
	if m.Production != nil {
		val := *m.Production
		out.Production = &val
	}
	if m.Collect != nil {
		val := *m.Collect
		val.AllowedResources = append([]string(nil), m.Collect.AllowedResources...)
		out.Collect = &val
	}
	if m.Orbital != nil {
		val := *m.Orbital
		if len(m.Orbital.Outputs) > 0 {
			val.Outputs = append([]ItemAmount(nil), m.Orbital.Outputs...)
		}
		out.Orbital = &val
	}
	if m.Transport != nil {
		val := *m.Transport
		out.Transport = &val
	}
	if m.Sorter != nil {
		val := *m.Sorter
		out.Sorter = &val
	}
	if m.Spray != nil {
		val := *m.Spray
		out.Spray = &val
	}
	if m.Storage != nil {
		val := *m.Storage
		out.Storage = &val
	}
	if m.RayReceiver != nil {
		val := *m.RayReceiver
		out.RayReceiver = &val
	}
	if m.EnergyExchanger != nil {
		val := *m.EnergyExchanger
		out.EnergyExchanger = &val
	}
	if m.EnergyStorage != nil {
		val := *m.EnergyStorage
		out.EnergyStorage = &val
	}
	if m.Energy != nil {
		val := *m.Energy
		if len(m.Energy.FuelRules) > 0 {
			val.FuelRules = append([]modelpower.FuelRule(nil), m.Energy.FuelRules...)
		}
		out.Energy = &val
	}
	if m.Research != nil {
		val := *m.Research
		out.Research = &val
	}
	if m.Combat != nil {
		val := *m.Combat
		out.Combat = &val
	}
	if m.PowerGrid != nil {
		val := *m.PowerGrid
		out.PowerGrid = &val
	}
	if m.Shield != nil {
		val := *m.Shield
		out.Shield = &val
	}
	if m.Launch != nil {
		val := *m.Launch
		out.Launch = &val
	}
	if m.Deployment != nil {
		val := *m.Deployment
		val.AllowedBlueprints = append([]string(nil), m.Deployment.AllowedBlueprints...)
		out.Deployment = &val
	}
	return out
}

// RequiresLavaProximity reports whether the building type must be placed on or
// directly adjacent to lava terrain (geothermal power stations).
func RequiresLavaProximity(btype BuildingType) bool {
	return btype == BuildingTypeGeothermalPowerStation
}

// LavaProximityOk reports whether any tile covered by the footprint at (x,y)
// or by its 1-tile surrounding ring is lava, using the provided lookup. The
// lookup must answer false for out-of-bounds coordinates.
func LavaProximityOk(isLava func(x, y int) bool, x, y, width, height int) bool {
	if isLava == nil {
		return false
	}
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	for dy := -1; dy <= height; dy++ {
		for dx := -1; dx <= width; dx++ {
			if isLava(x+dx, y+dy) {
				return true
			}
		}
	}
	return false
}
