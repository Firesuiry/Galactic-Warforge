package model

import (
	"sort"
	"testing"
)

// dspBuildingCostAlignment 冻结 DSP（develop_tools/dsp-catalog/scope.json，
// cat=buildings 且 inPlanet）建筑合成配方并入 SW BuildCost 的期望值。
// minerals/energy 维持对齐前有效值（显式值 > defaultBuildCostOverrides > 类别默认），
// items 为 DSP 配方物品输入（数量一致，按 id 排序）。
// DSP 配方中以建筑为输入的进阶链（如 conveyor-belt-2 消耗 3 个 conveyor-belt-1）
// 在 SW 中不作为物品存在，按政策不并入 Items。
var dspBuildingCostAlignment = map[BuildingType]BuildCost{
	BuildingTypeAccumulator:                  {Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "crystal_silicon", Quantity: 3}, {ItemID: "iron_ingot", Quantity: 6}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
	BuildingTypeAdvancedMiningMachine:        {Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 10}, {ItemID: "grating_crystal", Quantity: 40}, {ItemID: "quantum_chip", Quantity: 4}, {ItemID: "super_magnetic_ring", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 20}}},
	BuildingTypeArcSmelter:                   {Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 4}, {ItemID: "magnetic_coil", Quantity: 2}, {ItemID: "stone_brick", Quantity: 2}}},
	BuildingTypeArtificialStar:               {Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "annihilation_constraint_sphere", Quantity: 10}, {ItemID: "frame_material", Quantity: 20}, {ItemID: "quantum_chip", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 20}}},
	BuildingTypeAssemblingMachineMk1:         {Minerals: 100, Energy: 50, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 4}, {ItemID: "gear", Quantity: 8}, {ItemID: "iron_ingot", Quantity: 4}}},
	BuildingTypeAssemblingMachineMk2:         {Minerals: 240, Energy: 120, Items: []ItemAmount{{ItemID: "graphene", Quantity: 8}, {ItemID: "processor", Quantity: 4}}},
	BuildingTypeAssemblingMachineMk3:         {Minerals: 360, Energy: 180, Items: []ItemAmount{{ItemID: "particle_broadband", Quantity: 8}, {ItemID: "quantum_chip", Quantity: 2}}},
	BuildingTypeAutomaticPiler:               {Minerals: 20, Energy: 10, Items: []ItemAmount{{ItemID: "gear", Quantity: 4}, {ItemID: "processor", Quantity: 2}, {ItemID: "steel", Quantity: 3}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
	BuildingTypeChemicalPlant:                {Minerals: 140, Energy: 70, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "glass", Quantity: 8}, {ItemID: "steel", Quantity: 8}, {ItemID: "stone_brick", Quantity: 8}}},
	BuildingTypeConveyorBeltMk1:              {Minerals: 4, Energy: 0, Items: []ItemAmount{{ItemID: "gear", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 2}}},
	BuildingTypeConveyorBeltMk2:              {Minerals: 8, Energy: 0, Items: []ItemAmount{{ItemID: "electromagnetic_turbine", Quantity: 1}}},
	BuildingTypeConveyorBeltMk3:              {Minerals: 12, Energy: 0, Items: []ItemAmount{{ItemID: "graphene", Quantity: 1}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
	BuildingTypeBattlefieldAnalysisBase:      {Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 18}, {ItemID: "engine", Quantity: 12}, {ItemID: "microcrystalline_component", Quantity: 6}, {ItemID: "steel", Quantity: 12}}},
	BuildingTypeGaussTurret:                  {Minerals: 80, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "gear", Quantity: 8}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "magnetic_coil", Quantity: 4}}},
	BuildingTypeImplosionCannon:              {Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 10}, {ItemID: "motor", Quantity: 8}, {ItemID: "steel", Quantity: 10}, {ItemID: "super_magnetic_ring", Quantity: 2}}},
	BuildingTypeJammerTower:                  {Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "copper_ingot", Quantity: 12}, {ItemID: "diamond", Quantity: 6}, {ItemID: "plasma_exciter", Quantity: 9}, {ItemID: "processor", Quantity: 3}}},
	BuildingTypeLaserTurret:                  {Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 6}, {ItemID: "photon_combiner", Quantity: 9}, {ItemID: "plasma_exciter", Quantity: 6}, {ItemID: "steel", Quantity: 9}}},
	BuildingTypeMissileTurret:                {Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 12}, {ItemID: "engine", Quantity: 6}, {ItemID: "motor", Quantity: 6}, {ItemID: "steel", Quantity: 8}}},
	BuildingTypePlanetaryShieldGenerator:     {Minerals: 500, Energy: 250, Items: []ItemAmount{{ItemID: "electromagnetic_turbine", Quantity: 20}, {ItemID: "particle_container", Quantity: 5}, {ItemID: "steel", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 5}}},
	BuildingTypePlasmaTurret:                 {Minerals: 100, Energy: 40, Items: []ItemAmount{{ItemID: "plasma_exciter", Quantity: 5}, {ItemID: "processor", Quantity: 5}, {ItemID: "super_magnetic_ring", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 20}, {ItemID: "titanium_glass", Quantity: 10}}},
	BuildingTypeSRPlasmaTurret:               {Minerals: 300, Energy: 150, Items: []ItemAmount{{ItemID: "plasma_exciter", Quantity: 5}, {ItemID: "processor", Quantity: 5}, {ItemID: "steel", Quantity: 15}, {ItemID: "super_magnetic_ring", Quantity: 5}}},
	BuildingTypeSignalTower:                  {Minerals: 50, Energy: 20, Items: []ItemAmount{{ItemID: "crystal_silicon", Quantity: 6}, {ItemID: "steel", Quantity: 12}}},
	BuildingTypeEMRailEjector:                {Minerals: 260, Energy: 130, Items: []ItemAmount{{ItemID: "gear", Quantity: 20}, {ItemID: "processor", Quantity: 5}, {ItemID: "steel", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 10}}},
	BuildingTypeEnergyExchanger:              {Minerals: 180, Energy: 80, Items: []ItemAmount{{ItemID: "particle_container", Quantity: 8}, {ItemID: "processor", Quantity: 40}, {ItemID: "steel", Quantity: 40}, {ItemID: "titanium_alloy", Quantity: 40}}},
	BuildingTypeFractionator:                 {Minerals: 100, Energy: 60, Items: []ItemAmount{{ItemID: "glass", Quantity: 4}, {ItemID: "processor", Quantity: 1}, {ItemID: "steel", Quantity: 8}, {ItemID: "stone_brick", Quantity: 4}}},
	BuildingTypeGeothermalPowerStation:       {Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "copper_ingot", Quantity: 20}, {ItemID: "photon_combiner", Quantity: 4}, {ItemID: "steel", Quantity: 15}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
	BuildingTypeInterstellarLogisticsStation: {Minerals: 280, Energy: 140, Items: []ItemAmount{{ItemID: "particle_container", Quantity: 20}, {ItemID: "titanium_alloy", Quantity: 40}}},
	BuildingTypeLogisticsDistributor:         {Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "iron_ingot", Quantity: 8}, {ItemID: "plasma_exciter", Quantity: 4}, {ItemID: "processor", Quantity: 4}}},
	BuildingTypeMatrixLab:                    {Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 4}, {ItemID: "glass", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "magnetic_coil", Quantity: 4}}},
	BuildingTypeMiniFusionPowerPlant:         {Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "carbon_nanotube", Quantity: 8}, {ItemID: "processor", Quantity: 4}, {ItemID: "super_magnetic_ring", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 12}}},
	BuildingTypeMiniatureParticleCollider:    {Minerals: 120, Energy: 60, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 20}, {ItemID: "graphene", Quantity: 10}, {ItemID: "processor", Quantity: 8}, {ItemID: "super_magnetic_ring", Quantity: 25}, {ItemID: "titanium_alloy", Quantity: 20}}},
	BuildingTypeMiningMachine:                {Minerals: 50, Energy: 20, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "gear", Quantity: 2}, {ItemID: "iron_ingot", Quantity: 4}, {ItemID: "magnetic_coil", Quantity: 2}}},
	BuildingTypeOilExtractor:                 {Minerals: 80, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 6}, {ItemID: "plasma_exciter", Quantity: 4}, {ItemID: "steel", Quantity: 12}, {ItemID: "stone_brick", Quantity: 12}}},
	BuildingTypeOilRefinery:                  {Minerals: 140, Energy: 70, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 6}, {ItemID: "plasma_exciter", Quantity: 6}, {ItemID: "steel", Quantity: 10}, {ItemID: "stone_brick", Quantity: 10}}},
	BuildingTypeOrbitalCollector:             {Minerals: 200, Energy: 80, Items: []ItemAmount{{ItemID: "reinforced_thruster", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 50}}},
	BuildingTypePlaneSmelter:                 {Minerals: 180, Energy: 90, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 5}, {ItemID: "monopole_magnet", Quantity: 15}, {ItemID: "plane_filter", Quantity: 4}}},
	BuildingTypePlanetaryLogisticsStation:    {Minerals: 160, Energy: 80, Items: []ItemAmount{{ItemID: "particle_container", Quantity: 20}, {ItemID: "processor", Quantity: 40}, {ItemID: "steel", Quantity: 40}, {ItemID: "titanium_ingot", Quantity: 40}}},
	BuildingTypeQuantumChemicalPlant:         {Minerals: 220, Energy: 110, Items: []ItemAmount{{ItemID: "quantum_chip", Quantity: 3}, {ItemID: "strange_matter", Quantity: 3}, {ItemID: "titanium_glass", Quantity: 10}}},
	BuildingTypeRayReceiver:                  {Minerals: 260, Energy: 130, Items: []ItemAmount{{ItemID: "photon_combiner", Quantity: 10}, {ItemID: "processor", Quantity: 5}, {ItemID: "silicon_ingot", Quantity: 20}, {ItemID: "steel", Quantity: 20}, {ItemID: "super_magnetic_ring", Quantity: 20}}},
	BuildingTypeSatelliteSubstation:          {Minerals: 80, Energy: 40, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 2}, {ItemID: "super_magnetic_ring", Quantity: 10}}},
	BuildingTypeSolarPanel:                   {Minerals: 40, Energy: 0, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 5}, {ItemID: "copper_ingot", Quantity: 10}, {ItemID: "silicon_ingot", Quantity: 10}}},
	BuildingTypeSorterMk1:                    {Minerals: 6, Energy: 0, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 1}}},
	BuildingTypeSorterMk2:                    {Minerals: 10, Energy: 0, Items: []ItemAmount{{ItemID: "motor", Quantity: 1}}},
	BuildingTypeSorterMk3:                    {Minerals: 14, Energy: 0, Items: []ItemAmount{{ItemID: "electromagnetic_turbine", Quantity: 1}}},
	BuildingTypePileSorter:                   {Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "processor", Quantity: 1}, {ItemID: "super_magnetic_ring", Quantity: 1}}},
	BuildingTypeSplitter:                     {Minerals: 20, Energy: 10, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 1}, {ItemID: "gear", Quantity: 2}, {ItemID: "iron_ingot", Quantity: 3}}},
	BuildingTypeSprayCoater:                  {Minerals: 60, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "microcrystalline_component", Quantity: 2}, {ItemID: "plasma_exciter", Quantity: 2}, {ItemID: "steel", Quantity: 4}}},
	BuildingTypeDepotMk1:                     {Minerals: 60, Energy: 20, Items: []ItemAmount{{ItemID: "iron_ingot", Quantity: 4}, {ItemID: "stone_brick", Quantity: 4}}},
	BuildingTypeDepotMk2:                     {Minerals: 60, Energy: 20, Items: []ItemAmount{{ItemID: "steel", Quantity: 8}, {ItemID: "stone_brick", Quantity: 8}}},
	BuildingTypeStorageTank:                  {Minerals: 60, Energy: 20, Items: []ItemAmount{{ItemID: "glass", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "stone_brick", Quantity: 4}}},
	BuildingTypeTeslaTower:                   {Minerals: 20, Energy: 10, Items: []ItemAmount{{ItemID: "iron_ingot", Quantity: 2}, {ItemID: "magnetic_coil", Quantity: 1}}},
	BuildingTypeThermalPowerPlant:            {Minerals: 90, Energy: 30, Items: []ItemAmount{{ItemID: "gear", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 10}, {ItemID: "magnetic_coil", Quantity: 4}, {ItemID: "stone_brick", Quantity: 4}}},
	BuildingTypeTrafficMonitor:               {Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "gear", Quantity: 2}, {ItemID: "glass", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 3}}},
	BuildingTypeVerticalLaunchingSilo:        {Minerals: 260, Energy: 130, Items: []ItemAmount{{ItemID: "frame_material", Quantity: 30}, {ItemID: "graviton_lens", Quantity: 20}, {ItemID: "quantum_chip", Quantity: 10}, {ItemID: "titanium_alloy", Quantity: 80}}},
	BuildingTypeWaterPump:                    {Minerals: 80, Energy: 30, Items: []ItemAmount{{ItemID: "circuit_board", Quantity: 2}, {ItemID: "motor", Quantity: 4}, {ItemID: "iron_ingot", Quantity: 8}, {ItemID: "stone_brick", Quantity: 4}}},
	BuildingTypeWindTurbine:                  {Minerals: 30, Energy: 0, Items: []ItemAmount{{ItemID: "gear", Quantity: 1}, {ItemID: "iron_ingot", Quantity: 6}, {ItemID: "magnetic_coil", Quantity: 3}}},
	BuildingTypeWirelessPowerTower:           {Minerals: 40, Energy: 20, Items: []ItemAmount{{ItemID: "plasma_exciter", Quantity: 3}}},
}

