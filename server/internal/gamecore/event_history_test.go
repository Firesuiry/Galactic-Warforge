package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestEventHistoryKeepsIndependentTypeBuffers(t *testing.T) {
	history := NewEventHistory(2)
	history.Record([]*model.GameEvent{
		{EventID: "evt-1-1", Tick: 1, EventType: model.EvtCommandResult},
	})
	history.Record([]*model.GameEvent{
		{EventID: "evt-2-1", Tick: 2, EventType: model.EvtTickCompleted},
		{EventID: "evt-3-1", Tick: 3, EventType: model.EvtTickCompleted},
		{EventID: "evt-4-1", Tick: 4, EventType: model.EvtTickCompleted},
	})

	commandEvents, _, _, availableFrom := history.Snapshot([]model.EventType{model.EvtCommandResult}, "", 0, 10)
	if len(commandEvents) != 1 {
		t.Fatalf("expected command result to be retained, got %d events", len(commandEvents))
	}
	if commandEvents[0].EventID != "evt-1-1" {
		t.Fatalf("expected evt-1-1, got %s", commandEvents[0].EventID)
	}
	if availableFrom != 1 {
		t.Fatalf("expected available_from_tick=1, got %d", availableFrom)
	}

	tickEvents, _, _, tickAvailableFrom := history.Snapshot([]model.EventType{model.EvtTickCompleted}, "", 0, 10)
	if len(tickEvents) != 2 {
		t.Fatalf("expected tick buffer to keep latest 2 events, got %d", len(tickEvents))
	}
	if tickEvents[0].EventID != "evt-3-1" || tickEvents[1].EventID != "evt-4-1" {
		t.Fatalf("unexpected tick events retained: %s, %s", tickEvents[0].EventID, tickEvents[1].EventID)
	}
	if tickAvailableFrom != 3 {
		t.Fatalf("expected tick available_from_tick=3, got %d", tickAvailableFrom)
	}
}

func TestEventBusPublishesOnlySubscribedTypes(t *testing.T) {
	bus := NewEventBus()
	ch := bus.Subscribe("sub-1", []model.EventType{model.EvtCommandResult})
	defer bus.Unsubscribe("sub-1")

	bus.Publish([]*model.GameEvent{
		{EventID: "evt-1-1", Tick: 1, EventType: model.EvtTickCompleted},
		{EventID: "evt-1-2", Tick: 1, EventType: model.EvtCommandResult},
	})

	select {
	case evt := <-ch:
		if evt.EventType != model.EvtCommandResult {
			t.Fatalf("expected command_result, got %s", evt.EventType)
		}
	default:
		t.Fatal("expected subscribed event to be delivered")
	}

	select {
	case evt := <-ch:
		t.Fatalf("expected only one matching event, got %s", evt.EventType)
	default:
	}
}
