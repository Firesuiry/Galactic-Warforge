package model

// ProductionState tracks the active recipe and the in-flight production cycle.
type ProductionState struct {
	RecipeID          string       `json:"recipe_id,omitempty"`
	Mode              BonusMode    `json:"mode,omitempty"`
	RemainingTicks    int          `json:"remaining_ticks,omitempty"`
	PendingOutputs    []ItemAmount `json:"pending_outputs,omitempty"`
	PendingByproducts []ItemAmount `json:"pending_byproducts,omitempty"`
}

// InitBuildingProduction ensures a building has initialized production state when applicable.
func InitBuildingProduction(building *Building) {
	if building == nil {
		return
	}
	if building.Runtime.Functions.Production == nil {
		building.Production = nil
		return
	}
	if building.Production == nil {
		building.Production = &ProductionState{}
	}
	if building.Production.Mode == "" {
		building.Production.Mode = CurrentProductionBonusConfig().DefaultMode
		if building.Production.Mode == "" {
			building.Production.Mode = BonusModeSpeed
		}
	}
}

// SyncBuildingProduction reconciles production state after runtime changes.
func SyncBuildingProduction(building *Building) {
	InitBuildingProduction(building)
	if building == nil || building.Production == nil || building.Production.RecipeID == "" {
		return
	}
	recipe, ok := Recipe(building.Production.RecipeID)
	if !ok || !recipeAllowsBuilding(recipe, building.Type) {
		building.Production.RecipeID = ""
		building.Production.RemainingTicks = 0
		building.Production.PendingOutputs = nil
		building.Production.PendingByproducts = nil
	}
}
