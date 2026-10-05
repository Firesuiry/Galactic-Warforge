package model

// WeaponType 武器类型
type WeaponType string

const (
	WeaponTypeGun     WeaponType = "gun"     // 机枪
	WeaponTypeCannon  WeaponType = "cannon"  // 加农炮
	WeaponTypeMissile WeaponType = "missile" // 导弹
	WeaponTypeLaser   WeaponType = "laser"   // 激光
)

// ShieldState 护盾状态
type ShieldState struct {
	Level         float64 `json:"level" yaml:"level,omitempty"`                   // 当前护盾值
	MaxLevel      float64 `json:"max_level" yaml:"max_level,omitempty"`           // 最大护盾值
	RechargeRate  float64 `json:"recharge_rate" yaml:"recharge_rate,omitempty"`   // 恢复速度 (每tick)
	RechargeDelay int     `json:"recharge_delay" yaml:"recharge_delay,omitempty"` // 恢复延迟 (ticks)
	LastHitTick   int64   `json:"last_hit_tick" yaml:"-"`                         // 上次受击tick
}

// ProcessShieldRecharge 处理护盾恢复
func (s *ShieldState) ProcessShieldRecharge(currentTick int64) {
	if s.Level <= 0 {
		return
	}
	if currentTick-s.LastHitTick < int64(s.RechargeDelay) {
		return
	}
	if s.Level < s.MaxLevel {
		s.Level += s.RechargeRate
		if s.Level > s.MaxLevel {
			s.Level = s.MaxLevel
		}
	}
}

// ApplyShieldDamage 应用护盾伤害，返回实际受到的伤害
func (s *ShieldState) ApplyShieldDamage(damage int) (actualDamage int) {
	if s.Level <= 0 {
		return damage
	}

	shieldAbsorb := s.Level * 0.3 // 护盾吸收30%伤害
	if shieldAbsorb > float64(damage) {
		shieldAbsorb = float64(damage)
	}
	s.Level -= shieldAbsorb
	actualDamage = damage - int(shieldAbsorb)
	return
}

// WeaponState 武器状态
type WeaponState struct {
	Type         WeaponType `json:"type" yaml:"type,omitempty"`           // 武器类型
	Damage       int        `json:"damage" yaml:"damage,omitempty"`       // 伤害值
	FireRate     int        `json:"fire_rate" yaml:"fire_rate,omitempty"` // 射速 (ticks/发)
	Range        float64    `json:"range" yaml:"range,omitempty"`         // 射程
	LastFireTick int64      `json:"last_fire_tick" yaml:"-"`              // 上次开火tick
	AmmoCost     int        `json:"ammo_cost" yaml:"ammo_cost,omitempty"` // 每发弹药消耗
}
