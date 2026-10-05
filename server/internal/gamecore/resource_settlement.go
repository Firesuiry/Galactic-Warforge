package gamecore

import (
	"math"
	"sort"

	"siliconworld/internal/mapmodel"
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

		maintenance := b.Runtime.Params.MaintenanceCost
		totalEnergyCost := model.PowerDemandForBuilding(b)
		powerRatio := 1.0

		if maintenance.Minerals > 0 && player.Resources.Minerals < maintenance.Minerals {
			if evt := applyBuildingState(b, model.BuildingWorkError, stateReasonFault); evt != nil {
				evt.Payload["cause"] = "maintenance_insufficient"
				events = append(events, evt)
			}
			continue
		}

		if totalEnergyCost > 0 {
			powered, reason, alloc := buildingPowerAvailability(ws, b, coverage, allocations)
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

		oldM := player.Resources.Minerals

		player.Resources.Minerals -= maintenance.Minerals

		minerals := 0
		if b.Runtime.Functions.Collect != nil {
			syncCollectorResourceKind(ws, b)
			collectYield := b.Runtime.Functions.Collect.YieldPerTick
			if def, ok := model.BuildingDefinitionByID(b.Type); ok && def.RequiresResourceNode {
				collectYield = scaleByPowerRatio(collectYield, powerRatio)
				// Always extract at power-scaled yield. Storage only buffers
				// items for logistics/recipes; minerals kickback is keyed off
				// mined amount so a full local buffer cannot freeze the
				// construction-currency income (opening loop before belts).
				mined, byItem := mineResource(ws, player, b, collectYield)
				if mined > 0 && len(byItem) > 0 && b.Storage != nil {
					minerals = collectMineralsKickback(b.Runtime.Functions.Collect, mined)
					for _, itemID := range sortedMiningItemIDs(byItem) {
						stored, _, err := b.Storage.Receive(itemID, byItem[itemID])
						if err != nil {
							stored = 0
						}
						if productionSnapshot != nil && stored > 0 {
							productionSnapshot.RecordBuildingOutputs(b, []model.ItemAmount{{
								ItemID:   itemID,
								Quantity: stored,
							}})
						}
					}
					collectYield = 0
				} else {
					minerals = mined
				}
			} else {
				minerals = scaleByPowerRatio(collectYield, powerRatio)
			}
		}
		player.Resources.Minerals += minerals
		if minerals > 0 && productionSnapshot != nil {
			productionSnapshot.RecordBuildingOutputs(b, []model.ItemAmount{{
				ItemID:   model.ProductionStatMinerals,
				Quantity: minerals,
			}})
		}

		// Cap resources to avoid integer overflow
		if player.Resources.Minerals > 10000 {
			player.Resources.Minerals = 10000
		}
		if player.Resources.Minerals < 0 {
			player.Resources.Minerals = 0
		}

		if oldM != player.Resources.Minerals {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtResourceChanged,
				VisibilityScope: b.OwnerID,
				Payload: map[string]any{
					"player_id": b.OwnerID,
					"minerals":  player.Resources.Minerals,
					"energy":    player.Resources.Energy,
				},
			})
		}
	}

	regenResourceNodes(ws)

	return events
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

