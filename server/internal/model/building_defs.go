package model

// BuildingType identifies a building definition.
type BuildingType string

const (
	BuildingTypeBattlefieldAnalysisBase BuildingType = "battlefield_analysis_base"

	BuildingTypeMiningMachine         BuildingType = "mining_machine"
	BuildingTypeAdvancedMiningMachine BuildingType = "advanced_mining_machine"
	BuildingTypeWaterPump             BuildingType = "water_pump"
	BuildingTypeOilExtractor          BuildingType = "oil_extractor"
	BuildingTypeOrbitalCollector      BuildingType = "orbital_collector"

	BuildingTypeConveyorBeltMk1 BuildingType = "conveyor_belt_mk1"
	BuildingTypeConveyorBeltMk2 BuildingType = "conveyor_belt_mk2"
	BuildingTypeConveyorBeltMk3 BuildingType = "conveyor_belt_mk3"
	BuildingTypeSplitter        BuildingType = "splitter"
	BuildingTypeAutomaticPiler  BuildingType = "automatic_piler"
	BuildingTypeTrafficMonitor  BuildingType = "traffic_monitor"
	BuildingTypeSprayCoater     BuildingType = "spray_coater"
	BuildingTypeSorterMk1       BuildingType = "sorter_mk1"
	BuildingTypeSorterMk2       BuildingType = "sorter_mk2"
	BuildingTypeSorterMk3       BuildingType = "sorter_mk3"
	BuildingTypePileSorter      BuildingType = "pile_sorter"

	BuildingTypeLogisticsDistributor         BuildingType = "logistics_distributor"
	BuildingTypePlanetaryLogisticsStation    BuildingType = "planetary_logistics_station"
	BuildingTypeInterstellarLogisticsStation BuildingType = "interstellar_logistics_station"

	BuildingTypeDepotMk1    BuildingType = "depot_mk1"
	BuildingTypeDepotMk2    BuildingType = "depot_mk2"
	BuildingTypeStorageTank BuildingType = "storage_tank"

	BuildingTypeArcSmelter                BuildingType = "arc_smelter"
	BuildingTypePlaneSmelter              BuildingType = "plane_smelter"
	BuildingTypeNegentropySmelter         BuildingType = "negentropy_smelter"
	BuildingTypeAssemblingMachineMk1      BuildingType = "assembling_machine_mk1"
	BuildingTypeAssemblingMachineMk2      BuildingType = "assembling_machine_mk2"
	BuildingTypeAssemblingMachineMk3      BuildingType = "assembling_machine_mk3"
	BuildingTypeRecomposingAssembler      BuildingType = "recomposing_assembler"
	BuildingTypeOilRefinery               BuildingType = "oil_refinery"
	BuildingTypeFractionator              BuildingType = "fractionator"
	BuildingTypeChemicalPlant             BuildingType = "chemical_plant"
	BuildingTypeQuantumChemicalPlant      BuildingType = "quantum_chemical_plant"
	BuildingTypeMiniatureParticleCollider BuildingType = "miniature_particle_collider"
	BuildingTypeMatrixLab                 BuildingType = "matrix_lab"
	BuildingTypeSelfEvolutionLab          BuildingType = "self_evolution_lab"

	BuildingTypeTeslaTower             BuildingType = "tesla_tower"
	BuildingTypeWirelessPowerTower     BuildingType = "wireless_power_tower"
	BuildingTypeSatelliteSubstation    BuildingType = "satellite_substation"
	BuildingTypeWindTurbine            BuildingType = "wind_turbine"
	BuildingTypeThermalPowerPlant      BuildingType = "thermal_power_plant"
	BuildingTypeSolarPanel             BuildingType = "solar_panel"
	BuildingTypeGeothermalPowerStation BuildingType = "geothermal_power_station"
	BuildingTypeMiniFusionPowerPlant   BuildingType = "mini_fusion_power_plant"
	BuildingTypeEnergyExchanger        BuildingType = "energy_exchanger"
	BuildingTypeAccumulator            BuildingType = "accumulator"
	BuildingTypeAccumulatorFull        BuildingType = "accumulator_full"
	BuildingTypeRayReceiver            BuildingType = "ray_receiver"
	BuildingTypeArtificialStar         BuildingType = "artificial_star"

	BuildingTypeGaussTurret              BuildingType = "gauss_turret"
	BuildingTypeMissileTurret            BuildingType = "missile_turret"
	BuildingTypeImplosionCannon          BuildingType = "implosion_cannon"
	BuildingTypeLaserTurret              BuildingType = "laser_turret"
	BuildingTypePlasmaTurret             BuildingType = "plasma_turret"
	BuildingTypeSRPlasmaTurret           BuildingType = "sr_plasma_turret"
	BuildingTypeJammerTower              BuildingType = "jammer_tower"
	BuildingTypeSignalTower              BuildingType = "signal_tower"
	BuildingTypePlanetaryShieldGenerator BuildingType = "planetary_shield_generator"

	BuildingTypeEMRailEjector         BuildingType = "em_rail_ejector"
	BuildingTypeVerticalLaunchingSilo BuildingType = "vertical_launching_silo"
	BuildingTypeFoundation            BuildingType = "foundation"
)

