package gamecore

import (
	"math"
	"sort"

	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
)

// settleResources produces/consumes resources for all buildings each tick
func settleResources(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent
	snapshot := model.CurrentPowerSettlementSnapshot(ws)
	coverage := map[string]model.PowerCoverageResult{}
	allocations := model.PowerAllocationState{}
	if snapshot != nil {
		coverage = snapshot.Coverage
		allocations = snapshot.Allocations
	}
	productionSnapshot := model.CurrentProductionSettlementSnapshot(ws)

	for _, b := range ws.Buildings {
		player := ws.Players[b.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}

		if b.Runtime.State == model.BuildingWorkPaused || b.Runtime.State == model.BuildingWorkIdle {
			continue
		}

		totalEnergyCost := model.PowerDemandForBuilding(b)
		powerRatio := 1.0

		if totalEnergyCost > 0 {
			powered, reason, alloc := buildingPowerAvailability(b, coverage, allocations)
			if !powered {
				if evt := applyBuildingState(b, model.BuildingWorkNoPower, reason); evt != nil {
					events = append(events, evt)
				}
				continue
			}
			powerRatio = alloc.Ratio
		}

		if module := b.Runtime.Functions.Energy; module != nil && modelpower.IsFuelBasedPowerSource(module.SourceKind) {
			if b.Runtime.State == model.BuildingWorkNoPower && b.Runtime.StateReason == stateReasonNoFuel {
				continue
			}
		}

		if evt := applyBuildingState(b, model.BuildingWorkRunning, ""); evt != nil {
			events = append(events, evt)
		}

		if b.Runtime.Functions.Collect != nil {
			syncCollectorResourceKind(ws, b)
			collectYield := b.Runtime.Functions.Collect.YieldPerTick
			if def, ok := model.BuildingDefinitionByID(b.Type); ok && def.RequiresResourceNode {
				collectYield = scaleByPowerRatio(collectYield, powerRatio)
				// 先规划、按实际落地量提交：采掘产物落「输出缓冲 → 主库存」
				// （见 StorageState.StoreCollectorProduct），落不下的矿种不扣矿脉。
				// 旧实现无条件按全速扣矿，缓冲满后 8 个节点被抽干而矿石从未落地
				// （试玩 1015）。第 16 轮起采矿机只产出矿石实物（不再回充矿物池），
				// 输出缓冲满了就停采。
				if b.Storage == nil {
					continue
				}
				plan := planMiningExtraction(ws, player, b, collectYield)
				stored := storeMiningOutputs(b, miningPlanByItem(plan), productionSnapshot)
				commitMiningExtraction(plan, stored)
			}
		}
	}

	regenResourceNodes(ws)

	return events
}

// regenResourceNodes 每 tick 只推进可再生矿脉（水/硫酸/木/植物燃料）。
// 世界边长 ×3 后资源 cell 数上了一个数量级，逐格扫描会变成每 tick 的固定
// 开销；这里维护一个只含可再生矿脉的索引，结算与地图生成时刷新，扫描量
// 与可再生矿脉数同阶而不是与全图资源 cell 数同阶。
func regenResourceNodes(ws *model.WorldState) {
	if ws == nil {
		return
	}
	for _, node := range ws.RenewableResources {
		if node == nil {
			continue
		}
		if node.Behavior != "renewable" || node.RegenPerTick <= 0 {
			continue
		}
		if node.Remaining < node.MaxAmount {
			node.Remaining += node.RegenPerTick
			if node.Remaining > node.MaxAmount {
				node.Remaining = node.MaxAmount
			}
			node.SyncDepleted()
		}
	}
}

// IndexRenewableResources 重建可再生矿脉索引（地图生成/读档后调用一次）。
func IndexRenewableResources(ws *model.WorldState) {
	if ws == nil {
		return
	}
	ws.RenewableResources = ws.RenewableResources[:0]
	for _, node := range ws.Resources {
		if node != nil && node.Behavior == "renewable" && node.RegenPerTick > 0 {
			ws.RenewableResources = append(ws.RenewableResources, node)
		}
	}
}