// dspBuildingUnlockTechAlignment 冻结 DSP 建筑配方的解锁科技（scope.json
// techs[*].unlocks 反查，DSP id 经 mapping.json 映射或 kebab→snake 转换）。
// BuildingDefinition.UnlockTech 由 catalog_derivation 从科技定义的
// TechUnlockBuilding 解锁项派生，此处守住派生结果与 DSP 一致。
var dspBuildingUnlockTechAlignment = map[BuildingType]string{
	BuildingTypeAccumulator:                  "energy_storage",
	BuildingTypeAdvancedMiningMachine:        "photon_mining",
	BuildingTypeArcSmelter:                   "automatic_metallurgy",
	BuildingTypeArtificialStar:               "artificial_star",
	BuildingTypeAssemblingMachineMk1:         "basic_assembling_processes",
	BuildingTypeAssemblingMachineMk2:         "highspeed_assembling",
	BuildingTypeAssemblingMachineMk3:         "quantum_printing",
	BuildingTypeAutomaticPiler:               "integrated_logistics",
	BuildingTypeChemicalPlant:                "basic_chemical",
	BuildingTypeConveyorBeltMk1:              "basic_logistics_system",
	BuildingTypeConveyorBeltMk2:              "efficient_logistics",
	BuildingTypeConveyorBeltMk3:              "planetary_logistics",
	BuildingTypeBattlefieldAnalysisBase:      "battlefield_analysis",
	BuildingTypeGaussTurret:                  "weapon_system",
	BuildingTypeImplosionCannon:              "implosion_cannon",
	BuildingTypeJammerTower:                  "df_jammer_tower_tech",
	BuildingTypeLaserTurret:                  "df_planetary_defense_system",
	BuildingTypeMissileTurret:                "missile_turret",
	BuildingTypePlanetaryShieldGenerator:     "df_planetary_defense_system",
	BuildingTypePlasmaTurret:                 "plasma_turret",
	BuildingTypeSRPlasmaTurret:               "plasma_turret",
	BuildingTypeSignalTower:                  "signal_tower",
	BuildingTypeEMRailEjector:                "solar_sail_orbit",
	BuildingTypeEnergyExchanger:              "interstellar_power",
	BuildingTypeFractionator:                 "deuterium_fractionation",
	BuildingTypeGeothermalPowerStation:       "geothermal",
	BuildingTypeInterstellarLogisticsStation: "interstellar_logistics",
	BuildingTypeLogisticsDistributor:         "distribution_logistics",
	BuildingTypeMatrixLab:                    "electromagnetic_matrix_technology",
	BuildingTypeMiniFusionPowerPlant:         "mini_fusion",
	BuildingTypeMiniatureParticleCollider:    "miniature_collider",
	BuildingTypeMiningMachine:                "electromagnetism",
	BuildingTypeOilExtractor:                 "plasma_refining",
	BuildingTypeOilRefinery:                  "plasma_refining",
	BuildingTypeOrbitalCollector:             "gas_giants",
	BuildingTypePlaneSmelter:                 "plane_filter_smelting",
	BuildingTypePlanetaryLogisticsStation:    "planetary_logistics",
	BuildingTypeQuantumChemicalPlant:         "mesoscopic_entanglement",
	BuildingTypeRayReceiver:                  "ray_receiver",
	BuildingTypeSatelliteSubstation:          "satellite_power",
	BuildingTypeSolarPanel:                   "solar_collection",
	BuildingTypeSorterMk1:                    "basic_logistics_system",
	BuildingTypeSorterMk2:                    "improved_logistics_system",
	BuildingTypeSorterMk3:                    "efficient_logistics",
	BuildingTypePileSorter:                   "integrated_logistics",
	BuildingTypeSplitter:                     "improved_logistics_system",
	BuildingTypeSprayCoater:                  "proliferator_mk1",
	BuildingTypeDepotMk1:                     "basic_logistics_system",
	BuildingTypeDepotMk2:                     "efficient_logistics",
	BuildingTypeStorageTank:                  "fluid_storage",
	BuildingTypeTeslaTower:                   "electromagnetism",
	BuildingTypeThermalPowerPlant:            "thermal_power",
	BuildingTypeTrafficMonitor:               "improved_logistics_system",
	BuildingTypeVerticalLaunchingSilo:        "vertical_launching",
	BuildingTypeWaterPump:                    "fluid_storage",
	BuildingTypeWindTurbine:                  "electromagnetism",
	BuildingTypeWirelessPowerTower:           "plasma_control",
}

