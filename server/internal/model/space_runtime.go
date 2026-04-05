package model

// SpaceRuntimeState is the top-level authoritative space runtime container.
type SpaceRuntimeState struct {
	EntityCounter int64                          `json:"entity_counter"`
	Players       map[string]*PlayerSpaceRuntime `json:"players,omitempty"`
}

// PlayerSpaceRuntime stores per-player space runtime data.
type PlayerSpaceRuntime struct {
	PlayerID string                          `json:"player_id"`
	Systems  map[string]*PlayerSystemRuntime `json:"systems,omitempty"`
}

// PlayerSystemRuntime stores per-player, per-system space runtime data.
type PlayerSystemRuntime struct {
	SystemID       string                 `json:"system_id"`
	SolarSailOrbit *SolarSailOrbitState   `json:"solar_sail_orbit,omitempty"`
	Fleets         map[string]*SpaceFleet `json:"fleets,omitempty"`
}

// NewSpaceRuntimeState returns an initialized empty space runtime.
func NewSpaceRuntimeState() *SpaceRuntimeState {
	return &SpaceRuntimeState{
		Players: make(map[string]*PlayerSpaceRuntime),
	}
}

// NextEntityID allocates a unique space entity ID.
func (rt *SpaceRuntimeState) NextEntityID(prefix string) string {
	if rt == nil {
		return prefix + "-0"
	}
	rt.EntityCounter++
	return prefix + "-" + int64ToStr(rt.EntityCounter)
}

// EnsurePlayerSystem returns an initialized player-system runtime bucket.
func (rt *SpaceRuntimeState) EnsurePlayerSystem(playerID, systemID string) *PlayerSystemRuntime {
	if rt == nil {
		return nil
	}
	if rt.Players == nil {
		rt.Players = make(map[string]*PlayerSpaceRuntime)
	}
	playerRuntime, ok := rt.Players[playerID]
	if !ok || playerRuntime == nil {
		playerRuntime = &PlayerSpaceRuntime{
			PlayerID: playerID,
			Systems:  make(map[string]*PlayerSystemRuntime),
		}
		rt.Players[playerID] = playerRuntime
	}
	if playerRuntime.Systems == nil {
		playerRuntime.Systems = make(map[string]*PlayerSystemRuntime)
	}
	systemRuntime, ok := playerRuntime.Systems[systemID]
	if !ok || systemRuntime == nil {
		systemRuntime = &PlayerSystemRuntime{
			SystemID: systemID,
			Fleets:   make(map[string]*SpaceFleet),
		}
		playerRuntime.Systems[systemID] = systemRuntime
	}
	if systemRuntime.Fleets == nil {
		systemRuntime.Fleets = make(map[string]*SpaceFleet)
	}
	return systemRuntime
}

// PlayerSystem returns a player-system runtime bucket when present.
func (rt *SpaceRuntimeState) PlayerSystem(playerID, systemID string) *PlayerSystemRuntime {
	if rt == nil || rt.Players == nil {
		return nil
	}
	playerRuntime := rt.Players[playerID]
	if playerRuntime == nil || playerRuntime.Systems == nil {
		return nil
	}
	return playerRuntime.Systems[systemID]
}

// CloneSpaceRuntimeState deep-copies space runtime state.
func CloneSpaceRuntimeState(rt *SpaceRuntimeState) *SpaceRuntimeState {
	if rt == nil {
		return NewSpaceRuntimeState()
	}
	out := &SpaceRuntimeState{
		EntityCounter: rt.EntityCounter,
		Players:       make(map[string]*PlayerSpaceRuntime, len(rt.Players)),
	}
	for playerID, playerRuntime := range rt.Players {
		if playerRuntime == nil {
			continue
		}
		playerCopy := &PlayerSpaceRuntime{
			PlayerID: playerRuntime.PlayerID,
			Systems:  make(map[string]*PlayerSystemRuntime, len(playerRuntime.Systems)),
		}
		for systemID, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			systemCopy := &PlayerSystemRuntime{
				SystemID: systemRuntime.SystemID,
				Fleets:   make(map[string]*SpaceFleet, len(systemRuntime.Fleets)),
			}
			if systemRuntime.SolarSailOrbit != nil {
				orbitCopy := *systemRuntime.SolarSailOrbit
				orbitCopy.Sails = append([]SolarSail(nil), systemRuntime.SolarSailOrbit.Sails...)
				systemCopy.SolarSailOrbit = &orbitCopy
			}
			for fleetID, fleet := range systemRuntime.Fleets {
				if fleet == nil {
					continue
				}
				fleetCopy := *fleet
				fleetCopy.Units = append([]FleetUnitStack(nil), fleet.Units...)
				if fleet.Target != nil {
					targetCopy := *fleet.Target
					fleetCopy.Target = &targetCopy
				}
				systemCopy.Fleets[fleetID] = &fleetCopy
			}
			playerCopy.Systems[systemID] = systemCopy
		}
		out.Players[playerID] = playerCopy
	}
	return out
}