func scaleByPowerRatio(value int, ratio float64) int {
	if value <= 0 {
		return 0
	}
	if ratio >= 1 {
		return value
	}
	if ratio <= 0 {
		return 0
	}
	scaled := int(float64(value) * ratio)
	if scaled < 0 {
		return 0
	}
	if scaled > value {
		return value
	}
	return scaled
}

// veinsUtilizationTechID 矿物利用科技（DSP：每级 +10% 采矿产能、-6% 矿脉消耗）。
// techs.yaml 暂未给该科技登记 Effects，故这里直接按等级结算。
const (
	veinsUtilizationTechID         = "veins_utilization"
	veinsUtilizationMaxLevel       = 6
	veinsUtilizationOutputPerLevel = 0.10
	veinsUtilizationSavingPerLevel = 0.06
)

// veinsUtilizationLevel returns the effective veins_utilization research level,
// capped at the tech's max level so oversized stored levels stay idempotent.
func veinsUtilizationLevel(player *model.PlayerState) int {
	if player == nil || player.Tech == nil {
		return 0
	}
	level := player.Tech.CompletedTechs[veinsUtilizationTechID]
	if level < 0 {
		return 0
	}
	if level > veinsUtilizationMaxLevel {
		return veinsUtilizationMaxLevel
	}
	return level
}

// miningYieldPerVein scales the per-vein yield by the veins_utilization output
// bonus (+10% per level, rounded half-up so small yields still improve).
func miningYieldPerVein(yieldPerTick, veinsLevel int) int {
	if yieldPerTick <= 0 || veinsLevel <= 0 {
		return yieldPerTick
	}
	scaled := int(math.Floor(float64(yieldPerTick)*(1+veinsUtilizationOutputPerLevel*float64(veinsLevel)) + 0.5))
	if scaled < yieldPerTick {
		return yieldPerTick
	}
	return scaled
}

// veinConsumption converts extracted ore into vein depletion, applying the
// veins_utilization saving (-6% consumption per level, at least 1 per unit
// extracted so veins still deplete).
func veinConsumption(extracted, veinsLevel int) int {
	if extracted <= 0 {
		return 0
	}
	if veinsLevel <= 0 {
		return extracted
	}
	saved := int(math.Floor(float64(extracted)*veinsUtilizationSavingPerLevel*float64(veinsLevel) + 0.5))
	consumed := extracted - saved
	if consumed < 1 {
		consumed = 1
	}
	return consumed
}

// coveredResourceNodeIDs returns the deterministic set of resource nodes the
// building covers: its whole footprint plus `max(1, coverage_radius)` rings
// (DSP-style box-select mining), so a 3×3 miner no longer only reaches the
// anchor cell's Chebyshev square.
func coveredResourceNodeIDs(ws *model.WorldState, building *model.Building) []string {
	if ws == nil || building == nil {
		return nil
	}
	if !ws.InBounds(building.Position.X, building.Position.Y) {
		return nil
	}
	ids := make([]string, 0, 4)
	seen := make(map[string]struct{})
	for _, cell := range model.CollectorCoverageCells(ws, building.Type, building.Rotation, building.Position) {
		nodeID := ws.Grid[cell.Y][cell.X].ResourceNodeID
		if nodeID == "" {
			continue
		}
		if _, dup := seen[nodeID]; dup {
			continue
		}
		seen[nodeID] = struct{}{}
		ids = append(ids, nodeID)
	}
	sort.Strings(ids)
	return ids
}

// miningExtraction 是「一台采集建筑本 tick 从某个矿脉要抽多少」的纯计划项：
// 只描述意图，不改动世界（见 planMiningExtraction / commitMiningExtraction）。
type miningExtraction struct {
	node      *model.ResourceNodeState
	extracted int
	consumed  int
}

