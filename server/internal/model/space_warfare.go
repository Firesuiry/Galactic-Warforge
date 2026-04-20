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
	InterdictedLandings   int                  `json:"interdicted_landings,omitempty"`
	LastReason            string               `json:"last_reason,omitempty"`
	UpdatedTick           int64                `json:"updated_tick,omitempty"`
}

// LandingOperationStage describes the current phase of a landing operation.
type LandingOperationStage string

const (
	LandingOperationStageReconnaissance       LandingOperationStage = "reconnaissance"
	LandingOperationStageLandingWindowOpen    LandingOperationStage = "landing_window_open"
	LandingOperationStageVanguardLanding      LandingOperationStage = "vanguard_landing"
	LandingOperationStageBeachheadEstablished LandingOperationStage = "beachhead_established"
	LandingOperationStageFailed               LandingOperationStage = "failed"
)

// LandingOperationResult describes the final outcome of a landing operation.
type LandingOperationResult string

const (
	LandingOperationResultPending LandingOperationResult = "pending"
	LandingOperationResultSuccess LandingOperationResult = "success"
	LandingOperationResultFailed  LandingOperationResult = "failed"
)

// LandingOperationState stores one system-to-planet landing pipeline.
type LandingOperationState struct {
	ID                string                 `json:"id"`
	OwnerID           string                 `json:"owner_id"`
	TaskForceID       string                 `json:"task_force_id"`
	SystemID          string                 `json:"system_id"`
	PlanetID          string                 `json:"planet_id"`
	Stage             LandingOperationStage  `json:"stage"`
	Result            LandingOperationResult `json:"result"`
	BlockedReason     string                 `json:"blocked_reason,omitempty"`
	TransportCapacity int                    `json:"transport_capacity,omitempty"`
	InitialSupply     WarSupplyStock         `json:"initial_supply,omitempty"`
	LandingZoneSafety float64                `json:"landing_zone_safety,omitempty"`
	BridgeheadID      string                 `json:"bridgehead_id,omitempty"`
	StartedTick       int64                  `json:"started_tick,omitempty"`
	UpdatedTick       int64                  `json:"updated_tick,omitempty"`
	CompletedTick     int64                  `json:"completed_tick,omitempty"`
}

// LandingBridgeheadStatus describes the current state of a planetary bridgehead.
type LandingBridgeheadStatus string

const (
	LandingBridgeheadStatusEstablishing LandingBridgeheadStatus = "establishing"
	LandingBridgeheadStatusActive       LandingBridgeheadStatus = "active"
	LandingBridgeheadStatusCollapsed    LandingBridgeheadStatus = "collapsed"
)

// LandingBridgehead stores authoritative planetary landing ingress state.
type LandingBridgehead struct {
	ID                 string                  `json:"id"`
	OperationID        string                  `json:"operation_id"`
	OwnerID            string                  `json:"owner_id"`
	PlanetID           string                  `json:"planet_id"`
	FrontlineID        string                  `json:"frontline_id,omitempty"`
	Status             LandingBridgeheadStatus `json:"status"`
	Contested          bool                    `json:"contested,omitempty"`
	ExpansionLevel     float64                 `json:"expansion_level,omitempty"`
	FortificationLevel float64                 `json:"fortification_level,omitempty"`
	EstablishedTick    int64                   `json:"established_tick,omitempty"`
	LastSupportTick    int64                   `json:"last_support_tick,omitempty"`
	TransportCapacity  int                     `json:"transport_capacity,omitempty"`
}

// SystemWarfareRuntime stores authoritative system-level war state.
type SystemWarfareRuntime struct {
	SystemID           string                            `json:"system_id"`
	OrbitalSuperiority *OrbitalSuperiorityState          `json:"orbital_superiority,omitempty"`
	PlanetBlockades    map[string]*PlanetBlockadeState   `json:"planet_blockades,omitempty"`
	LandingOperations  map[string]*LandingOperationState `json:"landing_operations,omitempty"`
}

// NewSystemWarfareRuntime returns an initialized system warfare runtime.
func NewSystemWarfareRuntime(systemID string) *SystemWarfareRuntime {
	return &SystemWarfareRuntime{
		SystemID:          systemID,
		PlanetBlockades:   make(map[string]*PlanetBlockadeState),
		LandingOperations: make(map[string]*LandingOperationState),
	}
}

// CloneSystemWarfareRuntime deep-copies system warfare runtime.
func CloneSystemWarfareRuntime(runtime *SystemWarfareRuntime) *SystemWarfareRuntime {
	if runtime == nil {
		return nil
	}
	out := &SystemWarfareRuntime{
		SystemID:          runtime.SystemID,
		PlanetBlockades:   make(map[string]*PlanetBlockadeState, len(runtime.PlanetBlockades)),
		LandingOperations: make(map[string]*LandingOperationState, len(runtime.LandingOperations)),
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
	for operationID, operation := range runtime.LandingOperations {
		if operation == nil {
			continue
		}
		copy := *operation
		out.LandingOperations[operationID] = &copy
	}
	return out
}
