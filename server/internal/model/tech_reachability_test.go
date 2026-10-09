package model

import (
	"fmt"
	"sort"
	"testing"

	"siliconworld/internal/mapmodel"
)

// tech_reachability_test.go 是新玩家可达性总验收（试玩报告 tmp/playtest-1007 的
// 「遭遇战科技树死锁」回归护栏）：从新玩家状态出发做不动点推演，断言
//   - 所有非 hidden 科技都能研究完成；
//   - 所有 buildable 建筑都能建造；
//   - 所有物品都有真实来源（配方产出、建筑采集或白名单中的引擎机制）。
//
// 推演模型（与运行时逐条对应）：
//   - 新玩家已完成 dyson_sphere_program（model.DefaultCompletedTechs）；
//   - 机甲可手动采集固体资源节点（gamecore.manualMineItem：资源节点解析为
//     固体物品即允许手采，见 mapgen 的 ResourceFinite/ResourceRenewable）；
//   - 建筑需「已解锁（任一 UnlockTech 已完成）且造价物品可得」；
//     采集型建筑（runtime.functions.collect.allowed_resources）产出对应资源；
//   - 配方需「已解锁（recipe.tech_unlock 或科技侧 unlocks，任一完成即可，
//     对齐 gamecore.CanUseRecipeTech）且有可用生产者（配方 building_types
//     命中的已建生产建筑，或 handcraft_allowed 的手工路径）」；
//   - 科技需「研究站已可建（runtime.functions.research）+ 前置已完成 +
//     成本物品可得」。研究站本身由研究站的建造条件覆盖，不需要额外假设。

// reachabilityWhitelist 是非配方来源物品的显式建模：这些物品在运行时由引擎
// 机制而非生产配方产出，推演器无法从配方目录推导，逐条列出真实来源。
// 新增条目必须先在服务端找到对应机制；找不到真实来源的应视为阻塞并修复数据。
var reachabilityWhitelist = map[string]string{
	// 流体容器物品：由 fluid 资源的分装语义定义（items.yaml form_containers、
	// model.ContainerForForm），不是生产配方产物。
	"liquid_tank": "流体容器物品（form_containers.liquid）",
	"gas_tank":    "流体容器物品（form_containers.gas）",
	// 射线接收站光子模式产出（ray_receiver.go rayReceiverOutput / PhotonItemID）。
	"critical_photon": "射线接收站光子模式产出",
	// 能量枢纽充放电循环：蓄电器物品 → 满蓄电器（energy_storage_settlement.go
	// chargeExchangerItems，EmptyItemID/FullItemID）。
	"accumulator_full": "能量枢纽充电循环产出（energy_exchanger.empty/full_item_id）",
	// 黑雾掉落（combat_settlement.go darkFogLootTable）：隐藏科技链的触发物品。
	"dark_fog_matrix": "黑雾击杀掉落（darkFogLootTable）",
	// 单位载荷物品：不再有实物生产配方，由兵营/战车工厂/机场按 units.yaml 生产，
	// 战争蓝图经 ReadyPayloads 服役（war_industry_commands.go）。
	"precision_drone": "单位载荷（战争蓝图服役，无实物配方）",
}

// handMineableResourceItems 返回机甲可手采的资源物品：资源节点种类即物品 id，
// 固体形态才可手采（gamecore.manualMineItem 与 mapgen 的资源调色板一致）。
func handMineableResourceItems(t *testing.T) []string {
	t.Helper()
	out := make([]string, 0, len(mapmodel.AllResourceKinds()))
	for _, kind := range mapmodel.AllResourceKinds() {
		def, ok := Item(string(kind))
		if !ok {
			continue
		}
		if def.Form == ResourceSolid {
			out = append(out, def.ID)
		}
	}
	sort.Strings(out)
	return out
}

// recipeGateTechs 返回配方可用的门控科技集合（recipe.tech_unlock 与科技侧
// TechUnlockRecipe 的并集），空集合表示基础配方。
func recipeGateTechs(recipeID string) map[string]bool {
	gates := map[string]bool{}
	if recipe, ok := Recipe(recipeID); ok {
		for _, techID := range recipe.TechUnlock {
			gates[techID] = true
		}
	}
	for _, def := range AllTechDefinitions() {
		if def == nil {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type == TechUnlockRecipe && unlock.ID == recipeID {
				gates[def.ID] = true
			}
		}
	}
	return gates
}

