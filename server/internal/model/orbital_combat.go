package model

import (
	"math"
)

// OrbitPosition 轨道位置
type OrbitPosition struct {
	PlanetID     string  `json:"planet_id"`     // 所属星球
	Radius       float64 `json:"radius"`        // 轨道半径
	Angle        float64 `json:"angle"`         // 当前角度(弧度)
	AngularSpeed float64 `json:"angular_speed"` // 角速度(弧度/tick)
}

// Position2D 2D平面位置
type Position2D struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// FormationType 编队类型
type FormationType string

const (
	FormationTypeLine   FormationType = "line"   // 线性
	FormationTypeVee    FormationType = "vee"    // V形
	FormationTypeCircle FormationType = "circle" // 环形
	FormationTypeWedge  FormationType = "wedge"  // 楔形
)

// FleetState describes the high-level fleet runtime state.
type FleetState string

const (
	FleetStateIdle      FleetState = "idle"
	FleetStateAttacking FleetState = "attacking"
)

// FleetTarget stores the current orbital-strike target.
type FleetTarget struct {
	PlanetID string `json:"planet_id"`
	TargetID string `json:"target_id,omitempty"`
}

// FleetTransitState tracks an in-flight inter-system jump.
// A fleet with Transit != nil is mid-jump: State stays idle, the fleet keeps
// its origin SystemID bucket until arrival, and progress derives from
// 1 - RemainingTicks/TotalTicks.
type FleetTransitState struct {
	FromSystemID   string `json:"from_system_id"`
	TargetSystemID string `json:"target_system_id"`
	TotalTicks     int64  `json:"total_ticks"`
	RemainingTicks int64  `json:"remaining_ticks"`
}

// FleetUnitStack stores unit counts by payload type.
type FleetUnitStack struct {
	BlueprintID string `json:"blueprint_id"`
	Count       int    `json:"count"`
}

// OrbitalPlatform 轨道防御平台
type OrbitalPlatform struct {
	ID           string        `json:"id"`             // 平台ID
	OwnerID      string        `json:"owner_id"`       // 所属玩家
	PlanetID     string        `json:"planet_id"`      // 所属星球
	Orbit        OrbitPosition `json:"orbit"`          // 轨道位置
	HP           int           `json:"hp"`             // 当前生命值
	MaxHP        int           `json:"max_hp"`         // 最大生命值
	Weapon       WeaponState   `json:"weapon"`         // 武器状态
	AmmoCapacity int           `json:"ammo_capacity"`  // 弹药容量
	AmmoCount    int           `json:"ammo_count"`     // 当前弹药
	LastFireTick int64         `json:"last_fire_tick"` // 上次开火tick
	IsActive     bool          `json:"is_active"`      // 是否激活
}

// DefaultOrbitalPlatformStats 返回默认轨道平台属性
func DefaultOrbitalPlatformStats(platformType string) OrbitalPlatform {
	platform := OrbitalPlatform{
		Weapon: WeaponState{
			Type:     WeaponTypeLaser,
			Damage:   100,
			FireRate: 30,
			Range:    50.0,
			AmmoCost: 3,
		},
		AmmoCapacity: 200,
		AmmoCount:    200,
		IsActive:     true,
	}

	switch platformType {
	case "basic":
		platform.MaxHP = 300
		platform.HP = platform.MaxHP
		platform.Orbit.Radius = 10.0
		platform.Orbit.AngularSpeed = 0.001
	case "heavy":
		platform.MaxHP = 600
		platform.HP = platform.MaxHP
		platform.Weapon.Damage = 200
		platform.Weapon.FireRate = 60
		platform.Orbit.Radius = 15.0
		platform.Orbit.AngularSpeed = 0.0005
	case "fast":
		platform.MaxHP = 200
		platform.HP = platform.MaxHP
		platform.Weapon.Damage = 80
		platform.Weapon.FireRate = 15
		platform.Orbit.Radius = 8.0
		platform.Orbit.AngularSpeed = 0.005
	}

	return platform
}

