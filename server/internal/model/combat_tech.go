package model

// CombatTechType 战斗科技类型
type CombatTechType string

const (
	CombatTechWeapon CombatTechType = "weapon" // 武器科技
	CombatTechArmor  CombatTechType = "armor"  // 装甲科技
	CombatTechPower  CombatTechType = "power"  // 动力科技
	CombatTechDrone  CombatTechType = "drone"  // 无人机科技
)

// CombatTechEffect 科技效果
type CombatTechEffect struct {
	DamageBonus       float64 `json:"damage_bonus"`        // 伤害加成
	DefenseBonus      float64 `json:"defense_bonus"`     // 防御加成
	SpeedBonus        float64 `json:"speed_bonus"`       // 速度加成
	RangeBonus        float64 `json:"range_bonus"`       // 射程加成
	ShieldBonus       float64 `json:"shield_bonus"`      // 护盾加成
	AmmoCapacityBonus int     `json:"ammo_capacity_bonus"` // 弹药容量加成
}

// CombatTech 战斗科技
type CombatTech struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Type          CombatTechType   `json:"type"`
	Level         int              `json:"level"`          // 科技等级
	MaxLevel      int              `json:"max_level"`      // 最大等级
	ResearchCost  int              `json:"research_cost"`   // 研究成本
	Effects       CombatTechEffect `json:"effects"`        // 科技效果
}

// CombatTechDefinition 战斗科技定义
type CombatTechDefinition struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Type         CombatTechType   `json:"type"`
	MaxLevel     int              `json:"max_level"`
	BaseCost     int              `json:"base_cost"`       // 基础研究成本
	CostPerLevel int              `json:"cost_per_level"`  // 每级增加成本
	Effects      []CombatTechEffect `json:"effects"`       // 每级效果
}

// PlayerCombatTechState 玩家战斗科技状态
type PlayerCombatTechState struct {
	PlayerID        string                  `json:"player_id"`
	UnlockedTechs   map[string]*CombatTech `json:"unlocked_techs"`   // 已解锁科技
	CurrentResearch *CombatTech             `json:"current_research"` // 当前研究
	ResearchProgress int                    `json:"research_progress"` // 研究进度
}

// DroneUnit 无人机单位
type DroneUnit struct {
	ID           string    `json:"id"`
	OwnerID      string    `json:"owner_id"`
	Position     Position  `json:"position"`
	HP           int       `json:"hp"`
	MaxHP        int       `json:"max_hp"`
	Attack       int       `json:"attack"`
	Defense      int       `json:"defense"`
	Speed        float64   `json:"speed"`
	AttackRange  int       `json:"attack_range"`
	VisionRange  int       `json:"vision_range"`
	ControlledBy string   `json:"controlled_by"` // 控制者单位ID
	State        string    `json:"state"`         // 状态
}

