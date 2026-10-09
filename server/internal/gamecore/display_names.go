package gamecore

import "siliconworld/internal/model"

// 玩家可见的回执文案统一用中文名：物品取 items.yaml 的 name，单位/建筑取各自目录的
// name，配方取 recipes.yaml 的 name。回执里不再直接暴露 item_id / unit_id / building_id
// 这类内部 ID；只有目录里查不到的未知 ID（正常不该出现）才原样回显，便于排查。

// itemDisplayName 物品中文名。
func itemDisplayName(itemID string) string {
	if itemID == "" {
		return "物品"
	}
	if def, ok := model.Item(itemID); ok && def.Name != "" {
		return def.Name
	}
	return itemID
}

// unitTypeDisplayName 单位类型中文名（soldier → 步兵）。
func unitTypeDisplayName(unitType model.UnitType) string {
	if def, ok := model.UnitDefinitionByID(unitType); ok && def.Name != "" {
		return def.Name
	}
	return string(unitType)
}

// unitDisplayName 单位中文名；机甲（执行体）统一称「机甲」。
func unitDisplayName(unit *model.Unit) string {
	if unit == nil {
		return "单位"
	}
	if unit.Mecha != nil {
		return "机甲"
	}
	return unitTypeDisplayName(unit.Type)
}

// buildingTypeDisplayName 建筑类型中文名。
func buildingTypeDisplayName(buildingType model.BuildingType) string {
	if def, ok := model.BuildingDefinitionByID(buildingType); ok && def.Name != "" {
		return def.Name
	}
	return string(buildingType)
}

// buildingDisplayName 建筑实例中文名。
func buildingDisplayName(building *model.Building) string {
	if building == nil {
		return "建筑"
	}
	return buildingTypeDisplayName(building.Type)
}

// recipeDisplayName 配方中文名。
func recipeDisplayName(recipeID string) string {
	if def, ok := model.Recipe(recipeID); ok && def.Name != "" {
		return def.Name
	}
	return recipeID
}

// targetDisplayName 攻击/命令目标的中文名：单位、建筑、黑雾巢穴依次解析。
func targetDisplayName(ws *model.WorldState, target *unitCombatTarget) string {
	if target == nil {
		return "目标"
	}
	switch target.kind {
	case "unit":
		return unitDisplayName(target.unit)
	case "building":
		return buildingDisplayName(target.building)
	default:
		return "黑雾"
	}
}
