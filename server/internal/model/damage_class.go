package model

// 伤害类型与克制（R6）：护甲类 × 武器类伤害系数表。
// 每个兵种至少有一个明确的克制对象与被克制对象：
//   - gun（机枪/利爪）：克轻甲（工蜂/蜂群），被重甲与建筑克制
//   - cannon（加农/电磁）：克重甲与建筑，难以命中空中
//   - missile（导弹）：克空中与舰船，被点防（太空既有规则）与地面重甲部分抵抗
//   - laser（激光）：均衡，对舰船与空中略优

// ArmorClass 护甲类型。
type ArmorClass string

const (
	ArmorLight     ArmorClass = "light"     // 轻甲（工人/士兵/蜂群）
	ArmorHeavy     ArmorClass = "heavy"     // 重甲（机甲/载具/执行体）
	ArmorStructure ArmorClass = "structure" // 建筑
	ArmorAir       ArmorClass = "air"       // 空中（无人机编队）
	ArmorShip      ArmorClass = "ship"      // 舰船（舰队）
)

// DamageCoefficient 武器对护甲的伤害系数。
var DamageCoefficient = map[WeaponType]map[ArmorClass]float64{
	WeaponTypeGun: {
		ArmorLight: 1.25, ArmorHeavy: 0.75, ArmorStructure: 0.50, ArmorAir: 1.00, ArmorShip: 0.75,
	},
	WeaponTypeCannon: {
		ArmorLight: 0.75, ArmorHeavy: 1.25, ArmorStructure: 1.50, ArmorAir: 0.50, ArmorShip: 1.00,
	},
	WeaponTypeMissile: {
		ArmorLight: 1.00, ArmorHeavy: 0.75, ArmorStructure: 1.25, ArmorAir: 1.50, ArmorShip: 1.25,
	},
	WeaponTypeLaser: {
		ArmorLight: 1.00, ArmorHeavy: 0.90, ArmorStructure: 1.00, ArmorAir: 1.10, ArmorShip: 1.10,
	},
}

// ResolveDamageCoefficient 查询武器对护甲的伤害系数，缺省 1.0。
func ResolveDamageCoefficient(weapon WeaponType, armor ArmorClass) float64 {
	if row, ok := DamageCoefficient[weapon]; ok {
		if coef, ok := row[armor]; ok && coef > 0 {
			return coef
		}
	}
	return 1.0
}

// WeaponClassForUnitType 单位的武器类型（R6）。
func WeaponClassForUnitType(utype UnitType) WeaponType {
	switch utype {
	case UnitTypeMecha:
		return WeaponTypeCannon
	case UnitTypeExecutor:
		return WeaponTypeGun
	case UnitTypeDarkFog:
		return WeaponTypeGun // 蜂群利爪归入机枪类
	default:
		return WeaponTypeGun
	}
}

// ArmorClassForUnitType 单位的护甲类型（R6）。
func ArmorClassForUnitType(utype UnitType) ArmorClass {
	switch utype {
	case UnitTypeMecha, UnitTypeExecutor:
		return ArmorHeavy
	default:
		return ArmorLight
	}
}

// WeaponClassForBuilding 防御建筑的武器类型（炮塔用，R6）。
func WeaponClassForBuilding(btype BuildingType) WeaponType {
	switch btype {
	case BuildingTypeGaussTurret:
		return WeaponTypeCannon
	case BuildingTypeMissileTurret:
		return WeaponTypeMissile
	default:
		return WeaponTypeLaser
	}
}
