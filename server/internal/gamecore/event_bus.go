package gamecore

import (
	"sync"
	"sync/atomic"

	"siliconworld/internal/model"
)

// EventBus broadcasts game events to all subscribers
type EventBus struct {
	mu           sync.RWMutex
	subscribers  map[string]*eventSubscriber // key: subscriber ID
	droppedCount atomic.Uint64
}

type eventSubscriber struct {
	ch          chan *model.GameEvent
	eventFilter map[model.EventType]struct{}
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string]*eventSubscriber),
	}
}

func (eb *EventBus) Subscribe(id string, eventTypes []model.EventType) chan *model.GameEvent {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	ch := make(chan *model.GameEvent, 256)
	eb.subscribers[id] = &eventSubscriber{
		ch:          ch,
		eventFilter: buildEventFilterSet(eventTypes),
	}
	return ch
}

func (eb *EventBus) Unsubscribe(id string) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	if sub, ok := eb.subscribers[id]; ok {
		close(sub.ch)
		delete(eb.subscribers, id)
	}
}

func (eb *EventBus) SubscriberCount() int {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	return len(eb.subscribers)
}

func (eb *EventBus) Publish(events []*model.GameEvent) {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	for _, evt := range events {
		for _, sub := range eb.subscribers {
			if !matchesEventFilter(evt, sub.eventFilter) {
				continue
			}
			select {
			case sub.ch <- evt:
			default:
				eb.droppedCount.Add(1)
			}
		}
	}
}

func (eb *EventBus) DroppedCount() uint64 {
	if eb == nil {
		return 0
	}
	return eb.droppedCount.Load()
}

// CloseAll closes and removes every subscriber channel (F1: hot reset tears down
// the old session's bus so SSE consumers of the previous game disconnect).
func (eb *EventBus) CloseAll() {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	for id, sub := range eb.subscribers {
		close(sub.ch)
		delete(eb.subscribers, id)
	}
}

func buildEventFilterSet(eventTypes []model.EventType) map[model.EventType]struct{} {
	if len(eventTypes) == 0 {
		return nil
	}
	filter := make(map[model.EventType]struct{}, len(eventTypes))
	for _, eventType := range eventTypes {
		filter[eventType] = struct{}{}
	}
	return filter
}

func matchesEventFilter(evt *model.GameEvent, filter map[model.EventType]struct{}) bool {
	if evt == nil || len(filter) == 0 {
		return true
	}
	_, ok := filter[evt.EventType]
	return ok
}

// eventSlicePool pools event slices to reduce allocations
var eventSlicePool = sync.Pool{
	New: func() any {
		return make([]*model.GameEvent, 0, 64)
	},
}

// GetEventSlice gets a pooled event slice
func GetEventSlice() []*model.GameEvent {
	return eventSlicePool.Get().([]*model.GameEvent)
}

// PutEventSlice returns an event slice to the pool
func PutEventSlice(es []*model.GameEvent) {
	if cap(es) >= 64 { // Only pool reasonably sized slices
		eventSlicePool.Put(es[:0])
	}
}
