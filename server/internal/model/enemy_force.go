package model

import (
	"math"
)

// EnemyForceType 敌对势力类型
type EnemyForceType string

const (
	EnemyForceTypeSwarm  EnemyForceType = "swarm"  // 蜂群
	EnemyForceTypeHive   EnemyForceType = "hive"   // 蜂巢
	EnemyForceTypeBeacon EnemyForceType = "beacon" // 信标
)

// ThreatLevel 威胁等级
type ThreatLevel int

const (
	ThreatLevelNone     ThreatLevel = 0 // 无威胁
	ThreatLevelLow      ThreatLevel = 1 // 低威胁
	ThreatLevelMedium   ThreatLevel = 2 // 中威胁
	ThreatLevelHigh     ThreatLevel = 3 // 高威胁
	ThreatLevelCritical ThreatLevel = 4 // 危急
)

// EnemyForce 单个敌对势力
type EnemyForce struct {
	ID             string         `json:"id"`
	Type           EnemyForceType `json:"type"`                       // 势力类型
	Position       Position       `json:"position"`                   // 当前位置
	Strength       int            `json:"strength"`                   // 实力值
	SpreadRadius   float64        `json:"spread_radius"`              // 扩散半径
	SpawnTick      int64          `json:"spawn_tick"`                 // 生成时间
	Level          int            `json:"level,omitempty"`            // 巢穴等级（生成时固化，E4：守军编制/掉落放大/威胁回落）
	LastAttackTick int64          `json:"last_attack_tick,omitempty"` // 上次反击 tick（静态黑雾反击节流）
	LastWaveTick   int64          `json:"last_wave_tick,omitempty"`   // 上次孵化波次 tick（巢穴）
}

// NestRuin 巢穴遗址（E4 区域安全）：巢穴被摧毁后记录位置与摧毁 tick，
// 冷却期内遗址半径内不再刷新新巢；冷却结束后由结算清理，状态有界。
type NestRuin struct {
	Position      Position `json:"position"`
	DestroyedTick int64    `json:"destroyed_tick"`
	Level         int      `json:"level"`
}

// DarkFogOwnerID 黑雾单位的保留归属 ID（不是玩家，不参与胜负判定）。
const DarkFogOwnerID = "dark_fog"

// DefaultDarkFogCalmTicks 黑雾最后一次被伤害后恢复中立的默认 tick 数。
const DefaultDarkFogCalmTicks int64 = 6000

// DarkFogRelation 黑雾对某玩家的敌对关系。不敌对时 HostileUntilTick 为 0。
type DarkFogRelation struct {
	Hostile          bool  `json:"hostile"`
	HostileUntilTick int64 `json:"hostile_until_tick"`
}

// DarkFogHostileTo 黑雾当前是否对该归属敌对（非玩家归属一律不敌对）。
func DarkFogHostileTo(ws *WorldState, ownerID string) bool {
	if ws == nil || ownerID == "" || ownerID == DarkFogOwnerID {
		return false
	}
	player := ws.Players[ownerID]
	return player != nil && player.DarkFog.Hostile
}

// EnemyForceState 敌对势力整体状态
type EnemyForceState struct {
	SystemID    string       `json:"system_id"`    // 所属恒星系
	Forces      []EnemyForce `json:"forces"`       // 敌对势力列表（巢穴/信标等静态实体）
	ThreatLevel ThreatLevel  `json:"threat_level"` // 总威胁等级
	LastAttack  int64        `json:"last_attack"`  // 上次攻击tick
	// ThreatMeter 威胁累积（E2）：随玩家发电/工业活动与战斗累积，
	// 决定巢穴孵化节奏、波次规模与扩张。
	ThreatMeter float64 `json:"threat_meter"`
	// NestSeq 已生成巢穴的累计序号：巢穴位置由 (行星, 序号) 哈希派生，
	// 与随机序列无关，回放/读档/回滚天然一致。
	NestSeq int `json:"nest_seq"`
	// NestRuins 巢穴遗址（E4）：被摧毁巢穴的位置与摧毁 tick，
	// 冷却期内同区域不再刷新新巢（区域安全）。
	NestRuins []NestRuin `json:"nest_ruins,omitempty"`
}

// ThreatParams 威胁系统参数
type ThreatParams struct {
	BaseThreatPerForce   float64 `json:"base_threat_per_force"`   // 每服势力基础威胁
	StrengthThreatFactor float64 `json:"strength_threat_factor"`  // 实力威胁系数
	DistanceThreatDecay  float64 `json:"distance_threat_decay"`   // 距离衰减系数
	TimeThreatGrowthRate float64 `json:"time_threat_growth_rate"` // 时间威胁增长率
}

// DefaultThreatParams 返回默认威胁参数
func DefaultThreatParams() ThreatParams {
	return ThreatParams{
		BaseThreatPerForce:   5.0,
		StrengthThreatFactor: 0.1,
		DistanceThreatDecay:  0.01,
		TimeThreatGrowthRate: 0.5,
	}
}

// CalculateThreatLevel 计算威胁等级
func CalculateThreatLevel(ws *WorldState, forces []EnemyForce, playerPos Position, params ThreatParams) ThreatLevel {
	if len(forces) == 0 {
		return ThreatLevelNone
	}

	totalThreat := 0.0

	for _, force := range forces {
		// 基础威胁
		baseThreat := params.BaseThreatPerForce

		// 实力威胁
		strengthThreat := float64(force.Strength) * params.StrengthThreatFactor

		// 距离衰减
		distance := float64(ws.SurfaceDistance(force.Position, playerPos))
		distanceFactor := math.Exp(-distance * params.DistanceThreatDecay)

		threat := (baseThreat + strengthThreat) * distanceFactor
		totalThreat += threat
	}

	// 根据威胁值确定等级
	switch {
	case totalThreat < 10:
		return ThreatLevelNone
	case totalThreat < 30:
		return ThreatLevelLow
	case totalThreat < 60:
		return ThreatLevelMedium
	case totalThreat < 100:
		return ThreatLevelHigh
	default:
		return ThreatLevelCritical
	}
}
