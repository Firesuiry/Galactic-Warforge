package model

// IsDefenseBuilding 判断建筑类型是否为防御建筑
func IsDefenseBuilding(btype BuildingType) bool {
	if def, ok := BuildingRuntimeDefinitionByID(btype); ok && def.Functions.Combat != nil {
		return true
	}
	switch btype {
	case BuildingTypeGaussTurret, BuildingTypeMissileTurret,
		BuildingTypeLaserTurret, BuildingTypePlasmaTurret, BuildingTypeSRPlasmaTurret,
		BuildingTypeImplosionCannon,
		BuildingTypeJammerTower, BuildingTypeSignalTower,
		BuildingTypePlanetaryShieldGenerator:
		return true
	default:
		return false
	}
}
