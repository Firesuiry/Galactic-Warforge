package gamecore

import (
	"sync"

	"siliconworld/internal/model"
)

// AlertHistory stores recent production alerts for snapshot queries.
// Alerts sharing the same (building, alert type) pair are aggregated into a
// single entry: repeats bump RepeatCount and LastTick instead of appending
// new entries, so a persistent condition cannot flood the alert panel.
type AlertHistory struct {
	mu     sync.RWMutex
	limit  int
	alerts []*model.ProductionAlert
	index  map[string]int
	keys   map[string]int
}

func NewAlertHistory(limit int) *AlertHistory {
	if limit <= 0 {
		limit = 1000
	}
	return &AlertHistory{
		limit: limit,
		index: make(map[string]int),
		keys:  make(map[string]int),
	}
}

// alertAggregationKey identifies the stream an alert belongs to.
func alertAggregationKey(alert *model.ProductionAlert) string {
	return string(alert.AlertType) + "|" + alert.BuildingID
}

// Record appends alerts and enforces size limit. Repeats of an already
// recorded (building, alert type) pair update the existing entry in place.
func (ah *AlertHistory) Record(alerts []*model.ProductionAlert) {
	if len(alerts) == 0 {
		return
	}
	ah.mu.Lock()
	defer ah.mu.Unlock()
	for _, alert := range alerts {
		if alert == nil {
			continue
		}
		key := alertAggregationKey(alert)
		if pos, ok := ah.keys[key]; ok {
			existing := ah.alerts[pos]
			existing.RepeatCount++
			existing.LastTick = alert.Tick
			existing.Severity = alert.Severity
			existing.Metrics = alert.Metrics
			existing.Details = alert.Details
			continue
		}
		ah.alerts = append(ah.alerts, alert)
		pos := len(ah.alerts) - 1
		ah.index[alert.AlertID] = pos
		ah.keys[key] = pos
	}
	if len(ah.alerts) <= ah.limit {
		return
	}
	trim := len(ah.alerts) - ah.limit
	ah.alerts = ah.alerts[trim:]
	ah.rebuildIndex()
}

func (ah *AlertHistory) All() []*model.ProductionAlert {
	ah.mu.RLock()
	defer ah.mu.RUnlock()
	return cloneAlerts(ah.alerts)
}

func (ah *AlertHistory) ReplaceAll(alerts []*model.ProductionAlert) {
	ah.mu.Lock()
	defer ah.mu.Unlock()
	ah.alerts = cloneAlerts(alerts)
	if len(ah.alerts) > ah.limit {
		ah.alerts = ah.alerts[len(ah.alerts)-ah.limit:]
	}
	ah.rebuildIndex()
}

// Snapshot returns alerts after a given alert ID or since a tick.
func (ah *AlertHistory) Snapshot(afterAlertID string, sinceTick int64, limit int) ([]*model.ProductionAlert, string, bool, int64) {
	ah.mu.RLock()
	defer ah.mu.RUnlock()

	if limit <= 0 {
		limit = len(ah.alerts)
	}
	availableFrom := int64(0)
	if len(ah.alerts) > 0 {
		availableFrom = ah.alerts[0].Tick
	}
	start := 0
	useTickFallback := true
	if afterAlertID != "" {
		if idx, ok := ah.index[afterAlertID]; ok {
			start = idx + 1
			useTickFallback = false
		}
	}
	if useTickFallback && sinceTick > 0 {
		found := false
		for i, alert := range ah.alerts {
			if alert.Tick >= sinceTick {
				start = i
				found = true
				break
			}
		}
		if !found {
			start = len(ah.alerts)
		}
	}
	if start >= len(ah.alerts) {
		return nil, "", false, availableFrom
	}
	end := start + limit
	if end > len(ah.alerts) {
		end = len(ah.alerts)
	}
	result := append([]*model.ProductionAlert(nil), ah.alerts[start:end]...)
	nextID := ""
	if len(result) > 0 {
		nextID = result[len(result)-1].AlertID
	}
	hasMore := end < len(ah.alerts)
	return result, nextID, hasMore, availableFrom
}

// TrimAfterTick removes alerts with tick greater than target tick.
func (ah *AlertHistory) TrimAfterTick(tick int64) int {
	ah.mu.Lock()
	defer ah.mu.Unlock()
	if len(ah.alerts) == 0 {
		return 0
	}
	keep := len(ah.alerts)
	for keep > 0 && ah.alerts[keep-1].Tick > tick {
		keep--
	}
	if keep == len(ah.alerts) {
		return 0
	}
	removed := len(ah.alerts) - keep
	ah.alerts = ah.alerts[:keep]
	ah.rebuildIndex()
	return removed
}

// rebuildIndex recomputes the alert id and aggregation key indexes.
// Callers must hold the write lock.
func (ah *AlertHistory) rebuildIndex() {
	ah.index = make(map[string]int, len(ah.alerts))
	ah.keys = make(map[string]int, len(ah.alerts))
	for i, alert := range ah.alerts {
		if alert == nil {
			continue
		}
		ah.index[alert.AlertID] = i
		ah.keys[alertAggregationKey(alert)] = i
	}
}

func cloneAlerts(alerts []*model.ProductionAlert) []*model.ProductionAlert {
	if len(alerts) == 0 {
		return nil
	}
	out := make([]*model.ProductionAlert, 0, len(alerts))
	for _, alert := range alerts {
		if alert == nil {
			continue
		}
		cp := *alert
		out = append(out, &cp)
	}
	return out
}
