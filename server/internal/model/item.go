package model

import "fmt"

// ItemCategory describes the high-level classification of an item.
type ItemCategory string

const (
	ItemCategoryOre       ItemCategory = "ore"
	ItemCategoryMaterial  ItemCategory = "material"
	ItemCategoryComponent ItemCategory = "component"
	ItemCategoryFuel      ItemCategory = "fuel"
	ItemCategoryMatrix    ItemCategory = "matrix"
	ItemCategoryAmmo      ItemCategory = "ammo"
	ItemCategoryContainer ItemCategory = "container"
)

// ResourceForm describes whether an item is solid, liquid, or gas.
type ResourceForm string

const (
	ResourceSolid  ResourceForm = "solid"
	ResourceLiquid ResourceForm = "liquid"
	ResourceGas    ResourceForm = "gas"
)

const (
	ItemLiquidTank = "liquid_tank"
	ItemGasTank    = "gas_tank"

	ItemIronOre        = "iron_ore"
	ItemCopperOre      = "copper_ore"
	ItemStoneOre       = "stone_ore"
	ItemSiliconOre     = "silicon_ore"
	ItemTitaniumOre    = "titanium_ore"
	ItemCoal           = "coal"
	ItemFireIce        = "fire_ice"
	ItemFractalSilicon = "fractal_silicon"
	ItemGratingCrystal = "grating_crystal"
	ItemMonopoleMagnet = "monopole_magnet"

	ItemCrudeOil     = "crude_oil"
	ItemRefinedOil   = "refined_oil"
	ItemWater        = "water"
	ItemSulfuricAcid = "sulfuric_acid"
	ItemHydrogen     = "hydrogen"
	ItemDeuterium    = "deuterium"

	ItemIronIngot      = "iron_ingot"
	ItemCopperIngot    = "copper_ingot"
	ItemStoneBrick     = "stone_brick"
	ItemGlass          = "glass"
	ItemSiliconIngot   = "silicon_ingot"
	ItemTitaniumIngot  = "titanium_ingot"
	ItemGraphene       = "graphene"
	ItemCarbonNanotube = "carbon_nanotube"
	ItemCrystalSilicon = "crystal_silicon"
	ItemPlastic        = "plastic"

	ItemGear                         = "gear"
	ItemMotor                        = "motor"
	ItemCircuitBoard                 = "circuit_board"
	ItemMicrocrystalline             = "microcrystalline_component"
	ItemProcessor                    = "processor"
	ItemTitaniumCrystal              = "titanium_crystal"
	ItemTitaniumAlloy                = "titanium_alloy"
	ItemFrameMaterial                = "frame_material"
	ItemQuantumChip                  = "quantum_chip"
	ItemPhotonCombiner               = "photon_combiner"
	ItemCriticalPhoton               = "critical_photon"
	ItemAntimatter                   = "antimatter"
	ItemParticleContainer            = "particle_container"
	ItemAnnihilationConstraintSphere = "annihilation_constraint_sphere"
	ItemStrangeMatter                = "strange_matter"
	ItemSpaceWarper                  = "space_warper"

	ItemEnergeticGraphite = "energetic_graphite"
	ItemHydrogenFuelRod   = "hydrogen_fuel_rod"
	ItemDeuteriumFuelRod  = "deuterium_fuel_rod"
	ItemAntimatterFuelRod = "antimatter_fuel_rod"
	ItemProliferatorMk1   = "proliferator_mk1"
	ItemProliferatorMk2   = "proliferator_mk2"
	ItemProliferatorMk3   = "proliferator_mk3"

	ItemElectromagneticMatrix = "electromagnetic_matrix"
	ItemEnergyMatrix          = "energy_matrix"
	ItemStructureMatrix       = "structure_matrix"
	ItemInformationMatrix     = "information_matrix"
	ItemGravityMatrix         = "gravity_matrix"
	ItemDarkFogMatrix         = "dark_fog_matrix"
	ItemUniverseMatrix        = "universe_matrix"

	ItemMatrixBlue     = "matrix_blue"
	ItemMatrixRed      = "matrix_red"
	ItemMatrixYellow   = "matrix_yellow"
	ItemMatrixUniverse = "matrix_universe"

	ItemAmmoBullet  = "ammo_bullet"
	ItemAmmoMissile = "ammo_missile"

	ItemSolarSail          = "solar_sail"
	ItemSmallCarrierRocket = "small_carrier_rocket"
)

