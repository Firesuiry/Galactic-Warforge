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
	X int `json:"x" yaml:"x"`
	Y int `json:"y" yaml:"y"`
}

// ConnectionPoint represents a generic attachment point for power/logistics networks.
type ConnectionPoint struct {
	ID       string         `json:"id" yaml:"id"`
	Kind     ConnectionKind `json:"kind" yaml:"kind"`
	Offset   GridOffset     `json:"offset" yaml:"offset"`
	Capacity int            `json:"capacity" yaml:"capacity"`
}

// IOPort represents an input/output port for items or fluids.
type IOPort struct {
	ID           string        `json:"id" yaml:"id"`
	Direction    PortDirection `json:"direction" yaml:"direction"`
	Offset       GridOffset    `json:"offset" yaml:"offset"`
	Capacity     int           `json:"capacity" yaml:"capacity"`
	AllowedItems []string      `json:"allowed_items,omitempty" yaml:"allowed_items,omitempty"`
}

// MaintenanceCost represents recurring upkeep costs per tick.
type MaintenanceCost struct {
	Minerals int `json:"minerals" yaml:"minerals"`
	Energy   int `json:"energy" yaml:"energy"`
}

// BuildingRuntimeParams defines shared runtime parameters for a building.
type BuildingRuntimeParams struct {
	EnergyConsume    int               `json:"energy_consume" yaml:"energy_consume"`
	EnergyGenerate   int               `json:"energy_generate" yaml:"energy_generate"`
	PowerPriority    int               `json:"power_priority" yaml:"power_priority"`
	Capacity         int               `json:"capacity" yaml:"capacity"`
	MaintenanceCost  MaintenanceCost   `json:"maintenance_cost" yaml:"maintenance_cost"`
	Footprint        Footprint         `json:"footprint" yaml:"footprint"`
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
	Throughput  int `json:"throughput" yaml:"throughput"`
	RecipeSlots int `json:"recipe_slots" yaml:"recipe_slots"`
}

// CollectModule handles resource extraction.
type CollectModule struct {
	ResourceKind string `json:"resource_kind,omitempty" yaml:"resource_kind,omitempty"`
	YieldPerTick int    `json:"yield_per_tick" yaml:"yield_per_tick"`
	// MineralsKickback is the amount of minerals credited to the owner's pool
	// per unit of mined resource stored in the building's local storage.
	// It keeps the minerals-based construction economy funded while the
	// mined items themselves flow into the item/logistics economy.
	MineralsKickback float64 `json:"minerals_kickback,omitempty" yaml:"minerals_kickback,omitempty"`
}

// OrbitalModule handles orbital collection outputs per tick.
type OrbitalModule struct {
	Outputs      []ItemAmount `json:"outputs" yaml:"outputs"`
	MaxInventory int          `json:"max_inventory" yaml:"max_inventory"`
}

// TransportModule handles transport throughput.
type TransportModule struct {
	Throughput int `json:"throughput" yaml:"throughput"`
	StackLimit int `json:"stack_limit" yaml:"stack_limit"`
}

// SorterModule handles sorter throughput and range.
type SorterModule struct {
	Speed int `json:"speed" yaml:"speed"`
	Range int `json:"range" yaml:"range"`
}

// SprayModule handles spray coating throughput.
type SprayModule struct {
	Throughput int `json:"throughput" yaml:"throughput"`
	MaxLevel   int `json:"max_level" yaml:"max_level"`
}

// StorageModule handles storage capacity.
type StorageModule struct {
	Capacity       int `json:"capacity" yaml:"capacity"`
	Slots          int `json:"slots,omitempty" yaml:"slots,omitempty"`
	Buffer         int `json:"buffer" yaml:"buffer"`
	InputPriority  int `json:"input_priority" yaml:"input_priority"`
	OutputPriority int `json:"output_priority" yaml:"output_priority"`
}

// AccumulatorItemEnergy is the grid energy stored in one full accumulator
// item (ItemAccumulatorFull), aligned with the accumulator building's storage
// capacity. The accumulator item ids themselves live in item.go.
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
	Hub bool `json:"hub" yaml:"hub"`
	// Mode selects charge/discharge/standby behavior for the item cycle.
	Mode EnergyExchangerMode `json:"mode,omitempty" yaml:"mode,omitempty"`
	// EnergyPerItem is the grid energy consumed to charge one item, or
	// released when discharging one item.
	EnergyPerItem int `json:"energy_per_item" yaml:"energy_per_item"`
	// ItemsPerTick caps item conversions per tick in either direction.
	ItemsPerTick int `json:"items_per_tick" yaml:"items_per_tick"`
	// EmptyItemID is the discharged accumulator item consumed in charge mode.
	EmptyItemID string `json:"empty_item_id" yaml:"empty_item_id"`
	// FullItemID is the charged accumulator item produced in charge mode and
	// consumed in discharge mode.
	FullItemID string `json:"full_item_id" yaml:"full_item_id"`
}

