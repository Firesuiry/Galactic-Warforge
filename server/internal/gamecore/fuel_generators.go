package gamecore

import (
	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
)

func fuelBasedGeneratorHasReachableFuel(building *model.Building) bool {
	if building == nil {
		return false
	}
	module := building.Runtime.Functions.Energy
	if module == nil || !modelpower.IsFuelBasedPowerSource(module.SourceKind) {
		return false
	}
	storage := building.Storage
	if storage == nil {
		return false
	}
	for _, rule := range module.FuelRules {
		if rule.ItemID == "" || rule.ConsumePerTick <= 0 {
			continue
		}
		if reachableFuelQuantity(storage, rule.ItemID) >= rule.ConsumePerTick {
			return true
		}
	}
	return false
}

func reachableFuelQuantity(storage *model.StorageState, itemID string) int {
	if storage == nil || itemID == "" {
		return 0
	}
	total := 0
	if storage.InputBuffer != nil {
		total += storage.InputBuffer[itemID]
	}
	if storage.Inventory != nil {
		total += storage.Inventory[itemID]
	}
	return total
}