// ItemDefinition defines immutable data for an item.
type ItemDefinition struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Category    ItemCategory `json:"category"`
	Form        ResourceForm `json:"form"`
	StackLimit  int          `json:"stack_limit"`
	UnitVolume  int          `json:"unit_volume"`
	ContainerID string       `json:"container_id,omitempty"`
	IsRare      bool         `json:"is_rare,omitempty"`
}

// ItemAmount couples an item with a quantity.
type ItemAmount struct {
	ItemID   string `json:"item_id"`
	Quantity int    `json:"quantity"`
}

// ItemStack represents a stack of identical items.
type ItemStack struct {
	ItemID   string      `json:"item_id"`
	Quantity int         `json:"quantity"`
	Spray    *SprayState `json:"spray,omitempty"`
}

// Validate ensures the stack conforms to the stack limit rule.
func (s ItemStack) Validate() error {
	if err := ValidateStack(s.ItemID, s.Quantity); err != nil {
		return err
	}
	if s.Spray != nil {
		return s.Spray.Validate()
	}
	return nil
}

// Volume returns the total volume for this stack.
func (s ItemStack) Volume() (int, error) {
	return StackVolume(s.ItemID, s.Quantity)
}

var containerByForm = map[ResourceForm]string{
	ResourceLiquid: ItemLiquidTank,
	ResourceGas:    ItemGasTank,
}

