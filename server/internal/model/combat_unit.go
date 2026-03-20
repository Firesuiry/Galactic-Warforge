package model

import (
	"math"
)

// CombatUnitType 战斗单位类型
type CombatUnitType string

const (
	CombatUnitTypeMech     CombatUnitType = "mech"     // 机甲
	CombatUnitTypeTank     CombatUnitType = "tank"     // 坦克
	CombatUnitTypeAircraft CombatUnitType = "aircraft" // 飞机
	CombatUnitTypeShip     CombatUnitType = "ship"     // 舰船
)

// WeaponType 武器类型
type WeaponType string

const (
	WeaponTypeGun     WeaponType = "gun"     // 机枪
	WeaponTypeCannon WeaponType = "cannon" // 加农炮
	WeaponTypeMissile WeaponType = "missile" // 导弹
	WeaponTypeLaser   WeaponType = "laser"   // 激光
)

// CombatUnitState 战斗单位状态
type CombatUnitState string

const (
	CombatUnitStateIdle      CombatUnitState = "idle"
	CombatUnitStateMoving    CombatUnitState = "moving"
	CombatUnitStateAttacking CombatUnitState = "attacking"
	CombatUnitStateDead     CombatUnitState = "dead"
)

// ShieldState 护盾状态
type ShieldState struct {
	Level         float64 `json:"level"`          // 当前护盾值
	MaxLevel     float64 `json:"max_level"`      // 最大护盾值
	RechargeRate float64 `json:"recharge_rate"`  // 恢复速度 (每tick)
	RechargeDelay int     `json:"recharge_delay"` // 恢复延迟 (ticks)
	LastHitTick  int64    `json:"last_hit_tick"` // 上次受击tick
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
	Type         WeaponType `json:"type"`          // 武器类型
	Damage       int        `json:"damage"`         // 伤害值
	FireRate     int        `json:"fire_rate"`     // 射速 (ticks/发)
	Range        float64    `json:"range"`          // 射程
	LastFireTick int64      `json:"last_fire_tick"` // 上次开火tick
	AmmoCost     int        `json:"ammo_cost"`      // 每发弹药消耗
}

// CombatUnit 战斗单位扩展信息
type CombatUnit struct {
	ID            string           `json:"id"`             // 单位ID
	Type          CombatUnitType   `json:"type"`           // 单位类型
	PlayerID      string           `json:"player_id"`      // 所属玩家
	Position      Position         `json:"position"`       // 位置
	HP            int              `json:"hp"`             // 当前生命值
	MaxHP         int              `json:"max_hp"`         // 最大生命值
	Shield        ShieldState      `json:"shield"`          // 护盾状态
	Weapon        WeaponState      `json:"weapon"`          // 武器状态
	AmmoInventory int              `json:"ammo_inventory"` // 弹药库存
	Speed         float64          `json:"speed"`          // 移动速度
	State         CombatUnitState  `json:"state"`          // 单位状态
	AttackTarget  string           `json:"attack_target"`  // 攻击目标ID
}

// LootDrop 掉落物品
type LootDrop struct {
	ItemID   string `json:"item_id"`
	Quantity int    `json:"quantity"`
}

