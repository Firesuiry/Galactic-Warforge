package gamecore

import (
	"strconv"

	"siliconworld/internal/model"
)

var solarSailOrbitParams = model.DefaultSolarSailOrbitParams()

// SolarSailOrbits holds all solar sail orbit state keyed by player ID.
var solarSailOrbits = make(map[string]*model.SolarSailOrbitState)

// LaunchSolarSail launches a solar sail from a building (EM rail or silo).
func LaunchSolarSail(playerID, systemID string, orbitRadius, inclination float64, launchTick int64) *model.SolarSail {
	sail := &model.SolarSail{
		ID:            "sail-" + playerID + "-" + strconv.FormatInt(launchTick, 10),
		OrbitRadius:   orbitRadius,
		Inclination:   inclination,
		LaunchTick:    launchTick,
		LifetimeTicks: solarSailOrbitParams.DefaultLifetime,
		EnergyPerTick: solarSailOrbitParams.EnergyPerSail,
	}

	orbit, ok := solarSailOrbits[playerID]
	if !ok {
		orbit = &model.SolarSailOrbitState{
			PlayerID:  playerID,
			SystemID:  systemID,
			Sails:    make([]model.SolarSail, 0),
		}
		solarSailOrbits[playerID] = orbit
	}

	orbit.Sails = append(orbit.Sails, *sail)
	orbit.TotalEnergy = model.SolarSailEnergyOutput(len(orbit.Sails), solarSailOrbitParams)

	return sail
}

// GetSolarSailOrbit returns the orbit state for a player.
func GetSolarSailOrbit(playerID string) *model.SolarSailOrbitState {
	return solarSailOrbits[playerID]
}

// settleSolarSails processes solar sail lifetime decay and energy output.
func settleSolarSails(currentTick int64) []*model.GameEvent {
	var events []*model.GameEvent

	for playerID, orbit := range solarSailOrbits {
		if orbit == nil {
			continue
		}

		// Decay sails and remove expired ones
		var activeSails []model.SolarSail
		for i := range orbit.Sails {
			sail := &orbit.Sails[i]
			age := currentTick - sail.LaunchTick
			if age >= sail.LifetimeTicks {
				// Sail has expired, emit event
				events = append(events, &model.GameEvent{
					EventType:       model.EvtEntityDestroyed,
					VisibilityScope: playerID,
					Payload: map[string]any{
						"entity_id": sail.ID,
						"reason":    "lifetime_expired",
					},
				})
				continue
			}
			activeSails = append(activeSails, *sail)
		}
		orbit.Sails = activeSails
		orbit.TotalEnergy = model.SolarSailEnergyOutput(len(orbit.Sails), solarSailOrbitParams)
	}

	return events
}

// GetSolarSailEnergyForPlayer returns total energy available from solar sails for a player.
func GetSolarSailEnergyForPlayer(playerID string) int {
	orbit := solarSailOrbits[playerID]
	if orbit == nil {
		return 0
	}
	return orbit.TotalEnergy
}

// ClearSolarSailOrbits clears all solar sail orbit state (for testing).
func ClearSolarSailOrbits() {
	solarSailOrbits = make(map[string]*model.SolarSailOrbitState)
}