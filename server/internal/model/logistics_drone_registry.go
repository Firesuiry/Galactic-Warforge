package model

import "fmt"

// RegisterLogisticsDrone registers a drone in world state after capacity checks.
func RegisterLogisticsDrone(ws *WorldState, drone *LogisticsDroneState) error {
	if ws == nil {
		return fmt.Errorf("world required")
	}
	if drone == nil {
		return fmt.Errorf("drone required")
	}
	drone.Normalize()
	if drone.ID == "" {
		return fmt.Errorf("drone id required")
	}
	if drone.StationID == "" {
		return fmt.Errorf("drone station_id required")
	}
	station := ws.LogisticsStations[drone.StationID]
	if station == nil {
		return fmt.Errorf("station %s not found", drone.StationID)
	}
	capacity := station.DroneCapacityValue()
	if capacity > 0 && stationDroneCount(ws, drone.StationID, drone.ID) >= capacity {
		return fmt.Errorf("station %s drone capacity reached", drone.StationID)
	}
	if ws.LogisticsDrones == nil {
		ws.LogisticsDrones = make(map[string]*LogisticsDroneState)
	}
	ws.LogisticsDrones[drone.ID] = drone
	return nil
}

// UnregisterLogisticsDrone removes a drone from world state.
func UnregisterLogisticsDrone(ws *WorldState, droneID string) {
	if ws == nil || droneID == "" || ws.LogisticsDrones == nil {
		return
	}
	delete(ws.LogisticsDrones, droneID)
}

// StationDroneCount returns the number of drones bound to a station.
func StationDroneCount(ws *WorldState, stationID string) int {
	return stationDroneCount(ws, stationID, "")
}

func stationDroneCount(ws *WorldState, stationID, excludeID string) int {
	if ws == nil || stationID == "" || len(ws.LogisticsDrones) == 0 {
		return 0
	}
	count := 0
	for id, drone := range ws.LogisticsDrones {
		if id == excludeID || drone == nil {
			continue
		}
		if drone.StationID == stationID {
			count++
		}
	}
	return count
}
