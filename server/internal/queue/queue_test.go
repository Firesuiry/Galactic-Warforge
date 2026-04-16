package queue_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func TestEnqueueAndDrain(t *testing.T) {
	q := queue.New()

	req := &model.QueuedRequest{
		Request:  model.CommandRequest{RequestID: "req-001"},
		PlayerID: "p1",
	}

	if !q.Enqueue(req) {
		t.Fatal("expected enqueue to succeed")
	}
	if q.Len() != 1 {
		t.Fatalf("expected len 1, got %d", q.Len())
	}

	batch := q.Drain()
	if len(batch) != 1 {
		t.Fatalf("expected 1 item in batch, got %d", len(batch))
	}
	if q.Len() != 0 {
		t.Fatal("expected queue to be empty after drain")
	}
}

func TestDeduplication(t *testing.T) {
	q := queue.New()

	req := &model.QueuedRequest{
		Request:  model.CommandRequest{RequestID: "req-dup"},
		PlayerID: "p1",
	}

	if !q.Enqueue(req) {
		t.Fatal("first enqueue should succeed")
	}
	if q.Enqueue(req) {
		t.Fatal("second enqueue with same request_id should be rejected")
	}
	if q.Len() != 1 {
		t.Fatalf("expected 1 item, got %d", q.Len())
	}
}

func TestHasSeen(t *testing.T) {
	q := queue.New()

	if q.HasSeen("req-x") {
		t.Fatal("queue should not have seen unseen request")
	}

	q.Enqueue(&model.QueuedRequest{
		Request:  model.CommandRequest{RequestID: "req-x"},
		PlayerID: "p1",
	})

	if !q.HasSeen("req-x") {
		t.Fatal("queue should have seen the enqueued request")
	}
}

func TestDrainEmpty(t *testing.T) {
	q := queue.New()
	batch := q.Drain()
	if batch != nil {
		t.Fatalf("expected nil batch from empty queue, got %v", batch)
	}
}

func TestPruneSeenExpiresOldRequestIDs(t *testing.T) {
	q := queue.NewWithSeenRetention(2)

	first := &model.QueuedRequest{
		Request:     model.CommandRequest{RequestID: "req-expire"},
		PlayerID:    "p1",
		EnqueueTick: 1,
	}
	if !q.Enqueue(first) {
		t.Fatal("expected first enqueue to succeed")
	}

	q.PruneSeen(4)

	if q.HasSeen("req-expire") {
		t.Fatal("expected expired request_id to be pruned")
	}

	second := &model.QueuedRequest{
		Request:     model.CommandRequest{RequestID: "req-expire"},
		PlayerID:    "p1",
		EnqueueTick: 4,
	}
	if !q.Enqueue(second) {
		t.Fatal("expected pruned request_id to be accepted again")
	}
}