// EnergyStorageModule handles power storage capacity and charge/discharge rules.
type EnergyStorageModule struct {
	Capacity            int     `json:"capacity" yaml:"capacity"`
	ChargePerTick       int     `json:"charge_per_tick" yaml:"charge_per_tick"`
	DischargePerTick    int     `json:"discharge_per_tick" yaml:"discharge_per_tick"`
	ChargeEfficiency    float64 `json:"charge_efficiency" yaml:"charge_efficiency"`
	DischargeEfficiency float64 `json:"discharge_efficiency" yaml:"discharge_efficiency"`
	Priority            int     `json:"priority" yaml:"priority"`
	InitialCharge       int     `json:"initial_charge" yaml:"initial_charge"`
}

// ResearchModule handles research throughput.
type ResearchModule struct {
	ResearchPerTick int `json:"research_per_tick" yaml:"research_per_tick"`
}

// CombatModule handles defensive or offensive stats.
type CombatModule struct {
	Attack       int    `json:"attack" yaml:"attack"`
	Range        int    `json:"range" yaml:"range"`
	FireRate     int    `json:"fire_rate,omitempty" yaml:"fire_rate,omitempty"`
	AmmoItem     string `json:"ammo_item,omitempty" yaml:"ammo_item,omitempty"`
	AmmoConsume  int    `json:"ammo_consume,omitempty" yaml:"ammo_consume,omitempty"`
	LastFireTick int64  `json:"last_fire_tick,omitempty" yaml:"last_fire_tick,omitempty"`
	// AltAmmoItem is an optional upgraded ammunition the turret may fall back
	// to when the primary AmmoItem is unavailable. Consumption of AltAmmoItem
	// is wired in the turret settlement layer; the fields here are the
	// authoritative runtime data it consumes.
	AltAmmoItem string `json:"alt_ammo_item,omitempty" yaml:"alt_ammo_item,omitempty"`
	// AltAmmoAttack is the attack value applied when firing AltAmmoItem.
	AltAmmoAttack int `json:"alt_ammo_attack,omitempty" yaml:"alt_ammo_attack,omitempty"`
}

// PowerGridModule handles wireless power transmission coverage.
type PowerGridModule struct {
	WirelessRange int `json:"wireless_range" yaml:"wireless_range"`
}

// ShieldModule handles planetary shield charge and capacity.
type ShieldModule struct {
	Capacity      int `json:"capacity" yaml:"capacity"`
	ChargePerTick int `json:"charge_per_tick" yaml:"charge_per_tick"`
	CurrentCharge int `json:"current_charge" yaml:"current_charge"`
}

// LaunchModule handles launch-related parameters for EM Rail Ejector and Vertical Launching Silo.
type LaunchModule struct {
	EnergyPerLaunch int     `json:"energy_per_launch" yaml:"energy_per_launch"`               // energy consumed per launch
	SuccessRate     float64 `json:"success_rate" yaml:"success_rate"`                         // launch success probability (0-1)
	OrbitRadiusMin  float64 `json:"orbit_radius_min" yaml:"orbit_radius_min"`                 // minimum orbit radius in AU
	OrbitRadiusMax  float64 `json:"orbit_radius_max" yaml:"orbit_radius_max"`                 // maximum orbit radius in AU
	InclinationMax  float64 `json:"inclination_max" yaml:"inclination_max"`                   // maximum inclination in degrees
	LaunchInterval  int     `json:"launch_interval" yaml:"launch_interval"`                   // ticks between launches
	LaunchQueueSize int     `json:"launch_queue_size" yaml:"launch_queue_size"`               // max launch queue size
	RocketItemID    string  `json:"rocket_item_id,omitempty" yaml:"rocket_item_id,omitempty"` // rocket type to launch (for silo)
	ProductionSpeed int     `json:"production_speed" yaml:"production_speed"`                 // rocket production speed (for silo)
}

// DeploymentModule marks a building as a squad/fleet deployment hub.
type DeploymentModule struct {
	SquadCapacity     int      `json:"squad_capacity" yaml:"squad_capacity"`
	FleetCapacity     int      `json:"fleet_capacity" yaml:"fleet_capacity"`
	AllowedBlueprints []string `json:"allowed_blueprints,omitempty" yaml:"allowed_blueprints,omitempty"`
}

