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
		if building.Runtime.Functions.Sorter.CycleTicks > 0 {
			building.Sorter.CycleTicks = building.Runtime.Functions.Sorter.CycleTicks
		}
		if building.Runtime.Functions.Sorter.Range > 0 {
			building.Sorter.Range = building.Runtime.Functions.Sorter.Range
		}
	}
	building.Sorter.Normalize()
}

func defaultSorterState(runtime BuildingRuntime) *SorterState {
	cycleTicks := defaultSorterCycleTicks
	sortRange := 1
	if runtime.Functions.Sorter != nil {
		if runtime.Functions.Sorter.CycleTicks > 0 {
			cycleTicks = runtime.Functions.Sorter.CycleTicks
		}
		if runtime.Functions.Sorter.Range > 0 {
			sortRange = runtime.Functions.Sorter.Range
		}
	}
	state := &SorterState{
		CycleTicks: cycleTicks,
		Range:      sortRange,
		Filter:     SorterFilter{Mode: SorterFilterAllow},
	}
	state.Normalize()
	return state
}
