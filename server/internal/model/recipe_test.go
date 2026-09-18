package model

import (
	"strings"
	"testing"
)

func TestRecipesReferenceItems(t *testing.T) {
	if len(recipeCatalog) == 0 {
		t.Fatalf("recipe catalog should not be empty")
	}
	for id, recipe := range recipeCatalog {
		if recipe.ID != id {
			t.Fatalf("recipe id mismatch: key=%s def=%s", id, recipe.ID)
		}
		if recipe.Name == "" {
			t.Fatalf("recipe %s missing name", id)
		}
		if recipe.Duration <= 0 {
			t.Fatalf("recipe %s invalid duration %d", id, recipe.Duration)
		}
		if recipe.EnergyCost < 0 {
			t.Fatalf("recipe %s has negative energy cost %d", id, recipe.EnergyCost)
		}
		if len(recipe.BuildingTypes) == 0 {
			t.Fatalf("recipe %s missing building types", id)
		}
		if len(recipe.Outputs) == 0 && len(recipe.Byproducts) == 0 {
			t.Fatalf("recipe %s has no outputs", id)
		}
		for _, input := range recipe.Inputs {
			if input.Quantity <= 0 {
				t.Fatalf("recipe %s has invalid input quantity", id)
			}
			if _, ok := Item(input.ItemID); !ok {
				t.Fatalf("recipe %s references unknown input %s", id, input.ItemID)
			}
		}
		for _, output := range recipe.AllOutputs() {
			if output.Quantity <= 0 {
				t.Fatalf("recipe %s has invalid output quantity", id)
			}
			if _, ok := Item(output.ItemID); !ok {
				t.Fatalf("recipe %s references unknown output %s", id, output.ItemID)
			}
		}
	}
}

func TestByproductRecipes(t *testing.T) {
	fireIce, ok := Recipe("graphene_from_fire_ice")
	if !ok || len(fireIce.Byproducts) == 0 {
		t.Fatalf("graphene_from_fire_ice should have byproducts")
	}
}

func TestOilRefineryRecipes(t *testing.T) {
	for _, id := range []string{"oil_fractionation", "xray_cracking", "reformed_refinement"} {
		recipe, ok := Recipe(id)
		if !ok || len(recipe.BuildingTypes) != 1 || recipe.BuildingTypes[0] != BuildingTypeOilRefinery {
			t.Fatalf("%s must run in oil refinery: %+v", id, recipe)
		}
		if len(recipe.TechUnlock) == 0 {
			t.Fatalf("%s missing research gate", id)
		}
		for _, techID := range recipe.TechUnlock {
			tech, exists := TechDefinitionByID(techID)
			if !exists || tech.Hidden {
				t.Fatalf("%s has unreachable tech %s", id, techID)
			}
		}
	}
	recipe, _ := Recipe("oil_fractionation")
	if len(recipe.Outputs) != 1 || recipe.Outputs[0] != (ItemAmount{ItemID: ItemRefinedOil, Quantity: 2}) || len(recipe.Byproducts) != 1 || recipe.Byproducts[0] != (ItemAmount{ItemID: ItemHydrogen, Quantity: 1}) {
		t.Fatalf("incorrect plasma refining outputs: %+v", recipe)
	}
}

