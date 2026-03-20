package model

// BuildingProfile aggregates base stats and runtime parameters for a building.
type BuildingProfile struct {
	MaxHP       int             `json:"max_hp"`
	VisionRange int             `json:"vision_range"`
	Runtime     BuildingRuntime `json:"runtime"`
}

// BuildingProfileFor returns the runtime profile for a building type at a given level.
func BuildingProfileFor(btype BuildingType, level int) BuildingProfile {
	if level <= 0 {
		level = 1
	}
	def, _ := BuildingRuntimeDefinitionByID(btype)
	runtime := buildRuntimeFromDefinition(def)
	profile := BuildingProfile{
		Runtime: runtime,
	}

	switch btype {
	case BuildingTypeBattlefieldAnalysisBase:
		profile.MaxHP = 500 + 200*level
		profile.VisionRange = 5
	case BuildingTypeMiningMachine:
		profile.MaxHP = 150 + 50*level
		profile.VisionRange = 2
		scale := 3 * (level - 1)
		if runtime.Functions.Collect != nil {
			runtime.Functions.Collect.YieldPerTick += scale
		}
	case BuildingTypeSolarPanel:
		profile.MaxHP = 100 + 30*level
		profile.VisionRange = 2
		scale := 4 * (level - 1)
		if runtime.Functions.Energy != nil {
			runtime.Functions.Energy.OutputPerTick += scale
		}
	case BuildingTypeAssemblingMachineMk1:
		profile.MaxHP = 200 + 80*level
		profile.VisionRange = 3
	case BuildingTypeGaussTurret:
		profile.MaxHP = 120 + 40*level
		profile.VisionRange = 6
		scale := level - 1
		if runtime.Functions.Combat != nil {
			runtime.Functions.Combat.Attack += 5 * scale
			runtime.Functions.Combat.Range += scale
		}
	}

	syncRuntimeParams(&runtime)
	runtime.State = BuildingWorkRunning
	profile.Runtime = runtime

	if profile.MaxHP == 0 {
		profile.MaxHP = 100 + 20*level
		profile.VisionRange = 2
	}

	return profile
}

func buildRuntimeFromDefinition(def BuildingRuntimeDefinition) BuildingRuntime {
	return BuildingRuntime{
		Params:    def.Params.clone(),
		Functions: def.Functions.clone(),
		State:     BuildingWorkIdle,
	}
}

func syncRuntimeParams(runtime *BuildingRuntime) {
	if runtime == nil {
		return
	}
	if runtime.Functions.Energy != nil {
		runtime.Params.EnergyGenerate = runtime.Functions.Energy.OutputPerTick
		runtime.Params.EnergyConsume = runtime.Functions.Energy.ConsumePerTick
	}
	if runtime.Functions.Collect != nil {
		runtime.Params.Capacity = runtime.Functions.Collect.YieldPerTick
	} else if runtime.Functions.Production != nil {
		runtime.Params.Capacity = runtime.Functions.Production.Throughput
	} else if runtime.Functions.Spray != nil {
		runtime.Params.Capacity = runtime.Functions.Spray.Throughput
	}
}
