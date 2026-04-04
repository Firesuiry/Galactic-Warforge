package gamecore

import (
	"math"
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

type interstellarDispatchCandidate struct {
	itemID          string
	targetID        string
	targetPlanetID  string
	targetStationID string
	qty             int
	distance        int
	travelTicks     int
	energyCost      int
	routeCost       int
	targetPriority  int
	warped          bool
	warpItemID      string
	warpItemCost    int
}

type interstellarTripPlan struct {
	warped       bool
	travelTicks  int
	energyCost   int
	routeCost    int
	warpItemID   string
	warpItemCost int
}

type interstellarStationRuntime struct {
	key      string
	planetID string
	world    *model.WorldState
	building *model.Building
	station  *model.LogisticsStationState
}

type interstellarShipRuntime struct {
	planetID string
	world    *model.WorldState
	ship     *model.LogisticsShipState
}

func settleInterstellarDispatch(worlds map[string]*model.WorldState, maps *mapmodel.Universe) {
	if len(worlds) == 0 {
		return
	}

	stations := collectInterstellarStations(worlds)
	if len(stations) == 0 {
		return
	}

	demandRemaining, demandForecast := buildInterstellarDemandAcrossWorlds(worlds, stations)
	if len(demandRemaining) == 0 {
		return
	}

	stationShips := collectIdleInterstellarShips(worlds, stations)
	if len(stationShips) == 0 {
		return
	}

	originIDs := make([]string, 0, len(stationShips))
	for id := range stationShips {
		originIDs = append(originIDs, id)
	}
	sort.Slice(originIDs, func(i, j int) bool {
		pi := stationOutputPriority(stations[originIDs[i]].station)
		pj := stationOutputPriority(stations[originIDs[j]].station)
		if pi != pj {
			return pi > pj
		}
		return originIDs[i] < originIDs[j]
	})

	for _, originID := range originIDs {
		origin := stations[originID]
		if origin == nil || origin.station == nil || origin.building == nil {
			continue
		}
		ships := stationShips[originID]
		sort.Slice(ships, func(i, j int) bool { return ships[i].ship.ID < ships[j].ship.ID })

		for _, shipRef := range ships {
			if shipRef == nil || shipRef.ship == nil {
				continue
			}
			ship := shipRef.ship
			ship.Normalize()
			ship.OriginPlanetID = origin.planetID
			origin.station.RefreshCapacityCache()
			if len(origin.station.InterstellarCache.Supply) == 0 || len(demandRemaining) == 0 {
				continue
			}

			candidate := selectInterstellarDispatchCandidate(origin, demandRemaining, stations, ship, maps)
			if candidate == nil || candidate.qty <= 0 {
				continue
			}

			ship.Position = origin.building.Position
			accepted, _, err := ship.Load(candidate.itemID, candidate.qty)
			if err != nil || accepted <= 0 {
				ship.Cargo = nil
				continue
			}
			if accepted < candidate.qty {
				candidate.qty = accepted
			}

			if origin.station.Inventory == nil {
				origin.station.Inventory = make(model.ItemInventory)
			}
			origin.station.Inventory[candidate.itemID] -= accepted
			if origin.station.Inventory[candidate.itemID] <= 0 {
				delete(origin.station.Inventory, candidate.itemID)
			}

			if candidate.warped && candidate.warpItemCost > 0 {
				if !consumeWarpItem(origin.station, candidate.warpItemID, candidate.warpItemCost) {
					restoreStationInventory(origin.station, candidate.itemID, accepted)
					ship.Cargo = nil
					continue
				}
			}
			origin.station.RefreshCapacityCache()

			target := stations[candidate.targetID]
			if target == nil || target.building == nil {
				restoreStationInventory(origin.station, candidate.itemID, accepted)
				ship.Cargo = nil
				continue
			}
			if err := ship.BeginTrip(candidate.targetPlanetID, candidate.targetStationID, target.building.Position, candidate.distance, candidate.warped); err != nil {
				restoreStationInventory(origin.station, candidate.itemID, accepted)
				ship.Cargo = nil
				continue
			}

			consumeDemandRemaining(demandRemaining, candidate.targetID, candidate.itemID, accepted)
			recordInterstellarDispatchObservation(origin.world, originID, candidate, demandForecast)
		}
	}
}

func collectInterstellarStations(worlds map[string]*model.WorldState) map[string]*interstellarStationRuntime {
	stations := make(map[string]*interstellarStationRuntime)
	for planetID, ws := range worlds {
		if ws == nil {
			continue
		}
		for id, building := range ws.Buildings {
			if building == nil || !model.IsInterstellarLogisticsBuilding(building.Type) || building.LogisticsStation == nil {
				continue
			}
			if !building.LogisticsStation.Interstellar.Enabled {
				continue
			}
			key := interstellarStationKey(planetID, id)
			station := ws.LogisticsStations[id]
			if station == nil {
				station = building.LogisticsStation
			}
			station.RefreshCapacityCache()
			stations[key] = &interstellarStationRuntime{
				key:      key,
				planetID: planetID,
				world:    ws,
				building: building,
				station:  station,
			}
		}
	}
	return stations
}

func collectIdleInterstellarShips(worlds map[string]*model.WorldState, stations map[string]*interstellarStationRuntime) map[string][]*interstellarShipRuntime {
	out := make(map[string][]*interstellarShipRuntime)
	for planetID, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, ship := range ws.LogisticsShips {
			if ship == nil || ship.Status != model.LogisticsShipIdle || ship.CargoQty() > 0 {
				continue
			}
			originKey := interstellarStationKey(planetID, ship.StationID)
			if stations[originKey] == nil {
				continue
			}
			ship.OriginPlanetID = planetID
			out[originKey] = append(out[originKey], &interstellarShipRuntime{
				planetID: planetID,
				world:    ws,
				ship:     ship,
			})
		}
	}
	return out
}

