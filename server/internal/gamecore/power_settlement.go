package gamecore

import "siliconworld/internal/model"

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
