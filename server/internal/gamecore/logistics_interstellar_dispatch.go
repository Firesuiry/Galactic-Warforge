package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type interstellarDispatchCandidate struct {
	itemID         string
	targetID       string
	qty            int
	distance       int
	travelTicks    int
	energyCost     int
	routeCost      int
	targetPriority int
	warped         bool
	warpItemID     string
	warpItemCost   int
}

type interstellarTripPlan struct {
	warped       bool
	travelTicks  int
	energyCost   int
	routeCost    int
	warpItemID   string
	warpItemCost int
}

func settleInterstellarDispatch(ws *model.WorldState) {
	if ws == nil || len(ws.LogisticsShips) == 0 || len(ws.LogisticsStations) == 0 {
		return
	}

	stationBuildings := make(map[string]*model.Building)
	for id, building := range ws.Buildings {
		if building == nil || !model.IsInterstellarLogisticsBuilding(building.Type) || building.LogisticsStation == nil {
			continue
		}
		if !building.LogisticsStation.Interstellar.Enabled {
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

	demandRemaining, demandForecast := buildInterstellarDemandRemaining(ws, stationBuildings)
	if len(demandRemaining) == 0 {
		return
	}

	stationShips := make(map[string][]*model.LogisticsShipState)
	for _, ship := range ws.LogisticsShips {
		if ship == nil || ship.Status != model.LogisticsShipIdle {
			continue
		}
		if ship.CargoQty() > 0 {
			continue
		}
		if stationBuildings[ship.StationID] == nil {
			continue
		}
		stationShips[ship.StationID] = append(stationShips[ship.StationID], ship)
	}
	if len(stationShips) == 0 {
		return
	}

	originIDs := make([]string, 0, len(stationShips))
	for id := range stationShips {
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
		ships := stationShips[originID]
		sort.Slice(ships, func(i, j int) bool { return ships[i].ID < ships[j].ID })

		for _, ship := range ships {
			if ship == nil {
				continue
			}
			ship.Normalize()
			originStation.RefreshCapacityCache()
			if len(originStation.InterstellarCache.Supply) == 0 || len(demandRemaining) == 0 {
				continue
			}
			candidate := selectInterstellarDispatchCandidate(originID, originBuilding, originStation, demandRemaining, stationBuildings, ws.LogisticsStations, ship)
			if candidate == nil || candidate.qty <= 0 {
				continue
			}

			ship.Position = originBuilding.Position
			accepted, _, err := ship.Load(candidate.itemID, candidate.qty)
			if err != nil || accepted <= 0 {
				ship.Cargo = nil
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

			if candidate.warped && candidate.warpItemCost > 0 {
				if !consumeWarpItem(originStation, candidate.warpItemID, candidate.warpItemCost) {
					restoreStationInventory(originStation, candidate.itemID, accepted)
					ship.Cargo = nil
					continue
				}
			}
			originStation.RefreshCapacityCache()

			targetBuilding := stationBuildings[candidate.targetID]
			if targetBuilding == nil {
				restoreStationInventory(originStation, candidate.itemID, accepted)
				ship.Cargo = nil
				continue
			}
			if err := ship.BeginTrip(candidate.targetID, targetBuilding.Position, candidate.distance, candidate.warped); err != nil {
				restoreStationInventory(originStation, candidate.itemID, accepted)
				ship.Cargo = nil
				continue
			}
			consumeDemandRemaining(demandRemaining, candidate.targetID, candidate.itemID, accepted)
			recordInterstellarDispatchObservation(ws, originID, candidate, demandForecast)
		}
	}
}

func selectInterstellarDispatchCandidate(originID string, originBuilding *model.Building, originStation *model.LogisticsStationState, demandRemaining map[string]map[string]int, stationBuildings map[string]*model.Building, stations map[string]*model.LogisticsStationState, ship *model.LogisticsShipState) *interstellarDispatchCandidate {
	if originBuilding == nil || originStation == nil || ship == nil || len(originStation.InterstellarCache.Supply) == 0 {
		return nil
	}
	ship.Normalize()
	cfg := model.CurrentLogisticsSchedulingConfig()
	var best *interstellarDispatchCandidate
	for _, itemID := range sortedSupplyKeys(originStation.InterstellarCache.Supply) {
		supplyQty := originStation.InterstellarCache.Supply[itemID]
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
			if targetStation == nil || !targetStation.Interstellar.Enabled {
				continue
			}
			qty := minInt(minInt(ship.Capacity, supplyQty), demandQty)
			if qty <= 0 {
				continue
			}
			distance := model.ManhattanDist(originBuilding.Position, targetBuilding.Position)
			plan := planInterstellarTrip(distance, ship, originStation)
			candidate := interstellarDispatchCandidate{
				itemID:         itemID,
				targetID:       targetID,
				qty:            qty,
				distance:       distance,
				travelTicks:    plan.travelTicks,
				energyCost:     plan.energyCost,
				routeCost:      plan.routeCost,
				targetPriority: stationInputPriority(targetStation),
				warped:         plan.warped,
				warpItemID:     plan.warpItemID,
				warpItemCost:   plan.warpItemCost,
			}
			if betterInterstellarCandidate(&candidate, best, cfg.InterstellarStrategy) {
				copyCandidate := candidate
				best = &copyCandidate
			}
		}
	}
	return best
}

func planInterstellarTrip(distance int, ship *model.LogisticsShipState, station *model.LogisticsStationState) interstellarTripPlan {
	ship.Normalize()
	baseSpeed := ship.Speed
	baseTicks := model.LogisticsShipTravelTicks(distance, baseSpeed)
	baseEnergy := model.LogisticsShipEnergyCost(distance, ship.EnergyPerDistance, ship.WarpEnergyMultiplier, false)
	baseCost := baseEnergy + baseTicks
	plan := interstellarTripPlan{
		warped:       false,
		travelTicks:  baseTicks,
		energyCost:   baseEnergy,
		routeCost:    baseCost,
		warpItemID:   ship.WarpItemID,
		warpItemCost: 0,
	}

	warpItemCost := ship.WarpItemCost
	warpItemID := ship.WarpItemID
	warpAllowed := ship.WarpEnabled && station != nil && station.Interstellar.WarpEnabled && distance >= station.WarpDistanceValue()
	if warpAllowed && warpItemCost > 0 {
		available := 0
		if station != nil && station.Inventory != nil {
			available = station.Inventory[warpItemID]
		}
		if available < warpItemCost {
			warpAllowed = false
		}
	}

	if warpAllowed {
		warpSpeed := ship.WarpSpeed
		warpTicks := model.LogisticsShipTravelTicks(distance, warpSpeed)
		warpEnergy := model.LogisticsShipEnergyCost(distance, ship.EnergyPerDistance, ship.WarpEnergyMultiplier, true)
		warpCost := warpEnergy + warpTicks
		if warpCost < baseCost || (warpCost == baseCost && warpTicks < baseTicks) {
			plan = interstellarTripPlan{
				warped:       true,
				travelTicks:  warpTicks,
				energyCost:   warpEnergy,
				routeCost:    warpCost,
				warpItemID:   warpItemID,
				warpItemCost: warpItemCost,
			}
		}
	}
	return plan
}

func betterInterstellarCandidate(next *interstellarDispatchCandidate, current *interstellarDispatchCandidate, strategy model.LogisticsSchedulingStrategy) bool {
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
		nextCost := next.routeCost + next.warpItemCost
		currentCost := current.routeCost + current.warpItemCost
		if betterCostPerUnit(nextCost, next.qty, currentCost, current.qty) {
			return true
		}
		if betterCostPerUnit(currentCost, current.qty, nextCost, next.qty) {
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

func consumeWarpItem(station *model.LogisticsStationState, warpItemID string, qty int) bool {
	if station == nil || warpItemID == "" || qty <= 0 {
		return false
	}
	if station.Inventory == nil {
		return false
	}
	available := station.Inventory[warpItemID]
	if available < qty {
		return false
	}
	station.Inventory[warpItemID] = available - qty
	if station.Inventory[warpItemID] <= 0 {
		delete(station.Inventory, warpItemID)
	}
	return true
}