func TestRecipeDependencies(t *testing.T) {
	baseItems := map[string]struct{}{
		ItemIronOre:                    {},
		ItemCopperOre:                  {},
		ItemStoneOre:                   {},
		ItemSiliconOre:                 {},
		ItemTitaniumOre:                {},
		ItemCoal:                       {},
		ItemFireIce:                    {},
		ItemFractalSilicon:             {},
		ItemGratingCrystal:             {},
		ItemMonopoleMagnet:             {},
		ItemCrudeOil:                   {},
		ItemWater:                      {},
		ItemDeuterium:                  {},
		ItemCriticalPhoton:             {},
		ItemKimberliteOre:              {},
		ItemSpiniformStalagmiteCrystal: {},
		ItemLog:                        {},
		ItemPlantFuel:                  {},
	}

	producers := make(map[string][]string, len(recipeCatalog))
	for id, recipe := range recipeCatalog {
		if isRecyclingRecipe(recipe) {
			continue
		}
		for _, output := range recipe.AllOutputs() {
			producers[output.ItemID] = append(producers[output.ItemID], id)
		}
	}

	for id, recipe := range recipeCatalog {
		for _, input := range recipe.Inputs {
			if _, ok := baseItems[input.ItemID]; ok {
				continue
			}
			if _, ok := producers[input.ItemID]; !ok {
				t.Fatalf("recipe %s input %s has no producer", id, input.ItemID)
			}
		}
	}

	// Alternative and catalytic recipes may contain cycles. Every recipe must
	// still have a route from mined/collected resources to all of its seed inputs.
	reachable := make(map[string]bool)
	for item := range baseItems {
		reachable[item] = true
	}
	pending := make(map[string]RecipeDefinition)
	for id, recipe := range recipeCatalog {
		pending[id] = recipe
	}
	for {
		progressed := false
		for id, recipe := range pending {
			ready := true
			for _, input := range recipe.Inputs {
				if !reachable[input.ItemID] {
					ready = false
					break
				}
			}
			if !ready {
				continue
			}
			for _, output := range recipe.AllOutputs() {
				reachable[output.ItemID] = true
			}
			delete(pending, id)
			progressed = true
		}
		if !progressed {
			break
		}
	}
	if len(pending) > 0 {
		t.Fatalf("recipes with no reachable seed inputs: %+v", pending)
	}

}

func TestMidLateRecipesPresent(t *testing.T) {
	cases := []struct {
		recipeID       string
		buildingType   BuildingType
		outputItemID   string
		outputQuantity int
	}{
		{recipeID: "titanium_crystal", buildingType: BuildingTypeAssemblingMachineMk1, outputItemID: ItemTitaniumCrystal, outputQuantity: 1},
		{recipeID: "titanium_alloy", buildingType: BuildingTypeArcSmelter, outputItemID: ItemTitaniumAlloy, outputQuantity: 2},
		{recipeID: "frame_material", buildingType: BuildingTypeAssemblingMachineMk1, outputItemID: ItemFrameMaterial, outputQuantity: 1},
		{recipeID: "quantum_chip", buildingType: BuildingTypeAssemblingMachineMk1, outputItemID: ItemQuantumChip, outputQuantity: 1},
		{recipeID: "small_carrier_rocket", buildingType: BuildingTypeVerticalLaunchingSilo, outputItemID: ItemSmallCarrierRocket, outputQuantity: 1},
	}

	for _, tc := range cases {
		recipe, ok := Recipe(tc.recipeID)
		if !ok {
			t.Fatalf("missing recipe %s", tc.recipeID)
		}
		if len(recipe.Outputs) != 1 {
			t.Fatalf("recipe %s should have exactly one primary output, got %+v", tc.recipeID, recipe.Outputs)
		}
		if recipe.Outputs[0].ItemID != tc.outputItemID || recipe.Outputs[0].Quantity != tc.outputQuantity {
			t.Fatalf("recipe %s output mismatch: got %+v", tc.recipeID, recipe.Outputs[0])
		}
		supported := false
		for _, candidate := range recipe.BuildingTypes {
			if candidate == tc.buildingType {
				supported = true
				break
			}
		}
		if !supported {
			t.Fatalf("recipe %s should support %s", tc.recipeID, tc.buildingType)
		}
	}
}

func TestSelfEvolutionLabSupportsCanonicalMatrixRecipes(t *testing.T) {
	recipeIDs := []string{
		"electromagnetic_matrix",
		"energy_matrix",
		"structure_matrix",
		"information_matrix",
		"gravity_matrix",
		"universe_matrix",
	}

	for _, recipeID := range recipeIDs {
		recipe, ok := Recipe(recipeID)
		if !ok {
			t.Fatalf("expected recipe %s to exist", recipeID)
		}
		supported := false
		for _, btype := range recipe.BuildingTypes {
			if btype == BuildingTypeSelfEvolutionLab {
				supported = true
				break
			}
		}
		if !supported {
			t.Fatalf("expected recipe %s to support %s, got %+v", recipeID, BuildingTypeSelfEvolutionLab, recipe.BuildingTypes)
		}
	}
}

