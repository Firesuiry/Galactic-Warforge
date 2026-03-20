package model

// InitBuildingConveyor ensures a conveyor building has initialized belt state.
func InitBuildingConveyor(building *Building) {
	if building == nil {
		return
	}
	if !IsConveyorBuilding(building.Type) {
		return
	}
	if building.Conveyor == nil {
		building.Conveyor = defaultConveyorState(building.Runtime)
	}
	SyncBuildingConveyor(building)
}

// SyncBuildingConveyor aligns conveyor parameters with runtime modules.
func SyncBuildingConveyor(building *Building) {
	if building == nil {
		return
	}
	if !IsConveyorBuilding(building.Type) {
		building.Conveyor = nil
		return
	}
	if building.Conveyor == nil {
		building.Conveyor = defaultConveyorState(building.Runtime)
		return
	}
	if !building.Conveyor.Output.Valid() {
		output := ConveyorEast
		building.Conveyor.Output = output
	}
	if !building.Conveyor.Input.Valid() {
		building.Conveyor.Input = building.Conveyor.Output.Opposite()
	}
	if building.Conveyor.Output != ConveyorAuto && building.Conveyor.Input == building.Conveyor.Output {
		building.Conveyor.Input = building.Conveyor.Output.Opposite()
	}
	if building.Runtime.Functions.Transport != nil {
		if building.Runtime.Functions.Transport.Throughput > 0 {
			building.Conveyor.Throughput = building.Runtime.Functions.Transport.Throughput
		}
		if building.Runtime.Functions.Transport.StackLimit > 0 {
			building.Conveyor.MaxStack = building.Runtime.Functions.Transport.StackLimit
		}
	}
	if building.Conveyor.Throughput <= 0 {
		building.Conveyor.Throughput = 1
	}
	if building.Conveyor.MaxStack <= 0 {
		building.Conveyor.MaxStack = 1
	}
}

func defaultConveyorState(runtime BuildingRuntime) *ConveyorState {
	output := ConveyorEast
	input := output.Opposite()
	throughput := 1
	stackLimit := 1
	if runtime.Functions.Transport != nil {
		if runtime.Functions.Transport.Throughput > 0 {
			throughput = runtime.Functions.Transport.Throughput
		}
		if runtime.Functions.Transport.StackLimit > 0 {
			stackLimit = runtime.Functions.Transport.StackLimit
		}
	}
	return &ConveyorState{
		Input:      input,
		Output:     output,
		MaxStack:   stackLimit,
		Throughput: throughput,
	}
}