// buildingGateTechs 返回建筑解锁科技集合（科技侧 TechUnlockBuilding），
// 空集合表示开局即可建造。
func buildingGateTechs(btype BuildingType) map[string]bool {
	gates := map[string]bool{}
	for _, def := range AllTechDefinitions() {
		if def == nil {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type == TechUnlockBuilding && unlock.ID == string(btype) {
				gates[def.ID] = true
			}
		}
	}
	return gates
}

func anyTechDone(gates map[string]bool, done map[string]bool) bool {
	if len(gates) == 0 {
		return true
	}
	for id := range gates {
		if done[id] {
			return true
		}
	}
	return false
}

// reachabilityResult 是推演结果，用于失败时打印未达项。
type reachabilityResult struct {
	items     map[string]bool
	techs     map[string]bool
	buildings map[BuildingType]bool
}

// simulateNewPlayerReachability 从新玩家状态做不动点推演。
func simulateNewPlayerReachability(t *testing.T) reachabilityResult {
	t.Helper()

	items := map[string]bool{}
	for _, id := range handMineableResourceItems(t) {
		items[id] = true
	}
	for id := range reachabilityWhitelist {
		if _, ok := Item(id); !ok {
			t.Fatalf("reachability whitelist entry %q is not a catalog item", id)
		}
		items[id] = true
	}

	techs := map[string]bool{}
	for id := range DefaultCompletedTechs() {
		techs[id] = true
	}
	buildings := map[BuildingType]bool{}

	hasProduction := func(btype BuildingType) bool {
		rt, ok := BuildingRuntimeDefinitionByID(btype)
		return ok && rt.Functions.Production != nil
	}
	researchBuilding := func() bool {
		for btype := range buildings {
			if rt, ok := BuildingRuntimeDefinitionByID(btype); ok && rt.Functions.Research != nil {
				return true
			}
		}
		return false
	}

	for changed := true; changed; {
		changed = false

		// 建筑：已解锁 + 造价物品可得 → 建成；采集型建筑产出资源。
		for _, def := range AllBuildingDefinitions() {
			if !def.Buildable || buildings[def.ID] {
				continue
			}
			if !anyTechDone(buildingGateTechs(def.ID), techs) {
				continue
			}
			affordable := true
			for _, cost := range def.BuildCost.Items {
				if !items[cost.ItemID] {
					affordable = false
					break
				}
			}
			if !affordable {
				continue
			}
			buildings[def.ID] = true
			changed = true
			if rt, ok := BuildingRuntimeDefinitionByID(def.ID); ok && rt.Functions.Collect != nil {
				for _, resource := range rt.Functions.Collect.AllowedResources {
					if !items[resource] {
						items[resource] = true
						changed = true
					}
				}
			}
		}

		// 配方：已解锁 + 有生产者（生产建筑或手工）+ 输入可得 → 产出可得。
		for _, recipe := range AllRecipes() {
			if !anyTechDone(recipeGateTechs(recipe.ID), techs) {
				continue
			}
			producer := recipe.HandcraftAllowed
			if !producer {
				for _, btype := range recipe.BuildingTypes {
					if buildings[btype] && hasProduction(btype) {
						producer = true
						break
					}
				}
			}
			if !producer {
				continue
			}
			ready := true
			for _, in := range recipe.Inputs {
				if !items[in.ItemID] {
					ready = false
					break
				}
			}
			if !ready {
				continue
			}
			for _, out := range recipe.AllOutputs() {
				if !items[out.ItemID] {
					items[out.ItemID] = true
					changed = true
				}
			}
		}

		// 科技：研究站可建 + 前置完成 + 成本物品可得 → 完成。
		if !researchBuilding() {
			continue
		}
		for _, def := range AllTechDefinitions() {
			if def == nil || def.Hidden || techs[def.ID] {
				continue
			}
			prereqOK := true
			for _, prereq := range def.Prerequisites {
				if !techs[prereq] {
					prereqOK = false
					break
				}
			}
			if !prereqOK {
				continue
			}
			costOK := true
			for _, cost := range def.CostForLevel(1) {
				if !items[cost.ItemID] {
					costOK = false
					break
				}
			}
			if !costOK {
				continue
			}
			techs[def.ID] = true
			changed = true
		}
	}

	return reachabilityResult{items: items, techs: techs, buildings: buildings}
}

