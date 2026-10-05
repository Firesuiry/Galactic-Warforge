package gamecore

import (
	"math"

	"siliconworld/internal/model"
)

func buildDemandRemaining(ws *model.WorldState, stationBuildings map[string]*model.Building, worlds map[string]*model.WorldState) map[string]map[string]int {
	if ws == nil {
		return nil
	}
	reserved := reservedLogisticsDemand(worlds)

	cfg := model.CurrentLogisticsSchedulingConfig()
	remaining := make(map[string]map[string]int)
	for stationID, station := range ws.LogisticsStations {
		if station == nil || stationBuildings[stationID] == nil {
			continue
		}
		for itemID, setting := range station.Settings {
			if !setting.Mode.DemandEnabled() {
				continue
			}
			local := setting.LocalStorage
			if local < 0 {
				local = 0
			}
			stored := 0
			if station.Inventory != nil {
				stored = station.Inventory[itemID]
			}
			base := local - stored
			if base < 0 {
				base = 0
			}
			predicted, oversupply := forecastDemand(base, local, cfg)
			total := predicted + oversupply
			if total <= 0 {
				continue
			}
			reservedQty := 0
			if byItem := reserved[interstellarStationKey(ws.PlanetID, stationID)]; byItem != nil {
				reservedQty = byItem[itemID]
			}
			available := min(total, station.AvailableItemCapacity(itemID)) - reservedQty
			if available <= 0 {
				continue
			}
			if remaining[stationID] == nil {
				remaining[stationID] = make(map[string]int)
			}
			remaining[stationID][itemID] = available
		}
	}
	return remaining
}

func forecastDemand(base, local int, cfg model.LogisticsSchedulingConfig) (int, int) {
	if base < 0 {
		base = 0
	}
	if local < 0 {
		local = 0
	}
	multiplier := cfg.DemandForecastMultiplier
	if multiplier < 1 {
		multiplier = 1
	}
	forecast := int(math.Ceil(float64(base) * multiplier))
	ratio := cfg.OversupplyRatio
	if ratio < 0 {
		ratio = 0
	}
	oversupply := int(math.Ceil(float64(local) * ratio))
	if cfg.OversupplyMax > 0 && oversupply > cfg.OversupplyMax {
		oversupply = cfg.OversupplyMax
	}
	if oversupply < 0 {
		oversupply = 0
	}
	if forecast < 0 {
		forecast = 0
	}
	return forecast, oversupply
}

func betterCostPerUnit(costA, qtyA, costB, qtyB int) bool {
	if qtyA <= 0 {
		return false
	}
	if qtyB <= 0 {
		return true
	}
	left := int64(costA) * int64(qtyB)
	right := int64(costB) * int64(qtyA)
	return left < right
}