// DefaultCombatUnitStats 返回战斗单位默认属性
func DefaultCombatUnitStats(unitType CombatUnitType) CombatUnit {
	unit := CombatUnit{
		Type:     unitType,
		State:    CombatUnitStateIdle,
		Shield:   ShieldState{},
		Weapon:   WeaponState{},
	}

	switch unitType {
	case CombatUnitTypeMech:
		unit.MaxHP = 200
		unit.HP = unit.MaxHP
		unit.Shield.MaxLevel = 50
		unit.Shield.Level = unit.Shield.MaxLevel
		unit.Shield.RechargeRate = 2.0
		unit.Shield.RechargeDelay = 30
		unit.Weapon.Type = WeaponTypeGun
		unit.Weapon.Damage = 25
		unit.Weapon.FireRate = 8
		unit.Weapon.Range = 6
		unit.Weapon.AmmoCost = 1
		unit.AmmoInventory = 50
		unit.Speed = 1.0
	case CombatUnitTypeTank:
		unit.MaxHP = 400
		unit.HP = unit.MaxHP
		unit.Shield.MaxLevel = 100
		unit.Shield.Level = unit.Shield.MaxLevel
		unit.Shield.RechargeRate = 3.0
		unit.Shield.RechargeDelay = 50
		unit.Weapon.Type = WeaponTypeCannon
		unit.Weapon.Damage = 60
		unit.Weapon.FireRate = 20
		unit.Weapon.Range = 10
		unit.Weapon.AmmoCost = 2
		unit.AmmoInventory = 30
		unit.Speed = 0.5
	case CombatUnitTypeAircraft:
		unit.MaxHP = 100
		unit.HP = unit.MaxHP
		unit.Shield.MaxLevel = 30
		unit.Shield.Level = unit.Shield.MaxLevel
		unit.Shield.RechargeRate = 1.0
		unit.Shield.RechargeDelay = 20
		unit.Weapon.Type = WeaponTypeMissile
		unit.Weapon.Damage = 40
		unit.Weapon.FireRate = 15
		unit.Weapon.Range = 15
		unit.Weapon.AmmoCost = 1
		unit.AmmoInventory = 20
		unit.Speed = 2.0
	case CombatUnitTypeShip:
		unit.MaxHP = 600
		unit.HP = unit.MaxHP
		unit.Shield.MaxLevel = 200
		unit.Shield.Level = unit.Shield.MaxLevel
		unit.Shield.RechargeRate = 5.0
		unit.Shield.RechargeDelay = 60
		unit.Weapon.Type = WeaponTypeLaser
		unit.Weapon.Damage = 80
		unit.Weapon.FireRate = 25
		unit.Weapon.Range = 20
		unit.Weapon.AmmoCost = 3
		unit.AmmoInventory = 100
		unit.Speed = 0.3
	}

	return unit
}

// CalculateDistance 计算两点之间的距离
func CalculateDistance(a, b Position) float64 {
	dx := float64(a.X - b.X)
	dy := float64(a.Y - b.Y)
	return math.Sqrt(dx*dx + dy*dy)
}

// CalculateDamage 计算伤害
func CalculateDamage(weapon WeaponState, target *CombatUnit, distance float64) int {
	if distance > weapon.Range {
		return 0 // 超出射程
	}

	baseDamage := weapon.Damage

	// 距离衰减
	distanceFactor := 1.0 - (distance / weapon.Range) * 0.5
	if distanceFactor < 0.5 {
		distanceFactor = 0.5
	}

	damage := int(float64(baseDamage) * distanceFactor)

	// 目标护盾处理
	if target.Shield.Level > 0 {
		damage = target.Shield.ApplyShieldDamage(damage)
	}

	return damage
}

// ProcessWeaponFire 处理武器开火
func ProcessWeaponFire(unit *CombatUnit, target *CombatUnit, currentTick int64) (damage int, success bool) {
	if unit.State == CombatUnitStateDead {
		return 0, false
	}
	if currentTick-unit.Weapon.LastFireTick < int64(unit.Weapon.FireRate) {
		return 0, false // 冷却中
	}
	if unit.AmmoInventory < unit.Weapon.AmmoCost {
		return 0, false // 弹药不足
	}

	distance := CalculateDistance(unit.Position, target.Position)
	damage = CalculateDamage(unit.Weapon, target, distance)

	if damage > 0 {
		target.HP -= damage
		target.Shield.LastHitTick = currentTick
		unit.AmmoInventory -= unit.Weapon.AmmoCost
		unit.Weapon.LastFireTick = currentTick
		unit.State = CombatUnitStateAttacking
		success = true
	}

	return
}

// CalculateLoot 计算战斗掉落
func CalculateLoot(enemy *EnemyForce, rng *math.Rand) []LootDrop {
	drops := make([]LootDrop, 0)

	if enemy == nil {
		return drops
	}

	// 基于敌人类型和强度计算掉落
	baseChance := float64(enemy.Strength) / 100.0

	if rng.Float64() < baseChance*0.5 {
		drops = append(drops, LootDrop{ItemID: "enemy_core", Quantity: 1})
	}
	if rng.Float64() < baseChance*0.3 {
		drops = append(drops, LootDrop{ItemID: "rare_materials", Quantity: rng.Intn(3) + 1})
	}

	return drops
}