var itemCatalog = map[string]ItemDefinition{
	ItemLiquidTank: {
		ID:         ItemLiquidTank,
		Name:       "Liquid Tank",
		Category:   ItemCategoryContainer,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 6,
	},
	ItemGasTank: {
		ID:         ItemGasTank,
		Name:       "Gas Tank",
		Category:   ItemCategoryContainer,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 6,
	},
	ItemIronOre: {
		ID:         ItemIronOre,
		Name:       "Iron Ore",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemCopperOre: {
		ID:         ItemCopperOre,
		Name:       "Copper Ore",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemStoneOre: {
		ID:         ItemStoneOre,
		Name:       "Stone",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemSiliconOre: {
		ID:         ItemSiliconOre,
		Name:       "Silicon Ore",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemTitaniumOre: {
		ID:         ItemTitaniumOre,
		Name:       "Titanium Ore",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemCoal: {
		ID:         ItemCoal,
		Name:       "Coal",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemFireIce: {
		ID:         ItemFireIce,
		Name:       "Fire Ice",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
		IsRare:     true,
	},
	ItemFractalSilicon: {
		ID:         ItemFractalSilicon,
		Name:       "Fractal Silicon",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
		IsRare:     true,
	},
	ItemGratingCrystal: {
		ID:         ItemGratingCrystal,
		Name:       "Grating Crystal",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
		IsRare:     true,
	},
	ItemMonopoleMagnet: {
		ID:         ItemMonopoleMagnet,
		Name:       "Monopole Magnet",
		Category:   ItemCategoryOre,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
		IsRare:     true,
	},
	ItemCrudeOil: {
		ID:          ItemCrudeOil,
		Name:        "Crude Oil",
		Category:    ItemCategoryMaterial,
		Form:        ResourceLiquid,
		StackLimit:  1000,
		UnitVolume:  1,
		ContainerID: ItemLiquidTank,
	},
	ItemRefinedOil: {
		ID:          ItemRefinedOil,
		Name:        "Refined Oil",
		Category:    ItemCategoryMaterial,
		Form:        ResourceLiquid,
		StackLimit:  1000,
		UnitVolume:  1,
		ContainerID: ItemLiquidTank,
	},
	ItemWater: {
		ID:          ItemWater,
		Name:        "Water",
		Category:    ItemCategoryMaterial,
		Form:        ResourceLiquid,
		StackLimit:  1000,
		UnitVolume:  1,
		ContainerID: ItemLiquidTank,
	},
	ItemSulfuricAcid: {
		ID:          ItemSulfuricAcid,
		Name:        "Sulfuric Acid",
		Category:    ItemCategoryMaterial,
		Form:        ResourceLiquid,
		StackLimit:  1000,
		UnitVolume:  1,
		ContainerID: ItemLiquidTank,
	},
	ItemHydrogen: {
		ID:          ItemHydrogen,
		Name:        "Hydrogen",
		Category:    ItemCategoryMaterial,
		Form:        ResourceGas,
		StackLimit:  1000,
		UnitVolume:  1,
		ContainerID: ItemGasTank,
	},
	ItemDeuterium: {
		ID:          ItemDeuterium,
		Name:        "Deuterium",
		Category:    ItemCategoryMaterial,
		Form:        ResourceGas,
		StackLimit:  1000,
		UnitVolume:  1,
		ContainerID: ItemGasTank,
	},
	ItemIronIngot: {
		ID:         ItemIronIngot,
		Name:       "Iron Ingot",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemCopperIngot: {
		ID:         ItemCopperIngot,
		Name:       "Copper Ingot",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemStoneBrick: {
		ID:         ItemStoneBrick,
		Name:       "Stone Brick",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemGlass: {
		ID:         ItemGlass,
		Name:       "Glass",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemSiliconIngot: {
		ID:         ItemSiliconIngot,
		Name:       "Silicon Ingot",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemTitaniumIngot: {
		ID:         ItemTitaniumIngot,
		Name:       "Titanium Ingot",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemGraphene: {
		ID:         ItemGraphene,
		Name:       "Graphene",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemCarbonNanotube: {
		ID:         ItemCarbonNanotube,
		Name:       "Carbon Nanotube",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemCrystalSilicon: {
		ID:         ItemCrystalSilicon,
		Name:       "Crystal Silicon",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemPlastic: {
		ID:         ItemPlastic,
		Name:       "Plastic",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemGear: {
		ID:         ItemGear,
		Name:       "Gear",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemMotor: {
		ID:         ItemMotor,
		Name:       "Motor",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemCircuitBoard: {
		ID:         ItemCircuitBoard,
		Name:       "Circuit Board",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemMicrocrystalline: {
		ID:         ItemMicrocrystalline,
		Name:       "Microcrystalline Component",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemProcessor: {
		ID:         ItemProcessor,
		Name:       "Processor",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemTitaniumCrystal: {
		ID:         ItemTitaniumCrystal,
		Name:       "Titanium Crystal",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemTitaniumAlloy: {
		ID:         ItemTitaniumAlloy,
		Name:       "Titanium Alloy",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemFrameMaterial: {
		ID:         ItemFrameMaterial,
		Name:       "Frame Material",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemQuantumChip: {
		ID:         ItemQuantumChip,
		Name:       "Quantum Chip",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
	},
	ItemPhotonCombiner: {
		ID:         ItemPhotonCombiner,
		Name:       "Photon Combiner",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 2,
	},
	ItemCriticalPhoton: {
		ID:         ItemCriticalPhoton,
		Name:       "Critical Photon",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
	},
	ItemAntimatter: {
		ID:         ItemAntimatter,
		Name:       "Antimatter",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 1,
	},
	ItemParticleContainer: {
		ID:         ItemParticleContainer,
		Name:       "Particle Container",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 2,
	},
	ItemAnnihilationConstraintSphere: {
		ID:         ItemAnnihilationConstraintSphere,
		Name:       "Annihilation Constraint Sphere",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 2,
	},
	ItemStrangeMatter: {
		ID:         ItemStrangeMatter,
		Name:       "Strange Matter",
		Category:   ItemCategoryMaterial,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 2,
	},
	ItemSpaceWarper: {
		ID:         ItemSpaceWarper,
		Name:       "Space Warper",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemEnergeticGraphite: {
		ID:         ItemEnergeticGraphite,
		Name:       "Energetic Graphite",
		Category:   ItemCategoryFuel,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemHydrogenFuelRod: {
		ID:         ItemHydrogenFuelRod,
		Name:       "Hydrogen Fuel Rod",
		Category:   ItemCategoryFuel,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 2,
	},
	ItemDeuteriumFuelRod: {
		ID:         ItemDeuteriumFuelRod,
		Name:       "Deuterium Fuel Rod",
		Category:   ItemCategoryFuel,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 2,
	},
	ItemAntimatterFuelRod: {
		ID:         ItemAntimatterFuelRod,
		Name:       "Antimatter Fuel Rod",
		Category:   ItemCategoryFuel,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 3,
	},
	ItemProliferatorMk1: {
		ID:         ItemProliferatorMk1,
		Name:       "Proliferator Mk.I",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemProliferatorMk2: {
		ID:         ItemProliferatorMk2,
		Name:       "Proliferator Mk.II",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemProliferatorMk3: {
		ID:         ItemProliferatorMk3,
		Name:       "Proliferator Mk.III",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemElectromagneticMatrix: {
		ID:         ItemElectromagneticMatrix,
		Name:       "Electromagnetic Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemEnergyMatrix: {
		ID:         ItemEnergyMatrix,
		Name:       "Energy Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemStructureMatrix: {
		ID:         ItemStructureMatrix,
		Name:       "Structure Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemInformationMatrix: {
		ID:         ItemInformationMatrix,
		Name:       "Information Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemGravityMatrix: {
		ID:         ItemGravityMatrix,
		Name:       "Gravity Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemDarkFogMatrix: {
		ID:         ItemDarkFogMatrix,
		Name:       "Dark Fog Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemUniverseMatrix: {
		ID:         ItemUniverseMatrix,
		Name:       "Universe Matrix",
		Category:   ItemCategoryMatrix,
		Form:       ResourceSolid,
		StackLimit: 20,
		UnitVolume: 1,
	},
	ItemAmmoBullet: {
		ID:         ItemAmmoBullet,
		Name:       "Bullet",
		Category:   ItemCategoryAmmo,
		Form:       ResourceSolid,
		StackLimit: 200,
		UnitVolume: 1,
	},
	ItemAmmoMissile: {
		ID:         ItemAmmoMissile,
		Name:       "Missile",
		Category:   ItemCategoryAmmo,
		Form:       ResourceSolid,
		StackLimit: 50,
		UnitVolume: 3,
	},
	ItemSolarSail: {
		ID:         ItemSolarSail,
		Name:       "Solar Sail",
		Category:   ItemCategoryComponent,
		Form:       ResourceSolid,
		StackLimit: 100,
		UnitVolume: 1,
	},
	ItemSmallCarrierRocket: {
		ID:         ItemSmallCarrierRocket,
		Name:       "Small Carrier Rocket",
		Category:   ItemCategoryAmmo,
		Form:       ResourceSolid,
		StackLimit: 10,
		UnitVolume: 5,
	},
}

// Item returns the definition for an item id.
func Item(id string) (ItemDefinition, bool) {
	def, ok := itemCatalog[id]
	return def, ok
}

// IsFluidItem reports whether an item represents a liquid or gas.
func IsFluidItem(itemID string) bool {
	def, ok := Item(itemID)
	if !ok {
		return false
	}
	return IsFluidForm(def.Form)
}

// AllItems returns a copy of item definitions for read-only usage.
func AllItems() []ItemDefinition {
	items := make([]ItemDefinition, 0, len(itemCatalog))
	for _, def := range itemCatalog {
		items = append(items, def)
	}
	return items
}

// StackLimit returns the max stack size for an item.
func StackLimit(itemID string) (int, bool) {
	def, ok := Item(itemID)
	if !ok {
		return 0, false
	}
	return def.StackLimit, true
}

// UnitVolume returns the volume for one unit of an item.
func UnitVolume(itemID string) (int, bool) {
	def, ok := Item(itemID)
	if !ok {
		return 0, false
	}
	return def.UnitVolume, true
}

// ValidateStack checks the stack size against the rules.
func ValidateStack(itemID string, qty int) error {
	if qty <= 0 {
		return fmt.Errorf("quantity must be positive")
	}
	def, ok := Item(itemID)
	if !ok {
		return fmt.Errorf("unknown item: %s", itemID)
	}
	if qty > def.StackLimit {
		return fmt.Errorf("quantity %d exceeds stack limit %d for %s", qty, def.StackLimit, itemID)
	}
	return nil
}

// StackVolume returns the total volume occupied by a stack.
func StackVolume(itemID string, qty int) (int, error) {
	if err := ValidateStack(itemID, qty); err != nil {
		return 0, err
	}
	def, _ := Item(itemID)
	return def.UnitVolume * qty, nil
}

// ContainerForForm returns the container item required for a resource form.
func ContainerForForm(form ResourceForm) (string, bool) {
	container, ok := containerByForm[form]
	return container, ok
}

// RequiresContainer reports whether the item must be stored in a container.
func RequiresContainer(itemID string) (bool, string, error) {
	def, ok := Item(itemID)
	if !ok {
		return false, "", fmt.Errorf("unknown item: %s", itemID)
	}
	if def.Form == ResourceSolid {
		return false, "", nil
	}
	if def.ContainerID == "" {
		return true, "", fmt.Errorf("container required for %s", itemID)
	}
	return true, def.ContainerID, nil
}
