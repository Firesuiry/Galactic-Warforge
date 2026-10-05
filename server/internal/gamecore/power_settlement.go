package gamecore

import (
	"math"
	"sort"

	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
)

func finalizePowerSettlement(ws *model.WorldState, receiverViews map[string]model.RayReceiverSettlementView) []*model.GameEvent {
	if ws == nil {
		return nil
	}

	storageCharges := settleEnergyStorage(ws)
	snapshot := model.BuildPowerSettlementSnapshot(ws, receiverViews)
	ws.PowerSnapshot = snapshot
	if snapshot == nil {
		return nil
	}

	for buildingID, amount := range storageCharges {
		recordSurplusPowerConsumption(snapshot, buildingID, amount)
	}
	events := settleMechaCharging(ws, snapshot)
	for playerID, power := range snapshot.Players {
		player := ws.Players[playerID]
		if player == nil || !player.IsAlive {
			continue
		}
		oldEnergy := player.Resources.Energy
		player.Resources.Energy = power.EndEnergy
		if oldEnergy == player.Resources.Energy {
			continue
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtResourceChanged,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"player_id": playerID,
				"minerals":  player.Resources.Minerals,
				"energy":    player.Resources.Energy,
			},
		})
	}
	return events
}

// recordSurplusPowerConsumption accounts an already delivered charge in the
// current snapshot before the player's energy balance is committed. The same
// accounting is used for accumulators and mechas so surplus cannot be spent twice.
func recordSurplusPowerConsumption(snapshot *model.PowerSettlementSnapshot, buildingID string, amount int) {
	if snapshot == nil || amount <= 0 {
		return
	}
	networkID := snapshot.Networks.BuildingNetwork[buildingID]
	network := snapshot.Networks.Networks[networkID]
	allocation := snapshot.Allocations.Networks[networkID]
	if network == nil || allocation == nil {
		return
	}
	network.Demand += amount
	network.Net = network.Supply - network.Demand
	allocation.Demand += amount
	allocation.Allocated += amount
	allocation.Net = allocation.Supply - allocation.Demand
	allocation.Shortage = allocation.Demand > allocation.Supply
	building := snapshot.Allocations.Buildings[buildingID]
	building.NetworkID = networkID
	building.Demand += amount
	building.Allocated += amount
	building.Ratio = float64(building.Allocated) / float64(building.Demand)
	snapshot.Allocations.Buildings[buildingID] = building
	player := snapshot.Players[network.OwnerID]
	player.Demand += amount
	player.Allocated += amount
	player.NetDelta = player.Generation - player.Allocated
	player.EndEnergy = min(10000, max(0, player.StartEnergy+player.NetDelta))
	snapshot.Players[network.OwnerID] = player
}

func powerCoverageReasonToStateReason(reason model.PowerCoverageFailureReason) string {
	switch reason {
	case model.PowerCoverageNoConnector:
		return "power_no_connector"
	case model.PowerCoverageNoProvider:
		return "power_no_provider"
	case model.PowerCoverageOutOfRange:
		return "power_out_of_range"
	case model.PowerCoverageCapacityFull:
		return "power_capacity_full"
	default:
		return stateReasonUnderPower
	}
}

func buildingPowerAvailability(
	ws *model.WorldState,
	building *model.Building,
	coverage map[string]model.PowerCoverageResult,
	allocations model.PowerAllocationState,
) (bool, string, model.PowerAllocation) {
	if building == nil {
		return false, "", model.PowerAllocation{}
	}
	demand := model.PowerDemandForBuilding(building)
	if demand <= 0 {
		return true, "", model.PowerAllocation{}
	}

	cov, ok := coverage[building.ID]
	if !ok || !cov.Connected {
		reason := model.PowerCoverageNoConnector
		if ok {
			reason = cov.Reason
		}
		return false, powerCoverageReasonToStateReason(reason), model.PowerAllocation{}
	}

	alloc, ok := allocations.Buildings[building.ID]
	if !ok || alloc.Allocated <= 0 {
		return false, stateReasonUnderPower, model.PowerAllocation{}
	}
	return true, "", alloc
}

func buildingOperationalForCommand(ws *model.WorldState, building *model.Building) (bool, string) {
	if ws == nil || building == nil {
		return false, ""
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkError:
		return false, building.Runtime.StateReason
	}

	demand := model.PowerDemandForBuilding(building)
	if demand <= 0 {
		return true, ""
	}

	coverage := model.ResolvePowerCoverage(ws)
	allocations := model.ResolvePowerAllocations(ws, coverage)
	if ws.PowerSnapshot == nil || ws.PowerSnapshot.Tick != ws.Tick {
		allocations = resolveCommandPowerAllocations(ws, coverage)
	}
	powered, reason, _ := buildingPowerAvailability(ws, building, coverage, allocations)
	if !powered {
		return false, reason
	}
	return true, ""
}