func buildInterstellarDemandAcrossWorlds(worlds map[string]*model.WorldState, stations map[string]*interstellarStationRuntime) (map[string]map[string]int, map[string]map[string]demandForecast) {
	reserved := make(map[string]map[string]int)
	for originPlanetID, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, ship := range ws.LogisticsShips {
			if ship == nil || ship.Status == model.LogisticsShipIdle || ship.TargetStationID == "" || len(ship.Cargo) == 0 {
				continue
			}
			targetPlanetID := ship.TargetPlanetID
			if targetPlanetID == "" {
				targetPlanetID = originPlanetID
			}
			targetKey := interstellarStationKey(targetPlanetID, ship.TargetStationID)
			if stations[targetKey] == nil {
				continue
			}
			for itemID, qty := range ship.Cargo {
				if qty <= 0 {
					continue
				}
				if reserved[targetKey] == nil {
					reserved[targetKey] = make(map[string]int)
				}
				reserved[targetKey][itemID] += qty
			}
		}
	}

	cfg := model.CurrentLogisticsSchedulingConfig()
	remaining := make(map[string]map[string]int)
	forecast := make(map[string]map[string]demandForecast)
	for targetKey, ref := range stations {
		if ref == nil || ref.station == nil {
			continue
		}
		for itemID, setting := range ref.station.InterstellarSettings {
			if !setting.Mode.DemandEnabled() {
				continue
			}
			local := setting.LocalStorage
			if local < 0 {
				local = 0
			}
			stored := 0
			if ref.station.Inventory != nil {
				stored = ref.station.Inventory[itemID]
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
			if byItem := reserved[targetKey]; byItem != nil {
				reservedQty = byItem[itemID]
			}
			available := total - reservedQty
			if available <= 0 {
				continue
			}
			if remaining[targetKey] == nil {
				remaining[targetKey] = make(map[string]int)
			}
			if forecast[targetKey] == nil {
				forecast[targetKey] = make(map[string]demandForecast)
			}
			remaining[targetKey][itemID] = available
			forecast[targetKey][itemID] = demandForecast{
				base:       base,
				forecast:   predicted,
				oversupply: oversupply,
			}
		}
	}
	return remaining, forecast
}