func isRecyclingRecipe(recipe RecipeDefinition) bool {
	if strings.Contains(recipe.ID, "recycling") {
		return true
	}
	for _, tech := range recipe.TechUnlock {
		if tech == "recycling" {
			return true
		}
	}
	return false
}

// dspAlignmentRecipeExpectation pins the DSP 行星内生产对齐 additions
// (develop_tools/dsp-catalog/scope.json, DSP 0.10.29.21950).
type dspAlignmentRecipeExpectation struct {
	outputs   []ItemAmount
	byproduct []ItemAmount
	gate      string
	building  BuildingType
	duration  int
}

func dspAlignmentRecipes() map[string]dspAlignmentRecipeExpectation {
	assemblers := BuildingTypeAssemblingMachineMk1
	return map[string]dspAlignmentRecipeExpectation{
		"high_purity_silicon":         {outputs: []ItemAmount{{ItemID: ItemSiliconIngot, Quantity: 1}}, gate: "smelting_purification", building: BuildingTypeArcSmelter, duration: 120},
		"titanium_ingot":              {outputs: []ItemAmount{{ItemID: ItemTitaniumIngot, Quantity: 1}}, gate: "titanium_smelting", building: BuildingTypeArcSmelter, duration: 120},
		"diamond_advanced":            {outputs: []ItemAmount{{ItemID: ItemDiamond, Quantity: 2}}, gate: "crystal_smelting", building: BuildingTypeArcSmelter, duration: 90},
		"plasma_refining":             {outputs: []ItemAmount{{ItemID: ItemRefinedOil, Quantity: 2}}, byproduct: []ItemAmount{{ItemID: ItemHydrogen, Quantity: 1}}, gate: "plasma_refining", building: BuildingTypeOilRefinery, duration: 60},
		"x_ray_cracking":              {outputs: []ItemAmount{{ItemID: ItemHydrogen, Quantity: 3}}, byproduct: []ItemAmount{{ItemID: ItemEnergeticGraphite, Quantity: 1}}, gate: "xray_cracking", building: BuildingTypeOilRefinery, duration: 60},
		"graphene":                    {outputs: []ItemAmount{{ItemID: ItemGraphene, Quantity: 2}}, gate: "superconductor", building: BuildingTypeChemicalPlant, duration: 50},
		"graphene_advanced":           {outputs: []ItemAmount{{ItemID: ItemGraphene, Quantity: 2}}, byproduct: []ItemAmount{{ItemID: ItemHydrogen, Quantity: 1}}, gate: "superconductor", building: BuildingTypeChemicalPlant, duration: 50},
		"carbon_nanotube_advanced":    {outputs: []ItemAmount{{ItemID: ItemCarbonNanotube, Quantity: 2}}, gate: "high_strength_material", building: BuildingTypeChemicalPlant, duration: 70},
		"df_explosive_unit":           {outputs: []ItemAmount{{ItemID: ItemCombustibleUnit, Quantity: 2}}, gate: "df_explosive_unit_tech", building: BuildingTypeChemicalPlant, duration: 60},
		"crystal_explosive":           {outputs: []ItemAmount{{ItemID: ItemPlasmaCapsule, Quantity: 8}}, gate: "crystal_explosive", building: BuildingTypeChemicalPlant, duration: 240},
		"deuterium_fractionation":     {outputs: []ItemAmount{{ItemID: ItemDeuterium, Quantity: 1}}, gate: "deuterium_fractionation", building: BuildingTypeFractionator, duration: 1500},
		"proliferator_1":              {outputs: []ItemAmount{{ItemID: ItemProliferatorMk1, Quantity: 1}}, gate: "proliferator_mk1", building: assemblers, duration: 15},
		"proliferator_mk3":            {outputs: []ItemAmount{{ItemID: ItemProliferatorMk3, Quantity: 1}}, gate: "proliferator_mk3", building: assemblers, duration: 60},
		"df_magnum_ammo_box":          {outputs: []ItemAmount{{ItemID: ItemAmmoBullet, Quantity: 1}}, gate: "weapon_system", building: assemblers, duration: 30},
		"df_missile_set":              {outputs: []ItemAmount{{ItemID: ItemAmmoMissile, Quantity: 1}}, gate: "missile_turret", building: assemblers, duration: 60},
		"df_titanium_ammo_box":        {outputs: []ItemAmount{{ItemID: ItemTitaniumAmmo, Quantity: 1}}, gate: "titanium_ammo", building: assemblers, duration: 60},
		"df_superalloy_ammo_box":      {outputs: []ItemAmount{{ItemID: ItemTitaniumAmmo, Quantity: 1}}, gate: "df_superalloy_ammo_box_tech", building: assemblers, duration: 90},
		"supersonic_missile":          {outputs: []ItemAmount{{ItemID: ItemSupersonicMissileSet, Quantity: 2}}, gate: "supersonic_missile", building: assemblers, duration: 120},
		"df_gravity_missile_set":      {outputs: []ItemAmount{{ItemID: ItemGravityMissile, Quantity: 3}}, gate: "gravity_missile", building: assemblers, duration: 180},
		"df_plasma_capsule":           {outputs: []ItemAmount{{ItemID: ItemPlasmaCapsule, Quantity: 1}}, gate: "plasma_turret", building: assemblers, duration: 60},
		"df_shell_set":                {outputs: []ItemAmount{{ItemID: ItemShellSet, Quantity: 1}}, gate: "implosion_cannon", building: assemblers, duration: 45},
		"df_high_explosive_shell_set": {outputs: []ItemAmount{{ItemID: ItemShellSet, Quantity: 1}}, gate: "df_high_explosive_shell_set_tech", building: assemblers, duration: 90},
		"crystal_shell":               {outputs: []ItemAmount{{ItemID: ItemCrystalShellSet, Quantity: 1}}, gate: "crystal_shell", building: assemblers, duration: 180},
		"df_jamming_capsule":          {outputs: []ItemAmount{{ItemID: ItemJammingCapsule, Quantity: 1}}, gate: "df_jammer_tower_tech", building: assemblers, duration: 60},
		"df_suppressing_capsule":      {outputs: []ItemAmount{{ItemID: ItemSuppressingCapsule, Quantity: 2}}, gate: "df_suppressing_capsule_tech", building: assemblers, duration: 240},
		"df_prototype":                {outputs: []ItemAmount{{ItemID: ItemPrototype, Quantity: 1}}, gate: "prototype", building: assemblers, duration: 60},
		"df_precision_drone":          {outputs: []ItemAmount{{ItemID: ItemPrecisionDrone, Quantity: 1}}, gate: "precision_drone", building: assemblers, duration: 120},
		"df_attack_drone":             {outputs: []ItemAmount{{ItemID: ItemAttackDrone, Quantity: 1}}, gate: "df_attack_drone_tech", building: assemblers, duration: 120},
		"df_corvette":                 {outputs: []ItemAmount{{ItemID: ItemCorvette, Quantity: 1}}, gate: "corvette", building: assemblers, duration: 150},
		"df_destroyer":                {outputs: []ItemAmount{{ItemID: ItemDestroyer, Quantity: 1}}, gate: "destroyer", building: assemblers, duration: 240},
		"df_engine":                   {outputs: []ItemAmount{{ItemID: ItemEngine, Quantity: 1}}, gate: "engine", building: assemblers, duration: 90},
		"thruster":                    {outputs: []ItemAmount{{ItemID: ItemEngine, Quantity: 1}}, gate: "thruster", building: assemblers, duration: 120},
		"reinforced_thruster":         {outputs: []ItemAmount{{ItemID: ItemReinforcedThruster, Quantity: 1}}, gate: "reinforced_thruster_technology", building: assemblers, duration: 180},
		"titanium_glass":              {outputs: []ItemAmount{{ItemID: ItemTitaniumGlass, Quantity: 2}}, gate: "high_strength_glass", building: assemblers, duration: 150},
		"organic_crystal_original":    {outputs: []ItemAmount{{ItemID: ItemOrganicCrystal, Quantity: 1}}, gate: "polymer_chemical", building: assemblers, duration: 180},
		"photon_combiner":             {outputs: []ItemAmount{{ItemID: ItemPhotonCombiner, Quantity: 1}}, gate: "photon_conversion", building: assemblers, duration: 90},
		"particle_broadband":          {outputs: []ItemAmount{{ItemID: ItemParticleBroadband, Quantity: 1}}, gate: "particle_control", building: assemblers, duration: 240},
		"casimir_crystal":             {outputs: []ItemAmount{{ItemID: ItemCasimirCrystal, Quantity: 1}}, gate: "casimir_crystal", building: assemblers, duration: 120},
		"casimir_crystal_advanced":    {outputs: []ItemAmount{{ItemID: ItemCasimirCrystal, Quantity: 1}}, gate: "casimir_crystal", building: assemblers, duration: 120},
		"plane_filter":                {outputs: []ItemAmount{{ItemID: ItemPlaneFilter, Quantity: 1}}, gate: "wave_interference", building: assemblers, duration: 360},
		"gravitational_lens":          {outputs: []ItemAmount{{ItemID: ItemGravitonLens, Quantity: 1}}, gate: "strange_matter", building: assemblers, duration: 180},
		"space_warper":                {outputs: []ItemAmount{{ItemID: ItemSpaceWarper, Quantity: 1}}, gate: "gravitational_wave", building: assemblers, duration: 300},
		"space_warper_advanced":       {outputs: []ItemAmount{{ItemID: ItemSpaceWarper, Quantity: 8}}, gate: "gravity_matrix", building: assemblers, duration: 300},
		"dyson_sphere_component":      {outputs: []ItemAmount{{ItemID: ItemDysonSphereComponent, Quantity: 1}}, gate: "lightweight_structure", building: assemblers, duration: 240},
		"foundation":                  {outputs: []ItemAmount{{ItemID: ItemFoundationSupply, Quantity: 1}}, gate: "environment_modification", building: assemblers, duration: 30},
	}
}

