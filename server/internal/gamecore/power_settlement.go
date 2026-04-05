package gamecore

import "siliconworld/internal/model"

func finalizePowerSettlement(ws *model.WorldState, receiverViews map[string]model.RayReceiverSettlementView) []*model.GameEvent {
	if ws == nil {
		return nil
	}

	settleEnergyStorage(ws)
	snapshot := model.BuildPowerSettlementSnapshot(ws, receiverViews)
	ws.PowerSnapshot = snapshot
	if snapshot == nil {
		return nil
	}

	var events []*model.GameEvent
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