// BuildingRuntimeDefinition defines runtime parameters for a building type.
type BuildingRuntimeDefinition struct {
	ID        BuildingType            `json:"id" yaml:"id"`
	Params    BuildingRuntimeParams   `json:"params" yaml:"params"`
	Functions BuildingFunctionModules `json:"functions,omitempty" yaml:"functions,omitempty"`
}

var (
	buildingRuntimeMu sync.RWMutex
	buildingRuntime   map[BuildingType]BuildingRuntimeDefinition
)

func init() {
	catalog, err := buildBuildingRuntimeCatalog(defaultBuildingRuntimeDefinitions)
	if err != nil {
		panic(err)
	}
	buildingRuntime = catalog
}

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

func buildBuildingRuntimeCatalog(defs []BuildingRuntimeDefinition) (map[BuildingType]BuildingRuntimeDefinition, error) {
	baseDefs := AllBuildingDefinitions()
	if len(baseDefs) == 0 {
		return nil, fmt.Errorf("building runtime catalog requires building definitions")
	}
	catalog := make(map[BuildingType]BuildingRuntimeDefinition, len(baseDefs))
	for _, def := range baseDefs {
		catalog[def.ID] = BuildingRuntimeDefinition{
			ID: def.ID,
			Params: BuildingRuntimeParams{
				Footprint: def.Footprint,
			},
		}
	}

	for _, def := range defs {
		if def.ID == "" {
			return nil, fmt.Errorf("building runtime id required")
		}
		baseDef, ok := BuildingDefinitionByID(def.ID)
		if !ok {
			return nil, fmt.Errorf("building runtime %s missing building definition", def.ID)
		}
		if def.Params.Footprint.Width == 0 || def.Params.Footprint.Height == 0 {
			def.Params.Footprint = baseDef.Footprint
		}
		if def.Params.Footprint != baseDef.Footprint {
			return nil, fmt.Errorf("building runtime %s footprint mismatch", def.ID)
		}
		if err := validateBuildingRuntimeDefinition(def); err != nil {
			return nil, err
		}
		catalog[def.ID] = def
	}

	for _, def := range catalog {
		if err := validateBuildingRuntimeDefinition(def); err != nil {
			return nil, err
		}
	}
	return catalog, nil
}

