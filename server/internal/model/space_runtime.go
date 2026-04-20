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
	SystemID       string                    `json:"system_id"`
	SolarSailOrbit *SolarSailOrbitState      `json:"solar_sail_orbit,omitempty"`
	DysonSphere    *DysonSphereState         `json:"dyson_sphere,omitempty"`
	Fleets         map[string]*SpaceFleet    `json:"fleets,omitempty"`
	SensorContacts map[string]*SensorContact `json:"sensor_contacts,omitempty"`
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
			SystemID:       systemID,
			Fleets:         make(map[string]*SpaceFleet),
			SensorContacts: make(map[string]*SensorContact),
		}
		playerRuntime.Systems[systemID] = systemRuntime
	}
	if systemRuntime.Fleets == nil {
		systemRuntime.Fleets = make(map[string]*SpaceFleet)
	}
	if systemRuntime.SensorContacts == nil {
		systemRuntime.SensorContacts = make(map[string]*SensorContact)
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

// EnsureDysonSphereState returns a player-system Dyson sphere state, creating it when missing.
func EnsureDysonSphereState(rt *SpaceRuntimeState, playerID, systemID string) *DysonSphereState {
	if rt == nil {
		return nil
	}
	systemRuntime := rt.EnsurePlayerSystem(playerID, systemID)
	if systemRuntime == nil {
		return nil
	}
	if systemRuntime.DysonSphere == nil {
		systemRuntime.DysonSphere = NewDysonSphereState(playerID, systemID)
	}
	return systemRuntime.DysonSphere
}

// GetDysonSphereState returns the Dyson sphere state for one player in one system.
func GetDysonSphereState(rt *SpaceRuntimeState, playerID, systemID string) *DysonSphereState {
	if rt == nil {
		return nil
	}
	systemRuntime := rt.PlayerSystem(playerID, systemID)
	if systemRuntime == nil {
		return nil
	}
	return systemRuntime.DysonSphere
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
				SystemID:       systemRuntime.SystemID,
				Fleets:         make(map[string]*SpaceFleet, len(systemRuntime.Fleets)),
				SensorContacts: cloneSensorContactMap(systemRuntime.SensorContacts),
			}
			if systemRuntime.SolarSailOrbit != nil {
				orbitCopy := *systemRuntime.SolarSailOrbit
				orbitCopy.Sails = append([]SolarSail(nil), systemRuntime.SolarSailOrbit.Sails...)
				systemCopy.SolarSailOrbit = &orbitCopy
			}
			systemCopy.DysonSphere = cloneDysonSphereState(systemRuntime.DysonSphere)
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

func cloneDysonSphereState(state *DysonSphereState) *DysonSphereState {
	if state == nil {
		return nil
	}
	stateCopy := *state
	stateCopy.Layers = append([]DysonLayer(nil), state.Layers...)
	for index := range stateCopy.Layers {
		stateCopy.Layers[index].Nodes = append([]DysonNode(nil), state.Layers[index].Nodes...)
		stateCopy.Layers[index].Frames = append([]DysonFrame(nil), state.Layers[index].Frames...)
		stateCopy.Layers[index].Shells = append([]DysonShell(nil), state.Layers[index].Shells...)
	}
	return &stateCopy
}
