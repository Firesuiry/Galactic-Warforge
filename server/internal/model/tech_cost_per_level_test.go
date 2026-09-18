package model

import "testing"

// DSP 行星内科技树对齐（任务域 C）验收测试：
// 每级成本（CostPerLevel）语义、既有家族级数修正、新增家族覆盖与 DAG 完整性。

func techDefByID(t *testing.T, id string) *TechDefinition {
	t.Helper()
	def, ok := TechDefinitionByID(id)
	if !ok {
		t.Fatalf("tech %s not found", id)
	}
	return def
}

func costTotal(cost []ItemAmount) int {
	total := 0
	for _, c := range cost {
		total += c.Quantity
	}
	return total
}

func costHas(cost []ItemAmount, itemID string, qty int) bool {
	for _, c := range cost {
		if c.ItemID == itemID && c.Quantity == qty {
			return true
		}
	}
	return false
}

// 无 CostPerLevel 的科技在任何等级都返回 Cost（行为不变）。
func TestCostForLevelFallsBackToFlatCost(t *testing.T) {
	def := techDefByID(t, "electromagnetism")
	for _, level := range []int{1, 2, 7} {
		got := def.CostForLevel(level)
		if len(got) != len(def.Cost) {
			t.Fatalf("electromagnetism CostForLevel(%d) = %v, want Cost %v", level, got, def.Cost)
		}
		if !costHas(got, "electromagnetic_matrix", 10) {
			t.Fatalf("electromagnetism CostForLevel(%d) = %+v, want electromagnetic_matrix x10", level, got)
		}
	}
}

// CostPerLevel 按 1 级起始的等级索引返回对应成本。
func TestCostForLevelUsesPerLevelEntries(t *testing.T) {
	def := techDefByID(t, "research_speed")
	if !costHas(def.CostForLevel(1), "information_matrix", 45) {
		t.Fatalf("research_speed L1 cost wrong: %+v", def.CostForLevel(1))
	}
	if !costHas(def.CostForLevel(2), "information_matrix", 72) {
		t.Fatalf("research_speed L2 cost wrong: %+v", def.CostForLevel(2))
	}
	if !costHas(def.CostForLevel(4), "universe_matrix", 112) {
		t.Fatalf("research_speed L4 cost wrong: %+v", def.CostForLevel(4))
	}
}

// DSP 数据集中 logistics_carrier_capacity 缺 10/11 级：缺级回落到最近的已定义低级。
func TestCostForLevelFallsBackToNearestLowerLevel(t *testing.T) {
	def := techDefByID(t, "logistics_carrier_capacity")
	l9 := def.CostForLevel(9)
	for _, level := range []int{10, 11} {
		got := def.CostForLevel(level)
		if costTotal(got) != costTotal(l9) {
			t.Fatalf("logistics_carrier_capacity L%d should reuse L9 cost %+v, got %+v", level, l9, got)
		}
	}
	if !costHas(def.CostForLevel(12), "universe_matrix", 456) {
		t.Fatalf("logistics_carrier_capacity L12 cost wrong: %+v", def.CostForLevel(12))
	}
}

// 低于所有已定义等级时回落到 Cost（mecha_core L1 由既有游戏测试钉住为电磁矩阵x100）。
func TestCostForLevelBelowDefinedMapFallsBackToCost(t *testing.T) {
	def := techDefByID(t, "mecha_core")
	got := def.CostForLevel(1)
	if !costHas(got, "electromagnetic_matrix", 100) {
		t.Fatalf("mecha_core L1 should fall back to Cost (electromagnetic_matrix x100), got %+v", got)
	}
	if !costHas(def.CostForLevel(2), "electromagnetic_matrix", 40) {
		t.Fatalf("mecha_core L2 cost wrong: %+v", def.CostForLevel(2))
	}
	if !costHas(def.CostForLevel(6), "universe_matrix", 160) {
		t.Fatalf("mecha_core L6 cost wrong: %+v", def.CostForLevel(6))
	}
}

// 既有家族级数与 DSP 对齐。
func TestExistingRepeatableTechLevelsAligned(t *testing.T) {
	cases := map[string]int{
		"mecha_core":            6,
		"drone_engine":          6,
		"research_speed":        4,
		"solar_sail_life":       6,
		"universe_exploration":  4,
		"vertical_construction": 6,
	}
	for id, want := range cases {
		def := techDefByID(t, id)
		if def.MaxLevel != want {
			t.Errorf("tech %s MaxLevel = %d, want %d (DSP)", id, def.MaxLevel, want)
		}
	}
}

