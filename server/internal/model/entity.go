package model

// Position represents a 2D grid position (Z reserved for future 3D)
type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
	Z int `json:"z"`
}

// BuildingType enumerates building categories
type BuildingType string

const (
	BuildingTypeBase       BuildingType = "base"
	BuildingTypeMine       BuildingType = "mine"
	BuildingTypeSolarPlant BuildingType = "solar_plant"
	BuildingTypeFactory    BuildingType = "factory"
	BuildingTypeTurret     BuildingType = "turret"
)

// UnitType enumerates unit categories
type UnitType string

const (
	UnitTypeWorker  UnitType = "worker"
	UnitTypeSoldier UnitType = "soldier"
)

// Building represents a constructed building entity
type Building struct {
	ID           string       `json:"id"`
	Type         BuildingType `json:"type"`
	OwnerID      string       `json:"owner_id"`
	Position     Position     `json:"position"`
	HP           int          `json:"hp"`
	MaxHP        int          `json:"max_hp"`
	Level        int          `json:"level"`
	VisionRange  int          `json:"vision_range"`
	MineralRate  int          `json:"mineral_rate"`  // minerals produced per tick
	EnergyRate   int          `json:"energy_rate"`   // energy produced per tick
	EnergyConsume int         `json:"energy_consume"` // energy consumed per tick
	Attack       int          `json:"attack"`        // turret attack damage
	AttackRange  int          `json:"attack_range"`  // turret attack range
	IsActive     bool         `json:"is_active"`
}

// Unit represents a mobile unit entity
type Unit struct {
	ID          string   `json:"id"`
	Type        UnitType `json:"type"`
	OwnerID     string   `json:"owner_id"`
	Position    Position `json:"position"`
	HP          int      `json:"hp"`
	MaxHP       int      `json:"max_hp"`
	Attack      int      `json:"attack"`
	Defense     int      `json:"defense"`
	AttackRange int      `json:"attack_range"`
	MoveRange   int      `json:"move_range"`
	VisionRange int      `json:"vision_range"`
	IsMoving    bool     `json:"is_moving"`
	TargetPos   *Position `json:"target_pos,omitempty"`
	AttackTarget string  `json:"attack_target,omitempty"` // entity ID
}

// BuildingStats returns default stats for a building type at a given level
func BuildingStats(btype BuildingType, level int) Building {
	b := Building{Level: level, IsActive: true}
	switch btype {
	case BuildingTypeBase:
		b.MaxHP = 500 + 200*level
		b.HP = b.MaxHP
		b.VisionRange = 5
		b.MineralRate = 2
		b.EnergyRate = 5
	case BuildingTypeMine:
		b.MaxHP = 150 + 50*level
		b.HP = b.MaxHP
		b.VisionRange = 2
		b.MineralRate = 5 + 3*level
		b.EnergyConsume = 2
	case BuildingTypeSolarPlant:
		b.MaxHP = 100 + 30*level
		b.HP = b.MaxHP
		b.VisionRange = 2
		b.EnergyRate = 8 + 4*level
	case BuildingTypeFactory:
		b.MaxHP = 200 + 80*level
		b.HP = b.MaxHP
		b.VisionRange = 3
		b.EnergyConsume = 5
	case BuildingTypeTurret:
		b.MaxHP = 120 + 40*level
		b.HP = b.MaxHP
		b.VisionRange = 6
		b.Attack = 10 + 5*level
		b.AttackRange = 4 + level
		b.EnergyConsume = 3
	}
	return b
}

// BuildingCost returns the resource cost to build a building type
func BuildingCost(btype BuildingType) (minerals, energy int) {
	switch btype {
	case BuildingTypeMine:
		return 50, 20
	case BuildingTypeSolarPlant:
		return 40, 0
	case BuildingTypeFactory:
		return 100, 50
	case BuildingTypeTurret:
		return 80, 30
	}
	return 0, 0
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
