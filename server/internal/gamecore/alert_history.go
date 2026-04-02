package gamecore

import (
	"sync"

	"siliconworld/internal/model"
)

// AlertHistory stores recent production alerts for snapshot queries.
type AlertHistory struct {
	mu     sync.RWMutex
	limit  int
	alerts []*model.ProductionAlert
	index  map[string]int
}

func NewAlertHistory(limit int) *AlertHistory {
	if limit <= 0 {
		limit = 1000
	}
	return &AlertHistory{
		limit: limit,
		index: make(map[string]int),
	}
}

// Record appends alerts and enforces size limit.
func (ah *AlertHistory) Record(alerts []*model.ProductionAlert) {
	if len(alerts) == 0 {
		return
	}
	ah.mu.Lock()
	defer ah.mu.Unlock()
	for _, alert := range alerts {
		ah.alerts = append(ah.alerts, alert)
		ah.index[alert.AlertID] = len(ah.alerts) - 1
	}
	if len(ah.alerts) <= ah.limit {
		return
	}
	trim := len(ah.alerts) - ah.limit
	for i := 0; i < trim; i++ {
		delete(ah.index, ah.alerts[i].AlertID)
	}
	ah.alerts = ah.alerts[trim:]
	ah.index = make(map[string]int, len(ah.alerts))
	for i, alert := range ah.alerts {
		ah.index[alert.AlertID] = i
	}
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
	ah.index = make(map[string]int, len(ah.alerts))
	for i, alert := range ah.alerts {
		ah.index[alert.AlertID] = i
	}
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
	ah.index = make(map[string]int, len(ah.alerts))
	for i, alert := range ah.alerts {
		ah.index[alert.AlertID] = i
	}
	return removed
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