// 新增 DSP 升级家族：单 TechDefinition + MaxLevel=DSP 全级数。
func TestNewDSPUpgradeFamiliesPresent(t *testing.T) {
	cases := map[string]int{
		"communication_control":                  7,
		"veins_utilization":                      6,
		"inventory_capacity":                     7,
		"drive_engine":                           6,
		"mechanical_frame":                       8,
		"mass_construction":                      5,
		"distribution_range":                     5,
		"energy_circuit":                         6,
		"logistics_carrier_capacity":             12,
		"logistics_carrier_engine":               7,
		"sorter_cargo_stacking":                  5,
		"sorter_cargo_integration":               1,
		"pile_sorter":                            6,
		"ray_transmission_efficiency":            8,
		"logistics_station_integrated_logistics": 3,
		"df_auto_reconstruction_marking":         6,
		"df_combat_drone_attack_speed":           5,
		"df_combat_drone_damage":                 5,
		"df_combat_drone_durability":             5,
		"df_em_weapon_strength":                  6,
		"df_energy_shield":                       7,
		"df_energy_weapon_damage":                6,
		"df_enhanced_structure":                  6,
		"df_explosive_weapon_damage":             6,
		"df_ground_squadron_expansion":           7,
		"df_kinetic_weapon_damage":               6,
		"df_planetary_shield":                    5,
		"df_space_fleet_expansion":               7,
	}
	for id, want := range cases {
		def := techDefByID(t, id)
		if def.MaxLevel != want {
			t.Errorf("family %s MaxLevel = %d, want %d", id, def.MaxLevel, want)
		}
		if len(def.CostPerLevel) == 0 {
			t.Errorf("family %s missing CostPerLevel", id)
		}
		if def.Name == "" || def.NameEN == "" {
			t.Errorf("family %s missing zh/en names", id)
		}
	}
}

// 新增单级科技存在且成本/前置与 DSP 对齐。
func TestNewDSPSingleTechsPresent(t *testing.T) {
	singles := []string{
		"electromagnetic_matrix_technology",
		"improved_logistics_system",
		"reinforced_thruster_technology",
		"df_antimatter_capsule_tech",
		"df_attack_drone_tech",
		"df_explosive_unit_tech",
		"df_high_density_controlled_annihilation",
		"df_high_explosive_shell_set_tech",
		"df_jammer_tower_tech",
		"df_matter_recombination",
		"df_negentropy_recursion",
		"df_planetary_defense_system",
		"df_superalloy_ammo_box_tech",
		"df_suppressing_capsule_tech",
	}
	for _, id := range singles {
		def := techDefByID(t, id)
		if def.MaxLevel != 0 {
			t.Errorf("single tech %s should not be repeatable, MaxLevel=%d", id, def.MaxLevel)
		}
		if len(def.Cost) == 0 {
			t.Errorf("single tech %s missing cost", id)
		}
	}

	em := techDefByID(t, "electromagnetic_matrix_technology")
	if !costHas(em.Cost, "circuit_board", 10) || !costHas(em.Cost, "magnetic_coil", 10) {
		t.Errorf("electromagnetic_matrix_technology cost wrong: %+v", em.Cost)
	}
	if len(em.Prerequisites) != 1 || em.Prerequisites[0] != "electromagnetism" {
		t.Errorf("electromagnetic_matrix_technology prereq wrong: %v", em.Prerequisites)
	}

	// gated 黑雾科技：数据入库、靠黑雾矩阵成本自然锁死。
	for _, id := range []string{"df_high_density_controlled_annihilation", "df_matter_recombination", "df_negentropy_recursion"} {
		def := techDefByID(t, id)
		if !costHas(def.Cost, "dark_fog_matrix", 60) {
			t.Errorf("gated tech %s should cost dark_fog_matrix x60, got %+v", id, def.Cost)
		}
	}
}

// 全图必须是无环 DAG：拓扑排序能消费所有节点。
func TestTechGraphIsAcyclic(t *testing.T) {
	defs := AllTechDefinitions()
	inDegree := make(map[string]int, len(defs))
	dependents := make(map[string][]string, len(defs))
	for _, def := range defs {
		if _, ok := inDegree[def.ID]; !ok {
			inDegree[def.ID] = 0
		}
		for _, prereq := range def.Prerequisites {
			inDegree[def.ID]++
			dependents[prereq] = append(dependents[prereq], def.ID)
		}
	}
	queue := make([]string, 0, len(defs))
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}
	visited := 0
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		visited++
		for _, next := range dependents[id] {
			inDegree[next]--
			if inDegree[next] == 0 {
				queue = append(queue, next)
			}
		}
	}
	if visited != len(defs) {
		var cyclic []string
		for id, deg := range inDegree {
			if deg > 0 {
				cyclic = append(cyclic, id)
			}
		}
		t.Fatalf("tech graph has a cycle involving %v (visited %d/%d)", cyclic, visited, len(defs))
	}
}

// MaxLevel 展开后的节点数必须显著增长（DSP 行星内 270 节点量级覆盖）。
func TestTechNodeCoverageExpanded(t *testing.T) {
	defs := AllTechDefinitions()
	if len(defs) < 140 {
		t.Fatalf("expected >= 140 tech definitions after DSP alignment, got %d", len(defs))
	}
	nodes := 0
	for _, def := range defs {
		if def.MaxLevel > 0 {
			nodes += def.MaxLevel
		} else {
			nodes++
		}
	}
	// mecha_engine(MaxLevel 100, 历史遗留) 贡献 100 节点；扣除后仍需 >= 270 级别的覆盖。
	if nodes-100 < 270 {
		t.Fatalf("expanded tech nodes (excluding legacy mecha_engine) = %d, want >= 270", nodes-100)
	}
}
