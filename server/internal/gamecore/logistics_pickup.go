package gamecore

import (
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"sort"
)

// Empty outbound pickup vehicles reserve their promised stock until arrival.
func reservedPickupStock(worlds map[string]*model.WorldState, planetID, stationID, itemID string) int {
	total := 0
	for worldID, ws := range worlds {
		if ws == nil {
			continue
		}
		if worldID == planetID {
			for _, d := range ws.LogisticsDrones {
				if d != nil && d.TripKind == "pickup" && !d.Returning && d.Status != model.LogisticsDroneIdle && d.Status != model.LogisticsDroneStranded && d.TargetStationID == stationID && d.PickupItemID == itemID {
					total += d.PickupQuantity
				}
			}
		}
		for _, s := range ws.LogisticsShips {
			if s != nil && s.TripKind == "pickup" && !s.Returning && s.Status != model.LogisticsShipIdle && s.Status != model.LogisticsShipStranded && s.TargetPlanetID == planetID && s.TargetStationID == stationID && s.PickupItemID == itemID {
				total += s.PickupQuantity
			}
		}
	}
	return total
}

func settleDronePickups(ws *model.WorldState, worlds map[string]*model.WorldState, buildings map[string]*model.Building) {
	demand, _ := buildDemandRemaining(ws, buildings, worlds)
	ids := make([]string, 0, len(ws.LogisticsDrones))
	for id := range ws.LogisticsDrones {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		d := ws.LogisticsDrones[id]
		if d == nil || d.Status != model.LogisticsDroneIdle || d.CargoQty() > 0 {
			continue
		}
		home := buildings[d.StationID]
		if home == nil || home.OwnerID != d.OwnerID || home.Position != d.Position || !logisticsStationCanDispatch(ws, home) {
			continue
		}
		var best *logisticsDispatchCandidate
		for itemID, want := range demand[home.ID] {
			for sourceID, source := range buildings {
				if sourceID == home.ID || source.OwnerID != d.OwnerID {
					continue
				}
				source.LogisticsStation.RefreshCapacityCache()
				supply := source.LogisticsStation.Cache.Supply[itemID] - reservedPickupStock(worlds, ws.PlanetID, sourceID, itemID)
				qty := min(want, supply, d.Capacity, home.LogisticsStation.AvailableItemCapacity(itemID))
				distance := ws.SurfaceDistance(home.Position, source.Position)
				if qty <= 0 || home.LogisticsStation.Energy < 2*max(1, distance) {
					continue
				}
				candidate := logisticsDispatchCandidate{itemID: itemID, targetID: sourceID, qty: qty, distance: distance, travelTicks: model.LogisticsDroneTravelTicks(distance, d.Speed), routeCost: model.LogisticsDroneTravelTicks(distance, d.Speed), targetPriority: source.LogisticsStation.OutputPriorityValue()}
				if betterDispatchCandidate(&candidate, best, model.CurrentLogisticsSchedulingConfig().PlanetaryStrategy) {
					copy := candidate
					best = &copy
				}
			}
		}
		if best == nil {
			continue
		}
		staged := d.Clone()
		if err := staged.BeginTrip(best.targetID, buildings[best.targetID].Position, best.distance); err != nil {
			continue
		}
		if !home.LogisticsStation.SpendEnergy(staged.EnergyCost) {
			continue
		}
		staged.TripKind = "pickup"
		staged.PickupItemID = best.itemID
		staged.PickupQuantity = best.qty
		*d = *staged
		consumeDemandRemaining(demand, home.ID, best.itemID, best.qty)
	}
}

