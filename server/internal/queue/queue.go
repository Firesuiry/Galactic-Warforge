package queue

import (
	"sync"

	"siliconworld/internal/model"
)

// CommandQueue is a thread-safe queue that deduplicates by request_id
// and batches commands for per-tick processing
type CommandQueue struct {
	mu            sync.Mutex
	pending       []*model.QueuedRequest
	seen          map[string]int64 // request_id -> last enqueue tick
	seenRetention int64
}

// New creates an empty CommandQueue
func New() *CommandQueue {
	return NewWithSeenRetention(1024)
}

// NewWithSeenRetention creates a queue with explicit dedup retention measured in ticks.
func NewWithSeenRetention(retentionTicks int64) *CommandQueue {
	return &CommandQueue{
		seen:          make(map[string]int64),
		seenRetention: retentionTicks,
	}
}

// Enqueue adds a request to the queue. Returns false if request_id is duplicate.
func (q *CommandQueue) Enqueue(req *model.QueuedRequest) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	if _, dup := q.seen[req.Request.RequestID]; dup {
		return false
	}
	q.seen[req.Request.RequestID] = req.EnqueueTick
	q.pending = append(q.pending, req)
	return true
}

// Drain atomically removes and returns all pending requests for tick processing
func (q *CommandQueue) Drain() []*model.QueuedRequest {
	q.mu.Lock()
	defer q.mu.Unlock()

	batch := q.pending
	q.pending = nil
	return batch
}

// Len returns the number of pending requests
func (q *CommandQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.pending)
}

// ClearPending drops all queued requests but keeps the deduplication set.
func (q *CommandQueue) ClearPending() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.pending = nil
}

// PruneSeen drops expired request IDs from the deduplication set.
func (q *CommandQueue) PruneSeen(currentTick int64) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.pruneSeenLocked(currentTick)
}

// HasSeen returns true if request_id has been processed before
func (q *CommandQueue) HasSeen(requestID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, ok := q.seen[requestID]
	return ok
}

func (q *CommandQueue) pruneSeenLocked(currentTick int64) {
	if q.seenRetention <= 0 || currentTick <= q.seenRetention || len(q.seen) == 0 {
		return
	}
	expireBefore := currentTick - q.seenRetention
	for requestID, enqueueTick := range q.seen {
		if enqueueTick <= expireBefore {
			delete(q.seen, requestID)
		}
	}
}
