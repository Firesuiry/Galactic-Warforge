package model

// EnemyIntel 敌人情报
type EnemyIntel struct {
	EnemyID     string   `json:"enemy_id"`
	Type       string   `json:"type"`
	Position   Position `json:"position"`
	Strength   int      `json:"strength"`
	LastSeen   int64    `json:"last_seen"`    // 最后发现时间
	ThreatLevel float64 `json:"threat_level"` // 威胁等级
}

// DetectionState 玩家的侦测状态
type DetectionState struct {
	PlayerID         string       `json:"player_id"`
	KnownEnemies     []EnemyIntel `json:"known_enemies"`      // 已知的敌人情报
	DetectedPositions []Position  `json:"detected_positions"` // 探测到的位置
	VisionRange      float64      `json:"vision_range"`      // 视野范围
}

// DefenseType 防御建筑类型
type DefenseType string

const (
	DefenseTypeTurret    DefenseType = "turret"      // 炮塔
	DefenseTypeMissile   DefenseType = "missile"    // 导弹塔
	DefenseTypeJammer    DefenseType = "jammer"     // 干扰塔
	DefenseTypeSlowField DefenseType = "slow_field" // 减速装置
	DefenseTypeRadar     DefenseType = "radar"      // 雷达
	DefenseTypeSignal    DefenseType = "signal"     // 信号塔
)

// DefenseBuildingRuntime 防御建筑运行时状态
type DefenseBuildingRuntime struct {
	Type          DefenseType `json:"type"`           // 防御建筑类型
	TargetID      string      `json:"target_id"`      // 当前目标
	AmmoCount     int         `json:"ammo_count"`     // 弹药数量
	AmmoMax       int         `json:"ammo_max"`       // 最大弹药
	ShieldLevel   float64     `json:"shield_level"`   // 护盾等级
	IsActive      bool        `json:"is_active"`      // 是否激活
	Range         float64     `json:"range"`          // 范围
	FireRate      int         `json:"fire_rate"`      // 射击间隔(ticks)
	LastFireTick  int64       `json:"last_fire_tick"` // 上次射击tick
	SlowFactor    float64     `json:"slow_factor"`    // 减速比例
	RedirectChance float64    `json:"redirect_chance"` // 重定向几率
	VisionBonus   float64     `json:"vision_bonus"`   // 视野加成
}

// DefaultDefenseBuildingRuntime 创建默认防御建筑运行时状态
func DefaultDefenseBuildingRuntime(defType DefenseType) DefenseBuildingRuntime {
	rt := DefenseBuildingRuntime{
		Type:     defType,
		IsActive: true,
	}
	switch defType {
	case DefenseTypeTurret:
		rt.Range = 5
		rt.FireRate = 10
		rt.AmmoMax = 100
		rt.AmmoCount = rt.AmmoMax
	case DefenseTypeMissile:
		rt.Range = 10
		rt.FireRate = 30
		rt.AmmoMax = 20
		rt.AmmoCount = rt.AmmoMax
	case DefenseTypeJammer:
		rt.Range = 8
		rt.SlowFactor = 0.5
	case DefenseTypeSlowField:
		rt.Range = 6
		rt.SlowFactor = 0.3
	case DefenseTypeRadar:
		rt.Range = 15
	case DefenseTypeSignal:
		rt.Range = 12
		rt.RedirectChance = 0.3
		rt.VisionBonus = 3.0
	}
	return rt
}

// DefenseStats 防御建筑属性
type DefenseStats struct {
	Damage       int     `json:"damage"`        // 伤害
	FireRate     int     `json:"fire_rate"`      // 射速 (ticks/发)
	Range        float64 `json:"range"`          // 射程
	AmmoConsume  int     `json:"ammo_consume"`   // 每发弹药消耗
	Tracking     bool    `json:"tracking"`       // 是否追踪(导弹)
	SlowFactor   float64 `json:"slow_factor"`    // 减速比例
	RedirectChance float64 `json:"redirect_chance"` // 重定向几率
}

// DefaultDefenseStats 返回防御建筑默认属性
func DefaultDefenseStats(defType DefenseType) DefenseStats {
	switch defType {
	case DefenseTypeTurret:
		return DefenseStats{Damage: 15, FireRate: 10, Range: 5, AmmoConsume: 1}
	case DefenseTypeMissile:
		return DefenseStats{Damage: 40, FireRate: 30, Range: 10, AmmoConsume: 1, Tracking: true}
	case DefenseTypeJammer:
		return DefenseStats{Range: 8, SlowFactor: 0.5}
	case DefenseTypeSlowField:
		return DefenseStats{Range: 6, SlowFactor: 0.3}
	case DefenseTypeSignal:
		return DefenseStats{Range: 12, RedirectChance: 0.3}
	default:
		return DefenseStats{}
	}
}

// IsDefenseBuilding 判断建筑类型是否为防御建筑
func IsDefenseBuilding(btype BuildingType) bool {
	switch btype {
	case BuildingTypeGaussTurret, BuildingTypeMissileTurret,
		BuildingTypeLaserTurret, BuildingTypePlasmaTurret,
		BuildingTypeJammerTower, BuildingTypeSignalTower,
		BuildingTypePlanetaryShieldGenerator:
		return true
	default:
		return false
	}
}

// GetDefenseType 获取防御建筑类型
func GetDefenseType(btype BuildingType) DefenseType {
	switch btype {
	case BuildingTypeGaussTurret, BuildingTypeLaserTurret,
		BuildingTypePlasmaTurret, BuildingTypeImplosionCannon:
		return DefenseTypeTurret
	case BuildingTypeMissileTurret:
		return DefenseTypeMissile
	case BuildingTypeJammerTower:
		return DefenseTypeJammer
	case BuildingTypeSignalTower:
		return DefenseTypeSignal
	default:
		return ""
	}
}