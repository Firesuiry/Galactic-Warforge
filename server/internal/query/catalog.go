package query

import "siliconworld/internal/model"

// CatalogView exposes front-end display metadata derived from server catalogs.
type CatalogView struct {
	Buildings []BuildingCatalogEntry `json:"buildings,omitempty"`
	Items     []ItemCatalogEntry     `json:"items,omitempty"`
	Recipes   []RecipeCatalogEntry   `json:"recipes,omitempty"`
	Techs     []TechCatalogEntry     `json:"techs,omitempty"`
}

type BuildingCatalogEntry struct {
	ID                   model.BuildingType        `json:"id"`
	Name                 string                    `json:"name"`
	Category             model.BuildingCategory    `json:"category"`
	Subcategory          model.BuildingSubcategory `json:"subcategory"`
	Footprint            model.Footprint           `json:"footprint"`
	BuildCost            model.BuildCost           `json:"build_cost"`
	Buildable            bool                      `json:"buildable"`
	DefaultRecipeID      string                    `json:"default_recipe_id,omitempty"`
	RequiresResourceNode bool                      `json:"requires_resource_node,omitempty"`
	CanProduceUnits      bool                      `json:"can_produce_units,omitempty"`
	UnlockTech           []string                  `json:"unlock_tech,omitempty"`
	IconKey              string                    `json:"icon_key"`
	Color                string                    `json:"color"`
}

type ItemCatalogEntry struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Category    model.ItemCategory `json:"category"`
	Form        model.ResourceForm `json:"form"`
	StackLimit  int                `json:"stack_limit"`
	UnitVolume  int                `json:"unit_volume"`
	ContainerID string             `json:"container_id,omitempty"`
	IsRare      bool               `json:"is_rare,omitempty"`
	IconKey     string             `json:"icon_key"`
	Color       string             `json:"color"`
}

type RecipeCatalogEntry struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	Inputs        []model.ItemAmount   `json:"inputs"`
	Outputs       []model.ItemAmount   `json:"outputs"`
	Byproducts    []model.ItemAmount   `json:"byproducts,omitempty"`
	Duration      int                  `json:"duration"`
	EnergyCost    int                  `json:"energy_cost"`
	BuildingTypes []model.BuildingType `json:"building_types,omitempty"`
	TechUnlock    []string             `json:"tech_unlock,omitempty"`
	IconKey       string               `json:"icon_key"`
	Color         string               `json:"color"`
}

type TechCatalogEntry struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	NameEN        string             `json:"name_en,omitempty"`
	Category      model.TechCategory `json:"category"`
	Type          model.TechType     `json:"type"`
	Level         int                `json:"level"`
	Prerequisites []string           `json:"prerequisites,omitempty"`
	Cost          []model.ItemAmount `json:"cost,omitempty"`
	Unlocks       []model.TechUnlock `json:"unlocks,omitempty"`
	Effects       []model.TechEffect `json:"effects,omitempty"`
	MaxLevel      int                `json:"max_level,omitempty"`
	Hidden        bool               `json:"hidden,omitempty"`
	IconKey       string             `json:"icon_key"`
	Color         string             `json:"color"`
}

