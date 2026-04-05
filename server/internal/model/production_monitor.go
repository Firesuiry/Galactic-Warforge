package model

import "fmt"

// ProductionAlertSeverity indicates alert importance.
type ProductionAlertSeverity string

const (
	AlertSeverityWarning  ProductionAlertSeverity = "warning"
	AlertSeverityCritical ProductionAlertSeverity = "critical"
)

// ProductionAlertType describes the alert category.
type ProductionAlertType string

const (
	AlertTypeThroughputDrop ProductionAlertType = "throughput_drop"
	AlertTypeBacklog        ProductionAlertType = "backlog"
	AlertTypeInputShortage  ProductionAlertType = "input_shortage"
	AlertTypeOutputBlocked  ProductionAlertType = "output_blocked"
	AlertTypePowerShortage  ProductionAlertType = "power_shortage"
)

// ProductionAlert is a monitoring alert raised for a single building.
type ProductionAlert struct {
	AlertID      string                  `json:"alert_id"`
	Tick         int64                   `json:"tick"`
	PlayerID     string                  `json:"player_id"`
	BuildingID   string                  `json:"building_id"`
	BuildingType BuildingType            `json:"building_type"`
	AlertType    ProductionAlertType     `json:"alert_type"`
	Severity     ProductionAlertSeverity `json:"severity"`
	Message      string                  `json:"message"`
	Metrics      MonitorStats            `json:"metrics"`
	Details      map[string]any          `json:"details,omitempty"`
}

// MonitorStats captures per-tick production monitoring data.
type MonitorStats struct {
	Throughput    int     `json:"throughput"`
	Backlog       int     `json:"backlog"`
	IdleRatio     float64 `json:"idle_ratio"`
	Efficiency    float64 `json:"efficiency"`
	InputShortage bool    `json:"input_shortage"`
	OutputBlocked bool    `json:"output_blocked"`
	PowerState    string  `json:"power_state,omitempty"`
}

// ProductionMonitorState tracks rolling production stats per building.
type ProductionMonitorState struct {
	Samples      int64                         `json:"samples"`
	IdleSamples  int64                         `json:"idle_samples"`
	TotalMoves   int64                         `json:"total_moves"`
	LastMoveTick int64                         `json:"last_move_tick"`
	LastAlertAt  map[ProductionAlertType]int64 `json:"last_alert_at,omitempty"`
	LastStats    MonitorStats                  `json:"last_stats"`
}

// NewProductionMonitorState returns an initialized monitor state.
func NewProductionMonitorState() *ProductionMonitorState {
	return &ProductionMonitorState{
		LastAlertAt: make(map[ProductionAlertType]int64),
	}
}

// Clone returns a deep copy of the production monitor state.
func (m *ProductionMonitorState) Clone() *ProductionMonitorState {
	if m == nil {
		return nil
	}
	out := *m
	if len(m.LastAlertAt) > 0 {
		out.LastAlertAt = make(map[ProductionAlertType]int64, len(m.LastAlertAt))
		for key, tick := range m.LastAlertAt {
			out.LastAlertAt[key] = tick
		}
	}
	return &out
}

// RegisterSample updates rolling counters for the building.
func (m *ProductionMonitorState) RegisterSample(tick int64, moved, backlog, throughput int, idle bool, inputShortage, outputBlocked bool, powerState string) {
	if m == nil {
		return
	}
	m.Samples++
	if idle {
		m.IdleSamples++
	}
	if moved > 0 {
		m.TotalMoves += int64(moved)
		m.LastMoveTick = tick
	}
	stats := MonitorStats{
		Throughput:    throughput,
		Backlog:       backlog,
		InputShortage: inputShortage,
		OutputBlocked: outputBlocked,
		PowerState:    powerState,
	}
	if m.Samples > 0 {
		stats.IdleRatio = float64(m.IdleSamples) / float64(m.Samples)
	}
	if throughput > 0 {
		stats.Efficiency = float64(moved) / float64(throughput)
	}
	m.LastStats = stats
}

func (m *ProductionMonitorState) ShouldAlert(alertType ProductionAlertType, tick int64, cooldown int64) bool {
	if m == nil {
		return true
	}
	if cooldown <= 0 {
		return true
	}
	last := m.LastAlertAt[alertType]
	return tick-last >= cooldown
}

func (m *ProductionMonitorState) MarkAlert(alertType ProductionAlertType, tick int64) {
	if m == nil {
		return
	}
	if m.LastAlertAt == nil {
		m.LastAlertAt = make(map[ProductionAlertType]int64)
	}
	m.LastAlertAt[alertType] = tick
}

// AlertMessage returns a human-friendly message for alert type.
func AlertMessage(alertType ProductionAlertType, buildingID string) string {
	switch alertType {
	case AlertTypeThroughputDrop:
		return fmt.Sprintf("building %s throughput drop detected", buildingID)
	case AlertTypeBacklog:
		return fmt.Sprintf("building %s backlog rising", buildingID)
	case AlertTypeInputShortage:
		return fmt.Sprintf("building %s input shortage", buildingID)
	case AlertTypeOutputBlocked:
		return fmt.Sprintf("building %s output blocked", buildingID)
	case AlertTypePowerShortage:
		return fmt.Sprintf("building %s power shortage", buildingID)
	default:
		return fmt.Sprintf("building %s alert", buildingID)
	}
}