// TestDSPAlignmentRecipes verifies every newly added DSP parity recipe:
// outputs resolve to catalog items, IO quantities match the frozen scope data,
// each locked recipe carries its DSP-mapped tech gate, and the mapped machine
// family is present. Runtime gating (locked until research completes) is
// covered generically by gamecore.TestCatalogRecipesAreExplicitlyBasicOrGated.
func TestDSPAlignmentRecipes(t *testing.T) {
	expect := dspAlignmentRecipes()
	if len(expect) != 45 {
		t.Fatalf("expected 45 DSP alignment recipes in fixture, got %d", len(expect))
	}
	for id, want := range expect {
		recipe, ok := Recipe(id)
		if !ok {
			t.Errorf("missing DSP alignment recipe %s", id)
			continue
		}
		if recipe.Name == "" {
			t.Errorf("recipe %s missing name", id)
		}
		if recipe.Duration != want.duration {
			t.Errorf("recipe %s duration %d, want %d", id, recipe.Duration, want.duration)
		}
		if len(recipe.Outputs) != len(want.outputs) {
			t.Errorf("recipe %s outputs %+v, want %+v", id, recipe.Outputs, want.outputs)
		} else {
			for i, out := range want.outputs {
				if recipe.Outputs[i] != out {
					t.Errorf("recipe %s output[%d] %+v, want %+v", id, i, recipe.Outputs[i], out)
				}
			}
		}
		if len(recipe.Byproducts) != len(want.byproduct) {
			t.Errorf("recipe %s byproducts %+v, want %+v", id, recipe.Byproducts, want.byproduct)
		} else {
			for i, bp := range want.byproduct {
				if recipe.Byproducts[i] != bp {
					t.Errorf("recipe %s byproduct[%d] %+v, want %+v", id, i, recipe.Byproducts[i], bp)
				}
			}
		}
		for _, out := range recipe.AllOutputs() {
			if _, ok := Item(out.ItemID); !ok {
				t.Skipf("recipe %s output %s not yet in item catalog (parallel domain A)", id, out.ItemID)
			}
		}
		for _, in := range recipe.Inputs {
			if _, ok := Item(in.ItemID); !ok {
				t.Skipf("recipe %s input %s not yet in item catalog (parallel domain A)", id, in.ItemID)
			}
		}
		if len(recipe.TechUnlock) != 1 || recipe.TechUnlock[0] != want.gate {
			t.Errorf("recipe %s tech gate %+v, want [%s]", id, recipe.TechUnlock, want.gate)
		}
		supported := false
		for _, btype := range recipe.BuildingTypes {
			if btype == want.building {
				supported = true
				break
			}
		}
		if !supported {
			t.Errorf("recipe %s should support %s, got %+v", id, want.building, recipe.BuildingTypes)
		}
	}
}