func settleShipPickups(worlds map[string]*model.WorldState, maps *mapmodel.Universe, stations map[string]*interstellarStationRuntime) {
	demand, _ := buildInterstellarDemandAcrossWorlds(worlds, stations)
	idle := collectIdleInterstellarShips(worlds, stations)
	homeIDs := make([]string, 0, len(idle))
	for key := range idle {
		homeIDs = append(homeIDs, key)
	}
	sort.Strings(homeIDs)
	for _, key := range homeIDs {
		home := stations[key]
		if home == nil || !logisticsStationCanDispatch(home.world, home.building) {
			continue
		}
		ships := idle[key]
		sort.Slice(ships, func(i, j int) bool { return ships[i].ship.ID < ships[j].ship.ID })
		for _, ref := range ships {
			s := ref.ship
			if s.OwnerID != home.building.OwnerID || s.Position != home.building.Position {
				continue
			}
			s.WarpEnabled = home.station.Interstellar.WarpEnabled
			var best *interstellarDispatchCandidate
			for itemID, want := range demand[key] {
				for sourceKey, source := range stations {
					if sourceKey == key || source.building.OwnerID != s.OwnerID {
						continue
					}
					source.station.RefreshCapacityCache()
					supply := source.station.InterstellarCache.Supply[itemID] - reservedPickupStock(worlds, source.planetID, source.building.ID, itemID)
					qty := min(want, supply, s.Capacity, home.station.AvailableItemCapacity(itemID))
					distance := interstellarDistance(maps, home, source)
					plan := planInterstellarTrip(distance, s, home.station)
					if qty <= 0 || home.station.Energy < plan.energyCost {
						continue
					}
					candidate := interstellarDispatchCandidate{itemID: itemID, targetID: sourceKey, targetStationID: source.building.ID, targetPlanetID: source.planetID, qty: qty, distance: distance, travelTicks: plan.travelTicks, energyCost: plan.energyCost, routeCost: plan.routeCost, targetPriority: source.station.OutputPriorityValue(), warped: plan.warped, warpItemID: plan.warpItemID, warpItemCost: plan.warpItemCost}
					if betterInterstellarCandidate(&candidate, best, model.CurrentLogisticsSchedulingConfig().InterstellarStrategy) {
						copy := candidate
						best = &copy
					}
				}
			}
			if best == nil {
				continue
			}
			staged := s.Clone()
			if err := staged.BeginTrip(best.targetPlanetID, best.targetStationID, stations[best.targetID].building.Position, best.distance, best.warped); err != nil {
				continue
			}
			if best.warped && home.station.Inventory[best.warpItemID] < best.warpItemCost {
				continue
			}
			if !home.station.SpendEnergy(staged.EnergyCost) {
				continue
			}
			if best.warped {
				consumeWarpItem(home.station, best.warpItemID, best.warpItemCost)
			}
			staged.TripKind = "pickup"
			staged.PickupItemID = best.itemID
			staged.PickupQuantity = best.qty
			staged.CurrentPlanetID = home.planetID
			staged.OriginPlanetID = home.planetID
			*s = *staged
			consumeDemandRemaining(demand, key, best.itemID, best.qty)
		}
	}
}

// Both local and interstellar modes share one physical inventory. Reserve all
// incoming cargo against both demand scopes, including empty pickup missions.
func reservedLogisticsDemand(worlds map[string]*model.WorldState) map[string]model.ItemInventory {
	reserved := make(map[string]model.ItemInventory)
	add := func(planetID, stationID string, cargo model.ItemInventory) {
		key := interstellarStationKey(planetID, stationID)
		if reserved[key] == nil {
			reserved[key] = make(model.ItemInventory)
		}
		for itemID, qty := range cargo {
			if qty > 0 {
				reserved[key][itemID] += qty
			}
		}
	}
	for planetID, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, d := range ws.LogisticsDrones {
			if d == nil || d.Status == model.LogisticsDroneIdle || d.Status == model.LogisticsDroneStranded {
				continue
			}
			targetID := d.TargetStationID
			cargo := d.Cargo
			if d.TripKind == "pickup" {
				targetID = d.StationID
				if !d.Returning {
					cargo = model.ItemInventory{d.PickupItemID: d.PickupQuantity}
				}
			} else if d.Returning {
				continue
			}
			add(planetID, targetID, cargo)
		}
		for _, s := range ws.LogisticsShips {
			if s == nil || s.Status == model.LogisticsShipIdle || s.Status == model.LogisticsShipStranded {
				continue
			}
			targetPlanetID := s.TargetPlanetID
			targetID := s.TargetStationID
			cargo := s.Cargo
			if targetPlanetID == "" {
				targetPlanetID = planetID
			}
			if s.TripKind == "pickup" {
				targetPlanetID = planetID
				targetID = s.StationID
				if !s.Returning {
					cargo = model.ItemInventory{s.PickupItemID: s.PickupQuantity}
				}
			} else if s.Returning {
				continue
			}
			add(targetPlanetID, targetID, cargo)
		}
	}
	return reserved
}
