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
	}
	station := building.LogisticsStation
	switch building.Type {
	case BuildingTypePlanetaryLogisticsStation:
		station.SlotCapacity, station.ItemCapacity, station.EnergyCapacity, station.ChargePerTick = 3, 200, 1000, 10
	case BuildingTypeInterstellarLogisticsStation:
		station.SlotCapacity, station.ItemCapacity, station.EnergyCapacity, station.ChargePerTick = 5, 500, 10000, 30
	case BuildingTypeOrbitalCollector:
		station.SlotCapacity, station.ItemCapacity, station.EnergyCapacity, station.ChargePerTick = 0, 0, 0, 0
	}
	building.LogisticsStation.Interstellar.Enabled = IsInterstellarLogisticsBuilding(building.Type)
	building.LogisticsStation.Normalize()
}
