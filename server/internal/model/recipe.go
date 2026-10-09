package model

import (
	"sort"
	"sync"
)

// recipeOutputIndex 产出物品 → 配方列表（按配方 ID 排序）。供热路径
// （bot 备料）按物品取候选配方，避免每次遍历整张配方表。
var (
	recipeOutputIndexMu sync.RWMutex
	recipeOutputIndex   map[string][]RecipeDefinition
	recipeOutputIndexOK bool
)

// ensureRecipeOutputIndex 惰性重建产出索引；InstallGameData 会先置脏。
func ensureRecipeOutputIndex() {
	recipeOutputIndexMu.RLock()
	ok := recipeOutputIndexOK
	recipeOutputIndexMu.RUnlock()
	if ok {
		return
	}
	recipeOutputIndexMu.Lock()
	defer recipeOutputIndexMu.Unlock()
	if recipeOutputIndexOK {
		return
	}
	index := make(map[string][]RecipeDefinition, len(recipeCatalog))
	ids := make([]string, 0, len(recipeCatalog))
	for id := range recipeCatalog {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		def := recipeCatalog[id]
		for _, out := range def.Outputs {
			index[out.ItemID] = append(index[out.ItemID], def)
		}
	}
	recipeOutputIndex = index
	recipeOutputIndexOK = true
}

// markRecipeOutputIndexDirty 数据重装后置脏。
func markRecipeOutputIndexDirty() {
	recipeOutputIndexMu.Lock()
	recipeOutputIndexOK = false
	recipeOutputIndexMu.Unlock()
}

// RecipeDefinition captures a production recipe.
type RecipeDefinition struct {
	ID               string         `json:"id" yaml:"id"`
	Name             string         `json:"name" yaml:"name"`
	Inputs           []ItemAmount   `json:"inputs" yaml:"inputs"`
	Outputs          []ItemAmount   `json:"outputs" yaml:"outputs"`
	Byproducts       []ItemAmount   `json:"byproducts,omitempty" yaml:"byproducts,omitempty"`
	Duration         int            `json:"duration" yaml:"duration"`
	EnergyCost       int            `json:"energy_cost" yaml:"energy_cost,omitempty"`
	BuildingTypes    []BuildingType `json:"building_types" yaml:"building_types"`
	TechUnlock       []string       `json:"tech_unlock,omitempty" yaml:"tech_unlock,omitempty"`
	HandcraftAllowed bool           `json:"handcraft_allowed" yaml:"handcraft_allowed,omitempty"`
}

// AllOutputs returns the main outputs plus byproducts.
func (r RecipeDefinition) AllOutputs() []ItemAmount {
	if len(r.Byproducts) == 0 {
		return r.Outputs
	}
	outs := make([]ItemAmount, 0, len(r.Outputs)+len(r.Byproducts))
	outs = append(outs, r.Outputs...)
	outs = append(outs, r.Byproducts...)
	return outs
}

// Recipe returns a recipe definition by id.
func Recipe(id string) (RecipeDefinition, bool) {
	def, ok := recipeCatalog[id]
	return def, ok
}

// AllRecipes returns a copy of recipes for read-only usage.
func AllRecipes() []RecipeDefinition {
	recipes := make([]RecipeDefinition, 0, len(recipeCatalog))
	for _, def := range recipeCatalog {
		recipes = append(recipes, def)
	}
	return recipes
}

// RecipesProducingItem 返回产出 item 的候选配方（按配方 ID 排序）。
// 供热路径（bot 备料）O(1) 查询，避免每次遍历整张配方表并排序。
func RecipesProducingItem(item string) []RecipeDefinition {
	ensureRecipeOutputIndex()
	recipeOutputIndexMu.RLock()
	defer recipeOutputIndexMu.RUnlock()
	return recipeOutputIndex[item]
}