// dspUnlockTechPending 是科技定义（tech.go，任务域 C）尚未按 DSP 对齐
// TechUnlockBuilding 归属的建筑：SW 现行归属有意或暂未与 DSP 一致
// （起始建筑由预完成的 dyson_sphere_program 直接授予，保证新局可建造）。
// 这些建筑仅要求 UnlockTech 非空，待科技域对齐后应移出本清单并接受精确匹配。
var dspUnlockTechPending = map[BuildingType]string{
	BuildingTypeArcSmelter:           "automatic_metallurgy（现由 dyson_sphere_program 授予）",
	BuildingTypeAssemblingMachineMk1: "basic_assembling_processes（现由 dyson_sphere_program 授予）",
	BuildingTypeConveyorBeltMk1:      "basic_logistics_system（现由 dyson_sphere_program 授予）",
	BuildingTypeDepotMk1:             "basic_logistics_system（现由 electromagnetism 授予）",
	BuildingTypeMiningMachine:        "electromagnetism（现由 dyson_sphere_program 授予）",
	BuildingTypeSorterMk1:            "basic_logistics_system（现由 dyson_sphere_program 授予）",
	BuildingTypeTeslaTower:           "electromagnetism（现由 dyson_sphere_program 授予）",
	BuildingTypeWindTurbine:          "electromagnetism（现由 dyson_sphere_program 授予）",
}

