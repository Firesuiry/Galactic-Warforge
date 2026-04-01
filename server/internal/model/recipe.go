package model

// RecipeDefinition captures a production recipe.
type RecipeDefinition struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Inputs        []ItemAmount   `json:"inputs"`
	Outputs       []ItemAmount   `json:"outputs"`
	Byproducts    []ItemAmount   `json:"byproducts,omitempty"`
	Duration      int            `json:"duration"`
	EnergyCost    int            `json:"energy_cost"`
	BuildingTypes []BuildingType `json:"building_types"`
	TechUnlock    []string       `json:"tech_unlock,omitempty"`
}

// AllOutputs returns the main outputs plus byproducts.
func (r RecipeDefinition) AllOutputs() []ItemAmount {
	if len(r.Byproducts) == 0 {
		return r.Outputs
	}
	outs := make([]ItemAmount, 0, len(r.Outputs)+len(r.Byproducts))
	outs = append(outs, r.Outputs...)
	outs = append(outs, r.Byproducts...)
	return outs
}

var recipeCatalog = map[string]RecipeDefinition{
	"smelt_iron": {
		ID:            "smelt_iron",
		Name:          "Smelt Iron",
		Inputs:        []ItemAmount{{ItemID: ItemIronOre, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemIronIngot, Quantity: 1}},
		Duration:      60,
		EnergyCost:    1,
		BuildingTypes: []BuildingType{BuildingTypeArcSmelter, BuildingTypePlaneSmelter, BuildingTypeNegentropySmelter},
		TechUnlock:    []string{"smelting"},
	},
	"smelt_copper": {
		ID:            "smelt_copper",
		Name:          "Smelt Copper",
		Inputs:        []ItemAmount{{ItemID: ItemCopperOre, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemCopperIngot, Quantity: 1}},
		Duration:      60,
		EnergyCost:    1,
		BuildingTypes: []BuildingType{BuildingTypeArcSmelter, BuildingTypePlaneSmelter, BuildingTypeNegentropySmelter},
		TechUnlock:    []string{"smelting"},
	},
	"smelt_stone": {
		ID:            "smelt_stone",
		Name:          "Smelt Stone",
		Inputs:        []ItemAmount{{ItemID: ItemStoneOre, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemStoneBrick, Quantity: 1}},
		Duration:      50,
		EnergyCost:    1,
		BuildingTypes: []BuildingType{BuildingTypeArcSmelter, BuildingTypePlaneSmelter, BuildingTypeNegentropySmelter},
		TechUnlock:    []string{"smelting"},
	},
	"smelt_silicon": {
		ID:            "smelt_silicon",
		Name:          "Smelt Silicon",
		Inputs:        []ItemAmount{{ItemID: ItemSiliconOre, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemSiliconIngot, Quantity: 1}},
		Duration:      60,
		EnergyCost:    2,
		BuildingTypes: []BuildingType{BuildingTypeArcSmelter, BuildingTypePlaneSmelter, BuildingTypeNegentropySmelter},
		TechUnlock:    []string{"smelting"},
	},
	"smelt_titanium": {
		ID:            "smelt_titanium",
		Name:          "Smelt Titanium",
		Inputs:        []ItemAmount{{ItemID: ItemTitaniumOre, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemTitaniumIngot, Quantity: 1}},
		Duration:      60,
		EnergyCost:    2,
		BuildingTypes: []BuildingType{BuildingTypeArcSmelter, BuildingTypePlaneSmelter, BuildingTypeNegentropySmelter},
		TechUnlock:    []string{"smelting"},
	},
	"coal_to_graphite": {
		ID:            "coal_to_graphite",
		Name:          "Coal To Energetic Graphite",
		Inputs:        []ItemAmount{{ItemID: ItemCoal, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemEnergeticGraphite, Quantity: 1}},
		Duration:      30,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"basic_fuels"},
	},
	"oil_fractionation": {
		ID:            "oil_fractionation",
		Name:          "Oil Fractionation",
		Inputs:        []ItemAmount{{ItemID: ItemCrudeOil, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemRefinedOil, Quantity: 1}},
		Duration:      60,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"oil_processing"},
	},
	"plastic": {
		ID:            "plastic",
		Name:          "Plastic",
		Inputs:        []ItemAmount{{ItemID: ItemRefinedOil, Quantity: 1}, {ItemID: ItemEnergeticGraphite, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemPlastic, Quantity: 2}},
		Duration:      40,
		EnergyCost:    1,
		BuildingTypes: []BuildingType{BuildingTypeChemicalPlant, BuildingTypeQuantumChemicalPlant},
		TechUnlock:    []string{"chemical_processing"},
	},
	"sulfuric_acid": {
		ID:            "sulfuric_acid",
		Name:          "Sulfuric Acid",
		Inputs:        []ItemAmount{{ItemID: ItemRefinedOil, Quantity: 2}, {ItemID: ItemStoneOre, Quantity: 1}, {ItemID: ItemWater, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemSulfuricAcid, Quantity: 2}},
		Duration:      60,
		EnergyCost:    2,
		BuildingTypes: []BuildingType{BuildingTypeChemicalPlant, BuildingTypeQuantumChemicalPlant},
		TechUnlock:    []string{"chemical_processing"},
	},
	"graphene_from_graphite": {
		ID:            "graphene_from_graphite",
		Name:          "Graphene From Graphite",
		Inputs:        []ItemAmount{{ItemID: ItemEnergeticGraphite, Quantity: 2}, {ItemID: ItemSulfuricAcid, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemGraphene, Quantity: 2}},
		Duration:      50,
		EnergyCost:    2,
		BuildingTypes: []BuildingType{BuildingTypeChemicalPlant, BuildingTypeQuantumChemicalPlant},
		TechUnlock:    []string{"chemical_processing"},
	},
	"carbon_nanotube": {
		ID:            "carbon_nanotube",
		Name:          "Carbon Nanotube",
		Inputs:        []ItemAmount{{ItemID: ItemGraphene, Quantity: 2}, {ItemID: ItemTitaniumIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemCarbonNanotube, Quantity: 2}},
		Duration:      70,
		EnergyCost:    2,
		BuildingTypes: []BuildingType{BuildingTypeChemicalPlant, BuildingTypeQuantumChemicalPlant},
		TechUnlock:    []string{"chemical_processing"},
	},
	"gear": {
		ID:            "gear",
		Name:          "Gear",
		Inputs:        []ItemAmount{{ItemID: ItemIronIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemGear, Quantity: 1}},
		Duration:      20,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"basic_components"},
	},
	"motor": {
		ID:            "motor",
		Name:          "Motor",
		Inputs:        []ItemAmount{{ItemID: ItemGear, Quantity: 1}, {ItemID: ItemCircuitBoard, Quantity: 1}, {ItemID: ItemIronIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemMotor, Quantity: 1}},
		Duration:      40,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"basic_components"},
	},
	"circuit_board": {
		ID:            "circuit_board",
		Name:          "Circuit Board",
		Inputs:        []ItemAmount{{ItemID: ItemIronIngot, Quantity: 1}, {ItemID: ItemCopperIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemCircuitBoard, Quantity: 1}},
		Duration:      30,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"basic_components"},
	},
	"microcrystalline_component": {
		ID:            "microcrystalline_component",
		Name:          "Microcrystalline Component",
		Inputs:        []ItemAmount{{ItemID: ItemSiliconIngot, Quantity: 2}, {ItemID: ItemCopperIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemMicrocrystalline, Quantity: 1}},
		Duration:      40,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"advanced_components"},
	},
	"processor": {
		ID:            "processor",
		Name:          "Processor",
		Inputs:        []ItemAmount{{ItemID: ItemCircuitBoard, Quantity: 2}, {ItemID: ItemMicrocrystalline, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemProcessor, Quantity: 1}},
		Duration:      60,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"advanced_components"},
	},
	"graphene_from_fire_ice": {
		ID:            "graphene_from_fire_ice",
		Name:          "Graphene From Fire Ice",
		Inputs:        []ItemAmount{{ItemID: ItemFireIce, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemGraphene, Quantity: 2}},
		Byproducts:    []ItemAmount{{ItemID: ItemHydrogen, Quantity: 1}},
		Duration:      50,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"rare_resource_processing"},
	},
	"crystal_silicon_from_fractal": {
		ID:            "crystal_silicon_from_fractal",
		Name:          "Crystal Silicon From Fractal Silicon",
		Inputs:        []ItemAmount{{ItemID: ItemFractalSilicon, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemCrystalSilicon, Quantity: 1}},
		Duration:      30,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"rare_resource_processing"},
	},
	"photon_combiner_from_grating": {
		ID:            "photon_combiner_from_grating",
		Name:          "Photon Combiner",
		Inputs:        []ItemAmount{{ItemID: ItemGratingCrystal, Quantity: 1}, {ItemID: ItemCircuitBoard, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemPhotonCombiner, Quantity: 1}},
		Duration:      40,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"rare_resource_processing"},
	},
	"particle_container_from_monopole": {
		ID:            "particle_container_from_monopole",
		Name:          "Particle Container",
		Inputs:        []ItemAmount{{ItemID: ItemMonopoleMagnet, Quantity: 1}, {ItemID: ItemTitaniumIngot, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemParticleContainer, Quantity: 1}},
		Duration:      60,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"rare_resource_processing"},
	},
	"antimatter": {
		ID:            "antimatter",
		Name:          "Antimatter",
		Inputs:        []ItemAmount{{ItemID: ItemCriticalPhoton, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemAntimatter, Quantity: 2}},
		Duration:      120,
		EnergyCost:    8,
		BuildingTypes: []BuildingType{BuildingTypeMiniatureParticleCollider},
		TechUnlock:    []string{"dirac_inversion"},
	},
	"strange_matter": {
		ID:            "strange_matter",
		Name:          "Strange Matter",
		Inputs:        []ItemAmount{{ItemID: ItemParticleContainer, Quantity: 1}, {ItemID: ItemDeuterium, Quantity: 5}, {ItemID: ItemIronIngot, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemStrangeMatter, Quantity: 1}},
		Duration:      120,
		EnergyCost:    6,
		BuildingTypes: []BuildingType{BuildingTypeMiniatureParticleCollider},
		TechUnlock:    []string{"strange_matter"},
	},
	"annihilation_constraint_sphere": {
		ID:            "annihilation_constraint_sphere",
		Name:          "Annihilation Constraint Sphere",
		Inputs:        []ItemAmount{{ItemID: ItemParticleContainer, Quantity: 1}, {ItemID: ItemProcessor, Quantity: 1}, {ItemID: ItemDeuteriumFuelRod, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemAnnihilationConstraintSphere, Quantity: 1}},
		Duration:      120,
		EnergyCost:    3,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"controlled_annihilation"},
	},
	"hydrogen_fuel_rod": {
		ID:            "hydrogen_fuel_rod",
		Name:          "Hydrogen Fuel Rod",
		Inputs:        []ItemAmount{{ItemID: ItemHydrogen, Quantity: 5}, {ItemID: ItemTitaniumIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemHydrogenFuelRod, Quantity: 1}},
		Duration:      60,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"fuel_rods"},
	},
	"deuterium_fuel_rod": {
		ID:            "deuterium_fuel_rod",
		Name:          "Deuterium Fuel Rod",
		Inputs:        []ItemAmount{{ItemID: ItemDeuterium, Quantity: 5}, {ItemID: ItemTitaniumIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemDeuteriumFuelRod, Quantity: 1}},
		Duration:      80,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"fuel_rods"},
	},
	"antimatter_fuel_rod": {
		ID:            "antimatter_fuel_rod",
		Name:          "Antimatter Fuel Rod",
		Inputs:        []ItemAmount{{ItemID: ItemAntimatter, Quantity: 2}, {ItemID: ItemHydrogen, Quantity: 2}, {ItemID: ItemAnnihilationConstraintSphere, Quantity: 1}, {ItemID: ItemTitaniumIngot, Quantity: 2}},
		Outputs:       []ItemAmount{{ItemID: ItemAntimatterFuelRod, Quantity: 1}},
		Duration:      150,
		EnergyCost:    12,
		BuildingTypes: []BuildingType{BuildingTypeRecomposingAssembler},
		TechUnlock:    []string{"controlled_annihilation"},
	},
	"fuel_rod_recycling": {
		ID:            "fuel_rod_recycling",
		Name:          "Fuel Rod Recycling",
		Inputs:        []ItemAmount{{ItemID: ItemDeuteriumFuelRod, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemDeuterium, Quantity: 2}, {ItemID: ItemTitaniumIngot, Quantity: 1}},
		Duration:      60,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"recycling"},
	},
	"matrix_blue": {
		ID:            "matrix_blue",
		Name:          "Electromagnetic Matrix",
		Inputs:        []ItemAmount{{ItemID: ItemCircuitBoard, Quantity: 1}, {ItemID: ItemEnergeticGraphite, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemMatrixBlue, Quantity: 1}},
		Duration:      60,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1, BuildingTypeMatrixLab},
		TechUnlock:    []string{"matrix_blue"},
	},
	"matrix_red": {
		ID:            "matrix_red",
		Name:          "Energy Matrix",
		Inputs:        []ItemAmount{{ItemID: ItemEnergeticGraphite, Quantity: 1}, {ItemID: ItemHydrogen, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemMatrixRed, Quantity: 1}},
		Duration:      80,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1, BuildingTypeMatrixLab},
		TechUnlock:    []string{"matrix_red"},
	},
	"matrix_yellow": {
		ID:            "matrix_yellow",
		Name:          "Structure Matrix",
		Inputs:        []ItemAmount{{ItemID: ItemTitaniumIngot, Quantity: 1}, {ItemID: ItemPlastic, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemMatrixYellow, Quantity: 1}},
		Duration:      90,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1, BuildingTypeMatrixLab},
		TechUnlock:    []string{"matrix_yellow"},
	},
	"matrix_universe": {
		ID:            "matrix_universe",
		Name:          "Universe Matrix",
		Inputs:        []ItemAmount{{ItemID: ItemMatrixBlue, Quantity: 1}, {ItemID: ItemMatrixRed, Quantity: 1}, {ItemID: ItemMatrixYellow, Quantity: 1}, {ItemID: ItemStrangeMatter, Quantity: 1}, {ItemID: ItemAntimatter, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemMatrixUniverse, Quantity: 1}},
		Duration:      150,
		EnergyCost:    10,
		BuildingTypes: []BuildingType{BuildingTypeMatrixLab},
		TechUnlock:    []string{"universe_matrix"},
	},
	"ammo_bullet": {
		ID:            "ammo_bullet",
		Name:          "Bullet",
		Inputs:        []ItemAmount{{ItemID: ItemIronIngot, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemAmmoBullet, Quantity: 5}},
		Duration:      20,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"basic_ammo"},
	},
	"ammo_missile": {
		ID:            "ammo_missile",
		Name:          "Missile",
		Inputs:        []ItemAmount{{ItemID: ItemTitaniumIngot, Quantity: 2}, {ItemID: ItemProcessor, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemAmmoMissile, Quantity: 1}},
		Duration:      80,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1},
		TechUnlock:    []string{"advanced_ammo"},
	},
	"solar_sail": {
		ID:            "solar_sail",
		Name:          "Solar Sail",
		Inputs:        []ItemAmount{{ItemID: ItemGraphene, Quantity: 2}, {ItemID: ItemCarbonNanotube, Quantity: 1}},
		Outputs:       []ItemAmount{{ItemID: ItemSolarSail, Quantity: 1}},
		Duration:      30,
		BuildingTypes: []BuildingType{BuildingTypeAssemblingMachineMk1, BuildingTypeAssemblingMachineMk2, BuildingTypeAssemblingMachineMk3},
		TechUnlock:    []string{"solar_sail"},
	},
}

// Recipe returns a recipe definition by id.
func Recipe(id string) (RecipeDefinition, bool) {
	def, ok := recipeCatalog[id]
	return def, ok
}

// AllRecipes returns a copy of recipes for read-only usage.
func AllRecipes() []RecipeDefinition {
	recipes := make([]RecipeDefinition, 0, len(recipeCatalog))
	for _, def := range recipeCatalog {
		recipes = append(recipes, def)
	}
	return recipes
}
