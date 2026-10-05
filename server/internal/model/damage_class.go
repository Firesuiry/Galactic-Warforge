package model

// 伤害类型与克制（R6）：护甲类 × 武器类伤害系数表，数值在 server/data/combat.yaml。
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

// DamageCoefficients 返回 combat.yaml 伤害系数表的副本：weapon -> armor -> 系数。
func DamageCoefficients() map[WeaponType]map[ArmorClass]float64 {
	out := make(map[WeaponType]map[ArmorClass]float64, len(damageCoefficients))
	for weapon, row := range damageCoefficients {
		cp := make(map[ArmorClass]float64, len(row))
		for armor, coef := range row {
			cp[armor] = coef
		}
		out[weapon] = cp
	}
	return out
}

// ResolveDamageCoefficient 查询武器对护甲的伤害系数，缺省 1.0。
func ResolveDamageCoefficient(weapon WeaponType, armor ArmorClass) float64 {
	if row, ok := damageCoefficients[weapon]; ok {
		if coef, ok := row[armor]; ok && coef > 0 {
			return coef
		}
	}
	return 1.0
}

// WeaponClassForBuilding 防御建筑的武器类型（buildings.yaml profile.weapon_class）。
func WeaponClassForBuilding(btype BuildingType) WeaponType {
	def, _ := BuildingDefinitionByID(btype)
	return def.Profile.WeaponClass
}
