package model

import "fmt"

// RegisterLogisticsShip registers a ship in world state after capacity checks.
func RegisterLogisticsShip(ws *WorldState, ship *LogisticsShipState) error {
	if ws == nil {
		return fmt.Errorf("world required")
	}
	if ship == nil {
		return fmt.Errorf("ship required")
	}
	ship.Normalize()
	if ship.ID == "" {
		return fmt.Errorf("ship id required")
	}
	if ship.StationID == "" {
		return fmt.Errorf("ship station_id required")
	}
	station := ws.LogisticsStations[ship.StationID]
	if station == nil {
		return fmt.Errorf("station %s not found", ship.StationID)
	}
	if !station.Interstellar.Enabled {
		return fmt.Errorf("station %s interstellar disabled", ship.StationID)
	}
	ship.Capacity = station.ShipCapacityValue()
	ship.Speed = station.ShipSpeedValue()
	ship.WarpSpeed = station.WarpSpeedValue()
	ship.WarpDistance = station.WarpDistanceValue()
	ship.EnergyPerDistance = station.EnergyPerDistanceValue()
	ship.WarpEnergyMultiplier = station.WarpEnergyMultiplierValue()
	ship.WarpItemID = station.WarpItemIDValue()
	ship.WarpItemCost = station.WarpItemCostValue()
	ship.WarpEnabled = station.Interstellar.WarpEnabled
	capacity := station.ShipSlotCapacityValue()
	if capacity > 0 && stationShipCount(ws, ship.StationID, ship.ID) >= capacity {
		return fmt.Errorf("station %s ship capacity reached", ship.StationID)
	}
	if ws.LogisticsShips == nil {
		ws.LogisticsShips = make(map[string]*LogisticsShipState)
	}
	ws.LogisticsShips[ship.ID] = ship
	return nil
}

// UnregisterLogisticsShip removes a ship from world state.
func UnregisterLogisticsShip(ws *WorldState, shipID string) {
	if ws == nil || shipID == "" || ws.LogisticsShips == nil {
		return
	}
	delete(ws.LogisticsShips, shipID)
}

// StationShipCount returns the number of ships bound to a station.
func StationShipCount(ws *WorldState, stationID string) int {
	return stationShipCount(ws, stationID, "")
}

func stationShipCount(ws *WorldState, stationID, excludeID string) int {
	if ws == nil || stationID == "" || len(ws.LogisticsShips) == 0 {
		return 0
	}
	count := 0
	for id, ship := range ws.LogisticsShips {
		if id == excludeID || ship == nil {
			continue
		}
		if ship.StationID == stationID {
			count++
		}
	}
	return count
}
