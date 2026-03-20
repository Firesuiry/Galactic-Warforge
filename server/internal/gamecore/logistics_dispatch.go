package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type logisticsDispatchCandidate struct {
	itemID         string
	targetID       string
	qty            int
	distance       int
	travelTicks    int
	routeCost      int
	targetPriority int
}

func settleLogisticsDispatch(ws *model.WorldState) {
	if ws == nil || len(ws.LogisticsDrones) == 0 || len(ws.LogisticsStations) == 0 {
		return
	}

	stationBuildings := make(map[string]*model.Building)
	for id, building := range ws.Buildings {
		if building == nil || !model.IsLogisticsStationBuilding(building.Type) || building.LogisticsStation == nil {
			continue
		}
		stationBuildings[id] = building
	}
	if len(stationBuildings) == 0 {
		return
	}

	for id := range stationBuildings {
		if station := ws.LogisticsStations[id]; station != nil {
			station.RefreshCapacityCache()
		}
	}

	demandRemaining, demandForecast := buildDemandRemaining(ws, stationBuildings)
	if len(demandRemaining) == 0 {
		return
	}

	stationDrones := make(map[string][]*model.LogisticsDroneState)
	for _, drone := range ws.LogisticsDrones {
		if drone == nil || drone.Status != model.LogisticsDroneIdle {
			continue
		}
		if drone.CargoQty() > 0 {
			continue
		}
		if stationBuildings[drone.StationID] == nil {
			continue
		}
		stationDrones[drone.StationID] = append(stationDrones[drone.StationID], drone)
	}
	if len(stationDrones) == 0 {
		return
	}

	originIDs := make([]string, 0, len(stationDrones))
	for id := range stationDrones {
		originIDs = append(originIDs, id)
	}
	sort.Slice(originIDs, func(i, j int) bool {
		pi := stationOutputPriority(ws.LogisticsStations[originIDs[i]])
		pj := stationOutputPriority(ws.LogisticsStations[originIDs[j]])
		if pi != pj {
			return pi > pj
		}
		return originIDs[i] < originIDs[j]
	})

	for _, originID := range originIDs {
		originStation := ws.LogisticsStations[originID]
		originBuilding := stationBuildings[originID]
		if originStation == nil || originBuilding == nil {
			continue
		}
		drones := stationDrones[originID]
		sort.Slice(drones, func(i, j int) bool { return drones[i].ID < drones[j].ID })

		for _, drone := range drones {
			if drone == nil {
				continue
			}
			drone.Normalize()
			originStation.RefreshCapacityCache()
			if len(originStation.Cache.Supply) == 0 || len(demandRemaining) == 0 {
				continue
			}
			candidate := selectDispatchCandidate(originID, originBuilding, originStation, demandRemaining, stationBuildings, ws.LogisticsStations, drone)
			if candidate == nil || candidate.qty <= 0 {
				continue
			}

			drone.Position = originBuilding.Position
			accepted, _, err := drone.Load(candidate.itemID, candidate.qty)
			if err != nil || accepted <= 0 {
				drone.Cargo = nil
				continue
			}
			if accepted < candidate.qty {
				candidate.qty = accepted
			}

			if originStation.Inventory == nil {
				originStation.Inventory = make(model.ItemInventory)
			}
			originStation.Inventory[candidate.itemID] -= accepted
			if originStation.Inventory[candidate.itemID] <= 0 {
				delete(originStation.Inventory, candidate.itemID)
			}
			originStation.RefreshCapacityCache()

			targetBuilding := stationBuildings[candidate.targetID]
			if targetBuilding == nil {
				restoreStationInventory(originStation, candidate.itemID, accepted)
				drone.Cargo = nil
				continue
			}
			if err := drone.BeginTrip(candidate.targetID, targetBuilding.Position); err != nil {
				restoreStationInventory(originStation, candidate.itemID, accepted)
				drone.Cargo = nil
				continue
			}
			consumeDemandRemaining(demandRemaining, candidate.targetID, candidate.itemID, accepted)
			recordDispatchObservation(ws, model.LogisticsSchedulingPlanetary, originID, candidate, demandForecast)
		}
	}
}

