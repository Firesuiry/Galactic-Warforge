package model

// InitBuildingSorter ensures a sorter building has initialized sorter state.
func InitBuildingSorter(building *Building) {
	if building == nil {
		return
	}
	if !IsSorterBuilding(building.Type) {
		return
	}
	if building.Sorter == nil {
		building.Sorter = defaultSorterState(building.Runtime)
	}
	SyncBuildingSorter(building)
}

// SyncBuildingSorter aligns sorter parameters with runtime modules.
func SyncBuildingSorter(building *Building) {
	if building == nil {
		return
	}
	if !IsSorterBuilding(building.Type) {
		building.Sorter = nil
		return
	}
	if building.Sorter == nil {
		building.Sorter = defaultSorterState(building.Runtime)
		return
	}
	if building.Runtime.Functions.Sorter != nil {
		if building.Runtime.Functions.Sorter.Speed > 0 {
			building.Sorter.Speed = building.Runtime.Functions.Sorter.Speed
		}
		if building.Runtime.Functions.Sorter.Range > 0 {
			building.Sorter.Range = building.Runtime.Functions.Sorter.Range
		}
	}
	building.Sorter.Normalize()
}

func defaultSorterState(runtime BuildingRuntime) *SorterState {
	speed := 1
	sortRange := 1
	if runtime.Functions.Sorter != nil {
		if runtime.Functions.Sorter.Speed > 0 {
			speed = runtime.Functions.Sorter.Speed
		}
		if runtime.Functions.Sorter.Range > 0 {
			sortRange = runtime.Functions.Sorter.Range
		}
	}
	state := &SorterState{
		InputDirections:  append([]ConveyorDirection(nil), defaultSorterDirections...),
		OutputDirections: append([]ConveyorDirection(nil), defaultSorterDirections...),
		Speed:            speed,
		Range:            sortRange,
		Filter:           SorterFilter{Mode: SorterFilterAllow},
	}
	state.Normalize()
	return state
}
