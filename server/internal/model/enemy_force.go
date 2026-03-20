package model

import (
	"math"
	"math/rand"
)

// EnemyForceType 敌对势力类型
type EnemyForceType string

const (
	EnemyForceTypeSwarm  EnemyForceType = "swarm"   // 蜂群
	EnemyForceTypeHive   EnemyForceType = "hive"    // 蜂巢
	EnemyForceTypeBeacon EnemyForceType = "beacon"  // 信标
)

// ThreatLevel 威胁等级
type ThreatLevel int

const (
	ThreatLevelNone     ThreatLevel = 0  // 无威胁
	ThreatLevelLow     ThreatLevel = 1  // 低威胁
	ThreatLevelMedium  ThreatLevel = 2  // 中威胁
	ThreatLevelHigh    ThreatLevel = 3  // 高威胁
	ThreatLevelCritical ThreatLevel = 4 // 危急
)

// EnemyForce 单个敌对势力
type EnemyForce struct {
	ID           string         `json:"id"`
	Type         EnemyForceType `json:"type"`          // 势力类型
	Position     Position       `json:"position"`       // 当前位置
	Strength     int            `json:"strength"`      // 实力值
	SpreadRadius float64        `json:"spread_radius"` // 扩散半径
	TargetPlayer string         `json:"target_player"` // 目标玩家
	SpawnTick    int64          `json:"spawn_tick"`    // 生成时间
}

// EnemyForceState 敌对势力整体状态
type EnemyForceState struct {
	SystemID    string        `json:"system_id"`    // 所属恒星系
	Forces      []EnemyForce  `json:"forces"`       // 敌对势力列表
	ThreatLevel ThreatLevel   `json:"threat_level"` // 总威胁等级
	LastAttack  int64         `json:"last_attack"`  // 上次攻击tick
}

// ThreatParams 威胁系统参数
type ThreatParams struct {
	BaseThreatPerForce   float64 `json:"base_threat_per_force"`   // 每服势力基础威胁
	StrengthThreatFactor float64 `json:"strength_threat_factor"` // 实力威胁系数
	DistanceThreatDecay  float64 `json:"distance_threat_decay"`  // 距离衰减系数
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
func CalculateThreatLevel(forces []EnemyForce, playerPos Position, params ThreatParams) ThreatLevel {
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
		distance := math.Sqrt(math.Pow(float64(force.Position.X-playerPos.X), 2) +
			math.Pow(float64(force.Position.Y-playerPos.Y), 2))
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

// SpreadEnemyForce 扩散敌对势力
func SpreadEnemyForce(force *EnemyForce, rng *rand.Rand) {
	if force == nil {
		return
	}

	// 计算扩散速度（基于威胁等级）
	spreadSpeed := 0.01 * (1.0 + float64(force.Strength)/100.0)

	// 随机方向扩散
	angle := rng.Float64() * 2 * math.Pi
	force.Position.X += int(spreadSpeed * math.Cos(angle))
	force.Position.Y += int(spreadSpeed * math.Sin(angle))

	// 增加扩散半径
	force.SpreadRadius += spreadSpeed * 0.1
}

// AttackRhythm 进攻节奏参数
type AttackRhythm struct {
	MinIntervalTicks  int64 `json:"min_interval_ticks"`  // 最小攻击间隔
	MaxIntervalTicks  int64 `json:"max_interval_ticks"`  // 最大攻击间隔
	StrengthPerAttack int   `json:"strength_per_attack"` // 每次攻击强度
}

// DefaultAttackRhythm 返回默认进攻节奏
func DefaultAttackRhythm() AttackRhythm {
	return AttackRhythm{
		MinIntervalTicks:  100,  // 10秒（假设10tick/s）
		MaxIntervalTicks:  500,  // 50秒
		StrengthPerAttack: 10,
	}
}

// GetNextAttackTick 计算下次攻击时间
func GetNextAttackTick(currentTick int64, threat ThreatLevel, rhythm AttackRhythm) int64 {
	// 高威胁 = 更频繁的攻击
	baseInterval := rhythm.MinIntervalTicks
	threatMultiplier := 1.0 - float64(threat)*0.15 // 威胁越高，间隔越短
	if threatMultiplier < 0.3 {
		threatMultiplier = 0.3
	}
	interval := int64(float64(rhythm.MaxIntervalTicks-rhythm.MinIntervalTicks) * (1 - threatMultiplier))
	return currentTick + baseInterval + interval
}