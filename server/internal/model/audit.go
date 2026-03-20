package model

import "time"

// AuditEntry records a single auditable action.
type AuditEntry struct {
	Timestamp         time.Time      `json:"timestamp"`
	Tick              int64          `json:"tick"`
	PlayerID          string         `json:"player_id"`
	Role              string         `json:"role,omitempty"`
	IssuerType        string         `json:"issuer_type,omitempty"`
	IssuerID          string         `json:"issuer_id,omitempty"`
	RequestID         string         `json:"request_id,omitempty"`
	Action            string         `json:"action"`
	Permission        string         `json:"permission,omitempty"`
	PermissionGranted *bool          `json:"permission_granted,omitempty"`
	Permissions       []string       `json:"permissions,omitempty"`
	Details           map[string]any `json:"details,omitempty"`
}

// AuditQuery describes a filter for audit entries.
type AuditQuery struct {
	PlayerID          string
	IssuerType        string
	IssuerID          string
	Action            string
	RequestID         string
	Permission        string
	PermissionGranted *bool
	FromTick          *int64
	ToTick            *int64
	FromTime          *time.Time
	ToTime            *time.Time
	Limit             int
	Order             string // "asc" (default) or "desc"
}

// AuditQueryResponse is the API response for audit queries.
type AuditQueryResponse struct {
	Count   int           `json:"count"`
	Entries []*AuditEntry `json:"entries"`
}
