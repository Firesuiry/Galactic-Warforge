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
	AlertTypeThroughputDrop   ProductionAlertType = "throughput_drop"
	AlertTypeBacklog          ProductionAlertType = "backlog"
	AlertTypeInputShortage    ProductionAlertType = "input_shortage"
	AlertTypeOutputBlocked    ProductionAlertType = "output_blocked"
	AlertTypePowerShortage    ProductionAlertType = "power_shortage"
	AlertTypeUnitSpawnBlocked ProductionAlertType = "unit_spawn_blocked"
)

// ProductionAlert is a monitoring alert raised for a single building.
// Alerts are aggregated per (building, alert type): repeated occurrences do
// not create new entries, they bump RepeatCount and LastTick on the existing
// entry instead.
type ProductionAlert struct {
	AlertID      string                  `json:"alert_id"`
	Tick         int64                   `json:"tick"`
	LastTick     int64                   `json:"last_tick,omitempty"`
	RepeatCount  int                     `json:"repeat_count,omitempty"`
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
	// ActiveAlerts 当前仍成立的告警：同一问题持续期间只在开始时报一次，
	// 之后每 ProductionAlertRemindTicks 提醒一次，问题解除后清除。
	ActiveAlerts map[ProductionAlertType]bool `json:"active_alerts,omitempty"`
	LastStats    MonitorStats                 `json:"last_stats"`
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
	if len(m.ActiveAlerts) > 0 {
		out.ActiveAlerts = make(map[ProductionAlertType]bool, len(m.ActiveAlerts))
		for key, active := range m.ActiveAlerts {
			out.ActiveAlerts[key] = active
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

// ProductionAlertRemindTicks 同一告警持续存在时的重复提醒间隔（10 tps 下 5 分钟）。
const ProductionAlertRemindTicks int64 = 3000

// Alert 按告警条件决定本次采样是否发出告警（发出时记账）：
//   - 条件不成立：清除持续状态，不发；
//   - 新出现：距上次同类告警满 cooldown 才发（防抖动）；
//   - 持续中：每 ProductionAlertRemindTicks 提醒一次。
func (m *ProductionMonitorState) Alert(alertType ProductionAlertType, condition bool, tick, cooldown int64) bool {
	if m == nil {
		return condition
	}
	if !condition {
		delete(m.ActiveAlerts, alertType)
		return false
	}
	last, seen := m.LastAlertAt[alertType]
	if m.ActiveAlerts[alertType] {
		if tick-last < ProductionAlertRemindTicks {
			return false
		}
	} else if seen && tick-last < cooldown {
		return false
	}
	if m.LastAlertAt == nil {
		m.LastAlertAt = make(map[ProductionAlertType]int64)
	}
	if m.ActiveAlerts == nil {
		m.ActiveAlerts = make(map[ProductionAlertType]bool)
	}
	m.LastAlertAt[alertType] = tick
	m.ActiveAlerts[alertType] = true
	return true
}

// AlertMessage returns a player-facing Chinese message for alert type.
// Clients may further localize with building type names; this is the server baseline.
func AlertMessage(alertType ProductionAlertType, buildingID string) string {
	switch alertType {
	case AlertTypeThroughputDrop:
		return fmt.Sprintf("建筑 %s：产能下降", buildingID)
	case AlertTypeBacklog:
		return fmt.Sprintf("建筑 %s：堆积升高", buildingID)
	case AlertTypeInputShortage:
		return fmt.Sprintf("建筑 %s：原料短缺", buildingID)
	case AlertTypeOutputBlocked:
		return fmt.Sprintf("建筑 %s：产物阻塞", buildingID)
	case AlertTypePowerShortage:
		return fmt.Sprintf("建筑 %s：电力不足", buildingID)
	case AlertTypeUnitSpawnBlocked:
		return fmt.Sprintf("建筑 %s：出厂口被占满", buildingID)
	default:
		return fmt.Sprintf("建筑 %s：产线告警", buildingID)
	}
}
