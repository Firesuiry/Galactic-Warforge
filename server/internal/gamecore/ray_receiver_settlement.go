package gamecore

import (
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

const maxPlayerEnergy = 10000

func settleRayReceivers(ws *model.WorldState, maps *mapmodel.Universe, spaceRuntime *model.SpaceRuntimeState) map[string]model.RayReceiverSettlementView {
	if ws == nil || len(ws.Buildings) == 0 {
		return nil
	}
	systemID := ""
	if maps != nil {
		if planet, ok := maps.Planet(ws.PlanetID); ok && planet != nil {
			systemID = planet.SystemID
		}
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	views := make(map[string]model.RayReceiverSettlementView)

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
		mode := module.Mode
		if mode == "" {
			mode = model.RayReceiverModeHybrid
		}
		view := model.RayReceiverSettlementView{
			BuildingID:  building.ID,
			Mode:        mode,
			SettledTick: ws.Tick,
		}

		// Ray receivers only convert externally available Dyson energy.
		// `InputPerTick` is the receiver's intake ceiling, not free baseline energy.
		availableDysonEnergy := GetSolarSailEnergy(spaceRuntime, player.PlayerID, systemID) + GetDysonSphereEnergyForPlayer(player.PlayerID)
		view.AvailableDysonEnergy = availableDysonEnergy
		effectiveInput := availableDysonEnergy
		if module.InputPerTick > 0 && effectiveInput > module.InputPerTick {
			effectiveInput = module.InputPerTick
		}
		view.EffectiveInput = effectiveInput

		if effectiveInput > 0 {
			// `InputPerTick` is replaced with the actually available Dyson energy for this tick.
			modifiedModule := *module
			modifiedModule.Mode = mode
			modifiedModule.InputPerTick = effectiveInput

			result, err := model.ResolveRayReceiver(model.RayReceiverRequest{
				Module:        &modifiedModule,
				PowerCapacity: maxPlayerEnergy,
			})
			if err == nil {
				view.PowerOutput = result.PowerOutput
				view.PhotonOutput = result.PhotonOutput
				if result.PowerOutput > 0 {
					ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{
						BuildingID:     building.ID,
						OwnerID:        building.OwnerID,
						SourceKind:     model.PowerSourceRayReceiver,
						BaseOutput:     effectiveInput,
						EnvFactor:      module.ReceiveEfficiency,
						FuelMultiplier: module.PowerEfficiency,
						Output:         result.PowerOutput,
					})
				}
				if result.PhotonOutput > 0 && building.Storage != nil {
					_, _, _ = building.Storage.Receive(result.PhotonItemID, result.PhotonOutput)
				}
			}
		}

		views[id] = view
	}
	if len(views) == 0 {
		return nil
	}
	return views
}