// dspPendingItemIDs 是 BuildCost.Items 中引用、由物品域（任务域 A）并行新增的
// DSP 物品，当前尚未进入物品目录。域 A 落地后本集合应收缩为空。
var dspPendingItemIDs = map[string]bool{
	"graviton_lens":       true,
	"particle_broadband":  true,
	"plane_filter":        true,
	"reinforced_thruster": true,
	"titanium_glass":      true,
}

func sortedItems(items []ItemAmount) []ItemAmount {
	out := append([]ItemAmount(nil), items...)
	sort.Slice(out, func(i, j int) bool { return out[i].ItemID < out[j].ItemID })
	return out
}

// TestDSPBuildingCatalogCount 守住建筑总数 62（对齐只改成本，不增不减）。
func TestDSPBuildingCatalogCount(t *testing.T) {
	defs := AllBuildingDefinitions()
	if len(defs) != 62 {
		t.Fatalf("building catalog should hold 62 definitions, got %d", len(defs))
	}
}

// TestDSPBuildingBuildCostAlignment 逐建筑核对 BuildCost 与 DSP 建筑合成配方一致。
func TestDSPBuildingBuildCostAlignment(t *testing.T) {
	if len(dspBuildingCostAlignment) != 57 {
		t.Fatalf("alignment table should cover 57 in-planet buildings, got %d", len(dspBuildingCostAlignment))
	}
	for id, want := range dspBuildingCostAlignment {
		def, ok := BuildingDefinitionByID(id)
		if !ok {
			t.Errorf("building %s missing from catalog", id)
			continue
		}
		if def.BuildCost.Minerals != want.Minerals || def.BuildCost.Energy != want.Energy {
			t.Errorf("building %s cost minerals/energy = (%d,%d), want (%d,%d)",
				id, def.BuildCost.Minerals, def.BuildCost.Energy, want.Minerals, want.Energy)
		}
		gotItems := sortedItems(def.BuildCost.Items)
		wantItems := sortedItems(want.Items)
		if len(gotItems) != len(wantItems) {
			t.Errorf("building %s items = %v, want %v", id, gotItems, wantItems)
			continue
		}
		for i := range wantItems {
			if gotItems[i] != wantItems[i] {
				t.Errorf("building %s items = %v, want %v", id, gotItems, wantItems)
				break
			}
		}
	}
}

