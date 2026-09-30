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

	ItemKimberliteOre              = "kimberlite_ore"
	ItemSpiniformStalagmiteCrystal = "spiniform_stalagmite_crystal"
	ItemLog                        = "log"
	ItemPlantFuel                  = "plant_fuel"

	ItemIronIngot      = "iron_ingot"
	ItemCopperIngot    = "copper_ingot"
	ItemStoneBrick     = "stone_brick"
	ItemGlass          = "glass"
	ItemSteel          = "steel"
	ItemSiliconIngot   = "silicon_ingot"
	ItemTitaniumIngot  = "titanium_ingot"
	ItemGraphene       = "graphene"
	ItemCarbonNanotube = "carbon_nanotube"
	ItemCrystalSilicon = "crystal_silicon"
	ItemDiamond        = "diamond"
	ItemOrganicCrystal = "organic_crystal"
	ItemMagnet         = "magnet"

	ItemGear                         = "gear"
	ItemMotor                        = "motor"
	ItemEngine                       = "engine"
	ItemElectromagneticTurbine       = "electromagnetic_turbine"
	ItemSuperMagneticRing            = "super_magnetic_ring"
	ItemPrism                        = "prism"
	ItemPlasmaExciter                = "plasma_exciter"
	ItemLogisticsBot                 = "logistics_bot"
	ItemLogisticsDrone               = "logistics_drone"
	ItemLogisticsVessel              = "logistics_vessel"
	ItemMagneticCoil                 = "magnetic_coil"
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
	ItemTitaniumGlass                = "titanium_glass"
	ItemPlaneFilter                  = "plane_filter"
	ItemParticleBroadband            = "particle_broadband"
	ItemReinforcedThruster           = "reinforced_thruster"
	ItemGravitonLens                 = "graviton_lens"
	ItemCasimirCrystal               = "casimir_crystal"
	ItemDysonSphereComponent         = "dyson_sphere_component"
	ItemFoundationSupply             = "foundation_supply"

	ItemEnergeticGraphite = "energetic_graphite"
	ItemHydrogenFuelRod   = "hydrogen_fuel_rod"
	ItemDeuteriumFuelRod  = "deuterium_fuel_rod"
	ItemAntimatterFuelRod = "antimatter_fuel_rod"
	ItemProliferatorMk1   = "proliferator_mk1"
	ItemProliferatorMk2   = "proliferator_mk2"
	ItemProliferatorMk3   = "proliferator_mk3"

	ItemElectromagneticMatrix = "electromagnetic_matrix"
	ItemEnergyMatrix          = "energy_matrix"
	ItemDarkFogMatrix         = "dark_fog_matrix"
	ItemUniverseMatrix        = "universe_matrix"

	ItemAmmoBullet        = "ammo_bullet"
	ItemAmmoMissile       = "ammo_missile"
	ItemCombustibleUnit   = "combustible_unit"
	ItemShellSet          = "shell_set"
	ItemTitaniumAmmo      = "titanium_ammo"
	ItemPlasmaCapsule     = "plasma_capsule"
	ItemAntimatterCapsule = "antimatter_capsule"
	ItemGravityMissile    = "gravity_missile"
	ItemPrototype         = "prototype"
	ItemPrecisionDrone    = "precision_drone"
	ItemCorvette          = "corvette"
	ItemDestroyer         = "destroyer"

	ItemSupersonicMissileSet = "supersonic_missile_set"
	ItemCrystalShellSet      = "crystal_shell_set"
	ItemJammingCapsule       = "jamming_capsule"
	ItemSuppressingCapsule   = "suppressing_capsule"

	ItemSolarSail          = "solar_sail"
	ItemSmallCarrierRocket = "small_carrier_rocket"

	ItemAccumulator     = "accumulator"
	ItemAccumulatorFull = "accumulator_full"
)

// ItemDefinition defines immutable data for an item.
type ItemDefinition struct {
	ID              string       `json:"id" yaml:"id"`
	Name            string       `json:"name" yaml:"name"`
	Category        ItemCategory `json:"category" yaml:"category"`
	Form            ResourceForm `json:"form" yaml:"form"`
	StackLimit      int          `json:"stack_limit" yaml:"stack_limit"`
	UnitVolume      int          `json:"unit_volume" yaml:"unit_volume"`
	ContainerID     string       `json:"container_id,omitempty" yaml:"container_id,omitempty"`
	IsRare          bool         `json:"is_rare,omitempty" yaml:"is_rare,omitempty"`
	MechaFuelEnergy int          `json:"mecha_fuel_energy,omitempty" yaml:"mecha_fuel_energy,omitempty"`
}

// ItemAmount couples an item with a quantity.
type ItemAmount struct {
	ItemID   string `json:"item_id" yaml:"item_id"`
	Quantity int    `json:"quantity" yaml:"quantity"`
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
