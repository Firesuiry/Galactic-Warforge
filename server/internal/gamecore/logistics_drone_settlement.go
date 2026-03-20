package gamecore

import "siliconworld/internal/model"

func settleLogisticsDrones(ws *model.WorldState) {
	if ws == nil || len(ws.LogisticsDrones) == 0 {
		return
	}
	for _, drone := range ws.LogisticsDrones {
		if drone == nil {
			continue
		}
		drone.Normalize()
		switch drone.Status {
		case model.LogisticsDroneIdle:
			continue
		case model.LogisticsDroneTakeoff:
			drone.RemainingTicks = tickDown(drone.RemainingTicks)
			if drone.RemainingTicks <= 0 {
				drone.Status = model.LogisticsDroneInFlight
				drone.RemainingTicks = clampTicks(drone.TravelTicks, 1)
			}
		case model.LogisticsDroneInFlight:
			drone.RemainingTicks = tickDown(drone.RemainingTicks)
			if drone.RemainingTicks <= 0 {
				drone.Status = model.LogisticsDroneLanding
				drone.RemainingTicks = clampTicks(model.DefaultLogisticsDroneLandingTicks, 1)
				if drone.TargetPos != nil {
					drone.Position = *drone.TargetPos
				}
			}
		case model.LogisticsDroneLanding:
			drone.RemainingTicks = tickDown(drone.RemainingTicks)
			if drone.RemainingTicks <= 0 {
				deliverLogisticsDroneCargo(ws, drone)
				drone.Status = model.LogisticsDroneIdle
				if drone.TargetPos != nil {
					drone.Position = *drone.TargetPos
				}
				drone.TargetPos = nil
				drone.TargetStationID = ""
				drone.TravelTicks = 0
			}
		default:
			drone.Status = model.LogisticsDroneIdle
		}
	}
}

func deliverLogisticsDroneCargo(ws *model.WorldState, drone *model.LogisticsDroneState) {
	if ws == nil || drone == nil || drone.TargetStationID == "" || len(drone.Cargo) == 0 {
		return
	}
	station := ws.LogisticsStations[drone.TargetStationID]
	if station == nil {
		if building := ws.Buildings[drone.TargetStationID]; building != nil {
			station = building.LogisticsStation
		}
	}
	if station == nil {
		return
	}
	if station.Inventory == nil {
		station.Inventory = make(model.ItemInventory)
	}
	for itemID, qty := range drone.Cargo {
		if qty <= 0 {
			continue
		}
		station.Inventory[itemID] += qty
	}
	station.RefreshCapacityCache()
	drone.Cargo = nil
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
