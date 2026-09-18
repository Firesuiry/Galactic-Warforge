package gamecore

import (
	"math"
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
	"siliconworld/internal/terrain"
)

// stateReasonNoLava marks geothermal generators without lava proximity.
const stateReasonNoLava = "no_lava"

// ticksPerSecond is the default tick rate used for environment curves.
const ticksPerSecond = 10

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
		if !modelpower.IsPowerGeneratorModule(module) {
			continue
		}
		if building.Runtime.State == model.BuildingWorkPaused || building.Runtime.State == model.BuildingWorkIdle || building.Runtime.State == model.BuildingWorkError {
			continue
		}
		if modelpower.IsFuelBasedPowerSource(module.SourceKind) {
			// Fuel-based generators publish the authoritative runtime result for
			// this tick here. Later phases may consume resources, but they must not
			// overwrite a successful generation tick with a post-consumption
			// inventory check.
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
		if module.SourceKind == modelpower.PowerSourceGeothermal {
			// Geothermal generators only produce while their footprint touches
			// lava (on-lava or 1-tile adjacency). The placement check lives in
			// the build rules chain; this runtime gate keeps generation
			// authoritative regardless of how the building got there.
			if !geothermalHasLava(ws, building) {
				if evt := applyBuildingState(building, model.BuildingWorkNoPower, stateReasonNoLava); evt != nil {
					events = append(events, evt)
				}
				continue
			}
			if building.Runtime.State == model.BuildingWorkNoPower && building.Runtime.StateReason == stateReasonNoLava {
				if evt := applyBuildingState(building, model.BuildingWorkRunning, stateReasonStart); evt != nil {
					events = append(events, evt)
				}
			}
		}
		factor := powerEnvFactor(module.SourceKind, env, ws.Tick)
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

func powerEnvFactor(kind modelpower.PowerSourceKind, env mapmodel.PlanetEnvironment, tick int64) float64 {
	switch kind {
	case modelpower.PowerSourceWind:
		return env.WindFactor
	case modelpower.PowerSourceSolar:
		return env.LightFactor * solarDayNightFactor(env, tick)
	default:
		return 1
	}
}

// solarDayNightFactor modulates solar output over the planet's day cycle. It
// is a pure function of (environment, tick) so save/load restores identical
// output for the same tick. Tidal-locked planets (and planets without a
// configured day length) receive constant output.
func solarDayNightFactor(env mapmodel.PlanetEnvironment, tick int64) float64 {
	if env.TidalLocked || env.DayLengthHours <= 0 {
		return 1
	}
	dayTicks := env.DayLengthHours * 3600 * ticksPerSecond
	if dayTicks <= 0 {
		return 1
	}
	phase := math.Mod(float64(tick)/dayTicks, 1)
	if phase < 0 {
		phase += 1
	}
	// Noon at the day boundary: full output at phase 0, zero through the
	// night half of the cycle.
	factor := math.Cos(2 * math.Pi * phase)
	if factor < 0 {
		return 0
	}
	return factor
}

// geothermalHasLava reports whether the building footprint or its 1-tile ring
// touches lava terrain.
func geothermalHasLava(ws *model.WorldState, building *model.Building) bool {
	if ws == nil || building == nil {
		return false
	}
	isLava := func(x, y int) bool {
		if y < 0 || y >= len(ws.Grid) || x < 0 || x >= len(ws.Grid[y]) {
			return false
		}
		return ws.Grid[y][x].Terrain == terrain.TileLava
	}
	footprint := building.Runtime.Params.Footprint
	return model.LavaProximityOk(isLava, building.Position.X, building.Position.Y, footprint.Width, footprint.Height)
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
