package gamecore

import "siliconworld/internal/model"

var solarSailOrbitParams = model.DefaultSolarSailOrbitParams()

// LaunchSolarSail launches a solar sail into the authoritative space runtime.
func LaunchSolarSail(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string, orbitRadius, inclination float64, launchTick int64) *model.SolarSail {
	if spaceRuntime == nil {
		return nil
	}
	systemRuntime := spaceRuntime.EnsurePlayerSystem(playerID, systemID)
	if systemRuntime == nil {
		return nil
	}

	sail := model.SolarSail{
		ID:            spaceRuntime.NextEntityID("sail"),
		OrbitRadius:   orbitRadius,
		Inclination:   inclination,
		LaunchTick:    launchTick,
		LifetimeTicks: solarSailOrbitParams.DefaultLifetime,
		EnergyPerTick: solarSailOrbitParams.EnergyPerSail,
	}
	if systemRuntime.SolarSailOrbit == nil {
		systemRuntime.SolarSailOrbit = &model.SolarSailOrbitState{
			PlayerID: playerID,
			SystemID: systemID,
			Sails:    make([]model.SolarSail, 0),
		}
	}
	systemRuntime.SolarSailOrbit.Sails = append(systemRuntime.SolarSailOrbit.Sails, sail)
	systemRuntime.SolarSailOrbit.TotalEnergy = model.SolarSailEnergyOutput(len(systemRuntime.SolarSailOrbit.Sails), solarSailOrbitParams)
	return &sail
}

// GetSolarSailOrbit returns the orbit state for a player in a given system.
func GetSolarSailOrbit(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string) *model.SolarSailOrbitState {
	if spaceRuntime == nil {
		return nil
	}
	systemRuntime := spaceRuntime.PlayerSystem(playerID, systemID)
	if systemRuntime == nil {
		return nil
	}
	return systemRuntime.SolarSailOrbit
}

// settleSolarSails processes solar sail lifetime decay and energy output.
func settleSolarSails(spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.GameEvent {
	if spaceRuntime == nil {
		return nil
	}
	var events []*model.GameEvent

	for playerID, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil || systemRuntime.SolarSailOrbit == nil {
				continue
			}
			orbit := systemRuntime.SolarSailOrbit

			activeSails := make([]model.SolarSail, 0, len(orbit.Sails))
			for i := range orbit.Sails {
				sail := orbit.Sails[i]
				age := currentTick - sail.LaunchTick
				if age >= sail.LifetimeTicks {
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
				activeSails = append(activeSails, sail)
			}
			orbit.Sails = activeSails
			orbit.TotalEnergy = model.SolarSailEnergyOutput(len(orbit.Sails), solarSailOrbitParams)
		}
	}

	return events
}

// GetSolarSailEnergy returns total solar sail energy for a player in one system.
func GetSolarSailEnergy(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string) int {
	orbit := GetSolarSailOrbit(spaceRuntime, playerID, systemID)
	if orbit == nil {
		return 0
	}
	return orbit.TotalEnergy
}

// ClearSolarSailOrbits remains for backward-compatible tests; space runtime is now per-core.
func ClearSolarSailOrbits() {}
