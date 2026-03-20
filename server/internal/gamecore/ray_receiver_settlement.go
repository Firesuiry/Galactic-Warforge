package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

const maxPlayerEnergy = 10000

func settleRayReceivers(ws *model.WorldState) []*model.GameEvent {
	if ws == nil || len(ws.Buildings) == 0 {
		return nil
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	oldEnergy := make(map[string]int)

	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil {
			continue
		}
		module := building.Runtime.Functions.RayReceiver
		if module == nil {
			continue
		}
		if building.Runtime.State == model.BuildingWorkPaused || building.Runtime.State == model.BuildingWorkIdle || building.Runtime.State == model.BuildingWorkError {
			continue
		}
		player := ws.Players[building.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}
		if _, ok := oldEnergy[player.PlayerID]; !ok {
			oldEnergy[player.PlayerID] = player.Resources.Energy
		}
		powerCap := maxPlayerEnergy - player.Resources.Energy
		if powerCap < 0 {
			powerCap = 0
		}
		result, err := model.ResolveRayReceiver(model.RayReceiverRequest{
			Module:        module,
			PowerCapacity: powerCap,
		})
		if err != nil {
			continue
		}
		if result.PowerOutput > 0 {
			ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{
				BuildingID:     building.ID,
				OwnerID:        building.OwnerID,
				SourceKind:     model.PowerSourceRayReceiver,
				BaseOutput:     module.InputPerTick,
				EnvFactor:      module.ReceiveEfficiency,
				FuelMultiplier: module.PowerEfficiency,
				Output:         result.PowerOutput,
			})
			player.Resources.Energy += result.PowerOutput
			if player.Resources.Energy > maxPlayerEnergy {
				player.Resources.Energy = maxPlayerEnergy
			}
			if player.Resources.Energy < 0 {
				player.Resources.Energy = 0
			}
		}
		if result.PhotonOutput > 0 && building.Storage != nil {
			_, _, _ = building.Storage.Receive(result.PhotonItemID, result.PhotonOutput)
		}
	}

	var events []*model.GameEvent
	for playerID, prev := range oldEnergy {
		player := ws.Players[playerID]
		if player == nil || !player.IsAlive {
			continue
		}
		if player.Resources.Energy == prev {
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
