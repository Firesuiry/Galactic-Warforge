package model

import (
	"fmt"
	"sort"
	"sync"
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
	Params    BuildingRuntimeParams   `json:"params"`
	Functions BuildingFunctionModules `json:"functions,omitempty"`
	State     BuildingWorkState       `json:"state"`
}

// BuildingFunctionModules describes modular building capabilities.
type BuildingFunctionModules struct {
	Production    *ProductionModule    `json:"production,omitempty" yaml:"production,omitempty"`
	Collect       *CollectModule       `json:"collect,omitempty" yaml:"collect,omitempty"`
	Orbital       *OrbitalModule       `json:"orbital,omitempty" yaml:"orbital,omitempty"`
	Transport     *TransportModule     `json:"transport,omitempty" yaml:"transport,omitempty"`
	Sorter        *SorterModule        `json:"sorter,omitempty" yaml:"sorter,omitempty"`
	Spray         *SprayModule         `json:"spray,omitempty" yaml:"spray,omitempty"`
	Storage       *StorageModule       `json:"storage,omitempty" yaml:"storage,omitempty"`
	RayReceiver   *RayReceiverModule   `json:"ray_receiver,omitempty" yaml:"ray_receiver,omitempty"`
	EnergyStorage *EnergyStorageModule `json:"energy_storage,omitempty" yaml:"energy_storage,omitempty"`
	Energy        *EnergyModule        `json:"energy,omitempty" yaml:"energy,omitempty"`
	Research      *ResearchModule      `json:"research,omitempty" yaml:"research,omitempty"`
	Combat        *CombatModule        `json:"combat,omitempty" yaml:"combat,omitempty"`
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

// EnergyModule handles energy conversion/output.
type EnergyModule struct {
	OutputPerTick  int             `json:"output_per_tick" yaml:"output_per_tick"`
	ConsumePerTick int             `json:"consume_per_tick" yaml:"consume_per_tick"`
	Buffer         int             `json:"buffer" yaml:"buffer"`
	SourceKind     PowerSourceKind `json:"source_kind,omitempty" yaml:"source_kind,omitempty"`
	FuelRules      []FuelRule      `json:"fuel_rules,omitempty" yaml:"fuel_rules,omitempty"`
}

// ResearchModule handles research throughput.
type ResearchModule struct {
	ResearchPerTick int `json:"research_per_tick" yaml:"research_per_tick"`
}

// CombatModule handles defensive or offensive stats.
type CombatModule struct {
	Attack int `json:"attack" yaml:"attack"`
	Range  int `json:"range" yaml:"range"`
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
		if def.Functions.Energy.SourceKind != "" && !IsPowerSourceKind(def.Functions.Energy.SourceKind) {
			return fmt.Errorf("building runtime %s invalid power source %s", def.ID, def.Functions.Energy.SourceKind)
		}
		if def.Functions.Energy.SourceKind != "" && IsFuelBasedPowerSource(def.Functions.Energy.SourceKind) && len(def.Functions.Energy.FuelRules) == 0 {
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
	if m.EnergyStorage != nil {
		val := *m.EnergyStorage
		out.EnergyStorage = &val
	}
	if m.Energy != nil {
		val := *m.Energy
		if len(m.Energy.FuelRules) > 0 {
			val.FuelRules = append([]FuelRule(nil), m.Energy.FuelRules...)
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
	return out
}

var defaultBuildingRuntimeDefinitions = []BuildingRuntimeDefinition{
	{
		ID: BuildingTypeBattlefieldAnalysisBase,
		Params: BuildingRuntimeParams{
			Capacity:       2,
			EnergyGenerate: 5,
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Collect: &CollectModule{ResourceKind: "minerals", YieldPerTick: 2},
			Energy:  &EnergyModule{OutputPerTick: 5},
		},
	},
	{
		ID: BuildingTypeMiningMachine,
		Params: BuildingRuntimeParams{
			Capacity:      8,
			EnergyConsume: 2,
			IOPorts: []IOPort{
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Collect: &CollectModule{ResourceKind: "minerals", YieldPerTick: 8},
			Energy:  &EnergyModule{ConsumePerTick: 2},
		},
	},
	{
		ID: BuildingTypeOrbitalCollector,
		Params: BuildingRuntimeParams{
			EnergyConsume: 4,
		},
		Functions: BuildingFunctionModules{
			Orbital: &OrbitalModule{
				Outputs: []ItemAmount{
					{ItemID: ItemHydrogen, Quantity: 4},
					{ItemID: ItemDeuterium, Quantity: 1},
				},
				MaxInventory: 1000,
			},
			Energy: &EnergyModule{ConsumePerTick: 4},
		},
	},
	{
		ID: BuildingTypeConveyorBeltMk1,
		Functions: BuildingFunctionModules{
			Transport: &TransportModule{Throughput: 2, StackLimit: 1},
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
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &EnergyModule{ConsumePerTick: 4},
		},
	},
	{
		ID: BuildingTypePlaneSmelter,
		Params: BuildingRuntimeParams{
			Capacity:      2,
			EnergyConsume: 6,
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Production: &ProductionModule{Throughput: 2, RecipeSlots: 1},
			Energy:     &EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypeNegentropySmelter,
		Params: BuildingRuntimeParams{
			Capacity:      3,
			EnergyConsume: 9,
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 3},
			},
		},
		Functions: BuildingFunctionModules{
			Production: &ProductionModule{Throughput: 3, RecipeSlots: 1},
			Energy:     &EnergyModule{ConsumePerTick: 9},
		},
	},
	{
		ID: BuildingTypeChemicalPlant,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 6,
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &EnergyModule{ConsumePerTick: 6},
		},
	},
	{
		ID: BuildingTypeQuantumChemicalPlant,
		Params: BuildingRuntimeParams{
			Capacity:      2,
			EnergyConsume: 8,
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2},
			},
		},
		Functions: BuildingFunctionModules{
			Production: &ProductionModule{Throughput: 2, RecipeSlots: 1},
			Energy:     &EnergyModule{ConsumePerTick: 8},
		},
	},
	{
		ID: BuildingTypeTeslaTower,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
	},
	{
		ID: BuildingTypeWirelessPowerTower,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
	},
	{
		ID: BuildingTypeSatelliteSubstation,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
	},
	{
		ID: BuildingTypeEnergyExchanger,
		Params: BuildingRuntimeParams{
			ConnectionPoints: []ConnectionPoint{
				{ID: "power", Kind: ConnectionPower, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
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
			Energy: &EnergyModule{OutputPerTick: 10, SourceKind: PowerSourceWind},
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
				{ID: "fuel-in", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemCoal}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 50, Slots: 1, Buffer: 10, InputPriority: 2, OutputPriority: 0},
			Energy: &EnergyModule{
				OutputPerTick: 20,
				SourceKind:    PowerSourceThermal,
				FuelRules: []FuelRule{
					{ItemID: ItemCoal, ConsumePerTick: 1, OutputMultiplier: 1},
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
			Energy: &EnergyModule{OutputPerTick: 12, SourceKind: PowerSourceSolar},
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
				{ID: "fuel-in", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 2, AllowedItems: []string{ItemHydrogenFuelRod}},
			},
		},
		Functions: BuildingFunctionModules{
			Storage: &StorageModule{Capacity: 40, Slots: 1, Buffer: 10, InputPriority: 2, OutputPriority: 0},
			Energy: &EnergyModule{
				OutputPerTick: 40,
				SourceKind:    PowerSourceFusion,
				FuelRules: []FuelRule{
					{ItemID: ItemHydrogenFuelRod, ConsumePerTick: 1, OutputMultiplier: 1},
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
			Energy: &EnergyModule{
				OutputPerTick: 80,
				SourceKind:    PowerSourceArtificialStar,
				FuelRules: []FuelRule{
					{ItemID: ItemAntimatterFuelRod, ConsumePerTick: 1, OutputMultiplier: 1},
				},
			},
		},
	},
	{
		ID: BuildingTypeSprayCoater,
		Params: BuildingRuntimeParams{
			Capacity:      6,
			EnergyConsume: 2,
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "in-1", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Spray:  &SprayModule{Throughput: 6, MaxLevel: 3},
			Energy: &EnergyModule{ConsumePerTick: 2},
		},
	},
	{
		ID: BuildingTypeAssemblingMachineMk1,
		Params: BuildingRuntimeParams{
			Capacity:      1,
			EnergyConsume: 5,
			IOPorts: []IOPort{
				{ID: "in-0", Direction: PortInput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
				{ID: "out-0", Direction: PortOutput, Offset: GridOffset{X: 0, Y: 0}, Capacity: 1},
			},
		},
		Functions: BuildingFunctionModules{
			Production: &ProductionModule{Throughput: 1, RecipeSlots: 1},
			Energy:     &EnergyModule{ConsumePerTick: 5},
		},
	},
	{
		ID: BuildingTypeGaussTurret,
		Params: BuildingRuntimeParams{
			EnergyConsume: 3,
		},
		Functions: BuildingFunctionModules{
			Combat: &CombatModule{Attack: 15, Range: 5},
			Energy: &EnergyModule{ConsumePerTick: 3},
		},
	},
}
