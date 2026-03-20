package gamecore

import (
	"math"

	"siliconworld/internal/model"
)

type demandForecast struct {
	base       int
	forecast   int
	oversupply int
}

func buildDemandRemaining(ws *model.WorldState, stationBuildings map[string]*model.Building) (map[string]map[string]int, map[string]map[string]demandForecast) {
	if ws == nil {
		return nil, nil
	}
	reserved := make(map[string]map[string]int)
	for _, drone := range ws.LogisticsDrones {
		if drone == nil || drone.Status == model.LogisticsDroneIdle || drone.TargetStationID == "" || len(drone.Cargo) == 0 {
			continue
		}
		if stationBuildings[drone.TargetStationID] == nil {
			continue
		}
		for itemID, qty := range drone.Cargo {
			if qty <= 0 {
				continue
			}
			if reserved[drone.TargetStationID] == nil {
				reserved[drone.TargetStationID] = make(map[string]int)
			}
			reserved[drone.TargetStationID][itemID] += qty
		}
	}

	cfg := model.CurrentLogisticsSchedulingConfig()
	remaining := make(map[string]map[string]int)
	forecast := make(map[string]map[string]demandForecast)
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
			if byItem := reserved[stationID]; byItem != nil {
				reservedQty = byItem[itemID]
			}
			available := total - reservedQty
			if available <= 0 {
				continue
			}
			if remaining[stationID] == nil {
				remaining[stationID] = make(map[string]int)
			}
			if forecast[stationID] == nil {
				forecast[stationID] = make(map[string]demandForecast)
			}
			remaining[stationID][itemID] = available
			forecast[stationID][itemID] = demandForecast{
				base:       base,
				forecast:   predicted,
				oversupply: oversupply,
			}
		}
	}
	return remaining, forecast
}

func buildInterstellarDemandRemaining(ws *model.WorldState, stationBuildings map[string]*model.Building) (map[string]map[string]int, map[string]map[string]demandForecast) {
	if ws == nil {
		return nil, nil
	}
	reserved := make(map[string]map[string]int)
	for _, ship := range ws.LogisticsShips {
		if ship == nil || ship.Status == model.LogisticsShipIdle || ship.TargetStationID == "" || len(ship.Cargo) == 0 {
			continue
		}
		if stationBuildings[ship.TargetStationID] == nil {
			continue
		}
		for itemID, qty := range ship.Cargo {
			if qty <= 0 {
				continue
			}
			if reserved[ship.TargetStationID] == nil {
				reserved[ship.TargetStationID] = make(map[string]int)
			}
			reserved[ship.TargetStationID][itemID] += qty
		}
	}

	cfg := model.CurrentLogisticsSchedulingConfig()
	remaining := make(map[string]map[string]int)
	forecast := make(map[string]map[string]demandForecast)
	for stationID, station := range ws.LogisticsStations {
		if station == nil || stationBuildings[stationID] == nil {
			continue
		}
		if !station.Interstellar.Enabled {
			continue
		}
		for itemID, setting := range station.InterstellarSettings {
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
			if byItem := reserved[stationID]; byItem != nil {
				reservedQty = byItem[itemID]
			}
			available := total - reservedQty
			if available <= 0 {
				continue
			}
			if remaining[stationID] == nil {
				remaining[stationID] = make(map[string]int)
			}
			if forecast[stationID] == nil {
				forecast[stationID] = make(map[string]demandForecast)
			}
			remaining[stationID][itemID] = available
			forecast[stationID][itemID] = demandForecast{
				base:       base,
				forecast:   predicted,
				oversupply: oversupply,
			}
		}
	}
	return remaining, forecast
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

func recordDispatchObservation(ws *model.WorldState, mode model.LogisticsSchedulingMode, originID string, candidate *logisticsDispatchCandidate, forecast map[string]map[string]demandForecast) {
	if ws == nil || candidate == nil {
		return
	}
	cfg := model.CurrentLogisticsSchedulingConfig()
	strategy := cfg.PlanetaryStrategy
	if mode == model.LogisticsSchedulingInterstellar {
		strategy = cfg.InterstellarStrategy
	}
	base, predicted, oversupply := lookupDemandForecast(forecast, candidate.targetID, candidate.itemID)
	model.RecordLogisticsSchedulingObservation(model.LogisticsSchedulingObservation{
		Tick:             ws.Tick,
		Mode:             mode,
		Strategy:         strategy,
		OriginID:         originID,
		TargetID:         candidate.targetID,
		ItemID:           candidate.itemID,
		Quantity:         candidate.qty,
		Distance:         candidate.distance,
		TravelTicks:      candidate.travelTicks,
		RouteCost:        candidate.routeCost,
		DemandBase:       base,
		DemandForecast:   predicted,
		OversupplyBuffer: oversupply,
	})
}

func recordInterstellarDispatchObservation(ws *model.WorldState, originID string, candidate *interstellarDispatchCandidate, forecast map[string]map[string]demandForecast) {
	if ws == nil || candidate == nil {
		return
	}
	cfg := model.CurrentLogisticsSchedulingConfig()
	base, predicted, oversupply := lookupDemandForecast(forecast, candidate.targetID, candidate.itemID)
	model.RecordLogisticsSchedulingObservation(model.LogisticsSchedulingObservation{
		Tick:             ws.Tick,
		Mode:             model.LogisticsSchedulingInterstellar,
		Strategy:         cfg.InterstellarStrategy,
		OriginID:         originID,
		TargetID:         candidate.targetID,
		ItemID:           candidate.itemID,
		Quantity:         candidate.qty,
		Distance:         candidate.distance,
		TravelTicks:      candidate.travelTicks,
		RouteCost:        candidate.routeCost,
		WarpItemCost:     candidate.warpItemCost,
		DemandBase:       base,
		DemandForecast:   predicted,
		OversupplyBuffer: oversupply,
	})
}

func lookupDemandForecast(forecast map[string]map[string]demandForecast, stationID, itemID string) (int, int, int) {
	if forecast == nil || stationID == "" || itemID == "" {
		return 0, 0, 0
	}
	if byItem := forecast[stationID]; byItem != nil {
		if entry, ok := byItem[itemID]; ok {
			return entry.base, entry.forecast, entry.oversupply
		}
	}
	return 0, 0, 0
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