var defaultFootprint = Footprint{Width: 1, Height: 1}

var defaultBuildingDefinitions = []BuildingDefinition{
	{
		ID:          BuildingTypeBattlefieldAnalysisBase,
		Name:        "Battlefield Analysis Base",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 0, Energy: 0},
	},
	{
		ID:                   BuildingTypeMiningMachine,
		Name:                 "Mining Machine",
		Category:             BuildingCategoryCollect,
		Subcategory:          BuildingSubcategoryCollect,
		Footprint:            defaultFootprint,
		BuildCost:            BuildCost{Minerals: 50, Energy: 20},
		Buildable:            true,
		RequiresResourceNode: true,
	},
	{
		ID:          BuildingTypeAdvancedMiningMachine,
		Name:        "Advanced Mining Machine",
		Category:    BuildingCategoryCollect,
		Subcategory: BuildingSubcategoryCollect,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeWaterPump,
		Name:        "Water Pump",
		Category:    BuildingCategoryCollect,
		Subcategory: BuildingSubcategoryCollect,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeOilExtractor,
		Name:        "Oil Extractor",
		Category:    BuildingCategoryCollect,
		Subcategory: BuildingSubcategoryCollect,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeOrbitalCollector,
		Name:        "Orbital Collector",
		Category:    BuildingCategoryCollect,
		Subcategory: BuildingSubcategoryCollect,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 200, Energy: 80},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeConveyorBeltMk1,
		Name:        "Conveyor Belt Mk.I",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeConveyorBeltMk2,
		Name:        "Conveyor Belt Mk.II",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeConveyorBeltMk3,
		Name:        "Conveyor Belt Mk.III",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSplitter,
		Name:        "Splitter",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeAutomaticPiler,
		Name:        "Automatic Piler",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeTrafficMonitor,
		Name:        "Traffic Monitor",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSprayCoater,
		Name:        "Spray Coater",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSorterMk1,
		Name:        "Sorter Mk.I",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSorterMk2,
		Name:        "Sorter Mk.II",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSorterMk3,
		Name:        "Sorter Mk.III",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypePileSorter,
		Name:        "Pile Sorter",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeLogisticsDistributor,
		Name:        "Logistics Distributor",
		Category:    BuildingCategoryLogisticsHub,
		Subcategory: BuildingSubcategoryLogisticsHub,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypePlanetaryLogisticsStation,
		Name:        "Planetary Logistics Station",
		Category:    BuildingCategoryLogisticsHub,
		Subcategory: BuildingSubcategoryLogisticsHub,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeInterstellarLogisticsStation,
		Name:        "Interstellar Logistics Station",
		Category:    BuildingCategoryLogisticsHub,
		Subcategory: BuildingSubcategoryLogisticsHub,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeDepotMk1,
		Name:        "Depot Mk.I",
		Category:    BuildingCategoryStorage,
		Subcategory: BuildingSubcategoryStorage,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeDepotMk2,
		Name:        "Depot Mk.II",
		Category:    BuildingCategoryStorage,
		Subcategory: BuildingSubcategoryStorage,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeStorageTank,
		Name:        "Storage Tank",
		Category:    BuildingCategoryStorage,
		Subcategory: BuildingSubcategoryStorage,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeArcSmelter,
		Name:        "Arc Smelter",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 120, Energy: 60},
		Buildable:   true,
	},
	{
		ID:          BuildingTypePlaneSmelter,
		Name:        "Plane Smelter",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 180, Energy: 90},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeNegentropySmelter,
		Name:        "Negentropy Smelter",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 240, Energy: 120},
		Buildable:   true,
	},
	{
		ID:              BuildingTypeAssemblingMachineMk1,
		Name:            "Assembling Machine Mk.I",
		Category:        BuildingCategoryProduction,
		Subcategory:     BuildingSubcategoryProduction,
		Footprint:       defaultFootprint,
		BuildCost:       BuildCost{Minerals: 100, Energy: 50},
		Buildable:       true,
		CanProduceUnits: true,
	},
	{
		ID:          BuildingTypeAssemblingMachineMk2,
		Name:        "Assembling Machine Mk.II",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeAssemblingMachineMk3,
		Name:        "Assembling Machine Mk.III",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeRecomposingAssembler,
		Name:        "Re-Composing Assembler",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeOilRefinery,
		Name:        "Oil Refinery",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeFractionator,
		Name:        "Fractionator",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeChemicalPlant,
		Name:        "Chemical Plant",
		Category:    BuildingCategoryChemical,
		Subcategory: BuildingSubcategoryChemical,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 140, Energy: 70},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeQuantumChemicalPlant,
		Name:        "Quantum Chemical Plant",
		Category:    BuildingCategoryChemical,
		Subcategory: BuildingSubcategoryChemical,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 220, Energy: 110},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeMiniatureParticleCollider,
		Name:        "Miniature Particle Collider",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeMatrixLab,
		Name:        "Matrix Lab",
		Category:    BuildingCategoryResearch,
		Subcategory: BuildingSubcategoryResearch,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSelfEvolutionLab,
		Name:        "Self-Evolution Lab",
		Category:    BuildingCategoryResearch,
		Subcategory: BuildingSubcategoryResearch,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeTeslaTower,
		Name:        "Tesla Tower",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeWirelessPowerTower,
		Name:        "Wireless Power Tower",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSatelliteSubstation,
		Name:        "Satellite Substation",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeWindTurbine,
		Name:        "Wind Turbine",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeThermalPowerPlant,
		Name:        "Thermal Power Plant",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSolarPanel,
		Name:        "Solar Panel",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 0},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeGeothermalPowerStation,
		Name:        "Geothermal Power Station",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeMiniFusionPowerPlant,
		Name:        "Mini Fusion Power Plant",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeEnergyExchanger,
		Name:        "Energy Exchanger",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeAccumulator,
		Name:        "Accumulator",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeAccumulatorFull,
		Name:        "Accumulator (Full)",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeRayReceiver,
		Name:        "Ray Receiver",
		Category:    BuildingCategoryDyson,
		Subcategory: BuildingSubcategoryDyson,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeArtificialStar,
		Name:        "Artificial Star",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeGaussTurret,
		Name:        "Gauss Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 80, Energy: 30},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeMissileTurret,
		Name:        "Missile Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeImplosionCannon,
		Name:        "Implosion Cannon",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeLaserTurret,
		Name:        "Laser Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypePlasmaTurret,
		Name:        "Plasma Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSRPlasmaTurret,
		Name:        "SR Plasma Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeJammerTower,
		Name:        "Jammer Tower",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeSignalTower,
		Name:        "Signal Tower",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypePlanetaryShieldGenerator,
		Name:        "Planetary Shield Generator",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeEMRailEjector,
		Name:        "EM-Rail Ejector",
		Category:    BuildingCategoryDyson,
		Subcategory: BuildingSubcategoryDyson,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeVerticalLaunchingSilo,
		Name:        "Vertical Launching Silo",
		Category:    BuildingCategoryDyson,
		Subcategory: BuildingSubcategoryDyson,
		Footprint:   defaultFootprint,
	},
	{
		ID:          BuildingTypeFoundation,
		Name:        "Foundation",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
	},
}