// collectMineralsKickback converts mined output into minerals credited to the
// owning player's pool, according to the collector's MineralsKickback ratio.
// Callers pass the amount extracted from the resource node (not just what
// fitted into local storage) so full buffers do not halt construction income.
func collectMineralsKickback(module *model.CollectModule, mined int) int {
	if module == nil || mined <= 0 || module.MineralsKickback <= 0 {
		return 0
	}
	return int(float64(mined) * module.MineralsKickback)
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
// building covers: its own tile plus every tile inside its coverage radius.
func coveredResourceNodeIDs(ws *model.WorldState, building *model.Building) []string {
	if ws == nil || building == nil {
		return nil
	}
	x, y := building.Position.X, building.Position.Y
	if !ws.InBounds(x, y) {
		return nil
	}
	radius := 0
	if def, ok := model.BuildingRuntimeDefinitionByID(building.Type); ok && def.Functions.Collect != nil {
		radius = def.Functions.Collect.CoverageRadius
	}
	ids := make([]string, 0, 1)
	seen := make(map[string]struct{})
	for dy := -radius; dy <= radius; dy++ {
		for dx := -radius; dx <= radius; dx++ {
			nx, ny := x+dx, y+dy
			if !ws.InBounds(nx, ny) {
				continue
			}
			nodeID := ws.Grid[ny][nx].ResourceNodeID
			if nodeID == "" {
				continue
			}
			if _, dup := seen[nodeID]; dup {
				continue
			}
			seen[nodeID] = struct{}{}
			ids = append(ids, nodeID)
		}
	}
	sort.Strings(ids)
	return ids
}

// mineResource extracts from every resource node covered by the building at
// the per-vein yield (veins_utilization applies per vein). It returns the
// total amount extracted plus a per-item breakdown keyed by catalog item ID
// for storage crediting; unmapped kinds contribute only to the total so the
// caller can keep crediting them as construction minerals.
func mineResource(ws *model.WorldState, player *model.PlayerState, building *model.Building, yieldPerTick int) (int, map[string]int) {
	if ws == nil || building == nil {
		return 0, nil
	}
	if yieldPerTick <= 0 {
		return 0, nil
	}
	level := veinsUtilizationLevel(player)
	perVeinYield := miningYieldPerVein(yieldPerTick, level)
	total := 0
	var byItem map[string]int
	for _, nodeID := range coveredResourceNodeIDs(ws, building) {
		node := ws.Resources[nodeID]
		if node == nil {
			continue
		}
		if collect := building.Runtime.Functions.Collect; collect != nil && len(collect.AllowedResources) > 0 && !allowsItem(collect.AllowedResources, node.Kind) {
			continue
		}
		extracted := extractFromResourceNode(node, perVeinYield, level)
		if extracted <= 0 {
			continue
		}
		total += extracted
		if itemID := resourceKindToItemID(node.Kind); itemID != "" {
			if byItem == nil {
				byItem = make(map[string]int, 1)
			}
			byItem[itemID] += extracted
		}
	}
	return total, byItem
}

// extractFromResourceNode settles one node's extraction for a single tick,
// mutating remaining/yield and returning the amount the miner actually gets.
func extractFromResourceNode(node *model.ResourceNodeState, yieldPerTick, veinsLevel int) int {
	if node == nil {
		return 0
	}
	switch node.Behavior {
	case "finite", "renewable":
		if node.Remaining <= 0 || node.CurrentYield <= 0 {
			return 0
		}
		extracted := min(yieldPerTick, node.CurrentYield)
		extracted = min(extracted, node.Remaining)
		node.Remaining -= veinConsumption(extracted, veinsLevel)
		if node.Remaining <= 0 {
			node.Remaining = 0
			if node.Behavior == "finite" {
				node.CurrentYield = 0
			}
		}
		node.SyncDepleted()
		return extracted
	case "decay":
		if node.CurrentYield <= 0 {
			return 0
		}
		extracted := min(yieldPerTick, node.CurrentYield)
		if node.DecayPerTick > 0 {
			node.CurrentYield -= node.DecayPerTick
			if node.CurrentYield < node.MinYield {
				node.CurrentYield = node.MinYield
			}
		}
		return extracted
	default:
		return 0
	}
}

func sortedMiningItemIDs(byItem map[string]int) []string {
	ids := make([]string, 0, len(byItem))
	for id := range byItem {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func regenResourceNodes(ws *model.WorldState) {
	if ws == nil {
		return
	}
	for _, node := range ws.Resources {
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

// resourceKindToItemID maps a resource node kind to its mined catalog item.
func resourceKindToItemID(kind string) string {
	switch kind {
	case string(mapmodel.ResourceIronOre):
		return model.ItemIronOre
	case string(mapmodel.ResourceCopperOre):
		return model.ItemCopperOre
	case string(mapmodel.ResourceStoneOre):
		return model.ItemStoneOre
	case string(mapmodel.ResourceSiliconOre):
		return model.ItemSiliconOre
	case string(mapmodel.ResourceTitaniumOre):
		return model.ItemTitaniumOre
	case string(mapmodel.ResourceCoal):
		return model.ItemCoal
	case string(mapmodel.ResourceCrudeOil):
		return model.ItemCrudeOil
	case string(mapmodel.ResourceWater):
		return model.ItemWater
	case string(mapmodel.ResourceFireIce):
		return model.ItemFireIce
	case string(mapmodel.ResourceFractalSilicon):
		return model.ItemFractalSilicon
	case string(mapmodel.ResourceGratingCrystal):
		return model.ItemGratingCrystal
	case string(mapmodel.ResourceMonopoleMagnet):
		return model.ItemMonopoleMagnet
	case string(mapmodel.ResourceKimberliteOre):
		return model.ItemKimberliteOre
	case string(mapmodel.ResourceSpiniformStalagmiteCrystal):
		return model.ItemSpiniformStalagmiteCrystal
	case string(mapmodel.ResourceOrganicCrystal):
		return model.ItemOrganicCrystal
	case string(mapmodel.ResourceSulfuricAcid):
		return model.ItemSulfuricAcid
	case string(mapmodel.ResourceLog):
		return model.ItemLog
	case string(mapmodel.ResourcePlantFuel):
		return model.ItemPlantFuel
	default:
		return ""
	}
}

func collectorResourceKind(ws *model.WorldState, building *model.Building) string {
	node := resourceNodeForBuilding(ws, building)
	if node == nil {
		return ""
	}
	return node.Kind
}

func resourceNodeForBuilding(ws *model.WorldState, building *model.Building) *model.ResourceNodeState {
	if ws == nil || building == nil {
		return nil
	}
	if !ws.InBounds(building.Position.X, building.Position.Y) {
		return nil
	}
	nodeID := ws.Grid[building.Position.Y][building.Position.X].ResourceNodeID
	if nodeID == "" {
		return nil
	}
	return ws.Resources[nodeID]
}
