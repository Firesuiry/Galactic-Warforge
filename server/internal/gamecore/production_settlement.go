package gamecore

import (
	"math"

	"siliconworld/internal/model"
)

func settleProduction(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}

	snapshot := model.CurrentProductionSettlementSnapshot(ws)
	if snapshot == nil {
		snapshot = model.NewProductionSettlementSnapshot(ws.Tick)
		ws.ProductionSnapshot = snapshot
	}

	var powerSnapshot *model.PowerSettlementSnapshot
	var events []*model.GameEvent
	for _, building := range ws.Buildings {
		if building == nil || building.Runtime.Functions.Production == nil || building.Storage == nil {
			continue
		}
		model.InitBuildingProduction(building)
		if building.Production == nil || building.Production.RecipeID == "" {
			continue
		}
		if building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		powerRatio := 1.0
		if model.PowerDemandForBuilding(building) > 0 {
			if powerSnapshot == nil {
				powerSnapshot = model.CurrentPowerSettlementSnapshot(ws)
			}
			allocation, ok := powerSnapshot.Allocations.Buildings[building.ID]
			if !ok || allocation.Allocated <= 0 || allocation.Ratio <= 0 {
				continue
			}
			powerRatio = min(1.0, allocation.Ratio)
		}

		state := building.Production
		if state.RemainingTicks > 0 {
			state.ProgressFraction += powerRatio
			// A tiny tolerance prevents repeating fractions (e.g. 20/24)
			// from losing a whole tick at an exact cycle boundary.
			completed := int(math.Floor(state.ProgressFraction + 1e-9))
			state.RemainingTicks -= completed
			state.ProgressFraction = math.Max(0, state.ProgressFraction-float64(completed))
			if state.RemainingTicks > 0 {
				continue
			}
			state.ProgressFraction = 0
		}

		if len(state.PendingOutputs) > 0 || len(state.PendingByproducts) > 0 {
			combinedOutputs := combineItemAmounts(state.PendingOutputs, state.PendingByproducts)
			if !storeProductionOutputs(building, combinedOutputs) {
				continue
			}
			snapshot.RecordBuildingOutputs(building, combinedOutputs)
			events = append(events, &model.GameEvent{
				EventType:       model.EvtResourceChanged,
				VisibilityScope: building.OwnerID,
				Payload: map[string]any{
					"building_id": building.ID,
					"recipe_id":   state.RecipeID,
					"outputs":     combinedOutputs,
				},
			})
			state.PendingOutputs = nil
			state.PendingByproducts = nil
			continue
		}

		recipe, ok := model.Recipe(state.RecipeID)
		if !ok {
			state.RecipeID = ""
			state.ProgressFraction = 0
			continue
		}
		inputs, ok := collectRecipeInputs(building.Storage, recipe)
		if !ok {
			continue
		}

		result, err := model.ResolveProductionCycle(model.ProductionCycleRequest{
			Recipe:       recipe,
			BuildingType: building.Type,
			Runtime:      building.Runtime,
			Mode:         state.Mode,
			Inputs:       inputs,
		})
		if err != nil {
			continue
		}

		consumeRecipeInputs(building.Storage, recipe)
		state.RemainingTicks = max(1, result.Bonus.Duration)
		state.ProgressFraction = 0
		state.PendingOutputs = cloneItemAmounts(result.Bonus.Outputs)
		state.PendingByproducts = cloneItemAmounts(result.Bonus.Byproducts)
	}

	return events
}

func combineItemAmounts(groups ...[]model.ItemAmount) []model.ItemAmount {
	total := 0
	for _, group := range groups {
		total += len(group)
	}
	if total == 0 {
		return nil
	}
	combined := make([]model.ItemAmount, 0, total)
	for _, group := range groups {
		combined = append(combined, cloneItemAmounts(group)...)
	}
	return combined
}

func collectRecipeInputs(storage *model.StorageState, recipe model.RecipeDefinition) ([]model.ItemStack, bool) {
	if storage == nil {
		return nil, false
	}
	inputs := make([]model.ItemStack, 0, len(recipe.Inputs))
	for _, required := range recipe.Inputs {
		if availableStorageItem(storage, required.ItemID) < required.Quantity {
			return nil, false
		}
		inputs = append(inputs, model.ItemStack{ItemID: required.ItemID, Quantity: required.Quantity})
	}
	return inputs, true
}

func consumeRecipeInputs(storage *model.StorageState, recipe model.RecipeDefinition) {
	if storage == nil {
		return
	}
	for _, required := range recipe.Inputs {
		removed := removeStorageItem(storage.InputBuffer, required.ItemID, required.Quantity)
		remaining := required.Quantity - removed
		if remaining > 0 {
			removeStorageItem(storage.Inventory, required.ItemID, remaining)
		}
	}
}

// Commit the entire batch atomically. Feedback outputs are separate from the
// unprocessed seed stock and can leave only after the production cycle completes.
func storeProductionOutputs(building *model.Building, outputs []model.ItemAmount) bool {
	if building == nil || building.Storage == nil {
		return false
	}
	simulated := building.Storage.Clone()
	for _, output := range outputs {
		var accepted, remaining int
		var err error
		if building.IsFeedbackItem(output.ItemID) {
			accepted, remaining, err = simulated.ReceiveOutput(output.ItemID, output.Quantity)
		} else {
			accepted, remaining, err = simulated.Receive(output.ItemID, output.Quantity)
		}
		if err != nil || accepted != output.Quantity || remaining != 0 {
			return false
		}
	}
	*building.Storage = *simulated
	return true
}

func availableStorageItem(storage *model.StorageState, itemID string) int {
	if storage == nil || itemID == "" {
		return 0
	}
	return currentStorageItem(storage.InputBuffer, itemID) + currentStorageItem(storage.Inventory, itemID)
}

func currentStorageItem(inv model.ItemInventory, itemID string) int {
	if inv == nil || itemID == "" {
		return 0
	}
	return inv[itemID]
}

func removeStorageItem(inv model.ItemInventory, itemID string, qty int) int {
	if inv == nil || itemID == "" || qty <= 0 {
		return 0
	}
	available := inv[itemID]
	if available <= 0 {
		return 0
	}
	take := minInt(available, qty)
	inv[itemID] -= take
	if inv[itemID] <= 0 {
		delete(inv, itemID)
	}
	return take
}

func cloneItemAmounts(items []model.ItemAmount) []model.ItemAmount {
	if len(items) == 0 {
		return nil
	}
	out := make([]model.ItemAmount, len(items))
	copy(out, items)
	return out
}