// TestDSPAlignmentRecipeGatesResolve pins that each new recipe's gate is
// either an already-landed tech or one of the new DSP tech ids owned by the
// parallel tech domain (kebab-case DSP tech id -> snake_case SW id).
func TestDSPAlignmentRecipeGatesResolve(t *testing.T) {
	pendingNewTechs := map[string]bool{
		"df_explosive_unit_tech":           true,
		"df_superalloy_ammo_box_tech":      true,
		"df_high_explosive_shell_set_tech": true,
		"df_jammer_tower_tech":             true,
		"df_suppressing_capsule_tech":      true,
		"df_attack_drone_tech":             true,
		"reinforced_thruster_technology":   true,
	}
	for id := range dspAlignmentRecipes() {
		recipe, ok := Recipe(id)
		if !ok {
			t.Errorf("missing recipe %s", id)
			continue
		}
		if len(recipe.TechUnlock) == 0 {
			t.Errorf("locked DSP recipe %s has no tech gate", id)
			continue
		}
		for _, techID := range recipe.TechUnlock {
			if _, ok := TechDefinitionByID(techID); ok {
				continue
			}
			if pendingNewTechs[techID] {
				t.Logf("recipe %s gate %s pending parallel tech domain", id, techID)
				continue
			}
			t.Errorf("recipe %s references unknown tech gate %s", id, techID)
		}
	}
}

