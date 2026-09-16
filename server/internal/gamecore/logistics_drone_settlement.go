package gamecore

import "siliconworld/internal/model"

// Flight energy is reserved before takeoff. In-flight vehicles continue through power outages.
func settleLogisticsDrones(ws *model.WorldState) {
	if ws == nil {
		return
	}
	for _, drone := range ws.LogisticsDrones {
		if drone == nil {
			continue
		}
		drone.Normalize()

		if drone.Status == model.LogisticsDroneIdle {
			home := ws.Buildings[drone.StationID]
			if home == nil || home.OwnerID != drone.OwnerID {
				drone.Status = model.LogisticsDroneStranded
				drone.StateReason = "home_unavailable"
			}
			continue
		}
		if drone.Status == model.LogisticsDroneStranded {
			continue
		}
		switch drone.Status {
		case model.LogisticsDroneTakeoff:
			drone.RemainingTicks = tickDown(drone.RemainingTicks)
			if drone.RemainingTicks == 0 {
				drone.Status = model.LogisticsDroneInFlight
				drone.RemainingTicks = clampTicks(drone.TravelTicks, 1)
			}
		case model.LogisticsDroneInFlight:
			drone.RemainingTicks = tickDown(drone.RemainingTicks)
			if drone.RemainingTicks == 0 {
				drone.Status = model.LogisticsDroneLanding
				drone.RemainingTicks = model.DefaultLogisticsDroneLandingTicks
				if drone.TargetPos != nil {
					drone.Position = *drone.TargetPos
				}
			}
		case model.LogisticsDroneLanding, model.LogisticsDroneWaitingUnload:
			drone.RemainingTicks = tickDown(drone.RemainingTicks)
			if drone.RemainingTicks > 0 {
				continue
			}
			targetWorld := ws
			var target *model.Building
			if targetWorld != nil {
				target = targetWorld.Buildings[drone.TargetStationID]
			}
			valid := target != nil && target.OwnerID == drone.OwnerID && target.LogisticsStation != nil
			isPickupStop := drone.TripKind == "pickup" && !drone.Returning
			if valid && isPickupStop {
				station := target.LogisticsStation
				station.RefreshCapacityCache()
				supply := station.Cache.Supply[drone.PickupItemID]
				accepted, _, err := drone.Load(drone.PickupItemID, min(supply, drone.PickupQuantity))
				if err == nil && accepted > 0 {
					station.Inventory[drone.PickupItemID] -= accepted
					if station.Inventory[drone.PickupItemID] == 0 {
						delete(station.Inventory, drone.PickupItemID)
					}
					station.RefreshCapacityCache()
				}
			}
			if valid && !isPickupStop {
				for itemID, qty := range drone.Cargo {
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
						_, _, _ = drone.Unload(itemID, accepted)
					}
				}
			}
			if !valid && drone.Returning {
				drone.Status = model.LogisticsDroneStranded
				drone.StateReason = "home_unavailable"
				continue
			}
			if valid && !isPickupStop && drone.CargoQty() > 0 {
				drone.Status = model.LogisticsDroneWaitingUnload
				drone.StateReason = "destination_full"
				continue
			}
			if drone.Returning {
				drone.Status = model.LogisticsDroneIdle
				drone.Returning = false
				drone.TripKind = ""
				drone.PickupItemID = ""
				drone.PickupQuantity = 0
				drone.StateReason = ""
				drone.TargetPos = nil
				drone.TargetStationID = ""
				drone.TravelTicks = 0
				continue
			}
			// Keep undelivered cargo aboard when a destination disappears or changes owner.
			drone.Returning = true
			if !valid {
				drone.StateReason = "destination_unavailable"
			} else {
				drone.StateReason = ""
			}
			if drone.HomePos == nil {
				drone.Status = model.LogisticsDroneStranded
				drone.StateReason = "home_position_unknown"
				continue
			}
			pos := *drone.HomePos
			drone.TargetPos = &pos
			drone.TargetStationID = drone.StationID

			drone.Status = model.LogisticsDroneTakeoff
			drone.RemainingTicks = model.DefaultLogisticsDroneTakeoffTicks
		}
	}
}

func tickDown(value int) int {
	if value > 0 {
		return value - 1
	}
	return value
}
func clampTicks(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func logisticsItemInFlight(worlds map[string]*model.WorldState, planetID, stationID, itemID string) bool {
	for worldID, ws := range worlds {
		if ws == nil {
			continue
		}
		if worldID == planetID {
			for _, d := range ws.LogisticsDrones {
				if d != nil && (d.Cargo[itemID] > 0 || (d.TripKind == "pickup" && !d.Returning && d.Status != model.LogisticsDroneIdle && d.PickupItemID == itemID && d.PickupQuantity > 0)) && (d.StationID == stationID || d.TargetStationID == stationID) {
					return true
				}
			}
		}
		for _, s := range ws.LogisticsShips {
			if s == nil || (s.Cargo[itemID] <= 0 && !(s.TripKind == "pickup" && !s.Returning && s.Status != model.LogisticsShipIdle && s.PickupItemID == itemID && s.PickupQuantity > 0)) {
				continue
			}
			if (worldID == planetID && s.StationID == stationID) || (s.TargetPlanetID == planetID && s.TargetStationID == stationID) {
				return true
			}
		}
	}
	return false
}

func logisticsStationCanDispatch(ws *model.WorldState, building *model.Building) bool {
	if ws == nil || building == nil || building.Runtime.State != model.BuildingWorkRunning {
		return false
	}
	allocation, ok := model.CurrentPowerSettlementSnapshot(ws).Allocations.Buildings[building.ID]
	return ok && allocation.Allocated > 0 && allocation.Ratio > 0
}