func selectInterstellarDispatchCandidate(origin *interstellarStationRuntime, demandRemaining map[string]map[string]int, stations map[string]*interstellarStationRuntime, ship *model.LogisticsShipState, maps *mapmodel.Universe) *interstellarDispatchCandidate {
	if origin == nil || origin.building == nil || origin.station == nil || ship == nil || len(origin.station.InterstellarCache.Supply) == 0 {
		return nil
	}
	ship.Normalize()
	cfg := model.CurrentLogisticsSchedulingConfig()
	var best *interstellarDispatchCandidate
	for _, itemID := range sortedSupplyKeys(origin.station.InterstellarCache.Supply) {
		supplyQty := origin.station.InterstellarCache.Supply[itemID]
		if supplyQty <= 0 {
			continue
		}
		for targetID, demandByItem := range demandRemaining {
			if targetID == origin.key || demandByItem == nil {
				continue
			}
			demandQty := demandByItem[itemID]
			if demandQty <= 0 {
				continue
			}
			target := stations[targetID]
			if target == nil || target.building == nil || target.station == nil {
				continue
			}
			if target.building.OwnerID != origin.building.OwnerID || !target.station.Interstellar.Enabled {
				continue
			}
			qty := minInt(minInt(ship.Capacity, supplyQty), demandQty)
			if qty <= 0 {
				continue
			}
			distance := interstellarDistance(maps, origin, target)
			plan := planInterstellarTrip(distance, ship, origin.station)
			candidate := interstellarDispatchCandidate{
				itemID:          itemID,
				targetID:        targetID,
				targetPlanetID:  target.planetID,
				targetStationID: target.building.ID,
				qty:             qty,
				distance:        distance,
				travelTicks:     plan.travelTicks,
				energyCost:      plan.energyCost,
				routeCost:       plan.routeCost,
				targetPriority:  stationInputPriority(target.station),
				warped:          plan.warped,
				warpItemID:      plan.warpItemID,
				warpItemCost:    plan.warpItemCost,
			}
			if betterInterstellarCandidate(&candidate, best, cfg.InterstellarStrategy) {
				copyCandidate := candidate
				best = &copyCandidate
			}
		}
	}
	return best
}

func interstellarStationKey(planetID, stationID string) string {
	return planetID + "::" + stationID
}

func interstellarDistance(maps *mapmodel.Universe, origin, target *interstellarStationRuntime) int {
	if origin == nil || target == nil || origin.building == nil || target.building == nil {
		return 0
	}
	if origin.planetID == target.planetID {
		return model.ManhattanDist(origin.building.Position, target.building.Position)
	}
	if maps == nil {
		return 10
	}
	originPlanet, _ := maps.Planet(origin.planetID)
	targetPlanet, _ := maps.Planet(target.planetID)
	if originPlanet == nil || targetPlanet == nil {
		return 10
	}
	if originPlanet.SystemID == targetPlanet.SystemID {
		distance := 6 + int(math.Round(math.Abs(originPlanet.Orbit.DistanceAU-targetPlanet.Orbit.DistanceAU)*10))
		if distance < 6 {
			distance = 6
		}
		return distance
	}
	originSystem, _ := maps.System(originPlanet.SystemID)
	targetSystem, _ := maps.System(targetPlanet.SystemID)
	if originSystem == nil || targetSystem == nil {
		return 20
	}
	distance := 20 + int(math.Round(math.Hypot(originSystem.Position.X-targetSystem.Position.X, originSystem.Position.Y-targetSystem.Position.Y)))
	if distance < 20 {
		distance = 20
	}
	return distance
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
