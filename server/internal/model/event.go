package model

// EventType enumerates game event categories
type EventType string

const (
	EvtCommandResult         EventType = "command_result"
	EvtEntityCreated         EventType = "entity_created"
	EvtEntityMoved           EventType = "entity_moved"
	EvtDamageApplied         EventType = "damage_applied"
	EvtEntityDestroyed       EventType = "entity_destroyed"
	EvtBuildingStateChanged  EventType = "building_state_changed"
	EvtResourceChanged       EventType = "resource_changed"
	EvtTickCompleted         EventType = "tick_completed"
	EvtProductionAlert       EventType = "production_alert"
	EvtConstructionPaused   EventType = "construction_paused"
	EvtConstructionResumed  EventType = "construction_resumed"
	EvtResearchCompleted     EventType = "research_completed"
)

// GameEvent is a single game event pushed to SSE subscribers
type GameEvent struct {
	EventID         string         `json:"event_id"`
	Tick            int64          `json:"tick"`
	EventType       EventType      `json:"event_type"`
	VisibilityScope string         `json:"visibility_scope"` // player_id or "all"
	Payload         map[string]any `json:"payload"`
}

// TickSummary is a lightweight summary pushed at tick boundary
type TickSummary struct {
	Tick       int64 `json:"tick"`
	EventCount int   `json:"event_count"`
	DurationMs int64 `json:"duration_ms"`
}

// EventSnapshotResponse is the response for GET /events/snapshot.
type EventSnapshotResponse struct {
	SinceTick         int64        `json:"since_tick,omitempty"`
	AfterEventID      string       `json:"after_event_id,omitempty"`
	AvailableFromTick int64        `json:"available_from_tick"`
	NextEventID       string       `json:"next_event_id,omitempty"`
	HasMore           bool         `json:"has_more"`
	Events            []*GameEvent `json:"events"`
}
