package gamecore

import (
	"siliconworld/internal/model"
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

func buildingPowerAvailability(building *model.Building, coverage map[string]model.PowerCoverageResult, allocations model.PowerAllocationState) (bool, string, model.PowerAllocation) {
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

// buildingOperationalForCommand 判定建筑此刻能否工作：暂停/故障直接否决，
// 用电建筑再看与 tick 结算同源的供电视图（本 tick 已结算则直接复用快照）。
func buildingOperationalForCommand(ws *model.WorldState, building *model.Building) (bool, string) {
	if ws == nil || building == nil {
		return false, ""
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkError:
		return false, building.Runtime.StateReason
	}
	if model.PowerDemandForBuilding(building) <= 0 {
		return true, ""
	}
	power := model.CurrentPowerSettlementSnapshot(ws)
	powered, reason, _ := buildingPowerAvailability(building, power.Coverage, power.Allocations)
	return powered, reason
}
