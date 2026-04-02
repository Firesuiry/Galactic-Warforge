package model

import "time"

// SaveRequest defines a manual save trigger payload.
type SaveRequest struct {
	Reason string `json:"reason,omitempty"`
}

// SaveResponse describes a completed save operation.
type SaveResponse struct {
	Ok      bool      `json:"ok"`
	Tick    int64     `json:"tick"`
	SavedAt time.Time `json:"saved_at"`
	Path    string    `json:"path"`
	Trigger string    `json:"trigger"`
}
