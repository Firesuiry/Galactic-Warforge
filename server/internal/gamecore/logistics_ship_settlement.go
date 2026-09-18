package gamecore

import "siliconworld/internal/model"

// Flight energy is reserved before takeoff. In-flight vehicles continue through power outages.
func settleLogisticsShips(worlds map[string]*model.WorldState) {
	for originPlanetID, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, ship := range ws.LogisticsShips {
			if ship == nil {
				continue
			}
			ship.Normalize()
			ship.RefreshTechStats(ws.Players[ship.OwnerID])
			ship.OriginPlanetID = originPlanetID

			if ship.Status == model.LogisticsShipIdle {
				home := ws.Buildings[ship.StationID]
				if home == nil || home.OwnerID != ship.OwnerID {
					ship.Status = model.LogisticsShipStranded
					ship.StateReason = "home_unavailable"
				}
				continue
			}
			if ship.Status == model.LogisticsShipStranded {
				continue
			}
			switch ship.Status {
			case model.LogisticsShipTakeoff:
				ship.RemainingTicks = tickDown(ship.RemainingTicks)
				if ship.RemainingTicks == 0 {
					ship.Status = model.LogisticsShipInFlight
					ship.RemainingTicks = clampTicks(ship.TravelTicks, 1)
				}
			case model.LogisticsShipInFlight:
				ship.RemainingTicks = tickDown(ship.RemainingTicks)
				if ship.RemainingTicks == 0 {
					ship.Status = model.LogisticsShipLanding
					ship.RemainingTicks = model.DefaultLogisticsShipLandingTicks
					if ship.TargetPos != nil {
						ship.Position = *ship.TargetPos
					}
					ship.CurrentPlanetID = ship.TargetPlanetID
				}
			case model.LogisticsShipLanding, model.LogisticsShipWaitingUnload:
				ship.RemainingTicks = tickDown(ship.RemainingTicks)
				if ship.RemainingTicks > 0 {
					continue
				}
				targetWorld := worlds[ship.TargetPlanetID]
				if ship.TargetPlanetID == "" {
					targetWorld = worlds[originPlanetID]
				}
				var target *model.Building
				if targetWorld != nil {
					target = targetWorld.Buildings[ship.TargetStationID]
				}
				valid := target != nil && target.OwnerID == ship.OwnerID && target.LogisticsStation != nil
				isPickupStop := ship.TripKind == "pickup" && !ship.Returning
				if valid && isPickupStop {
					station := target.LogisticsStation
					station.RefreshCapacityCache()
					supply := station.InterstellarCache.Supply[ship.PickupItemID]
					accepted, _, err := ship.Load(ship.PickupItemID, min(supply, ship.PickupQuantity))
					if err == nil && accepted > 0 {
						station.Inventory[ship.PickupItemID] -= accepted
						if station.Inventory[ship.PickupItemID] == 0 {
							delete(station.Inventory, ship.PickupItemID)
						}
						station.RefreshCapacityCache()
					}
				}
				if valid && !isPickupStop {
					for itemID, qty := range ship.Cargo {
						if !target.LogisticsStation.ConfiguredItem(itemID) {
							valid = false
							break
						}
						accepted, _, err := target.LogisticsStation.ReceiveItem(itemID, qty)
						if err != nil {
							valid = false
							break
						}
						if accepted > 0 {
							_, _, _ = ship.Unload(itemID, accepted)
						}
					}
				}
				if !valid && ship.Returning {
					ship.Status = model.LogisticsShipStranded
					ship.StateReason = "home_unavailable"
					continue
				}
				if valid && !isPickupStop && ship.CargoQty() > 0 {
					ship.Status = model.LogisticsShipWaitingUnload
					ship.StateReason = "destination_full"
					continue
				}
				if ship.Returning {
					ship.Status = model.LogisticsShipIdle
					ship.Returning = false
					ship.TripKind = ""
					ship.PickupItemID = ""
					ship.PickupQuantity = 0
					ship.StateReason = ""
					ship.TargetPos = nil
					ship.TargetStationID = ""
					ship.TravelTicks = 0
					continue
				}
				// Keep undelivered cargo aboard when a destination disappears or changes owner.
				ship.Returning = true
				if !valid {
					ship.StateReason = "destination_unavailable"
				} else {
					ship.StateReason = ""
				}
				if ship.HomePos == nil {
					ship.Status = model.LogisticsShipStranded
					ship.StateReason = "home_position_unknown"
					continue
				}
				pos := *ship.HomePos
				ship.TargetPos = &pos
				ship.TargetStationID = ship.StationID
				ship.TargetPlanetID = originPlanetID

				ship.Status = model.LogisticsShipTakeoff
				ship.RemainingTicks = model.DefaultLogisticsShipTakeoffTicks
			}
		}
	}
}