// planMiningExtraction computes, without mutating anything, how much each
// covered node would yield this tick. 结算必须「先规划、落货成功再提交」：
// 采掘产物的落点是输出缓冲（→ 产出预留，采集建筑为 0），落不下就整批不采，
// 保证 remaining 的减少量恒等于实际产出量（试玩 1015）。
func planMiningExtraction(ws *model.WorldState, player *model.PlayerState, building *model.Building, yieldPerTick int) []miningExtraction {
	if ws == nil || building == nil || yieldPerTick <= 0 {
		return nil
	}
	level := veinsUtilizationLevel(player)
	perVeinYield := miningYieldPerVein(yieldPerTick, level)
	var plan []miningExtraction
	for _, nodeID := range coveredResourceNodeIDs(ws, building) {
		node := ws.Resources[nodeID]
		if node == nil {
			continue
		}
		if collect := building.Runtime.Functions.Collect; collect != nil && len(collect.AllowedResources) > 0 && !allowsItem(collect.AllowedResources, node.Kind) {
			continue
		}
		extracted := plannedExtraction(node, perVeinYield)
		if extracted <= 0 {
			continue
		}
		plan = append(plan, miningExtraction{
			node:      node,
			extracted: extracted,
			consumed:  veinConsumption(extracted, level),
		})
	}
	return plan
}

// plannedExtraction is the amount a single node yields this tick, mirroring
// extractFromResourceNode without mutating the node.
func plannedExtraction(node *model.ResourceNodeState, yieldPerTick int) int {
	if node == nil {
		return 0
	}
	switch node.Behavior {
	case "finite", "renewable":
		if node.Remaining <= 0 || node.CurrentYield <= 0 {
			return 0
		}
		return min(min(yieldPerTick, node.CurrentYield), node.Remaining)
	case "decay":
		if node.CurrentYield <= 0 {
			return 0
		}
		return min(yieldPerTick, node.CurrentYield)
	default:
		return 0
	}
}

// commitMiningExtraction applies a stored batch to the world. 每个节点只按「本 tick
// 该矿种实际落地的数量」扣减：不变量「矿脉的减少量 == 实际产出量」因此对每一种矿
// 都成立（试玩 1015：旧实现无条件全速扣矿，缓冲满后 8 个节点被抽干而矿石从未落地）。
// 返回实际提交的总量。
func commitMiningExtraction(plan []miningExtraction, storedByItem map[string]int) int {
	remaining := make(map[string]int, len(storedByItem))
	for itemID, qty := range storedByItem {
		remaining[itemID] = qty
	}
	total := 0
	for _, item := range plan {
		if item.node == nil || item.extracted <= 0 {
			continue
		}
		take := item.extracted
		if itemID := resourceKindToItemID(item.node.Kind); itemID != "" {
			if remaining[itemID] < take {
				take = remaining[itemID]
			}
			remaining[itemID] -= take
		}
		if take <= 0 {
			continue
		}
		applyExtraction(item, take)
		total += take
	}
	return total
}

// applyExtraction 扣减一个节点本 tick 实际落地的 take 份（整批全落时 take ==
// extracted，与整批提取等价；部分落地时按比例摊到各节点）。
func applyExtraction(item miningExtraction, take int) {
	node := item.node
	if node == nil || take <= 0 {
		return
	}
	switch node.Behavior {
	case "finite", "renewable":
		consumed := item.consumed
		if take < item.extracted && item.extracted > 0 {
			consumed = int(math.Round(float64(item.consumed) * float64(take) / float64(item.extracted)))
			if consumed < 1 {
				consumed = 1
			}
		}
		node.Remaining -= consumed
		if node.Remaining <= 0 {
			node.Remaining = 0
			if node.Behavior == "finite" {
				node.CurrentYield = 0
			}
		}
		node.SyncDepleted()
	case "decay":
		if node.DecayPerTick > 0 {
			node.CurrentYield -= node.DecayPerTick
			if node.CurrentYield < node.MinYield {
				node.CurrentYield = node.MinYield
			}
		}
	}
}

// plannedMiningTotal sums a planned batch without touching the world.
func plannedMiningTotal(plan []miningExtraction) (int, map[string]int) {
	total := 0
	byItem := miningPlanByItem(plan)
	for _, item := range plan {
		if item.node == nil || item.extracted <= 0 {
			continue
		}
		total += item.extracted
	}
	return total, byItem
}