// Catalog returns immutable metadata for UI display and command composition.
func (ql *Layer) Catalog() *CatalogView {
	buildDefs := model.AllBuildingDefinitions()
	buildings := make([]BuildingCatalogEntry, 0, len(buildDefs))
	for _, def := range buildDefs {
		buildCostItems := append([]model.ItemAmount(nil), def.BuildCost.Items...)
		buildings = append(buildings, BuildingCatalogEntry{
			ID:                   def.ID,
			Name:                 def.Name,
			Category:             def.Category,
			Subcategory:          def.Subcategory,
			Footprint:            def.Footprint,
			BuildCost:            model.BuildCost{Minerals: def.BuildCost.Minerals, Energy: def.BuildCost.Energy, Items: buildCostItems},
			Buildable:            def.Buildable,
			DefaultRecipeID:      def.DefaultRecipeID,
			RequiresResourceNode: def.RequiresResourceNode,
			CanProduceUnits:      def.CanProduceUnits,
			UnlockTech:           append([]string(nil), def.UnlockTech...),
			IconKey:              string(def.ID),
			Color:                buildingCatalogColor(def.Category),
		})
	}

	itemDefs := model.AllItems()
	items := make([]ItemCatalogEntry, 0, len(itemDefs))
	for _, item := range itemDefs {
		items = append(items, ItemCatalogEntry{
			ID:          item.ID,
			Name:        item.Name,
			Category:    item.Category,
			Form:        item.Form,
			StackLimit:  item.StackLimit,
			UnitVolume:  item.UnitVolume,
			ContainerID: item.ContainerID,
			IsRare:      item.IsRare,
			IconKey:     item.ID,
			Color:       itemCatalogColor(item.Category, item.Form, item.IsRare),
		})
	}

	recipeDefs := model.AllRecipes()
	recipes := make([]RecipeCatalogEntry, 0, len(recipeDefs))
	for _, recipe := range recipeDefs {
		recipes = append(recipes, RecipeCatalogEntry{
			ID:            recipe.ID,
			Name:          recipe.Name,
			Inputs:        append([]model.ItemAmount(nil), recipe.Inputs...),
			Outputs:       append([]model.ItemAmount(nil), recipe.Outputs...),
			Byproducts:    append([]model.ItemAmount(nil), recipe.Byproducts...),
			Duration:      recipe.Duration,
			EnergyCost:    recipe.EnergyCost,
			BuildingTypes: append([]model.BuildingType(nil), recipe.BuildingTypes...),
			TechUnlock:    append([]string(nil), recipe.TechUnlock...),
			IconKey:       recipe.ID,
			Color:         recipeCatalogColor(recipe),
		})
	}

	techDefs := model.AllTechDefinitions()
	techs := make([]TechCatalogEntry, 0, len(techDefs))
	for _, tech := range techDefs {
		if tech == nil {
			continue
		}
		techs = append(techs, TechCatalogEntry{
			ID:            tech.ID,
			Name:          tech.Name,
			NameEN:        tech.NameEN,
			Category:      tech.Category,
			Type:          tech.Type,
			Level:         tech.Level,
			Prerequisites: append([]string(nil), tech.Prerequisites...),
			Cost:          append([]model.ItemAmount(nil), tech.Cost...),
			Unlocks:       append([]model.TechUnlock(nil), tech.Unlocks...),
			Effects:       append([]model.TechEffect(nil), tech.Effects...),
			MaxLevel:      tech.MaxLevel,
			Hidden:        tech.Hidden,
			IconKey:       tech.ID,
			Color:         techCatalogColor(tech.Type),
		})
	}

	return &CatalogView{
		Buildings: buildings,
		Items:     items,
		Recipes:   recipes,
		Techs:     techs,
	}
}

func buildingCatalogColor(category model.BuildingCategory) string {
	switch category {
	case model.BuildingCategoryCollect:
		return "#48b589"
	case model.BuildingCategoryTransport:
		return "#3d8bfd"
	case model.BuildingCategoryStorage:
		return "#9b7b5c"
	case model.BuildingCategoryProduction:
		return "#f59f00"
	case model.BuildingCategoryChemical, model.BuildingCategoryRefining:
		return "#e8590c"
	case model.BuildingCategoryPower:
		return "#ffd43b"
	case model.BuildingCategoryPowerGrid:
		return "#74c0fc"
	case model.BuildingCategoryResearch:
		return "#9775fa"
	case model.BuildingCategoryLogisticsHub:
		return "#12b886"
	case model.BuildingCategoryDyson:
		return "#ff922b"
	case model.BuildingCategoryCommandSignal:
		return "#fa5252"
	default:
		return "#868e96"
	}
}

func itemCatalogColor(category model.ItemCategory, form model.ResourceForm, isRare bool) string {
	if isRare {
		return "#d6336c"
	}
	switch category {
	case model.ItemCategoryOre:
		return "#adb5bd"
	case model.ItemCategoryMaterial:
		return "#74c0fc"
	case model.ItemCategoryComponent:
		return "#ffd43b"
	case model.ItemCategoryFuel:
		return "#ff6b6b"
	case model.ItemCategoryMatrix:
		return "#748ffc"
	case model.ItemCategoryAmmo:
		return "#ff922b"
	case model.ItemCategoryContainer:
		return "#868e96"
	default:
		if form == model.ResourceLiquid {
			return "#339af0"
		}
		if form == model.ResourceGas {
			return "#63e6be"
		}
		return "#ced4da"
	}
}

func recipeCatalogColor(recipe model.RecipeDefinition) string {
	if len(recipe.Outputs) == 0 {
		return "#adb5bd"
	}
	outItem, ok := model.Item(recipe.Outputs[0].ItemID)
	if !ok {
		return "#adb5bd"
	}
	return itemCatalogColor(outItem.Category, outItem.Form, outItem.IsRare)
}

func techCatalogColor(techType model.TechType) string {
	switch techType {
	case model.TechTypeEnergy:
		return "#ffd43b"
	case model.TechTypeLogistics:
		return "#12b886"
	case model.TechTypeSmelting:
		return "#fab005"
	case model.TechTypeChemical:
		return "#fd7e14"
	case model.TechTypeCombat:
		return "#ff6b6b"
	case model.TechTypeMecha:
		return "#74c0fc"
	case model.TechTypeDyson:
		return "#ffa94d"
	default:
		return "#9775fa"
	}
}
