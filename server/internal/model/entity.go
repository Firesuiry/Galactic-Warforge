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
	Sorter            *SorterState            `json:"sorter,omitempty"`
	LogisticsStation  *LogisticsStationState  `json:"logistics_station,omitempty"`
	Production        *ProductionState        `json:"production,omitempty"`
	Job               *BuildingJob            `json:"job,omitempty"`
	ProductionMonitor *ProductionMonitorState `json:"production_monitor,omitempty"`
}

// Unit represents a mobile unit entity
type Unit struct {
	ID           string    `json:"id"`
	Type         UnitType  `json:"type"`
	OwnerID      string    `json:"owner_id"`
	Position     Position  `json:"position"`
	HP           int       `json:"hp"`
	MaxHP        int       `json:"max_hp"`
	Attack       int       `json:"attack"`
	Defense      int       `json:"defense"`
	AttackRange  int       `json:"attack_range"`
	MoveRange    int       `json:"move_range"`
	VisionRange  int       `json:"vision_range"`
	IsMoving     bool      `json:"is_moving"`
	TargetPos    *Position `json:"target_pos,omitempty"`
	AttackTarget string    `json:"attack_target,omitempty"` // entity ID
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
	case UnitTypeExecutor:
		u.MaxHP = 120
		u.HP = u.MaxHP
		u.Attack = 0
		u.Defense = 2
		u.AttackRange = 0
		u.MoveRange = 4
		u.VisionRange = 6
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
	}
	return 0, 0
}
