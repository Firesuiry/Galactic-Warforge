package gamecore

import (
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func settlePowerGeneration(ws *model.WorldState, env mapmodel.PlanetEnvironment) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	var events []*model.GameEvent

	ws.PowerSnapshot = nil
	if ws.PowerInputs != nil {
		ws.PowerInputs = ws.PowerInputs[:0]
	}

	if len(ws.Buildings) == 0 {
		return nil
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil {
			continue
		}
		player := ws.Players[building.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}
		module := building.Runtime.Functions.Energy
		if !model.IsPowerGeneratorModule(module) {
			continue
		}
		if building.Runtime.State == model.BuildingWorkPaused || building.Runtime.State == model.BuildingWorkIdle || building.Runtime.State == model.BuildingWorkError {
			continue
		}
		if model.IsFuelBasedPowerSource(module.SourceKind) {
			if !fuelBasedGeneratorHasReachableFuel(building) {
				if evt := applyBuildingState(building, model.BuildingWorkNoPower, stateReasonNoFuel); evt != nil {
					events = append(events, evt)
				}
				continue
			}
			if building.Runtime.State == model.BuildingWorkNoPower && building.Runtime.StateReason == stateReasonNoFuel {
				if evt := applyBuildingState(building, model.BuildingWorkRunning, stateReasonStart); evt != nil {
					events = append(events, evt)
				}
			}
		}
		factor := powerEnvFactor(module.SourceKind, env)
		result, err := model.ResolvePowerGeneration(model.PowerGenerationRequest{
			Module:    module,
			EnvFactor: factor,
			Storage:   building.Storage,
		})
		if err != nil {
			continue
		}
		if result.Output <= 0 && len(result.FuelUsed) == 0 {
			continue
		}
		ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{
			BuildingID:     building.ID,
			OwnerID:        building.OwnerID,
			SourceKind:     module.SourceKind,
			BaseOutput:     result.BaseOutput,
			EnvFactor:      result.EnvFactor,
			FuelMultiplier: result.FuelMultiplier,
			Output:         result.Output,
			FuelUsed:       result.FuelUsed,
		})
	}
	return events
}

func powerEnvFactor(kind model.PowerSourceKind, env mapmodel.PlanetEnvironment) float64 {
	switch kind {
	case model.PowerSourceWind:
		return env.WindFactor
	case model.PowerSourceSolar:
		return env.LightFactor
	default:
		return 1
	}
}

func currentPlanetEnvironment(maps *mapmodel.Universe, planetID string) mapmodel.PlanetEnvironment {
	if maps == nil || planetID == "" {
		return mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1}
	}
	planet, ok := maps.Planet(planetID)
	if !ok || planet == nil {
		return mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1}
	}
	return planet.Environment
}