func selectDispatchCandidate(originID string, originBuilding *model.Building, originStation *model.LogisticsStationState, demandRemaining map[string]map[string]int, stationBuildings map[string]*model.Building, stations map[string]*model.LogisticsStationState, drone *model.LogisticsDroneState) *logisticsDispatchCandidate {
	if originBuilding == nil || originStation == nil || len(originStation.Cache.Supply) == 0 {
		return nil
	}
	if drone == nil {
		return nil
	}
	drone.Normalize()
	cfg := model.CurrentLogisticsSchedulingConfig()
	droneCapacity := drone.Capacity
	if droneCapacity <= 0 {
		droneCapacity = model.DefaultLogisticsDroneCapacity
	}
	var best *logisticsDispatchCandidate
	for _, itemID := range sortedSupplyKeys(originStation.Cache.Supply) {
		supplyQty := originStation.Cache.Supply[itemID]
		if supplyQty <= 0 {
			continue
		}
		for targetID, demandByItem := range demandRemaining {
			if targetID == originID || demandByItem == nil {
				continue
			}
			demandQty := demandByItem[itemID]
			if demandQty <= 0 {
				continue
			}
			targetBuilding := stationBuildings[targetID]
			if targetBuilding == nil || targetBuilding.OwnerID != originBuilding.OwnerID {
				continue
			}
			targetStation := stations[targetID]
			if targetStation == nil {
				continue
			}
			qty := minInt(minInt(droneCapacity, supplyQty), demandQty)
			if qty <= 0 {
				continue
			}
			distance := model.ManhattanDist(originBuilding.Position, targetBuilding.Position)
			travelTicks := model.LogisticsDroneTravelTicks(distance, drone.Speed)
			candidate := logisticsDispatchCandidate{
				itemID:         itemID,
				targetID:       targetID,
				qty:            qty,
				distance:       distance,
				travelTicks:    travelTicks,
				routeCost:      travelTicks,
				targetPriority: stationInputPriority(targetStation),
			}
			if betterDispatchCandidate(&candidate, best, cfg.PlanetaryStrategy) {
				copyCandidate := candidate
				best = &copyCandidate
			}
		}
	}
	return best
}

func betterDispatchCandidate(next *logisticsDispatchCandidate, current *logisticsDispatchCandidate, strategy model.LogisticsSchedulingStrategy) bool {
	if next == nil {
		return false
	}
	if current == nil {
		return true
	}
	if next.targetPriority != current.targetPriority {
		return next.targetPriority > current.targetPriority
	}
	switch strategy {
	case model.LogisticsSchedulingStrategyLowestCost:
		if betterCostPerUnit(next.routeCost, next.qty, current.routeCost, current.qty) {
			return true
		}
		if betterCostPerUnit(current.routeCost, current.qty, next.routeCost, next.qty) {
			return false
		}
		if next.distance != current.distance {
			return next.distance < current.distance
		}
	default:
		if next.distance != current.distance {
			return next.distance < current.distance
		}
		if next.routeCost != current.routeCost {
			return next.routeCost < current.routeCost
		}
	}
	if next.qty != current.qty {
		return next.qty > current.qty
	}
	if next.targetID != current.targetID {
		return next.targetID < current.targetID
	}
	return next.itemID < current.itemID
}

func consumeDemandRemaining(demandRemaining map[string]map[string]int, stationID, itemID string, qty int) {
	if qty <= 0 || stationID == "" || itemID == "" {
		return
	}
	byItem := demandRemaining[stationID]
	if byItem == nil {
		return
	}
	remaining := byItem[itemID] - qty
	if remaining > 0 {
		byItem[itemID] = remaining
		return
	}
	delete(byItem, itemID)
	if len(byItem) == 0 {
		delete(demandRemaining, stationID)
	}
}

func sortedSupplyKeys(supply model.ItemInventory) []string {
	if len(supply) == 0 {
		return nil
	}
	type supplyEntry struct {
		itemID string
		qty    int
	}
	entries := make([]supplyEntry, 0, len(supply))
	for itemID, qty := range supply {
		if qty <= 0 {
			continue
		}
		entries = append(entries, supplyEntry{itemID: itemID, qty: qty})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].qty != entries[j].qty {
			return entries[i].qty > entries[j].qty
		}
		return entries[i].itemID < entries[j].itemID
	})
	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, entry.itemID)
	}
	return keys
}

func restoreStationInventory(station *model.LogisticsStationState, itemID string, qty int) {
	if station == nil || itemID == "" || qty <= 0 {
		return
	}
	if station.Inventory == nil {
		station.Inventory = make(model.ItemInventory)
	}
	station.Inventory[itemID] += qty
	station.RefreshCapacityCache()
}

func stationInputPriority(station *model.LogisticsStationState) int {
	if station == nil {
		return 1
	}
	return station.InputPriorityValue()
}

func stationOutputPriority(station *model.LogisticsStationState) int {
	if station == nil {
		return 1
	}
	return station.OutputPriorityValue()
}
