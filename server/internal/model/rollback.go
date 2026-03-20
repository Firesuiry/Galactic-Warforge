package model

// RollbackRequest defines the rollback control payload.
type RollbackRequest struct {
	ToTick int64 `json:"to_tick"`
}

// RollbackResponse describes the outcome of a rollback run.
type RollbackResponse struct {
	FromTick            int64        `json:"from_tick"`
	ToTick              int64        `json:"to_tick"`
	SnapshotTick        int64        `json:"snapshot_tick"`
	ReplayFromTick      int64        `json:"replay_from_tick"`
	ReplayToTick        int64        `json:"replay_to_tick"`
	AppliedTicks        int64        `json:"applied_ticks"`
	CommandCount        int          `json:"command_count"`
	DurationMs          int64        `json:"duration_ms"`
	TrimmedCommandLog   int          `json:"trimmed_command_log"`
	TrimmedEventHistory int          `json:"trimmed_event_history,omitempty"`
	TrimmedAlertHistory int          `json:"trimmed_alert_history,omitempty"`
	TrimmedSnapshots    int          `json:"trimmed_snapshots,omitempty"`
	TrimmedDeltas       int          `json:"trimmed_deltas,omitempty"`
	Digest              ReplayDigest `json:"digest"`
	Notes               []string     `json:"notes,omitempty"`
}
