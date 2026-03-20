package model

// RegisterLogisticsStation registers a logistics station in world state.
func RegisterLogisticsStation(ws *WorldState, building *Building) {
	if ws == nil || building == nil {
		return
	}
	if building.LogisticsStation == nil {
		return
	}
	if ws.LogisticsStations == nil {
		ws.LogisticsStations = make(map[string]*LogisticsStationState)
	}
	ws.LogisticsStations[building.ID] = building.LogisticsStation
}

// UnregisterLogisticsStation removes a logistics station from world state.
func UnregisterLogisticsStation(ws *WorldState, buildingID string) {
	if ws == nil || buildingID == "" || ws.LogisticsStations == nil {
		return
	}
	delete(ws.LogisticsStations, buildingID)
}

// RebuildLogisticsStations rebuilds the station registry from buildings.
func RebuildLogisticsStations(ws *WorldState) {
	if ws == nil {
		return
	}
	stations := make(map[string]*LogisticsStationState)
	for id, building := range ws.Buildings {
		if building == nil || building.LogisticsStation == nil {
			continue
		}
		stations[id] = building.LogisticsStation
	}
	ws.LogisticsStations = stations
}