// TestDSPBuildingCostItemReferences 核对 BuildCost.Items 引用的物品存在；
// 域 A 并行新增的物品允许暂缺，但必须命中 dspPendingItemIDs 白名单。
func TestDSPBuildingCostItemReferences(t *testing.T) {
	for id := range dspBuildingCostAlignment {
		def, ok := BuildingDefinitionByID(id)
		if !ok {
			t.Fatalf("building %s missing from catalog", id)
		}
		for _, item := range def.BuildCost.Items {
			if _, exists := Item(item.ItemID); exists {
				continue
			}
			if !dspPendingItemIDs[item.ItemID] {
				t.Errorf("building %s references unknown item %s (not in pending whitelist)", id, item.ItemID)
			}
		}
	}
}

// TestDSPAccumulatorFullPolicy 守住蓄电器（满）政策：accumulator-full 的 DSP
// 配方输入为建筑物品 accumulator，按政策不并入 Items；SW 中它不可直接建造，
// 由能量枢纽充放电循环产出。
func TestDSPAccumulatorFullPolicy(t *testing.T) {
	def, ok := BuildingDefinitionByID(BuildingTypeAccumulatorFull)
	if !ok {
		t.Fatal("accumulator_full missing from catalog")
	}
	if def.Buildable {
		t.Error("accumulator_full should not be directly buildable")
	}
	if len(def.BuildCost.Items) != 0 {
		t.Errorf("accumulator_full should not carry item costs, got %v", def.BuildCost.Items)
	}
}

