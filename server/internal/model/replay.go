package model

// ReplayRequest defines the replay control payload.
type ReplayRequest struct {
	FromTick int64   `json:"from_tick"`
	ToTick   int64   `json:"to_tick"`
	Step     bool    `json:"step,omitempty"`
	Speed    float64 `json:"speed,omitempty"`
	Verify   bool    `json:"verify,omitempty"`
}

// ReplayDigest summarizes a world state for consistency checks.
type ReplayDigest struct {
	Tick                 int64  `json:"tick"`
	Players              int    `json:"players"`
	AlivePlayers         int    `json:"alive_players"`
	Buildings            int    `json:"buildings"`
	Units                int    `json:"units"`
	Resources            int    `json:"resources"`
	TotalMinerals        int    `json:"total_minerals"`
	TotalEnergy          int    `json:"total_energy"`
	ResourceRemaining    int64  `json:"resource_remaining"`
	EntityCounter        int64  `json:"entity_counter"`
	SpaceEntityCounter   int64  `json:"space_entity_counter"`
	SolarSailCount       int    `json:"solar_sail_count"`
	SolarSailSystems     int    `json:"solar_sail_systems"`
	SolarSailTotalEnergy int    `json:"solar_sail_total_energy"`
	Hash                 string `json:"hash"`
}

// ReplayResponse describes the outcome of a replay run.
type ReplayResponse struct {
	FromTick            int64         `json:"from_tick"`
	ToTick              int64         `json:"to_tick"`
	SnapshotTick        int64         `json:"snapshot_tick"`
	ReplayFromTick      int64         `json:"replay_from_tick"`
	ReplayToTick        int64         `json:"replay_to_tick"`
	AppliedTicks        int64         `json:"applied_ticks"`
	CommandCount        int           `json:"command_count"`
	ResultMismatchCount int           `json:"result_mismatch_count,omitempty"`
	DurationMs          int64         `json:"duration_ms"`
	Step                bool          `json:"step"`
	Speed               float64       `json:"speed,omitempty"`
	Digest              ReplayDigest  `json:"digest"`
	SnapshotDigest      *ReplayDigest `json:"snapshot_digest,omitempty"`
	DriftDetected       bool          `json:"drift_detected"`
	Notes               []string      `json:"notes,omitempty"`
}
