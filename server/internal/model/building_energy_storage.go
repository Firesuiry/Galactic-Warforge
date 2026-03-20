package model

// InitBuildingEnergyStorage ensures a building has initialized energy storage state when applicable.
func InitBuildingEnergyStorage(building *Building) {
	if building == nil {
		return
	}
	if building.EnergyStorage != nil {
		return
	}
	if building.Runtime.Functions.EnergyStorage == nil {
		return
	}
	building.EnergyStorage = NewEnergyStorageState(*building.Runtime.Functions.EnergyStorage)
}
