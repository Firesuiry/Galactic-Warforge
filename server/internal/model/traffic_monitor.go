package model

import (
	"fmt"
	"math"
)

// ConveyorTrafficSnapshot records successful departures during one settlement.
// It is transient: monitor windows, rather than incomplete tick work, are saved.
type ConveyorTrafficSnapshot struct {
	Tick         int64
	Departed     map[string]int
	QueuedBefore map[string]int
}

// QueuedItems is observed before transport so a new arrival is not a blockage.
type TrafficSample struct {
	Tick        int64 `json:"tick"`
	Items       int   `json:"items"`
	QueuedItems int   `json:"queued_items"`
}

type TrafficMonitorState struct {
	TargetBeltID        string          `json:"target_belt_id"`
	WindowTicks         int             `json:"window_ticks"`
	MinimumItemsPerTick float64         `json:"minimum_items_per_tick"`
	AlertsEnabled       bool            `json:"alerts_enabled"`
	State               string          `json:"state"`
	Samples             []TrafficSample `json:"samples"`
	SampleCount         int             `json:"sample_count"`
	WindowItems         int             `json:"window_items"`
	ItemsPerTick        float64         `json:"items_per_tick"`
	TotalItems          int64           `json:"total_items"`
	LastSampleTick      int64           `json:"last_sample_tick"`
	AlertActive         bool            `json:"alert_active"`
}

func NewTrafficMonitorState() *TrafficMonitorState {
	return &TrafficMonitorState{WindowTicks: 30, MinimumItemsPerTick: 1, AlertsEnabled: true, State: "unconfigured", LastSampleTick: -1}
}

func InitBuildingTrafficMonitor(b *Building) {
	if b != nil && b.Type == BuildingTypeTrafficMonitor && b.TrafficMonitor == nil {
		b.TrafficMonitor = NewTrafficMonitorState()
	}
}

func (s *TrafficMonitorState) Clone() *TrafficMonitorState {
	if s == nil {
		return nil
	}
	out := *s
	out.Samples = append([]TrafficSample(nil), s.Samples...)
	return &out
}

func (s *TrafficMonitorState) ClearWindow() {
	s.Samples = nil
	s.SampleCount = 0
	s.WindowItems = 0
	s.ItemsPerTick = 0
	s.AlertActive = false
}

func (s *TrafficMonitorState) Validate() error {
	if s == nil || s.WindowTicks < 1 || s.WindowTicks > 600 {
		return fmt.Errorf("window_ticks must be an integer between 1 and 600")
	}
	if math.IsNaN(s.MinimumItemsPerTick) || math.IsInf(s.MinimumItemsPerTick, 0) || s.MinimumItemsPerTick < 0 || s.MinimumItemsPerTick > 60 {
		return fmt.Errorf("minimum_items_per_tick must be a finite number between 0 and 60")
	}
	if s.TotalItems < 0 || s.LastSampleTick < -1 || len(s.Samples) > s.WindowTicks || s.SampleCount != len(s.Samples) {
		return fmt.Errorf("invalid traffic monitor counters")
	}
	switch s.State {
	case "unconfigured", "sampling", "flowing", "idle", "low_flow", "blocked", "no_power", "paused", "error", "target_missing", "target_inactive":
	default:
		return fmt.Errorf("invalid traffic monitor state")
	}
	total := 0
	for i, sample := range s.Samples {
		if sample.Tick < 0 || sample.Items < 0 || sample.QueuedItems < 0 {
			return fmt.Errorf("invalid traffic sample")
		}
		if i > 0 && sample.Tick != s.Samples[i-1].Tick+1 {
			return fmt.Errorf("traffic samples must be consecutive")
		}
		total += sample.Items
	}
	if total != s.WindowItems || int64(total) > s.TotalItems {
		return fmt.Errorf("traffic window count mismatch")
	}
	rate := 0.0
	if len(s.Samples) > 0 {
		rate = float64(total) / float64(len(s.Samples))
		if s.Samples[len(s.Samples)-1].Tick != s.LastSampleTick {
			return fmt.Errorf("traffic sample tick mismatch")
		}
	}
	if math.IsNaN(s.ItemsPerTick) || math.IsInf(s.ItemsPerTick, 0) || s.ItemsPerTick != rate {
		return fmt.Errorf("traffic rate mismatch")
	}
	if s.AlertActive && (!s.AlertsEnabled || s.SampleCount < s.WindowTicks || (s.State != "blocked" && s.State != "low_flow")) {
		return fmt.Errorf("invalid active traffic alert")
	}
	if s.TargetBeltID == "" && (s.State != "unconfigured" || len(s.Samples) > 0 || s.TotalItems != 0) {
		return fmt.Errorf("unbound monitor contains samples")
	}
	return nil
}

func IsTrafficMonitorBelt(b *Building) bool {
	if b == nil || b.Conveyor == nil {
		return false
	}
	switch b.Type {
	case BuildingTypeConveyorBeltMk1, BuildingTypeConveyorBeltMk2, BuildingTypeConveyorBeltMk3:
		return true
	default:
		return false
	}
}
