package gamecore

import (
	"sort"
	"strconv"
	"strings"
	"sync"

	"siliconworld/internal/model"
)

// EventHistory stores recent game events for snapshot queries.
// Each event type keeps an independent ring buffer so high-frequency
// telemetry does not evict actionable events such as command results.
type EventHistory struct {
	mu     sync.RWMutex
	limit  int
	events map[model.EventType][]*model.GameEvent
}

func NewEventHistory(limit int) *EventHistory {
	if limit <= 0 {
		limit = 2000
	}
	return &EventHistory{
		limit:  limit,
		events: make(map[model.EventType][]*model.GameEvent),
	}
}

// Record appends events to per-type history and enforces the per-type size limit.
func (eh *EventHistory) Record(events []*model.GameEvent) {
	if len(events) == 0 {
		return
	}
	eh.mu.Lock()
	defer eh.mu.Unlock()

	for _, evt := range events {
		if evt == nil {
			continue
		}
		bucket := append(eh.events[evt.EventType], evt)
		if len(bucket) > eh.limit {
			bucket = append([]*model.GameEvent(nil), bucket[len(bucket)-eh.limit:]...)
		}
		eh.events[evt.EventType] = bucket
	}
}

// Snapshot returns events after a given event ID or since a tick.
// The returned events are ordered and capped by limit.
func (eh *EventHistory) Snapshot(eventTypes []model.EventType, afterEventID string, sinceTick int64, limit int) ([]*model.GameEvent, string, bool, int64) {
	eh.mu.RLock()
	defer eh.mu.RUnlock()

	if limit <= 0 {
		limit = eh.limit
	}

	merged := eh.collectLocked(eventTypes)
	if len(merged) == 0 {
		return nil, "", false, 0
	}

	sort.Slice(merged, func(i, j int) bool {
		return eventBefore(merged[i], merged[j])
	})

	availableFrom := merged[0].Tick
	start := 0
	useTickFallback := true
	if afterEventID != "" {
		for i, evt := range merged {
			if evt.EventID == afterEventID {
				start = i + 1
				useTickFallback = false
				break
			}
		}
	}
	if useTickFallback && sinceTick > 0 {
		start = len(merged)
		for i, evt := range merged {
			if evt.Tick >= sinceTick {
				start = i
				break
			}
		}
	}

	if start >= len(merged) {
		return nil, "", false, availableFrom
	}

	end := start + limit
	if end > len(merged) {
		end = len(merged)
	}

	result := append([]*model.GameEvent(nil), merged[start:end]...)
	nextEventID := ""
	if len(result) > 0 {
		nextEventID = result[len(result)-1].EventID
	}
	hasMore := end < len(merged)
	return result, nextEventID, hasMore, availableFrom
}

// TrimAfterTick removes events with tick greater than the target tick.
func (eh *EventHistory) TrimAfterTick(tick int64) int {
	eh.mu.Lock()
	defer eh.mu.Unlock()

	removed := 0
	for eventType, bucket := range eh.events {
		keep := len(bucket)
		for keep > 0 && bucket[keep-1].Tick > tick {
			keep--
		}
		if keep == len(bucket) {
			continue
		}
		removed += len(bucket) - keep
		if keep == 0 {
			delete(eh.events, eventType)
			continue
		}
		eh.events[eventType] = append([]*model.GameEvent(nil), bucket[:keep]...)
	}
	return removed
}

func (eh *EventHistory) Export() map[model.EventType][]*model.GameEvent {
	eh.mu.RLock()
	defer eh.mu.RUnlock()
	out := make(map[model.EventType][]*model.GameEvent, len(eh.events))
	for eventType, bucket := range eh.events {
		out[eventType] = cloneGameEvents(bucket)
	}
	return out
}

func (eh *EventHistory) ReplaceAll(events map[model.EventType][]*model.GameEvent) {
	eh.mu.Lock()
	defer eh.mu.Unlock()
	eh.events = make(map[model.EventType][]*model.GameEvent, len(events))
	for eventType, bucket := range events {
		b := cloneGameEvents(bucket)
		if len(b) > eh.limit {
			b = b[len(b)-eh.limit:]
		}
		eh.events[eventType] = b
	}
}

func (eh *EventHistory) collectLocked(eventTypes []model.EventType) []*model.GameEvent {
	merged := make([]*model.GameEvent, 0)
	for _, eventType := range eventTypes {
		merged = append(merged, eh.events[eventType]...)
	}
	return merged
}

func cloneGameEvents(events []*model.GameEvent) []*model.GameEvent {
	if len(events) == 0 {
		return nil
	}
	out := make([]*model.GameEvent, 0, len(events))
	for _, evt := range events {
		if evt == nil {
			continue
		}
		cp := *evt
		out = append(out, &cp)
	}
	return out
}

func eventBefore(a, b *model.GameEvent) bool {
	if a == nil || b == nil {
		return a != nil
	}
	if a.Tick != b.Tick {
		return a.Tick < b.Tick
	}
	return eventSequence(a) < eventSequence(b)
}

func eventSequence(evt *model.GameEvent) int64 {
	if evt == nil {
		return 0
	}
	parts := strings.Split(evt.EventID, "-")
	if len(parts) < 3 {
		return 0
	}
	if parts[2] == "tick" {
		return 1<<62 - 1
	}
	seq, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		return 0
	}
	return seq
}
