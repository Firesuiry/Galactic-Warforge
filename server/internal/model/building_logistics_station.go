package model

// InitBuildingLogisticsStation ensures a logistics station building has initialized station state.
func InitBuildingLogisticsStation(building *Building) {
	if building == nil {
		return
	}
	if !IsLogisticsStationBuilding(building.Type) {
		return
	}
	if building.LogisticsStation == nil {
		building.LogisticsStation = NewLogisticsStationState()
	}
	SyncBuildingLogisticsStation(building)
}

// SyncBuildingLogisticsStation aligns station state with building type.
func SyncBuildingLogisticsStation(building *Building) {
	if building == nil {
		return
	}
	if !IsLogisticsStationBuilding(building.Type) {
		building.LogisticsStation = nil
		return
	}
	if building.LogisticsStation == nil {
		building.LogisticsStation = NewLogisticsStationState()
		return
	}
	building.LogisticsStation.Interstellar.Enabled = IsInterstellarLogisticsBuilding(building.Type)
	building.LogisticsStation.Normalize()
}
