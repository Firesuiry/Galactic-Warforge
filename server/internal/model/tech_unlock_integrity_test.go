package model

import (
	"sort"
	"testing"
)

// 科技解锁引用完整性（recipe/building/unit/special 均指向真实内容、pending 清单不腐化）
// 由 LoadGameData 校验保证，见 gamedata_test.go。

// TestGatedRecipesHaveConsistentTechReferences 校验配方的 TechUnlock 字段与
// 科技树的 TechUnlockRecipe 引用保持一致：配方声明的每个门控科技必须真实存在，
// 且该科技必须在其 Unlocks 里回指这个配方（矩阵等通过科技侧独家声明的配方除外，
// 由科技侧单向声明即可，但配方侧不允许悬空）。
func TestGatedRecipesHaveConsistentTechReferences(t *testing.T) {
	// 科技侧实际（归一化后）引用了哪些配方。
	techReferenced := make(map[string][]string)
	for _, def := range AllTechDefinitions() {
		if def == nil {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type == TechUnlockRecipe {
				techReferenced[unlock.ID] = append(techReferenced[unlock.ID], def.ID)
			}
		}
	}
	for id, techIDs := range techReferenced {
		sort.Strings(techIDs)
		techReferenced[id] = techIDs
	}

	for id, recipe := range recipeCatalog {
		for _, techID := range recipe.TechUnlock {
			tech, ok := TechDefinitionByID(techID)
			if !ok {
				t.Errorf("recipe %s declares unknown tech gate %q", id, techID)
				continue
			}
			found := false
			for _, unlock := range tech.Unlocks {
				if unlock.Type == TechUnlockRecipe && unlock.ID == id {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("recipe %s declares tech gate %q, but that tech does not list the recipe in its unlocks", id, techID)
			}
		}
	}
}

// TestTechSideRecipeUnlocksAreMirroredOnRecipes 守住客户端可推导性：科技侧
// TechUnlockRecipe 声明的每个配方，都必须在配方自身的 TechUnlock 里回指该科技。
// 服务端 CanUseRecipeTech 两处都看，但客户端（client-web 的 listBuildingRecipes /
// MechaControls）只按 recipe.tech_unlock 推导，仅科技侧声明的门控会让前端
// 认为「开局可用」而服务端拒绝。
//
// 例外：开局预完成的科技（DefaultCompletedTechs，如 dyson_sphere_program）上的
// 声明等价于「基础配方」——新玩家一开始就拥有该科技，客户端按空 tech_unlock
// 显示为可用与服务端判定一致，因此这类声明不需要回指。
func TestTechSideRecipeUnlocksAreMirroredOnRecipes(t *testing.T) {
	initial := DefaultCompletedTechs()
	for _, def := range AllTechDefinitions() {
		if def == nil {
			continue
		}
		if _, precompleted := initial[def.ID]; precompleted {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type != TechUnlockRecipe {
				continue
			}
			recipe, ok := Recipe(unlock.ID)
			if !ok {
				continue
			}
			found := false
			for _, techID := range recipe.TechUnlock {
				if techID == def.ID {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("tech %s lists recipe %s in its unlocks, but the recipe's tech_unlock %v does not include it; clients deriving availability from recipe.tech_unlock would disagree",
					def.ID, unlock.ID, recipe.TechUnlock)
			}
		}
	}
}

// TestRecipeTechUnlockEntriesHaveTechSideUnlock 守住反方向：配方声明的每个
// 门控科技都要在科技侧 unlocks 里回指该配方（客户端按 recipe.tech_unlock 推导，
// 科技侧缺声明会让服务端 CanUseRecipeTech 与前端一致但科技面板漏报解锁）。
func TestRecipeTechUnlockEntriesHaveTechSideUnlock(t *testing.T) {
	for _, recipe := range AllRecipes() {
		for _, techID := range recipe.TechUnlock {
			def, ok := TechDefinitionByID(techID)
			if !ok {
				t.Errorf("recipe %s declares unknown gate tech %q", recipe.ID, techID)
				continue
			}
			found := false
			for _, unlock := range def.Unlocks {
				if unlock.Type == TechUnlockRecipe && unlock.ID == recipe.ID {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("recipe %s is gated by tech %s, but that tech's unlocks %v do not list it",
					recipe.ID, techID, def.Unlocks)
			}
		}
	}
}

// planetaryProductionTechIDs is the in-game tech set covering 行星内 production,
// logistics, energy and combat-ammo unlocks from
// the DSP 分级实现 reference (see git tag pre-refactor-2026-10).
// 电磁矩阵 / 改良物流系统 已并入开局配方与 basic_logistics_system，不作为独立科技。
var planetaryProductionTechIDs = []string{
	"dyson_sphere_program",
	"electromagnetism",
	"energy_matrix",
	"basic_logistics_system",
	"efficient_logistics",
	"distribution_logistics",
	"planetary_logistics",
	"environment_modification",
	"automatic_metallurgy",
	"smelting_purification",
	"steel_smelting",
	"titanium_smelting",
	"crystal_smelting",
	"basic_assembling_processes",
	"highspeed_assembling",
	"thermal_power",
	"solar_collection",
	"geothermal",
	"energy_storage",
	"electromagnetic_drive",
	"plasma_control",
	"engine",
	"magnetic_levitation",
	"fluid_storage",
	"plasma_refining",
	"basic_chemical",
	"polymer_chemical",
	"xray_cracking",
	"reformed_refinement",
	"superconductor",
	"semiconductor",
	"processor",
	"high_strength_crystal",
	"high_strength_material",
	"particle_container",
	"deuterium_fractionation",
	"hydrogen_fuel",
	"proliferator_mk1",
	"proliferator_mk2",
	"weapon_system",
	"combustible_unit",
	"missile_turret",
	"signal_tower",
	"implosion_cannon",
	"prototype",
	"precision_drone",
	"titanium_ammo",
	"battlefield_analysis",
}

var planetaryProductionBuildings = []BuildingType{
	BuildingTypeTeslaTower,
	BuildingTypeWirelessPowerTower,
	BuildingTypeSatelliteSubstation,
	BuildingTypeWindTurbine,
	BuildingTypeThermalPowerPlant,
	BuildingTypeSolarPanel,
	BuildingTypeGeothermalPowerStation,
	BuildingTypeMiniFusionPowerPlant,
	BuildingTypeEnergyExchanger,
	BuildingTypeAccumulator,
	BuildingTypeAccumulatorFull,
	BuildingTypeMiningMachine,
	BuildingTypeAdvancedMiningMachine,
	BuildingTypeWaterPump,
	BuildingTypeOilExtractor,
	BuildingTypeConveyorBeltMk1,
	BuildingTypeConveyorBeltMk2,
	BuildingTypeConveyorBeltMk3,
	BuildingTypeSplitter,
	BuildingTypeAutomaticPiler,
	BuildingTypeTrafficMonitor,
	BuildingTypeSprayCoater,
	BuildingTypeLogisticsDistributor,
	BuildingTypePlanetaryLogisticsStation,
	BuildingTypeSorterMk1,
	BuildingTypeSorterMk2,
	BuildingTypeSorterMk3,
	BuildingTypePileSorter,
	BuildingTypeDepotMk1,
	BuildingTypeDepotMk2,
	BuildingTypeStorageTank,
	BuildingTypeArcSmelter,
	BuildingTypePlaneSmelter,
	BuildingTypeNegentropySmelter,
	BuildingTypeAssemblingMachineMk1,
	BuildingTypeAssemblingMachineMk2,
	BuildingTypeAssemblingMachineMk3,
	BuildingTypeRecomposingAssembler,
	BuildingTypeOilRefinery,
	BuildingTypeFractionator,
	BuildingTypeChemicalPlant,
	BuildingTypeQuantumChemicalPlant,
	BuildingTypeMiniatureParticleCollider,
	BuildingTypeMatrixLab,
	BuildingTypeSelfEvolutionLab,
	BuildingTypeGaussTurret,
	BuildingTypeMissileTurret,
	BuildingTypeImplosionCannon,
	BuildingTypeLaserTurret,
	BuildingTypePlasmaTurret,
	BuildingTypeSRPlasmaTurret,
	BuildingTypeJammerTower,
	BuildingTypeSignalTower,
	BuildingTypePlanetaryShieldGenerator,
	BuildingTypeFoundation,
}

func TestPlanetaryProductionCatalogClosedLoop(t *testing.T) {
	for _, techID := range planetaryProductionTechIDs {
		def, ok := TechDefinitionByID(techID)
		if !ok {
			t.Errorf("planetary tech %s missing from catalog", techID)
			continue
		}
		if def.Hidden {
			t.Errorf("planetary tech %s is hidden", techID)
		}
		for _, unlock := range def.Unlocks {
			switch unlock.Type {
			case TechUnlockRecipe:
				if _, ok := Recipe(unlock.ID); !ok {
					t.Errorf("tech %s unlocks unknown recipe %q", techID, unlock.ID)
				}
			case TechUnlockBuilding:
				if _, ok := BuildingDefinitionByID(BuildingType(unlock.ID)); !ok {
					t.Errorf("tech %s unlocks unknown building %q", techID, unlock.ID)
				}
			}
		}
	}

	for _, btype := range planetaryProductionBuildings {
		def, ok := BuildingDefinitionByID(btype)
		if !ok {
			t.Errorf("planetary building %s missing from catalog", btype)
			continue
		}
		if btype != BuildingTypeAccumulatorFull && !def.Buildable {
			t.Errorf("planetary building %s is not buildable", btype)
		}
	}

	for _, itemID := range []string{
		ItemSteel, ItemDiamond, ItemOrganicCrystal, ItemPrism, ItemPlasmaExciter,
		ItemElectromagneticTurbine, ItemSuperMagneticRing, ItemEngine,
		ItemCombustibleUnit, ItemShellSet, ItemTitaniumAmmo, ItemGlass,
		ItemProliferatorMk1, ItemProliferatorMk2, ItemCrystalSilicon,
	} {
		if _, ok := Item(itemID); !ok {
			t.Errorf("planetary production item %s missing from catalog", itemID)
		}
	}
}
