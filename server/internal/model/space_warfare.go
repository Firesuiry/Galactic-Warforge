package model

// OrbitalSuperiorityState stores authoritative system-level orbital control.
type OrbitalSuperiorityState struct {
	SystemID          string  `json:"system_id"`
	AdvantagePlayerID string  `json:"advantage_player_id,omitempty"`
	ContestIntensity  float64 `json:"contest_intensity,omitempty"`
	LastReason        string  `json:"last_reason,omitempty"`
	UpdatedTick       int64   `json:"updated_tick,omitempty"`
}

// PlanetBlockadeStatus describes the live state of a blockade attempt.
type PlanetBlockadeStatus string

const (
	PlanetBlockadeStatusPlanned   PlanetBlockadeStatus = "planned"
	PlanetBlockadeStatusActive    PlanetBlockadeStatus = "active"
	PlanetBlockadeStatusContested PlanetBlockadeStatus = "contested"
	PlanetBlockadeStatusBroken    PlanetBlockadeStatus = "broken"
)

// PlanetBlockadeState stores authoritative blockade runtime for one planet.
type PlanetBlockadeState struct {
	PlanetID              string               `json:"planet_id"`
	SystemID              string               `json:"system_id"`
	OwnerID               string               `json:"owner_id"`
	TaskForceID           string               `json:"task_force_id,omitempty"`
	Status                PlanetBlockadeStatus `json:"status"`
	Intensity             float64              `json:"intensity,omitempty"`
	InterdictedSupply     int                  `json:"interdicted_supply,omitempty"`
	InterdictedTransports int                  `json:"interdicted_transports,omitempty"`
	LastReason            string               `json:"last_reason,omitempty"`
	UpdatedTick           int64                `json:"updated_tick,omitempty"`
}

// SystemWarfareRuntime stores authoritative system-level war state.
type SystemWarfareRuntime struct {
	SystemID           string                          `json:"system_id"`
	OrbitalSuperiority *OrbitalSuperiorityState        `json:"orbital_superiority,omitempty"`
	PlanetBlockades    map[string]*PlanetBlockadeState `json:"planet_blockades,omitempty"`
}

// NewSystemWarfareRuntime returns an initialized system warfare runtime.
func NewSystemWarfareRuntime(systemID string) *SystemWarfareRuntime {
	return &SystemWarfareRuntime{
		SystemID:        systemID,
		PlanetBlockades: make(map[string]*PlanetBlockadeState),
	}
}

// CloneSystemWarfareRuntime deep-copies system warfare runtime.
func CloneSystemWarfareRuntime(runtime *SystemWarfareRuntime) *SystemWarfareRuntime {
	if runtime == nil {
		return nil
	}
	out := &SystemWarfareRuntime{
		SystemID:        runtime.SystemID,
		PlanetBlockades: make(map[string]*PlanetBlockadeState, len(runtime.PlanetBlockades)),
	}
	if runtime.OrbitalSuperiority != nil {
		superiority := *runtime.OrbitalSuperiority
		out.OrbitalSuperiority = &superiority
	}
	for planetID, blockade := range runtime.PlanetBlockades {
		if blockade == nil {
			continue
		}
		copy := *blockade
		out.PlanetBlockades[planetID] = &copy
	}
	return out
}