// miningPlanByItem 把计划按矿种汇总（key 是目录物品 ID，映射不上的矿种不计入）。
func miningPlanByItem(plan []miningExtraction) map[string]int {
	var byItem map[string]int
	for _, item := range plan {
		if item.node == nil || item.extracted <= 0 {
			continue
		}
		if itemID := resourceKindToItemID(item.node.Kind); itemID != "" {
			if byItem == nil {
				byItem = make(map[string]int, 1)
			}
			byItem[itemID] += item.extracted
		}
	}
	return byItem
}

// storeMiningOutputs lands a planned batch on the collector's product path
// (output buffer → main inventory, see StorageState.StoreCollectorProduct) and
// returns the per-item breakdown of what actually made it into storage.
func storeMiningOutputs(building *model.Building, byItem map[string]int, snapshot *model.ProductionSettlementSnapshot) map[string]int {
	stored := make(map[string]int, len(byItem))
	for _, itemID := range sortedMiningItemIDs(byItem) {
		accepted, _, err := building.Storage.StoreCollectorProduct(itemID, byItem[itemID])
		if err != nil || accepted <= 0 {
			continue
		}
		stored[itemID] = accepted
		if snapshot != nil {
			snapshot.RecordBuildingOutputs(building, []model.ItemAmount{{ItemID: itemID, Quantity: accepted}})
		}
	}
	return stored
}

// mineResource plans one tick of extraction, commits it, and returns the total
// plus the per-item breakdown. 落不下的部分不回扣矿脉（见 commitMiningExtraction）。
func mineResource(ws *model.WorldState, player *model.PlayerState, building *model.Building, yieldPerTick int) (int, map[string]int) {
	plan := planMiningExtraction(ws, player, building, yieldPerTick)
	stored := storeMiningOutputs(building, miningPlanByItem(plan), nil)
	return commitMiningExtraction(plan, stored), stored
}

func sortedMiningItemIDs(byItem map[string]int) []string {
	ids := make([]string, 0, len(byItem))
	for id := range byItem {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func syncCollectorResourceKind(ws *model.WorldState, building *model.Building) {
	if ws == nil || building == nil || building.Runtime.Functions.Collect == nil {
		return
	}
	building.Runtime.Functions.Collect.ResourceKind = collectorResourceKind(ws, building)
}

func collectorOutputItemID(ws *model.WorldState, building *model.Building) string {
	node := resourceNodeForBuilding(ws, building)
	if node == nil {
		return ""
	}
	return resourceKindToItemID(node.Kind)
}

// resourceKindToItemID: a resource node kind is, by data convention, the ID of
// the catalog item it yields (items.yaml registers every mapmodel kind), so
// the mapping is a catalog lookup rather than a table. Unknown kinds yield nothing.
func resourceKindToItemID(kind string) string {
	if _, ok := model.Item(kind); !ok {
		return ""
	}
	return kind
}

func collectorResourceKind(ws *model.WorldState, building *model.Building) string {
	node := resourceNodeForBuilding(ws, building)
	if node == nil {
		return ""
	}
	return node.Kind
}

// resourceNodeForBuilding resolves the resource kind a collector reports. The
// building covers its whole footprint plus rings, so the anchor cell is only
// one candidate: the first covered node (row-major, matching
// model.coveredResourceNode) wins, which keeps the reported kind deterministic
// and identical to the pre-build validation.
func resourceNodeForBuilding(ws *model.WorldState, building *model.Building) *model.ResourceNodeState {
	if ws == nil || building == nil {
		return nil
	}
	if !ws.InBounds(building.Position.X, building.Position.Y) {
		return nil
	}
	for _, cell := range model.CollectorCoverageCells(ws, building.Type, building.Rotation, building.Position) {
		if nodeID := ws.Grid[cell.Y][cell.X].ResourceNodeID; nodeID != "" {
			return ws.Resources[nodeID]
		}
	}
	return nil
}
