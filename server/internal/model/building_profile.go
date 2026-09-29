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
	case BuildingTypeAssemblingMachineMk2:
		profile.MaxHP = 280 + 100*level
		profile.VisionRange = 3
	case BuildingTypeAssemblingMachineMk3:
		profile.MaxHP = 380 + 120*level
		profile.VisionRange = 4
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

// BuildingProfileSpec 建筑基础属性（buildings.yaml 每个条目的 profile 段）。
// 等级 level（≥1）下最大血量 = MaxHPBase + MaxHPPerLevel*level。
type BuildingProfileSpec struct {
	MaxHPBase     int        `yaml:"max_hp_base,omitempty"`
	MaxHPPerLevel int        `yaml:"max_hp_per_level,omitempty"`
	VisionRange   int        `yaml:"vision_range,omitempty"`
	// WeaponClass 炮塔武器类型（R6 克制），带 combat 模块的建筑必填。
	WeaponClass WeaponType `yaml:"weapon_class,omitempty"`
	// LevelBonus 每升一级在运行时模块上叠加的数值。
	LevelBonus BuildingLevelBonus `yaml:"level_bonus,omitempty"`
}

// BuildingLevelBonus 每级（相对 1 级）的运行时数值加成。
type BuildingLevelBonus struct {
	CollectYield int `yaml:"collect_yield,omitempty"` // collect.yield_per_tick
	EnergyOutput int `yaml:"energy_output,omitempty"` // energy.output_per_tick
	CombatAttack int `yaml:"combat_attack,omitempty"` // combat.attack
	CombatRange  int `yaml:"combat_range,omitempty"`  // combat.range
}

// buildingProfileFromSpec 按配置计算指定等级（≥1）的建筑档案。
func buildingProfileFromSpec(spec BuildingProfileSpec, def BuildingRuntimeDefinition, level int) BuildingProfile {
	runtime := buildRuntimeFromDefinition(def)
	scale := level - 1
	bonus := spec.LevelBonus
	if collect := runtime.Functions.Collect; collect != nil {
		collect.YieldPerTick += bonus.CollectYield * scale
	}
	if energy := runtime.Functions.Energy; energy != nil {
		energy.OutputPerTick += bonus.EnergyOutput * scale
	}
	if combat := runtime.Functions.Combat; combat != nil {
		combat.Attack += bonus.CombatAttack * scale
		combat.Range += bonus.CombatRange * scale
	}
	syncRuntimeParams(&runtime)
	runtime.State = BuildingWorkRunning
	return BuildingProfile{
		MaxHP:       spec.MaxHPBase + spec.MaxHPPerLevel*level,
		VisionRange: spec.VisionRange,
		Runtime:     runtime,
	}
}