type commandPowerConsumer struct {
	id       string
	demand   int
	priority int
}

func resolveCommandPowerAllocations(ws *model.WorldState, coverage map[string]model.PowerCoverageResult) model.PowerAllocationState {
	state := model.PowerAllocationState{
		Networks:  make(map[string]*model.PowerAllocationNetwork),
		Buildings: make(map[string]model.PowerAllocation),
	}
	if ws == nil {
		return state
	}
	networks := model.ResolvePowerNetworks(ws)
	if len(networks.Networks) == 0 {
		return state
	}
	powerInputs := commandPowerInputsByBuilding(ws.PowerInputs)
	useFallback := ws.PowerSnapshot == nil || ws.PowerSnapshot.Tick != ws.Tick

	for _, network := range networks.Networks {
		if network == nil {
			continue
		}
		consumers := make([]commandPowerConsumer, 0)
		supply := 0
		for _, id := range network.NodeIDs {
			building := ws.Buildings[id]
			if building == nil {
				continue
			}
			if commandPowerSupplyActive(building) {
				supply += commandPowerSupplyForBuilding(building, powerInputs, useFallback)
			}
			if !commandPowerDemandActive(building) {
				continue
			}
			demand := model.PowerDemandForBuilding(building)
			if demand <= 0 {
				continue
			}
			cov := coverage[id]
			if !cov.Connected {
				continue
			}
			consumers = append(consumers, commandPowerConsumer{
				id:       id,
				demand:   demand,
				priority: commandPowerPriorityForBuilding(building),
			})
		}

		if len(consumers) == 0 {
			state.Networks[network.ID] = &model.PowerAllocationNetwork{
				ID:        network.ID,
				OwnerID:   network.OwnerID,
				Supply:    supply,
				Demand:    0,
				Allocated: 0,
				Net:       supply,
				Shortage:  false,
			}
			continue
		}

		sort.Slice(consumers, func(i, j int) bool {
			if consumers[i].priority != consumers[j].priority {
				return consumers[i].priority > consumers[j].priority
			}
			return consumers[i].id < consumers[j].id
		})

		demandTotal := 0
		allocations := make(map[string]int, len(consumers))
		for _, consumer := range consumers {
			demandTotal += consumer.demand
			allocations[consumer.id] = 0
		}

		remaining := supply
		for i := 0; i < len(consumers) && remaining > 0; {
			priority := consumers[i].priority
			j := i + 1
			groupDemand := consumers[i].demand
			for j < len(consumers) && consumers[j].priority == priority {
				groupDemand += consumers[j].demand
				j++
			}
			if groupDemand <= 0 {
				i = j
				continue
			}

			if remaining >= groupDemand {
				for k := i; k < j; k++ {
					allocations[consumers[k].id] = consumers[k].demand
				}
				remaining -= groupDemand
				i = j
				continue
			}

			ratio := float64(remaining) / float64(groupDemand)
			allocatedSum := 0
			for k := i; k < j; k++ {
				alloc := int(float64(consumers[k].demand) * ratio)
				if alloc < 0 {
					alloc = 0
				}
				if alloc > consumers[k].demand {
					alloc = consumers[k].demand
				}
				allocations[consumers[k].id] = alloc
				allocatedSum += alloc
			}
			leftover := remaining - allocatedSum
			for k := i; k < j && leftover > 0; k++ {
				allocations[consumers[k].id]++
				leftover--
			}
			remaining = 0
			break
		}

		allocatedTotal := 0
		for _, consumer := range consumers {
			alloc := allocations[consumer.id]
			allocatedTotal += alloc
			ratio := 0.0
			if consumer.demand > 0 && alloc > 0 {
				ratio = float64(alloc) / float64(consumer.demand)
				if ratio > 1 {
					ratio = 1
				}
			}
			state.Buildings[consumer.id] = model.PowerAllocation{
				NetworkID: network.ID,
				Demand:    consumer.demand,
				Allocated: alloc,
				Ratio:     ratio,
				Priority:  consumer.priority,
			}
		}

		state.Networks[network.ID] = &model.PowerAllocationNetwork{
			ID:        network.ID,
			OwnerID:   network.OwnerID,
			Supply:    supply,
			Demand:    demandTotal,
			Allocated: allocatedTotal,
			Net:       supply - demandTotal,
			Shortage:  supply < demandTotal,
		}
	}

	return state
}