// CalculateOrbitalPosition 计算轨道平台在地面投影位置
func (op *OrbitalPlatform) CalculateGroundPosition(ws *WorldState) Position {
	t := ws.Surface().FromVector(math.Cos(op.Orbit.Angle), 0, math.Sin(op.Orbit.Angle))
	return Position{X: t.X, Y: t.Y}
}

// UpdateOrbit 更新轨道位置
func (op *OrbitalPlatform) UpdateOrbit() {
	op.Orbit.Angle += op.Orbit.AngularSpeed
	if op.Orbit.Angle > 2*math.Pi {
		op.Orbit.Angle -= 2 * math.Pi
	}
}

// CalculateOrbitalDistance 计算轨道平台到地面目标的距离
func CalculateOrbitalDistance(ws *WorldState, orbit OrbitPosition, groundPos Position) float64 {
	p := (&OrbitalPlatform{Orbit: orbit}).CalculateGroundPosition(ws)
	return float64(ws.SurfaceDistance(p, groundPos))
}

// CalculateFormationPositions 计算编队位置
func CalculateFormationPositions(ws *WorldState, leader *CombatUnit, formationType FormationType, spacing float64) []Position {
	positions := make([]Position, 0)

	switch formationType {
	case FormationTypeLine:
		for i := 0; i < 4; i++ {
			pos := Position{
				X: leader.Position.X - int(spacing*float64(i)),
				Y: leader.Position.Y,
			}
			positions = append(positions, pos)
		}
	case FormationTypeVee:
		for i := 0; i < 4; i++ {
			offset := int(spacing * float64(i))
			pos := Position{
				X: leader.Position.X - offset,
				Y: leader.Position.Y - offset,
			}
			if i%2 == 0 && i > 0 {
				pos.Y = leader.Position.Y + offset
			}
			positions = append(positions, pos)
		}
	case FormationTypeWedge:
		for i := 0; i < 4; i++ {
			offset := int(spacing * float64(i))
			pos := Position{
				X: leader.Position.X - offset,
				Y: leader.Position.Y,
			}
			if i == 1 || i == 2 {
				pos.Y = leader.Position.Y - offset/2
			} else if i == 3 {
				pos.Y = leader.Position.Y + offset/2
			}
			positions = append(positions, pos)
		}
	case FormationTypeCircle:
		for i := 0; i < 6; i++ {
			angle := float64(i) * (2 * math.Pi / 6)
			pos := Position{
				X: leader.Position.X + int(spacing*math.Cos(angle)),
				Y: leader.Position.Y + int(spacing*math.Sin(angle)),
			}
			positions = append(positions, pos)
		}
	}
	for i, p := range positions {
		positions[i] = ws.SurfaceOffset(leader.Position, p.X-leader.Position.X, p.Y-leader.Position.Y)
	}
	return positions
}

// SpaceFleet 太空舰队
type SpaceFleet struct {
	ID                 string                   `json:"id"`
	OwnerID            string                   `json:"owner_id"`
	SystemID           string                   `json:"system_id"`
	AnchorPlanetID     string                   `json:"anchor_planet_id,omitempty"`
	SourceBuildingID   string                   `json:"source_building_id,omitempty"`
	Name               string                   `json:"name,omitempty"`
	Formation          FormationType            `json:"formation"`
	State              FleetState               `json:"state"`
	Units              []FleetUnitStack         `json:"units,omitempty"`
	Weapon             WeaponState              `json:"weapon"`
	Weapons            SpaceWeaponMix           `json:"weapons"`
	Shield             ShieldState              `json:"shield"`
	Armor              DurabilityLayerState     `json:"armor"`
	Structure          DurabilityLayerState     `json:"structure"`
	Subsystems         SpaceFleetSubsystemState `json:"subsystems"`
	Sustainment        WarSustainmentState      `json:"sustainment"`
	Target             *FleetTarget             `json:"target,omitempty"`
	Transit            *FleetTransitState       `json:"transit,omitempty"`
	LastAttackTick     int64                    `json:"last_attack_tick,omitempty"`
	LastBattleReportID string                   `json:"last_battle_report_id,omitempty"`
}
