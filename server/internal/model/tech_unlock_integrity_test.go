package model

import (
	"sort"
	"testing"
)

// pendingRecipeUnlocks 记录科技树里故意保留、但配方尚未落地的 TechUnlockRecipe ID。
// 这些配方由后续内容批次（A1~A7）补齐；每落地一个配方，必须从这里移除对应条目，
// 让本测试转而强制校验它指向真实配方。
// 2026-09-18：12 个行星内生产配方（proliferator_mk3、supersonic_missile、
// crystal_explosive、crystal_shell、thruster、particle_broadband、titanium_glass、
// casimir_crystal、plane_filter、gravitational_lens、photon_combiner、space_warper）
// 已随 DSP 行星内生产对齐批次全部落地，当前无待落地条目。
var pendingRecipeUnlocks = map[string]string{
	// gated（黑雾材料锁定）配方，待物品/配方域后续批次落地后移除。
	"df_strange_annihilation_fuel_rod": "W1: 奇异湮灭燃料棒配方（df_high_density_controlled_annihilation，gated）",
}

// TestTechUnlocksResolve 校验原始科技定义（defaultTechDefinitions）中的每一个
// unlock 都指向真实存在的内容：
//   - TechUnlockRecipe 必须命中 recipeCatalog（或登记在 pendingRecipeUnlocks）；
//   - TechUnlockBuilding 必须是真实建筑类型；
//   - TechUnlockUnit 必须是运行时支持的单位解锁；
//   - TechUnlockSpecial 必须是已登记的特殊解锁 ID。
//
// 回归背景：大量 TechUnlockRecipe 曾因拼写/命名差异悬空（steel、diamond、
// graphite、missile 等），被 normalizeTechUnlocks 静默丢弃，导致对应配方
// 实际无人门控；prism/plasma_exciter 也曾被误标为建筑解锁。
func TestTechUnlocksResolve(t *testing.T) {
	unitIDs := runtimeSupportedUnitUnlocks()
	specialIDs := map[string]bool{
		"dyson_component":        true,
		"satellite_power":        true,
		"vertical_construction":  true,
		"dyson_stress":           true,
		"ionosphere_utilization": true,
		"photon_mode":            true,
		"warp_drive":             true,
		"game_win":               true,
	}

	for i := range defaultTechDefinitions {
		def := &defaultTechDefinitions[i]
		for _, unlock := range def.Unlocks {
			switch unlock.Type {
			case TechUnlockRecipe:
				if _, ok := recipeCatalog[unlock.ID]; ok {
					continue
				}
				if reason, pending := pendingRecipeUnlocks[unlock.ID]; pending {
					t.Logf("tech %s unlock %s pending recipe landing: %s", def.ID, unlock.ID, reason)
					continue
				}
				t.Errorf("tech %s references unknown recipe unlock %q", def.ID, unlock.ID)
			case TechUnlockBuilding:
				if _, ok := BuildingDefinitionByID(BuildingType(unlock.ID)); !ok {
					t.Errorf("tech %s references unknown building unlock %q", def.ID, unlock.ID)
				}
			case TechUnlockUnit:
				if _, ok := unitIDs[unlock.ID]; !ok {
					t.Errorf("tech %s references unsupported unit unlock %q", def.ID, unlock.ID)
				}
			case TechUnlockSpecial:
				if !specialIDs[unlock.ID] {
					t.Errorf("tech %s references unknown special unlock %q", def.ID, unlock.ID)
				}
			default:
				t.Errorf("tech %s has unlock with unknown type %q (%q)", def.ID, unlock.Type, unlock.ID)
			}
		}
	}
}

// TestPendingRecipeUnlocksStayPending 防止 pending 清单腐化：
// 一旦配方落地必须移除登记；登记了但科技树已不再引用的条目也必须清理。
func TestPendingRecipeUnlocksStayPending(t *testing.T) {
	referenced := make(map[string]bool)
	for i := range defaultTechDefinitions {
		def := &defaultTechDefinitions[i]
		for _, unlock := range def.Unlocks {
			if unlock.Type == TechUnlockRecipe {
				referenced[unlock.ID] = true
			}
		}
	}
	for id := range pendingRecipeUnlocks {
		if _, ok := recipeCatalog[id]; ok {
			t.Errorf("pending recipe unlock %q already exists in recipeCatalog; remove it from pendingRecipeUnlocks", id)
		}
		if !referenced[id] {
			t.Errorf("pending recipe unlock %q is no longer referenced by any tech; remove it from pendingRecipeUnlocks", id)
		}
	}
}

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

// planetaryProductionTechIDs is the in-game tech set covering 行星内 production,
// logistics, energy and combat-ammo unlocks from
// docs/archive/reference/戴森球计划-分级实现-科技与建筑.md.
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