// DefaultCombatTechDefinitions 返回默认战斗科技定义
func DefaultCombatTechDefinitions() []CombatTechDefinition {
	return []CombatTechDefinition{
		// 武器科技
		{
			ID:           "weapon_mk1",
			Name:         "Weapon MK I",
			Type:         CombatTechWeapon,
			MaxLevel:     3,
			BaseCost:     100,
			CostPerLevel: 50,
			Effects: []CombatTechEffect{
				{DamageBonus: 0.1, RangeBonus: 0.05},
				{DamageBonus: 0.2, RangeBonus: 0.10},
				{DamageBonus: 0.3, RangeBonus: 0.15},
			},
		},
		{
			ID:           "weapon_mk2",
			Name:         "Weapon MK II",
			Type:         CombatTechWeapon,
			MaxLevel:     3,
			BaseCost:     200,
			CostPerLevel: 100,
			Effects: []CombatTechEffect{
				{DamageBonus: 0.15, RangeBonus: 0.08},
				{DamageBonus: 0.30, RangeBonus: 0.16},
				{DamageBonus: 0.45, RangeBonus: 0.24},
			},
		},
		// 装甲科技
		{
			ID:           "armor_mk1",
			Name:         "Armor MK I",
			Type:         CombatTechArmor,
			MaxLevel:     3,
			BaseCost:     100,
			CostPerLevel: 50,
			Effects: []CombatTechEffect{
				{DefenseBonus: 0.1, ShieldBonus: 0.1},
				{DefenseBonus: 0.2, ShieldBonus: 0.2},
				{DefenseBonus: 0.3, ShieldBonus: 0.3},
			},
		},
		{
			ID:           "armor_mk2",
			Name:         "Armor MK II",
			Type:         CombatTechArmor,
			MaxLevel:     3,
			BaseCost:     200,
			CostPerLevel: 100,
			Effects: []CombatTechEffect{
				{DefenseBonus: 0.2, ShieldBonus: 0.15},
				{DefenseBonus: 0.4, ShieldBonus: 0.30},
				{DefenseBonus: 0.6, ShieldBonus: 0.45},
			},
		},
		// 动力科技
		{
			ID:           "power_mk1",
			Name:         "Power MK I",
			Type:         CombatTechPower,
			MaxLevel:     3,
			BaseCost:     100,
			CostPerLevel: 50,
			Effects: []CombatTechEffect{
				{SpeedBonus: 0.1},
				{SpeedBonus: 0.2},
				{SpeedBonus: 0.3},
			},
		},
		{
			ID:           "power_mk2",
			Name:         "Power MK II",
			Type:         CombatTechPower,
			MaxLevel:     3,
			BaseCost:     200,
			CostPerLevel: 100,
			Effects: []CombatTechEffect{
				{SpeedBonus: 0.15},
				{SpeedBonus: 0.30},
				{SpeedBonus: 0.45},
			},
		},
		// 无人机科技
		{
			ID:           "drone_mk1",
			Name:         "Drone MK I",
			Type:         CombatTechDrone,
			MaxLevel:     3,
			BaseCost:     150,
			CostPerLevel: 75,
			Effects: []CombatTechEffect{
				{AmmoCapacityBonus: 1},
				{AmmoCapacityBonus: 2},
				{AmmoCapacityBonus: 3},
			},
		},
	}
}

// GetTechResearchCost 获取科技研究成本
func GetTechResearchCost(def CombatTechDefinition, level int) int {
	if level <= 0 {
		level = 1
	}
	if level > def.MaxLevel {
		level = def.MaxLevel
	}
	return def.BaseCost + (level-1)*def.CostPerLevel
}

// ApplyTechToCombatUnit 将科技效果应用到战斗单位
func ApplyTechToCombatUnit(unit *CombatUnit, tech *CombatTech) {
	if tech == nil {
		return
	}

	switch tech.Type {
	case CombatTechWeapon:
		unit.Weapon.Damage = int(float64(unit.Weapon.Damage) * (1.0 + tech.Effects.DamageBonus))
		unit.Weapon.Range *= (1.0 + tech.Effects.RangeBonus)
	case CombatTechArmor:
		unit.MaxHP = int(float64(unit.MaxHP) * (1.0 + tech.Effects.DefenseBonus))
		unit.HP = unit.MaxHP
		unit.Shield.MaxLevel *= (1.0 + tech.Effects.ShieldBonus)
		unit.Shield.Level = unit.Shield.MaxLevel
	case CombatTechPower:
		unit.Speed *= (1.0 + tech.Effects.SpeedBonus)
	case CombatTechDrone:
		unit.AmmoInventory += tech.Effects.AmmoCapacityBonus
	}
}

// DefaultDroneStats 返回默认无人机属性
func DefaultDroneStats() DroneUnit {
	return DroneUnit{
		MaxHP:       30,
		HP:          30,
		Attack:      8,
		Defense:     2,
		Speed:       1.5,
		AttackRange: 4,
		VisionRange: 6,
		State:       "idle",
	}
}