package gamecore

import "siliconworld/internal/model"

func settleLogisticsShips(worlds map[string]*model.WorldState) {
	for originPlanetID, ws := range worlds {
		if ws == nil || len(ws.LogisticsShips) == 0 {
			continue
		}
		for _, ship := range ws.LogisticsShips {
			if ship == nil {
				continue
			}
			ship.Normalize()
			switch ship.Status {
			case model.LogisticsShipIdle:
				continue
			case model.LogisticsShipTakeoff:
				ship.RemainingTicks = tickDown(ship.RemainingTicks)
				if ship.RemainingTicks <= 0 {
					ship.Status = model.LogisticsShipInFlight
					ship.RemainingTicks = clampTicks(ship.TravelTicks, 1)
				}
			case model.LogisticsShipInFlight:
				ship.RemainingTicks = tickDown(ship.RemainingTicks)
				if ship.RemainingTicks <= 0 {
					ship.Status = model.LogisticsShipLanding
					ship.RemainingTicks = clampTicks(model.DefaultLogisticsShipLandingTicks, 1)
					if ship.TargetPos != nil {
						ship.Position = *ship.TargetPos
					}
				}
			case model.LogisticsShipLanding:
				ship.RemainingTicks = tickDown(ship.RemainingTicks)
				if ship.RemainingTicks <= 0 {
					deliverLogisticsShipCargo(worlds, originPlanetID, ship)
					ship.Status = model.LogisticsShipIdle
					if ship.TargetPos != nil {
						ship.Position = *ship.TargetPos
					}
					ship.TargetPos = nil
					ship.TargetPlanetID = ""
					ship.TargetStationID = ""
					ship.TravelTicks = 0
					ship.Warped = false
					ship.EnergyCost = 0
					ship.WarpItemSpent = 0
				}
			default:
				ship.Status = model.LogisticsShipIdle
			}
		}
	}
}

func deliverLogisticsShipCargo(worlds map[string]*model.WorldState, originPlanetID string, ship *model.LogisticsShipState) {
	if ship == nil || ship.TargetStationID == "" || len(ship.Cargo) == 0 {
		return
	}
	targetPlanetID := ship.TargetPlanetID
	if targetPlanetID == "" {
		targetPlanetID = originPlanetID
	}
	ws := worlds[targetPlanetID]
	if ws == nil {
		return
	}
	station := ws.LogisticsStations[ship.TargetStationID]
	if station == nil {
		if building := ws.Buildings[ship.TargetStationID]; building != nil {
			station = building.LogisticsStation
		}
	}
	if station == nil {
		return
	}
	if station.Inventory == nil {
		station.Inventory = make(model.ItemInventory)
	}
	for itemID, qty := range ship.Cargo {
		if qty <= 0 {
			continue
		}
		station.Inventory[itemID] += qty
	}
	station.RefreshCapacityCache()
	ship.Cargo = nil
}