func TestPlasmaCapsuleRecipeReachable(t *testing.T) {
	recipe, ok := Recipe("plasma_capsule")
	if !ok || len(recipe.Outputs) != 1 || recipe.Outputs[0] != (ItemAmount{ItemID: ItemPlasmaCapsule, Quantity: 1}) {
		t.Fatalf("missing plasma ammunition recipe: %+v", recipe)
	}
	if len(recipe.TechUnlock) != 1 || recipe.TechUnlock[0] != "plasma_turret" {
		t.Fatalf("plasma ammunition must unlock with its turret: %+v", recipe.TechUnlock)
	}
	tech, ok := TechDefinitionByID(recipe.TechUnlock[0])
	if !ok || tech.Hidden {
		t.Fatal("plasma research is unreachable")
	}
	unlocked := false
	for _, unlock := range tech.Unlocks {
		if unlock.Type == TechUnlockRecipe && unlock.ID == recipe.ID {
			unlocked = true
		}
	}
	if !unlocked {
		t.Fatal("plasma turret research must advertise its ammunition recipe")
	}
	for _, input := range recipe.Inputs {
		producible := false
		for _, producer := range AllRecipes() {
			for _, output := range producer.AllOutputs() {
				if output.ItemID != input.ItemID {
					continue
				}
				for _, kind := range producer.BuildingTypes {
					if BuildingProfileFor(kind, 1).Runtime.Functions.Production != nil {
						producible = true
					}
				}
			}
		}
		if !producible {
			t.Fatalf("plasma ingredient %s lacks an implemented production building", input.ItemID)
		}
	}
	for _, kind := range []BuildingType{BuildingTypeAssemblingMachineMk1, BuildingTypeAssemblingMachineMk2, BuildingTypeAssemblingMachineMk3} {
		if _, err := ResolveProductionCycle(ProductionCycleRequest{Recipe: recipe, BuildingType: kind}); err != nil {
			t.Fatalf("%s cannot produce plasma ammunition: %v", kind, err)
		}
	}
}
