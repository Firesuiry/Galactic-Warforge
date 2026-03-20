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

	generatedByPlayer := make(map[string]int)

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
		if result.Output > 0 {
			generatedByPlayer[building.OwnerID] += result.Output
		}
	}

	if len(generatedByPlayer) == 0 {
		return nil
	}

	var events []*model.GameEvent
	for playerID, delta := range generatedByPlayer {
		player := ws.Players[playerID]
		if player == nil || !player.IsAlive || delta <= 0 {
			continue
		}
		oldE := player.Resources.Energy
		player.Resources.Energy += delta
		if player.Resources.Energy > 10000 {
			player.Resources.Energy = 10000
		}
		if player.Resources.Energy < 0 {
			player.Resources.Energy = 0
		}
		if oldE != player.Resources.Energy {
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