// TestDSPBuildingUnlockTechCoverage 核对派生 UnlockTech 覆盖 DSP 解锁科技。
// 已对齐齐的精确匹配；dspUnlockTechPending 中的建筑暂只要求 UnlockTech 非空。
func TestDSPBuildingUnlockTechCoverage(t *testing.T) {
	if len(dspBuildingUnlockTechAlignment) != 57 {
		t.Fatalf("unlock tech table should cover 57 in-planet buildings, got %d", len(dspBuildingUnlockTechAlignment))
	}
	for id, wantTech := range dspBuildingUnlockTechAlignment {
		def, ok := BuildingDefinitionByID(id)
		if !ok {
			t.Errorf("building %s missing from catalog", id)
			continue
		}
		if note, pending := dspUnlockTechPending[id]; pending {
			if len(def.UnlockTech) == 0 {
				t.Errorf("building %s has no unlock tech at all (DSP expects %s)", id, note)
			}
			continue
		}
		if !hasUnlockTech(def.UnlockTech, wantTech) {
			t.Errorf("building %s unlock tech = %v, want it to contain %s", id, def.UnlockTech, wantTech)
		}
	}
}

// TestDspPileSorterAndSRPlasmaTurretMapping 守住 mapping_overrides 裁定：
// sorter-4 即 pile_sorter、df-plasma-turret-sr 即 sr_plasma_turret，且唯一无重复。
func TestDspPileSorterAndSRPlasmaTurretMapping(t *testing.T) {
	defs := AllBuildingDefinitions()
	count := map[BuildingType]int{}
	for _, def := range defs {
		count[def.ID]++
	}
	for _, id := range []BuildingType{BuildingTypePileSorter, BuildingTypeSRPlasmaTurret} {
		if count[id] != 1 {
			t.Fatalf("building %s should appear exactly once, got %d", id, count[id])
		}
	}
	pile, _ := BuildingDefinitionByID(BuildingTypePileSorter)
	if pile.Name != "Pile Sorter" {
		t.Errorf("pile_sorter name = %q, want Pile Sorter", pile.Name)
	}
	sr, _ := BuildingDefinitionByID(BuildingTypeSRPlasmaTurret)
	if sr.Name != "SR Plasma Turret" {
		t.Errorf("sr_plasma_turret name = %q, want SR Plasma Turret", sr.Name)
	}
	if hasUnlockTech(pile.UnlockTech, "integrated_logistics") == false {
		t.Errorf("pile_sorter unlock tech = %v, want integrated_logistics", pile.UnlockTech)
	}
	if hasUnlockTech(sr.UnlockTech, "plasma_turret") == false {
		t.Errorf("sr_plasma_turret unlock tech = %v, want plasma_turret", sr.UnlockTech)
	}
}

func hasUnlockTech(values []string, target string) bool {
	for _, v := range values {
		if v == target {
			return true
		}
	}
	return false
}
