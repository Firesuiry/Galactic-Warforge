package gamecore

import (
	"sync"

	"siliconworld/internal/model"
)

// EventHistory stores recent game events for snapshot queries.
type EventHistory struct {
	mu     sync.RWMutex
	limit  int
	events []*model.GameEvent
	index  map[string]int
}

func NewEventHistory(limit int) *EventHistory {
	if limit <= 0 {
		limit = 2000
	}
	return &EventHistory{
		limit: limit,
		index: make(map[string]int),
	}
}

// Record appends events to the history and enforces the size limit.
func (eh *EventHistory) Record(events []*model.GameEvent) {
	if len(events) == 0 {
		return
	}
	eh.mu.Lock()
	defer eh.mu.Unlock()

	for _, evt := range events {
		eh.events = append(eh.events, evt)
		eh.index[evt.EventID] = len(eh.events) - 1
	}

	if len(eh.events) <= eh.limit {
		return
	}

	trim := len(eh.events) - eh.limit
	for i := 0; i < trim; i++ {
		delete(eh.index, eh.events[i].EventID)
	}
	eh.events = eh.events[trim:]

	eh.index = make(map[string]int, len(eh.events))
	for i, evt := range eh.events {
		eh.index[evt.EventID] = i
	}
}

// Snapshot returns a slice of events after a given event ID or since a tick.
// The returned events are ordered and capped by limit.
func (eh *EventHistory) Snapshot(afterEventID string, sinceTick int64, limit int) ([]*model.GameEvent, string, bool, int64) {
	eh.mu.RLock()
	defer eh.mu.RUnlock()

	if limit <= 0 {
		limit = len(eh.events)
	}

	availableFrom := int64(0)
	if len(eh.events) > 0 {
		availableFrom = eh.events[0].Tick
	}

	start := 0
	useTickFallback := true
	if afterEventID != "" {
		if idx, ok := eh.index[afterEventID]; ok {
			start = idx + 1
			useTickFallback = false
		}
	}
	if useTickFallback && sinceTick > 0 {
		found := false
		for i, evt := range eh.events {
			if evt.Tick >= sinceTick {
				start = i
				found = true
				break
			}
		}
		if !found {
			start = len(eh.events)
		}
	}

	if start >= len(eh.events) {
		return nil, "", false, availableFrom
	}

	end := start + limit
	if end > len(eh.events) {
		end = len(eh.events)
	}

	result := append([]*model.GameEvent(nil), eh.events[start:end]...)
	nextEventID := ""
	if len(result) > 0 {
		nextEventID = result[len(result)-1].EventID
	}
	hasMore := end < len(eh.events)
	return result, nextEventID, hasMore, availableFrom
}

// TrimAfterTick removes events with tick greater than the target tick.
func (eh *EventHistory) TrimAfterTick(tick int64) int {
	eh.mu.Lock()
	defer eh.mu.Unlock()
	if len(eh.events) == 0 {
		return 0
	}
	keep := len(eh.events)
	for keep > 0 && eh.events[keep-1].Tick > tick {
		keep--
	}
	if keep == len(eh.events) {
		return 0
	}
	removed := len(eh.events) - keep
	eh.events = eh.events[:keep]
	eh.index = make(map[string]int, len(eh.events))
	for i, evt := range eh.events {
		eh.index[evt.EventID] = i
	}
	return removed
}
