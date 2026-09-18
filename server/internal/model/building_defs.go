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
		BuildCost:   BuildCost{Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 18}, {ItemID: "engine", Quantity: 12}, {ItemID: "microcrystalline_component", Quantity: 6}, {ItemID: "steel", Quantity: 12}}},
		Buildable:   true,
	},
	{
		ID:                   BuildingTypeMiningMachine,
		Name:                 "Mining Machine",
		Category:             BuildingCategoryCollect,
		Subcategory:          BuildingSubcategoryCollect,
		Footprint:            defaultFootprint,
		BuildCost:            BuildCost{Minerals: 50, Energy: 20, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "gear", Quantity: 2}, {ItemID: "iron_ingot", Quantity: 4}, {ItemID: "magnetic_coil", Quantity: 2}}},
		Buildable:            true,
		RequiresResourceNode: true,
	},
	{
		ID:                   BuildingTypeAdvancedMiningMachine,
		Name:                 "Advanced Mining Machine",
		Category:             BuildingCategoryCollect,
		Subcategory:          BuildingSubcategoryCollect,
		Footprint:            defaultFootprint,
		BuildCost:            BuildCost{Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 10}, {ItemID: "grating_crystal", Quantity: 40}, {ItemID: "quantum_chip", Quantity: 4}, {ItemID: "super_magnetic_ring", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 20}}},
		Buildable:            true,
		RequiresResourceNode: true,
	},
	{
		ID:                   BuildingTypeWaterPump,
		Name:                 "Water Pump",
		Category:             BuildingCategoryCollect,
		Subcategory:          BuildingSubcategoryCollect,
		Footprint:            defaultFootprint,
		BuildCost:            BuildCost{Minerals: 80, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "motor", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "stone_brick", Quantity: 4}}},
		RequiresResourceNode: true,
		Buildable:            true,
	},
	{
		ID:                   BuildingTypeOilExtractor,
		Name:                 "Oil Extractor",
		Category:             BuildingCategoryCollect,
		Subcategory:          BuildingSubcategoryCollect,
		Footprint:            defaultFootprint,
		BuildCost:            BuildCost{Minerals: 80, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 6}, {ItemID: "plasma_exciter", Quantity: 4}, {ItemID: "steel", Quantity: 12}, {ItemID: "stone_brick", Quantity: 12}}},
		RequiresResourceNode: true,
		Buildable:            true,
	},
	{
		ID:          BuildingTypeOrbitalCollector,
		Name:        "Orbital Collector",
		Category:    BuildingCategoryCollect,
		Subcategory: BuildingSubcategoryCollect,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 200, Energy: 80, Items: []ItemAmount{{ItemID: "reinforced_thruster", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 50}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeConveyorBeltMk1,
		Name:        "Conveyor Belt Mk.I",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 4, Energy: 0, Items: []ItemAmount{{ItemID: "gear", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 2}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeConveyorBeltMk2,
		Name:        "Conveyor Belt Mk.II",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 8, Energy: 0, Items: []ItemAmount{{ItemID: "electromagnetic_turbine", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeConveyorBeltMk3,
		Name:        "Conveyor Belt Mk.III",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 12, Energy: 0, Items: []ItemAmount{{ItemID: "graphene", Quantity: 1}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSplitter,
		Name:        "Splitter",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 20, Energy: 10, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 1}, {ItemID: "gear", Quantity: 2}, {ItemID: "iron_ingot", Quantity: 3}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeAutomaticPiler,
		Name:        "Automatic Piler",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 20, Energy: 10, Items: []ItemAmount{{ItemID: "gear", Quantity: 4}, {ItemID: "processor", Quantity: 2}, {ItemID: "steel", Quantity: 3}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeTrafficMonitor,
		Name:        "Traffic Monitor",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "gear", Quantity: 2}, {ItemID: "glass", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 3}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSprayCoater,
		Name:        "Spray Coater",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 60, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "microcrystalline_component", Quantity: 2}, {ItemID: "plasma_exciter", Quantity: 2}, {ItemID: "steel", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSorterMk1,
		Name:        "Sorter Mk.I",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 6, Energy: 0, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSorterMk2,
		Name:        "Sorter Mk.II",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 10, Energy: 0, Items: []ItemAmount{{ItemID: "motor", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSorterMk3,
		Name:        "Sorter Mk.III",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 14, Energy: 0, Items: []ItemAmount{{ItemID: "electromagnetic_turbine", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypePileSorter,
		Name:        "Pile Sorter",
		Category:    BuildingCategoryTransport,
		Subcategory: BuildingSubcategoryTransport,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "processor", Quantity: 1}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeLogisticsDistributor,
		Name:        "Logistics Distributor",
		Category:    BuildingCategoryLogisticsHub,
		Subcategory: BuildingSubcategoryLogisticsHub,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "iron_ingot", Quantity: 8}, {ItemID: "plasma_exciter", Quantity: 4}, {ItemID: "processor", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypePlanetaryLogisticsStation,
		Name:        "Planetary Logistics Station",
		Category:    BuildingCategoryLogisticsHub,
		Subcategory: BuildingSubcategoryLogisticsHub,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 160, Energy: 80, Items: []ItemAmount{{ItemID: "particle_container", Quantity: 20}, {ItemID: "processor", Quantity: 40}, {ItemID: "steel", Quantity: 40}, {ItemID: "titanium_ingot", Quantity: 40}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeInterstellarLogisticsStation,
		Name:        "Interstellar Logistics Station",
		Category:    BuildingCategoryLogisticsHub,
		Subcategory: BuildingSubcategoryLogisticsHub,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 280, Energy: 140, Items: []ItemAmount{{ItemID: "particle_container", Quantity: 20}, {ItemID: "titanium_alloy", Quantity: 40}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeDepotMk1,
		Name:        "Depot Mk.I",
		Category:    BuildingCategoryStorage,
		Subcategory: BuildingSubcategoryStorage,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 60, Energy: 20, Items: []ItemAmount{{ItemID: "iron_ingot", Quantity: 4}, {ItemID: "stone_brick", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeDepotMk2,
		Name:        "Depot Mk.II",
		Category:    BuildingCategoryStorage,
		Subcategory: BuildingSubcategoryStorage,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 60, Energy: 20, Items: []ItemAmount{{ItemID: "steel", Quantity: 8}, {ItemID: "stone_brick", Quantity: 8}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeStorageTank,
		Name:        "Storage Tank",
		Category:    BuildingCategoryStorage,
		Subcategory: BuildingSubcategoryStorage,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 60, Energy: 20, Items: []ItemAmount{{ItemID: "glass", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "stone_brick", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeArcSmelter,
		Name:        "Arc Smelter",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 4}, {ItemID: "magnetic_coil", Quantity: 2}, {ItemID: "stone_brick", Quantity: 2}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypePlaneSmelter,
		Name:        "Plane Smelter",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 180, Energy: 90, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 5}, {ItemID: "monopole_magnet", Quantity: 15}, {ItemID: "plane_filter", Quantity: 4}}},
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
		BuildCost:       BuildCost{Minerals: 100, Energy: 50, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 4}, {ItemID: "gear", Quantity: 8}, {ItemID: "iron_ingot", Quantity: 4}}},
		Buildable:       true,
		CanProduceUnits: true,
	},
	{
		ID:          BuildingTypeAssemblingMachineMk2,
		Name:        "Assembling Machine Mk.II",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 240, Energy: 120, Items: []ItemAmount{{ItemID: "graphene", Quantity: 8}, {ItemID: "processor", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeAssemblingMachineMk3,
		Name:        "Assembling Machine Mk.III",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 360, Energy: 180, Items: []ItemAmount{{ItemID: "particle_broadband", Quantity: 8}, {ItemID: "quantum_chip", Quantity: 2}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeRecomposingAssembler,
		Name:        "Re-Composing Assembler",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 220, Energy: 120},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeOilRefinery,
		Name:        "Oil Refinery",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 140, Energy: 70, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 6}, {ItemID: "plasma_exciter", Quantity: 6}, {ItemID: "steel", Quantity: 10}, {ItemID: "stone_brick", Quantity: 10}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeFractionator,
		Name:        "Fractionator",
		Category:    BuildingCategoryRefining,
		Subcategory: BuildingSubcategoryRefining,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 100, Energy: 60, Items: []ItemAmount{{ItemID: "glass", Quantity: 4}, {ItemID: "processor", Quantity: 1}, {ItemID: "steel", Quantity: 8}, {ItemID: "stone_brick", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeChemicalPlant,
		Name:        "Chemical Plant",
		Category:    BuildingCategoryChemical,
		Subcategory: BuildingSubcategoryChemical,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 140, Energy: 70, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "glass", Quantity: 8}, {ItemID: "steel", Quantity: 8}, {ItemID: "stone_brick", Quantity: 8}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeQuantumChemicalPlant,
		Name:        "Quantum Chemical Plant",
		Category:    BuildingCategoryChemical,
		Subcategory: BuildingSubcategoryChemical,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 220, Energy: 110, Items: []ItemAmount{{ItemID: "quantum_chip", Quantity: 3}, {ItemID: "strange_matter", Quantity: 3}, {ItemID: "titanium_glass", Quantity: 10}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeMiniatureParticleCollider,
		Name:        "Miniature Particle Collider",
		Category:    BuildingCategoryProduction,
		Subcategory: BuildingSubcategoryProduction,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 20}, {ItemID: "graphene", Quantity: 10}, {ItemID: "processor", Quantity: 8}, {ItemID: "super_magnetic_ring", Quantity: 25}, {ItemID: "titanium_alloy", Quantity: 20}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeMatrixLab,
		Name:        "Matrix Lab",
		Category:    BuildingCategoryResearch,
		Subcategory: BuildingSubcategoryResearch,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 4}, {ItemID: "glass", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "magnetic_coil", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSelfEvolutionLab,
		Name:        "Self-Evolution Lab",
		Category:    BuildingCategoryResearch,
		Subcategory: BuildingSubcategoryResearch,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 400, Energy: 200},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeTeslaTower,
		Name:        "Tesla Tower",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 20, Energy: 10, Items: []ItemAmount{{ItemID: "iron_ingot", Quantity: 2}, {ItemID: "magnetic_coil", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeWirelessPowerTower,
		Name:        "Wireless Power Tower",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "plasma_exciter", Quantity: 3}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSatelliteSubstation,
		Name:        "Satellite Substation",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 80, Energy: 40, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 2}, {ItemID: "super_magnetic_ring", Quantity: 10}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeWindTurbine,
		Name:        "Wind Turbine",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 30, Energy: 0, Items: []ItemAmount{{ItemID: "gear", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 6}, {ItemID: "magnetic_coil", Quantity: 3}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeThermalPowerPlant,
		Name:        "Thermal Power Plant",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "gear", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 10}, {ItemID: "magnetic_coil", Quantity: 4}, {ItemID: "stone_brick", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSolarPanel,
		Name:        "Solar Panel",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 0, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 5}, {ItemID: "copper_ingot", Quantity: 10}, {ItemID: "silicon_ingot", Quantity: 10}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeGeothermalPowerStation,
		Name:        "Geothermal Power Station",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "copper_ingot", Quantity: 20}, {ItemID: "photon_combiner", Quantity: 4}, {ItemID: "steel", Quantity: 15}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeMiniFusionPowerPlant,
		Name:        "Mini Fusion Power Plant",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "carbon_nanotube", Quantity: 8}, {ItemID: "processor", Quantity: 4}, {ItemID: "super_magnetic_ring", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 12}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeEnergyExchanger,
		Name:        "Energy Exchanger",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 180, Energy: 80, Items: []ItemAmount{{ItemID: "particle_container", Quantity: 8}, {ItemID: "processor", Quantity: 40}, {ItemID: "steel", Quantity: 40}, {ItemID: "titanium_alloy", Quantity: 40}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeAccumulator,
		Name:        "Accumulator",
		Category:    BuildingCategoryPowerGrid,
		Subcategory: BuildingSubcategoryPowerGrid,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "crystal_silicon", Quantity: 3}, {ItemID: "iron_ingot", Quantity: 6}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
		Buildable:   true,
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
		BuildCost:   BuildCost{Minerals: 260, Energy: 130, Items: []ItemAmount{{ItemID: "photon_combiner", Quantity: 10}, {ItemID: "processor", Quantity: 5}, {ItemID: "silicon_ingot", Quantity: 20}, {ItemID: "steel", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 20}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeArtificialStar,
		Name:        "Artificial Star",
		Category:    BuildingCategoryPower,
		Subcategory: BuildingSubcategoryPower,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "annihilation_constraint_sphere", Quantity: 10}, {ItemID: "frame_material", Quantity: 20}, {ItemID: "quantum_chip", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 20}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeGaussTurret,
		Name:        "Gauss Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 80, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "gear", Quantity: 8}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "magnetic_coil", Quantity: 4}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeMissileTurret,
		Name:        "Missile Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 12}, {ItemID: "engine", Quantity: 6}, {ItemID: "motor", Quantity: 6}, {ItemID: "steel", Quantity: 8}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeImplosionCannon,
		Name:        "Implosion Cannon",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 10}, {ItemID: "motor", Quantity: 8}, {ItemID: "steel", Quantity: 10}, {ItemID: "super_magnetic_ring", Quantity: 2}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeLaserTurret,
		Name:        "Laser Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 6}, {ItemID: "photon_combiner", Quantity: 9}, {ItemID: "plasma_exciter", Quantity: 6}, {ItemID: "steel", Quantity: 9}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypePlasmaTurret,
		Name:        "Plasma Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "plasma_exciter", Quantity: 5}, {ItemID: "processor", Quantity: 5}, {ItemID: "super_magnetic_ring", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 20}, {ItemID: "titanium_glass", Quantity: 10}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSRPlasmaTurret,
		Name:        "SR Plasma Turret",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 300, Energy: 150, Items: []ItemAmount{{ItemID: "plasma_exciter", Quantity: 5}, {ItemID: "processor", Quantity: 5}, {ItemID: "steel", Quantity: 15}, {ItemID: "super_magnetic_ring", Quantity: 5}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeJammerTower,
		Name:        "Jammer Tower",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "copper_ingot", Quantity: 12}, {ItemID: "diamond", Quantity: 6}, {ItemID: "plasma_exciter", Quantity: 9}, {ItemID: "processor", Quantity: 3}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeSignalTower,
		Name:        "Signal Tower",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 50, Energy: 20, Items: []ItemAmount{{ItemID: "crystal_silicon", Quantity: 6}, {ItemID: "steel", Quantity: 12}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypePlanetaryShieldGenerator,
		Name:        "Planetary Shield Generator",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 500, Energy: 250, Items: []ItemAmount{{ItemID: "electromagnetic_turbine", Quantity: 20}, {ItemID: "particle_container", Quantity: 5}, {ItemID: "steel", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 5}}},
		Buildable:   true,
	},
	{
		ID:          BuildingTypeEMRailEjector,
		Name:        "EM-Rail Ejector",
		Category:    BuildingCategoryDyson,
		Subcategory: BuildingSubcategoryDyson,
		Footprint:   defaultFootprint,
		BuildCost:   BuildCost{Minerals: 260, Energy: 130, Items: []ItemAmount{{ItemID: "gear", Quantity: 20}, {ItemID: "processor", Quantity: 5}, {ItemID: "steel", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 10}}},
		Buildable:   true,
	},
	{
		ID:              BuildingTypeVerticalLaunchingSilo,
		Name:            "Vertical Launching Silo",
		Category:        BuildingCategoryDyson,
		Subcategory:     BuildingSubcategoryDyson,
		Footprint:       defaultFootprint,
		BuildCost:       BuildCost{Minerals: 260, Energy: 130, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 30}, {ItemID: "graviton_lens", Quantity: 20}, {ItemID: "quantum_chip", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 80}}},
		Buildable:       true,
		DefaultRecipeID: "small_carrier_rocket",
	},
	{
		ID:          BuildingTypeFoundation,
		Name:        "Foundation",
		Category:    BuildingCategoryCommandSignal,
		Subcategory: BuildingSubcategoryCommandSignal,
		Footprint:   defaultFootprint,
		Buildable:   true,
	},
}
