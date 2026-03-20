package model

// ProductionAlertSnapshotResponse is the response for GET /alerts/production/snapshot.
type ProductionAlertSnapshotResponse struct {
	SinceTick         int64              `json:"since_tick,omitempty"`
	AfterAlertID      string             `json:"after_alert_id,omitempty"`
	AvailableFromTick int64              `json:"available_from_tick"`
	NextAlertID       string             `json:"next_alert_id,omitempty"`
	HasMore           bool               `json:"has_more"`
	Alerts            []*ProductionAlert `json:"alerts"`
}
