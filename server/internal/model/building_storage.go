package model

// InitBuildingStorage ensures a building has initialized storage state when applicable.
func InitBuildingStorage(building *Building) {
	if building == nil {
		return
	}
	if building.Storage != nil {
		return
	}
	if building.Runtime.Functions.Storage == nil {
		return
	}
	building.Storage = NewStorageState(*building.Runtime.Functions.Storage)
}
