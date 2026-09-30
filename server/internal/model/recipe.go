package model

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
