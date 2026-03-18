package queue

import (
	"sync"

	"siliconworld/internal/model"
)

// CommandQueue is a thread-safe queue that deduplicates by request_id
// and batches commands for per-tick processing
type CommandQueue struct {
	mu      sync.Mutex
	pending []*model.QueuedRequest
	seen    map[string]struct{} // deduplication set of request_ids
}

// New creates an empty CommandQueue
func New() *CommandQueue {
	return &CommandQueue{
		seen: make(map[string]struct{}),
	}
}

// Enqueue adds a request to the queue. Returns false if request_id is duplicate.
func (q *CommandQueue) Enqueue(req *model.QueuedRequest) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	if _, dup := q.seen[req.Request.RequestID]; dup {
		return false
	}
	q.seen[req.Request.RequestID] = struct{}{}
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

// HasSeen returns true if request_id has been processed before
func (q *CommandQueue) HasSeen(requestID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, ok := q.seen[requestID]
	return ok
}
