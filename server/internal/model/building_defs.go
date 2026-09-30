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
