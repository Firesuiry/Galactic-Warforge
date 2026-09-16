package model

import (
	"fmt"
	"math"
)

// IsFeedbackItem identifies a recipe material that is both consumed and produced.
// Its input stock must not be exported before it has been processed.
func (building *Building) IsFeedbackItem(itemID string) bool {
	if building == nil || building.Production == nil {
		return false
	}
	recipe, ok := Recipe(building.Production.RecipeID)
	if !ok {
		return false
	}
	input := false
	for _, item := range recipe.Inputs {
		if item.ItemID == itemID {
			input = true
			break
		}
	}
	if !input {
		return false
	}
	for _, item := range recipe.AllOutputs() {
		if item.ItemID == itemID {
			return true
		}
	}
	return false
}

// ExportableItemQuantity excludes unprocessed feedback inputs from belt/pipe output.
func (building *Building) ExportableItemQuantity(itemID string) int {
	if building == nil || building.Storage == nil {
		return 0
	}
	if building.IsFeedbackItem(itemID) {
		return building.Storage.OutputBuffer[itemID]
	}
	return building.Storage.OutputQuantity(itemID)
}

// ProductionState tracks the active recipe and the in-flight production cycle.
type ProductionState struct {
	RecipeID       string    `json:"recipe_id,omitempty"`
	Mode           BonusMode `json:"mode,omitempty"`
	RemainingTicks int       `json:"remaining_ticks,omitempty"`
	// ProgressFraction is completed work toward the next remaining tick.
	// It survives power changes and saves, and stays in [0, 1).
	ProgressFraction  float64      `json:"progress_fraction,omitempty"`
	PendingOutputs    []ItemAmount `json:"pending_outputs,omitempty"`
	PendingByproducts []ItemAmount `json:"pending_byproducts,omitempty"`
}

func (p *ProductionState) Validate() error {
	if p == nil {
		return fmt.Errorf("production state required")
	}
	if p.RemainingTicks < 0 || math.IsNaN(p.ProgressFraction) || math.IsInf(p.ProgressFraction, 0) || p.ProgressFraction < 0 || p.ProgressFraction >= 1 {
		return fmt.Errorf("invalid production progress")
	}
	if p.RemainingTicks == 0 && p.ProgressFraction != 0 {
		return fmt.Errorf("production fraction requires remaining work")
	}
	return nil
}

// Clone returns a deep copy of the production state.
func (p *ProductionState) Clone() *ProductionState {
	if p == nil {
		return nil
	}
	out := *p
	out.PendingOutputs = append([]ItemAmount(nil), p.PendingOutputs...)
	out.PendingByproducts = append([]ItemAmount(nil), p.PendingByproducts...)
	return &out
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
		building.Production.ProgressFraction = 0
		building.Production.PendingOutputs = nil
		building.Production.PendingByproducts = nil
	}
}