func validateBuildingRuntimeDefinition(def BuildingRuntimeDefinition) error {
	if def.ID == "" {
		return fmt.Errorf("building runtime id required")
	}
	baseDef, ok := BuildingDefinitionByID(def.ID)
	if !ok {
		return fmt.Errorf("building runtime %s missing building definition", def.ID)
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
		if def.Functions.Collect.YieldPerTick < 0 {
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
			if _, ok := Item(out.ItemID); !ok {
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
			if _, ok := Item(photonItem); !ok {
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
		}
	}
	if def.Functions.Research != nil && def.Functions.Research.ResearchPerTick < 0 {
		return fmt.Errorf("building runtime %s research module invalid", def.ID)
	}
	if def.Functions.Combat != nil {
		if def.Functions.Combat.Attack < 0 || def.Functions.Combat.Range < 0 {
			return fmt.Errorf("building runtime %s combat module invalid", def.ID)
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

var defaultBuildingRuntimeDefinitions = []BuildingRuntimeDefinition{
	{
		ID: BuildingTypeBattlefieldAnalysisBase,
		Params: BuildingRuntimeParams{
			Capacity:      4,
			EnergyConsume: 2,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 60, Slots: 4, Buffer: 20, InputPriority: 2, OutputPriority: 1},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 2},
			Deployment: &DeploymentModule{
				SquadCapacity:     4,
				FleetCapacity:     2,
				AllowedBlueprints: []string{ItemPrototype, ItemPrecisionDrone, ItemCorvette, ItemDestroyer},
			},
		},
	},
	{
		ID: BuildingTypeMiningMachine,
		Params: BuildingRuntimeParams{
			Capacity:      8,
			EnergyConsume: 2,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Collect: &CollectModule{YieldPerTick: 8, MineralsKickback: 1.0},
			Storage: &StorageModule{Capacity: 48, Slots: 2, Buffer: 12, InputPriority: 1, OutputPriority: 2},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 2},
		},
	},
	{
		ID: BuildingTypeAdvancedMiningMachine,
		Params: BuildingRuntimeParams{
			Capacity:      12,
			EnergyConsume: 6,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Collect: &CollectModule{YieldPerTick: 16, MineralsKickback: 0.5},
			Storage: &StorageModule{Capacity: 96, Slots: 3, Buffer: 24, InputPriority: 1, OutputPriority: 2},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypeWaterPump,
		Params: BuildingRuntimeParams{
			Capacity:      8,
			EnergyConsume: 2,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1, AllowedItems: []string{ItemWater}},
			},
		},
		Functions: BuildingFunctionModules{
			Collect: &CollectModule{YieldPerTick: 8},
			Storage: &StorageModule{Capacity: 60, Slots: 1, Buffer: 20, InputPriority: 1, OutputPriority: 2},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 2},
		},
	},
	{
		ID: BuildingTypeOilExtractor,
		Params: BuildingRuntimeParams{
			Capacity:      8,
			EnergyConsume: 2,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1, AllowedItems: []string{ItemCrudeOil}},
			},
		},
		Functions: BuildingFunctionModules{
			Collect: &CollectModule{YieldPerTick: 8},
			Storage: &StorageModule{Capacity: 60, Slots: 1, Buffer: 20, InputPriority: 1, OutputPriority: 2},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 2},
		},
	},
	{
		ID:        BuildingTypeLogisticsDistributor,
		Params:    BuildingRuntimeParams{EnergyConsume: 1, ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Capacity: 1}}},
		Functions: BuildingFunctionModules{Energy: &modelpower.EnergyModule{ConsumePerTick: 1}},
	},
	{
		ID: BuildingTypePlanetaryLogisticsStation,
		Params: BuildingRuntimeParams{
			EnergyConsume:    1,
			Capacity:         600,
			ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Capacity: 1}},
		},
		Functions: BuildingFunctionModules{Energy: &modelpower.EnergyModule{ConsumePerTick: 1}},
	},
	{
		ID: BuildingTypeInterstellarLogisticsStation,
		Params: BuildingRuntimeParams{
			EnergyConsume:    2,
			Capacity:         2500,
			ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Capacity: 1}},
		},
		Functions: BuildingFunctionModules{Energy: &modelpower.EnergyModule{ConsumePerTick: 2}},
	},
	{
		ID: BuildingTypeOrbitalCollector,
		Params: BuildingRuntimeParams{
			EnergyConsume: 4,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Orbital: &OrbitalModule{
				Outputs: []ItemAmount{
					{ItemID: ItemHydrogen, Quantity: 4},
					{ItemID: ItemDeuterium, Quantity: 1},
				},
				MaxInventory: 1000,
			},
			Energy: &modelpower.EnergyModule{ConsumePerTick: 4},
		},
	},
	{
		ID: BuildingTypeConveyorBeltMk1,
		Functions: BuildingFunctionModules{
			Transport: &TransportModule{Throughput: 2, StackLimit: 2},
		},
	},
	{
		ID: BuildingTypeTrafficMonitor,
		Params: BuildingRuntimeParams{
			EnergyConsume:    1,
			ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Capacity: 1}},
		},
		Functions: BuildingFunctionModules{Energy: &modelpower.EnergyModule{ConsumePerTick: 1}},
	},
	{
		ID: BuildingTypeSplitter,
		Functions: BuildingFunctionModules{
			Transport: &TransportModule{Throughput: 6, StackLimit: 24},
		},
	},
	{
		ID: BuildingTypeAutomaticPiler,
		Functions: BuildingFunctionModules{
			Transport: &TransportModule{Throughput: 2, StackLimit: 4},
		},
	},
	{
		ID: BuildingTypeConveyorBeltMk2,
		Functions: BuildingFunctionModules{
			Transport: &TransportModule{Throughput: 4, StackLimit: 2},
		},
	},
	{
		ID: BuildingTypeConveyorBeltMk3,
		Functions: BuildingFunctionModules{
			Transport: &TransportModule{Throughput: 6, StackLimit: 3},
		},
	},
	{
		ID: BuildingTypeSorterMk1,
		Functions: BuildingFunctionModules{
			Sorter: &SorterModule{Speed: 1, Range: 1},
		},
	},
	{
		ID: BuildingTypeSorterMk2,
		Functions: BuildingFunctionModules{
			Sorter: &SorterModule{Speed: 2, Range: 2},
		},
	},
	{
		ID: BuildingTypeSorterMk3,
		Functions: BuildingFunctionModules{
			Sorter: &SorterModule{Speed: 3, Range: 3},
		},
	},
	{
		ID: BuildingTypePileSorter,
		Functions: BuildingFunctionModules{
			Sorter: &SorterModule{Speed: 4, Range: 3},
		},
	},
	{
		ID: BuildingTypeDepotMk1,
		Params: BuildingRuntimeParams{
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 300, Slots: 3, Buffer: 40, InputPriority: 2, OutputPriority: 1},
		},
	},
	{
		ID: BuildingTypeDepotMk2,
		Params: BuildingRuntimeParams{
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 900, Slots: 6, Buffer: 80, InputPriority: 2, OutputPriority: 2},
		},
	},
	{
		ID: BuildingTypeStorageTank,
		Params: BuildingRuntimeParams{
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 600, Slots: 2, Buffer: 60, InputPriority: 1, OutputPriority: 2},
		},
	},
	{
		ID: BuildingTypeArcSmelter,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 4,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 24, Slots: 3, Buffer: 8, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 4},
		},
	},
	{
		ID: BuildingTypePlaneSmelter,
		Params: BuildingRuntimeParams{
			Capacity:      2,
			EnergyConsume: 6,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 36, Slots: 4, Buffer: 12, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 2, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypeNegentropySmelter,
		Params: BuildingRuntimeParams{
			Capacity:      3,
			EnergyConsume: 9,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 48, Slots: 4, Buffer: 12, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 3, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 9},
		},
	},
	{
		ID: BuildingTypeOilRefinery,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Capacity: 3},
				{ID: "out-main", Direction: PortOutput, Capacity: 3},
				{ID: "out-side", Direction: PortOutput, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 48, Slots: 4, Buffer: 12, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypeChemicalPlant,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 6,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 24, Slots: 4, Buffer: 8, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypeQuantumChemicalPlant,
		Params: BuildingRuntimeParams{
			Capacity:      2,
			EnergyConsume: 8,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 36, Slots: 5, Buffer: 12, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 2, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 8},
		},
	},
	{
		ID: BuildingTypeMiniatureParticleCollider,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 24,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Capacity: 6},
				{ID: "out-main", Direction: PortOutput, Capacity: 6},
				{ID: "out-side", Direction: PortOutput, Capacity: 6},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 96, Slots: 6, Buffer: 24, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 24},
		},
	},
	{
		ID: BuildingTypeMatrixLab,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 4,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 36, Slots: 4, Buffer: 12, InputPriority: 2, OutputPriority: 2},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Research:   &ResearchModule{ResearchPerTick: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 4},
		},
	},
	{
		ID: BuildingTypeSelfEvolutionLab,
		Params: BuildingRuntimeParams{
			Capacity:      3,
			EnergyConsume: 16,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 72, Slots: 6, Buffer: 24, InputPriority: 2, OutputPriority: 2},
			Production: &ProductionModule{Throughput: 3, RecipeSlots: 1},
			Research:   &ResearchModule{ResearchPerTick: 3},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 16},
		},
	},
	{
		ID: BuildingTypeTeslaTower,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			PowerGrid: &PowerGridModule{WirelessRange: DefaultTeslaTowerRange},
		},
	},
	{
		ID: BuildingTypeWirelessPowerTower,
		Params: BuildingRuntimeParams{
			EnergyConsume: 1,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			PowerGrid: &PowerGridModule{WirelessRange: DefaultWirelessPowerTowerRange},
			Energy:    &modelpower.EnergyModule{ConsumePerTick: 1},
		},
	},
	{
		ID: BuildingTypeSatelliteSubstation,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			PowerGrid: &PowerGridModule{WirelessRange: DefaultSatelliteSubstationRange},
		},
	},
	{
		ID: BuildingTypeEnergyExchanger,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "acc-in", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemAccumulator, ItemAccumulatorFull}},
				{ID: "acc-out", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemAccumulator, ItemAccumulatorFull}},
			},
		},
		Functions: BuildingFunctionModules{
			EnergyExchanger: &EnergyExchangerModule{
				Hub:           true,
				Mode:          EnergyExchangerModeStandby,
				EnergyPerItem: AccumulatorItemEnergy,
				ItemsPerTick:  1,
				EmptyItemID:   ItemAccumulator,
				FullItemID:    ItemAccumulatorFull,
			},
			EnergyStorage: &EnergyStorageModule{
				Capacity:            400,
				ChargePerTick:       80,
				DischargePerTick:    80,
				ChargeEfficiency:    0.95,
				DischargeEfficiency: 0.95,
				Priority:            2,
				InitialCharge:       0,
			},
			Storage: &StorageModule{Capacity: 200, Slots: 2, Buffer: 20, InputPriority: 2, OutputPriority: 1},
		},
	},
	{
		ID: BuildingTypeAccumulator,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			EnergyStorage: &EnergyStorageModule{
				Capacity:            100,
				ChargePerTick:       20,
				DischargePerTick:    20,
				ChargeEfficiency:    0.9,
				DischargeEfficiency: 0.9,
				Priority:            1,
				InitialCharge:       0,
			},
		},
	},
	{
		ID: BuildingTypeAccumulatorFull,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			EnergyStorage: &EnergyStorageModule{
				Capacity:            100,
				ChargePerTick:       20,
				DischargePerTick:    20,
				ChargeEfficiency:    0.9,
				DischargeEfficiency: 0.9,
				Priority:            1,
				InitialCharge:       100,
			},
		},
	},
	{
		ID: BuildingTypeRayReceiver,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemCriticalPhoton}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 100, Slots: 2, Buffer: 20, InputPriority: 1, OutputPriority: 1},
			RayReceiver: &RayReceiverModule{
				InputPerTick:        100,
				ReceiveEfficiency:   0.8,
				PowerOutputPerTick:  60,
				PowerEfficiency:     0.9,
				PhotonOutputPerTick: 2,
				PhotonEnergyCost:    10,
				PhotonEfficiency:    0.8,
				PhotonItemID:        ItemCriticalPhoton,
				Mode:                RayReceiverModeHybrid,
			},
		},
	},
	{
		ID: BuildingTypeWindTurbine,
		Params: BuildingRuntimeParams{
			EnergyGenerate: 10,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Energy: &modelpower.EnergyModule{OutputPerTick: 10, SourceKind: modelpower.PowerSourceWind},
		},
	},
	{
		ID: BuildingTypeGeothermalPowerStation,
		Params: BuildingRuntimeParams{
			EnergyGenerate: 30,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Energy: &modelpower.EnergyModule{OutputPerTick: 30, SourceKind: modelpower.PowerSourceGeothermal},
		},
	},
	{
		ID: BuildingTypeThermalPowerPlant,
		Params: BuildingRuntimeParams{
			EnergyGenerate: 20,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "fuel-in", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemCoal, ItemEnergeticGraphite, ItemHydrogen, ItemHydrogenFuelRod, ItemLog, ItemPlantFuel}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 50, Slots: 6, Buffer: 10, InputPriority: 2, OutputPriority: 0},
			Energy: &modelpower.EnergyModule{
				OutputPerTick: 20,
				SourceKind:    modelpower.PowerSourceThermal,
				// Output multipliers are折算自物品 MechaFuelEnergy 热值，以煤
				// (25) 为基准 1.0：石墨 50→2.0、氢 30→1.2、氢燃料棒 100→4.0、
				// 木材 15→0.6、植物燃料 5→0.2。结算按顺序选用第一种可达燃料。
				FuelRules: []modelpower.FuelRule{
					{ItemID: ItemCoal, ConsumePerTick: 1, OutputMultiplier: 1},
					{ItemID: ItemEnergeticGraphite, ConsumePerTick: 1, OutputMultiplier: 2},
					{ItemID: ItemHydrogen, ConsumePerTick: 1, OutputMultiplier: 1.2},
					{ItemID: ItemHydrogenFuelRod, ConsumePerTick: 1, OutputMultiplier: 4},
					{ItemID: ItemLog, ConsumePerTick: 1, OutputMultiplier: 0.6},
					{ItemID: ItemPlantFuel, ConsumePerTick: 1, OutputMultiplier: 0.2},
				},
			},
		},
	},
	{
		ID: BuildingTypeSolarPanel,
		Params: BuildingRuntimeParams{
			EnergyGenerate: 12,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Energy: &modelpower.EnergyModule{OutputPerTick: 12, SourceKind: modelpower.PowerSourceSolar},
		},
	},
	{
		ID: BuildingTypeMiniFusionPowerPlant,
		Params: BuildingRuntimeParams{
			EnergyGenerate: 40,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "fuel-in", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemHydrogenFuelRod, ItemDeuteriumFuelRod}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 40, Slots: 2, Buffer: 10, InputPriority: 2, OutputPriority: 0},
			Energy: &modelpower.EnergyModule{
				OutputPerTick: 40,
				SourceKind:    modelpower.PowerSourceFusion,
				// 氘棒热值 (MechaFuelEnergy 250) 为氢棒 (100) 的 2.5 倍。
				FuelRules: []modelpower.FuelRule{
					{ItemID: ItemHydrogenFuelRod, ConsumePerTick: 1, OutputMultiplier: 1},
					{ItemID: ItemDeuteriumFuelRod, ConsumePerTick: 1, OutputMultiplier: 2.5},
				},
			},
		},
	},
	{
		ID: BuildingTypeArtificialStar,
		Params: BuildingRuntimeParams{
			EnergyGenerate: 80,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "fuel-in", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemAntimatterFuelRod}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 30, Slots: 1, Buffer: 10, InputPriority: 2, OutputPriority: 0},
			Energy: &modelpower.EnergyModule{
				OutputPerTick: 80,
				SourceKind:    modelpower.PowerSourceArtificialStar,
				FuelRules: []modelpower.FuelRule{
					{ItemID: ItemAntimatterFuelRod, ConsumePerTick: 1, OutputMultiplier: 1},
				},
			},
		},
	},
	{
		ID: BuildingTypeFractionator,
		Params: BuildingRuntimeParams{
			EnergyConsume:    6,
			Capacity:         FractionationBufferCapacity,
			ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Capacity: 1}},
			IOPorts: []IOPort{
				{ID: "hydrogen-in", Direction: PortInput, Capacity: FractionationThroughput, AllowedItems: []string{ItemHydrogen}},
				{ID: "hydrogen-return", Direction: PortOutput, Capacity: FractionationThroughput, AllowedItems: []string{ItemHydrogen}},
				{ID: "deuterium-out", Direction: PortOutput, Capacity: FractionationThroughput, AllowedItems: []string{ItemDeuterium}},
			},
		},
		Functions: BuildingFunctionModules{Energy: &modelpower.EnergyModule{ConsumePerTick: 6}},
	},
	{
		ID: BuildingTypeSprayCoater,
		Params: BuildingRuntimeParams{
			Capacity:         24,
			ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Capacity: 1}},
			EnergyConsume:    2,
			IOPorts: []IOPort{
				{ID: "material-in", Direction: PortInput, Capacity: 6},
				{ID: "material-out", Direction: PortOutput, Capacity: 6},
				{ID: "proliferator-in", Direction: PortInput, Capacity: 6, AllowedItems: []string{ItemProliferatorMk1, ItemProliferatorMk2, ItemProliferatorMk3}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 48, Slots: 3},
			Spray:   &SprayModule{Throughput: 6, MaxLevel: 3},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 2},
		},
	},
	{
		ID: BuildingTypeAssemblingMachineMk1,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 5,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 24, Slots: 4, Buffer: 8, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 5},
		},
	},
	{
		ID: BuildingTypeAssemblingMachineMk2,
		Params: BuildingRuntimeParams{
			Capacity:      2,
			EnergyConsume: 8,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 48, Slots: 6, Buffer: 16, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 2, RecipeSlots: 2},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 8},
		},
	},
	{
		ID: BuildingTypeAssemblingMachineMk3,
		Params: BuildingRuntimeParams{
			Capacity:      3,
			EnergyConsume: 12,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 72, Slots: 8, Buffer: 24, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 3, RecipeSlots: 3},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 12},
		},
	},
	{
		ID: BuildingTypeRecomposingAssembler,
		Params: BuildingRuntimeParams{
			Capacity:      2,
			EnergyConsume: 12,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 48, Slots: 6, Buffer: 16, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 2, RecipeSlots: 2},
			Energy:     &modelpower.EnergyModule{ConsumePerTick: 12},
		},
	},
	{
		ID: BuildingTypeGaussTurret,
		Params: BuildingRuntimeParams{
			EnergyConsume: 3,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "ammo", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 4, AllowedItems: []string{ItemAmmoBullet, ItemTitaniumAmmo}},
			},
		},
		Functions: BuildingFunctionModules{
			Combat: &CombatModule{
				Attack:        15,
				Range:         5,
				FireRate:      10,
				AmmoItem:      ItemAmmoBullet,
				AmmoConsume:   1,
				AltAmmoItem:   ItemTitaniumAmmo,
				AltAmmoAttack: 25,
			},
			Energy:  &modelpower.EnergyModule{ConsumePerTick: 3},
			Storage: &StorageModule{Capacity: 40, Slots: 1, Buffer: 20, InputPriority: 2, OutputPriority: 1},
		},
	},
	{
		ID:        BuildingTypeMissileTurret,
		Params:    BuildingRuntimeParams{EnergyConsume: 8, ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Offset: GridOffset{}, Capacity: 1}}, IOPorts: []IOPort{{ID: "ammo", Direction: PortInput, Offset: GridOffset{}, Capacity: 4, AllowedItems: []string{ItemAmmoMissile}}}},
		Functions: BuildingFunctionModules{Combat: &CombatModule{Attack: 40, Range: 10, FireRate: 30, AmmoItem: ItemAmmoMissile, AmmoConsume: 1}, Energy: &modelpower.EnergyModule{ConsumePerTick: 8}, Storage: &StorageModule{Capacity: 40, Slots: 1, Buffer: 20, InputPriority: 2, OutputPriority: 1}},
	},
	{
		ID:        BuildingTypeImplosionCannon,
		Params:    BuildingRuntimeParams{EnergyConsume: 15, ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Offset: GridOffset{}, Capacity: 1}}, IOPorts: []IOPort{{ID: "ammo", Direction: PortInput, Offset: GridOffset{}, Capacity: 4, AllowedItems: []string{ItemGravityMissile}}}},
		Functions: BuildingFunctionModules{Combat: &CombatModule{Attack: 75, Range: 12, FireRate: 45, AmmoItem: ItemGravityMissile, AmmoConsume: 1}, Energy: &modelpower.EnergyModule{ConsumePerTick: 15}, Storage: &StorageModule{Capacity: 40, Slots: 1, Buffer: 20, InputPriority: 2, OutputPriority: 1}},
	},
	{
		ID:        BuildingTypeLaserTurret,
		Params:    BuildingRuntimeParams{EnergyConsume: 18, ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Offset: GridOffset{}, Capacity: 1}}},
		Functions: BuildingFunctionModules{Combat: &CombatModule{Attack: 30, Range: 8, FireRate: 8}, Energy: &modelpower.EnergyModule{ConsumePerTick: 18}},
	},
	{
		ID:        BuildingTypePlasmaTurret,
		Params:    BuildingRuntimeParams{EnergyConsume: 25, ConnectionPoints: []ConnectionPoint{{ID: "power", Kind: ConnectionPower, Offset: GridOffset{}, Capacity: 1}}, IOPorts: []IOPort{{ID: "ammo", Direction: PortInput, Offset: GridOffset{}, Capacity: 4, AllowedItems: []string{ItemPlasmaCapsule}}}},
		Functions: BuildingFunctionModules{Combat: &CombatModule{Attack: 55, Range: 11, FireRate: 20, AmmoItem: ItemPlasmaCapsule, AmmoConsume: 1}, Energy: &modelpower.EnergyModule{ConsumePerTick: 25}, Storage: &StorageModule{Capacity: 40, Slots: 1, Buffer: 20, InputPriority: 2, OutputPriority: 1}},
	},
	{
		ID: BuildingTypeSRPlasmaTurret,
		Params: BuildingRuntimeParams{
			EnergyConsume: 20,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Combat: &CombatModule{Attack: 60, Range: 12},
			Energy: &modelpower.EnergyModule{ConsumePerTick: 20},
		},
	},
	{
		ID: BuildingTypeJammerTower,
		Params: BuildingRuntimeParams{
			EnergyConsume: 6,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Combat: &CombatModule{Attack: 0, Range: 8},
			Energy: &modelpower.EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypePlanetaryShieldGenerator,
		Params: BuildingRuntimeParams{
			EnergyConsume: 50,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Shield: &ShieldModule{Capacity: 1000, ChargePerTick: 5, CurrentCharge: 0},
			Energy: &modelpower.EnergyModule{ConsumePerTick: 50},
		},
	},
	{
		ID: BuildingTypeEMRailEjector,
		Params: BuildingRuntimeParams{
			EnergyConsume: 30,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemSolarSail}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 20, Slots: 1, Buffer: 6, InputPriority: 2, OutputPriority: 0},
			Launch: &LaunchModule{
				EnergyPerLaunch: 300,
				SuccessRate:     0.95,
				OrbitRadiusMin:  0.5,
				OrbitRadiusMax:  5.0,
				InclinationMax:  90.0,
				LaunchInterval:  60,
				LaunchQueueSize: 10,
			},
			Energy: &modelpower.EnergyModule{ConsumePerTick: 30},
		},
	},
	{
		ID: BuildingTypeVerticalLaunchingSilo,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 50,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1, AllowedItems: []string{ItemSmallCarrierRocket}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage:    &StorageModule{Capacity: 20, Slots: 1, Buffer: 6, InputPriority: 2, OutputPriority: 1},
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Launch: &LaunchModule{
				EnergyPerLaunch: 500,
				SuccessRate:     0.9,
				OrbitRadiusMin:  0.5,
				OrbitRadiusMax:  5.0,
				InclinationMax:  90.0,
				LaunchInterval:  120,
				LaunchQueueSize: 20,
				RocketItemID:    ItemSmallCarrierRocket,
				ProductionSpeed: 1,
			},
			Energy: &modelpower.EnergyModule{ConsumePerTick: 50},
		},
	},
}