func commandPowerInputsByBuilding(inputs []model.PowerInput) map[string]int {
	if len(inputs) == 0 {
		return nil
	}
	result := make(map[string]int)
	for _, input := range inputs {
		if input.BuildingID == "" || input.Output <= 0 {
			continue
		}
		result[input.BuildingID] += input.Output
	}
	return result
}

func commandPowerSupplyForBuilding(building *model.Building, powerInputs map[string]int, useFallback bool) int {
	if building == nil {
		return 0
	}
	module := building.Runtime.Functions.Energy
	if modelpower.IsPowerGeneratorModule(module) {
		if powerInputs != nil {
			if output := powerInputs[building.ID]; output > 0 {
				return output
			}
		}
		if useFallback {
			return estimatedCommandGeneratorOutput(building, module)
		}
		return 0
	}
	if powerInputs != nil {
		if output := powerInputs[building.ID]; output > 0 {
			return output
		}
	}
	output := building.Runtime.Params.EnergyGenerate
	if module != nil && module.OutputPerTick > output {
		output = module.OutputPerTick
	}
	if output < 0 {
		return 0
	}
	return output
}

func estimatedCommandGeneratorOutput(building *model.Building, module *modelpower.EnergyModule) int {
	if building == nil || module == nil {
		return 0
	}
	switch module.SourceKind {
	case modelpower.PowerSourceRayReceiver:
		return 0
	case modelpower.PowerSourceThermal, modelpower.PowerSourceFusion, modelpower.PowerSourceArtificialStar:
		return estimateFuelBasedCommandGeneratorOutput(building, module)
	default:
		return commandGeneratorBaseOutput(building, module)
	}
}

func estimateFuelBasedCommandGeneratorOutput(building *model.Building, module *modelpower.EnergyModule) int {
	base := commandGeneratorBaseOutput(building, module)
	if base <= 0 || module == nil || len(module.FuelRules) == 0 {
		return 0
	}
	for i := range module.FuelRules {
		rule := module.FuelRules[i]
		if rule.ItemID == "" || rule.ConsumePerTick <= 0 {
			continue
		}
		available := commandStorageItemQuantity(building.Storage, rule.ItemID)
		if available <= 0 {
			continue
		}
		ratio := 1.0
		if available < rule.ConsumePerTick {
			ratio = float64(available) / float64(rule.ConsumePerTick)
		}
		multiplier := 1.0
		if rule.OutputMultiplier > 0 {
			multiplier = rule.OutputMultiplier
		}
		output := int(math.Round(float64(base) * multiplier * ratio))
		if output < 0 {
			return 0
		}
		return output
	}
	return 0
}

func commandGeneratorBaseOutput(building *model.Building, module *modelpower.EnergyModule) int {
	output := 0
	if building != nil {
		output = building.Runtime.Params.EnergyGenerate
	}
	if module != nil && module.OutputPerTick > output {
		output = module.OutputPerTick
	}
	if output < 0 {
		return 0
	}
	return output
}

func commandStorageItemQuantity(storage *model.StorageState, itemID string) int {
	if storage == nil || itemID == "" {
		return 0
	}
	total := 0
	if storage.InputBuffer != nil {
		total += storage.InputBuffer[itemID]
	}
	if storage.Inventory != nil {
		total += storage.Inventory[itemID]
	}
	return total
}

func commandPowerDemandActive(building *model.Building) bool {
	if building == nil {
		return false
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkIdle:
		return false
	default:
		return true
	}
}

func commandPowerSupplyActive(building *model.Building) bool {
	if building == nil {
		return false
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkIdle, model.BuildingWorkError, model.BuildingWorkNoPower:
		return false
	default:
		return true
	}
}

func commandPowerPriorityForBuilding(building *model.Building) int {
	if building == nil {
		return 1
	}
	if building.Runtime.Params.PowerPriority > 0 {
		return building.Runtime.Params.PowerPriority
	}
	def, ok := model.BuildingDefinitionByID(building.Type)
	if !ok {
		return 1
	}
	switch def.Category {
	case model.BuildingCategoryCommandSignal:
		return 100
	case model.BuildingCategoryPowerGrid:
		return 90
	case model.BuildingCategoryPower:
		return 80
	case model.BuildingCategoryDyson:
		return 70
	case model.BuildingCategoryLogisticsHub:
		return 60
	case model.BuildingCategoryResearch:
		return 50
	case model.BuildingCategoryProduction:
		return 45
	case model.BuildingCategoryChemical, model.BuildingCategoryRefining:
		return 40
	case model.BuildingCategoryCollect:
		return 35
	case model.BuildingCategoryTransport, model.BuildingCategoryStorage:
		return 30
	default:
		return 1
	}
}