// TestNewPlayerTechTreeFullyReachable 守住：从新玩家状态出发，全部非 hidden 科技
// 都能研究完成。失败信息列出未达科技及其缺口（前置未达/成本物品未达）。
func TestNewPlayerTechTreeFullyReachable(t *testing.T) {
	res := simulateNewPlayerReachability(t)

	var unreached []string
	for _, def := range AllTechDefinitions() {
		if def == nil || def.Hidden || res.techs[def.ID] {
			continue
		}
		var missingPrereq, missingCost []string
		for _, prereq := range def.Prerequisites {
			if !res.techs[prereq] {
				missingPrereq = append(missingPrereq, prereq)
			}
		}
		for _, cost := range def.CostForLevel(1) {
			if !res.items[cost.ItemID] {
				missingCost = append(missingCost, fmt.Sprintf("%s x%d", cost.ItemID, cost.Quantity))
			}
		}
		unreached = append(unreached, fmt.Sprintf("%s (prereq missing: %v; cost missing: %v)", def.ID, missingPrereq, missingCost))
	}
	if len(unreached) > 0 {
		t.Errorf("techs unreachable from a new player (%d):\n%s", len(unreached), joinLines(unreached))
	}
}

// TestNewPlayerBuildingsFullyReachable 守住：全部 buildable 建筑都能建造。
// 失败信息列出未建建筑及其缺口（解锁科技/造价物品）。
func TestNewPlayerBuildingsFullyReachable(t *testing.T) {
	res := simulateNewPlayerReachability(t)

	var unbuilt []string
	for _, def := range AllBuildingDefinitions() {
		if !def.Buildable || res.buildings[def.ID] {
			continue
		}
		var missingCost []string
		for _, cost := range def.BuildCost.Items {
			if !res.items[cost.ItemID] {
				missingCost = append(missingCost, fmt.Sprintf("%s x%d", cost.ItemID, cost.Quantity))
			}
		}
		unbuilt = append(unbuilt, fmt.Sprintf("%s (unlock techs: %v done=%v; cost missing: %v)",
			def.ID, sortedKeys(buildingGateTechs(def.ID)), anyTechDone(buildingGateTechs(def.ID), res.techs), missingCost))
	}
	if len(unbuilt) > 0 {
		t.Errorf("buildings unreachable from a new player (%d):\n%s", len(unbuilt), joinLines(unbuilt))
	}
}

// TestNewPlayerItemsFullyReachable 守住：全部物品都有真实来源。
// 失败信息列出未达物品及其配方门控（无配方物品必须进 reachabilityWhitelist）。
func TestNewPlayerItemsFullyReachable(t *testing.T) {
	res := simulateNewPlayerReachability(t)

	var unreachable []string
	for _, def := range AllItems() {
		if res.items[def.ID] {
			continue
		}
		var recipes []string
		for _, recipe := range AllRecipes() {
			for _, out := range recipe.AllOutputs() {
				if out.ItemID == def.ID {
					recipes = append(recipes, fmt.Sprintf("%s(gate=%v)", recipe.ID, sortedKeys(recipeGateTechs(recipe.ID))))
				}
			}
		}
		if len(recipes) == 0 {
			recipes = []string{"<no recipe: add a real source or a whitelist entry>"}
		}
		unreachable = append(unreachable, fmt.Sprintf("%s (%s): %v", def.ID, def.Category, recipes))
	}
	if len(unreachable) > 0 {
		t.Errorf("items unreachable from a new player (%d):\n%s", len(unreachable), joinLines(unreachable))
	}
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func joinLines(lines []string) string {
	out := ""
	for _, line := range lines {
		out += "  - " + line + "\n"
	}
	return out
}
