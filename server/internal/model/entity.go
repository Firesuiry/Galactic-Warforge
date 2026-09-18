package model

// Position represents a 2D grid position (Z reserved for future 3D)
type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
	Z int `json:"z"`
}

// UnitType enumerates unit categories
type UnitType string

const (
	UnitTypeWorker   UnitType = "worker"
	UnitTypeSoldier  UnitType = "soldier"
	UnitTypeMecha    UnitType = "mecha"
	UnitTypeExecutor UnitType = "executor"
)

// Building represents a constructed building entity
type Building struct {
	ID                string                  `json:"id"`
	Type              BuildingType            `json:"type"`
	OwnerID           string                  `json:"owner_id"`
	Position          Position                `json:"position"`
	HP                int                     `json:"hp"`
	MaxHP             int                     `json:"max_hp"`
	Level             int                     `json:"level"`
	VisionRange       int                     `json:"vision_range"`
	Runtime           BuildingRuntime         `json:"runtime"`
	Storage           *StorageState           `json:"storage,omitempty"`
	EnergyStorage     *EnergyStorageState     `json:"energy_storage,omitempty"`
	Conveyor          *ConveyorState          `json:"conveyor,omitempty"`
	Splitter          *SplitterState          `json:"splitter,omitempty"`
	TrafficMonitor    *TrafficMonitorState    `json:"traffic_monitor,omitempty"`
	Fractionation     *FractionationState     `json:"fractionation,omitempty"`
	SprayCoater       *SprayCoaterState       `json:"spray_coater,omitempty"`
	Sorter            *SorterState            `json:"sorter,omitempty"`
	Distributor       *DistributorState       `json:"distributor,omitempty"`
	LogisticsStation  *LogisticsStationState  `json:"logistics_station,omitempty"`
	Production        *ProductionState        `json:"production,omitempty"`
	Job               *BuildingJob            `json:"job,omitempty"`
	ProductionMonitor *ProductionMonitorState `json:"production_monitor,omitempty"`
	// FoundationTerrain stores the terrain replaced by a foundation, in footprint order.
	// It allows demolition and snapshot restore to return the tile to its prior state.
	FoundationTerrain []string `json:"foundation_terrain,omitempty"`
}

// Clone returns a deep copy of the building state for read-only snapshots.
func (b *Building) Clone() *Building {
	if b == nil {
		return nil
	}
	out := *b
	out.Runtime = BuildingRuntime{
		Params:      b.Runtime.Params.clone(),
		Functions:   b.Runtime.Functions.clone(),
		State:       b.Runtime.State,
		StateReason: b.Runtime.StateReason,
	}
	out.Storage = b.Storage.Clone()
	out.EnergyStorage = b.EnergyStorage.Clone()
	out.Conveyor = b.Conveyor.Clone()
	out.Sorter = b.Sorter.Clone()
	out.Splitter = b.Splitter.Clone()
	out.TrafficMonitor = b.TrafficMonitor.Clone()
	out.Fractionation = b.Fractionation.Clone()
	out.SprayCoater = b.SprayCoater.Clone()
	out.Distributor = b.Distributor.Clone()
	out.LogisticsStation = b.LogisticsStation.Clone()
	out.Production = b.Production.Clone()
	out.Job = b.Job.Clone()
	out.ProductionMonitor = b.ProductionMonitor.Clone()
	if b.FoundationTerrain != nil {
		out.FoundationTerrain = append([]string(nil), b.FoundationTerrain...)
	}
	return &out
}

// Unit represents a mobile unit entity
type Unit struct {
	ID           string      `json:"id"`
	Type         UnitType    `json:"type"`
	OwnerID      string      `json:"owner_id"`
	Position     Position    `json:"position"`
	HP           int         `json:"hp"`
	MaxHP        int         `json:"max_hp"`
	Attack       int         `json:"attack"`
	Defense      int         `json:"defense"`
	AttackRange  int         `json:"attack_range"`
	MoveRange    int         `json:"move_range"`
	VisionRange  int         `json:"vision_range"`
	IsMoving     bool        `json:"is_moving"`
	TargetPos    *Position   `json:"target_pos,omitempty"`
	AttackTarget string      `json:"attack_target,omitempty"` // entity ID
	Mecha        *MechaState `json:"mecha,omitempty"`
}

// Clone returns a deep copy of the unit state for read-only snapshots.
func (u *Unit) Clone() *Unit {
	if u == nil {
		return nil
	}
	out := *u
	out.Mecha = u.Mecha.Clone()
	if u.TargetPos != nil {
		target := *u.TargetPos
		out.TargetPos = &target
	}
	return &out
}

// BuildingCost returns the resource cost to build a building type.
func BuildingCost(btype BuildingType) (minerals, energy int) {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return 0, 0
	}
	return def.BuildCost.Minerals, def.BuildCost.Energy
}

// UnitStats returns default stats for a unit type
func UnitStats(utype UnitType) Unit {
	u := Unit{}
	switch utype {
	case UnitTypeWorker:
		u.MaxHP = 60
		u.HP = u.MaxHP
		u.Attack = 3
		u.Defense = 1
		u.AttackRange = 1
		u.MoveRange = 3
		u.VisionRange = 4
	case UnitTypeSoldier:
		u.MaxHP = 100
		u.HP = u.MaxHP
		u.Attack = 15
		u.Defense = 5
		u.AttackRange = 2
		u.MoveRange = 2
		u.VisionRange = 5
	case UnitTypeMecha:
		u.MaxHP = 240
		u.HP = u.MaxHP
		u.Attack = 28
		u.Defense = 12
		u.AttackRange = 4
		u.MoveRange = 3
		u.VisionRange = 7
	case UnitTypeExecutor:
		u.MaxHP = 120
		u.HP = u.MaxHP
		u.Attack = 20
		u.Defense = 8
		u.AttackRange = 4
		u.MoveRange = 12
		u.VisionRange = 6
		u.Mecha = NewMechaState()
	}
	return u
}

// UnitCost returns the resource cost to produce a unit type
func UnitCost(utype UnitType) (minerals, energy int) {
	switch utype {
	case UnitTypeWorker:
		return 30, 10
	case UnitTypeSoldier:
		return 60, 20
	case UnitTypeMecha:
		return 180, 80
	}
	return 0, 0
}
