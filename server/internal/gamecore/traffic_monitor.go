package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

func recordConveyorDeparture(ws *model.WorldState, source *model.Building, quantity int) {
	if ws == nil || !model.IsTrafficMonitorBelt(source) || quantity <= 0 {
		return
	}
	ensureConveyorTraffic(ws)
	ws.ConveyorTraffic.Departed[source.ID] += quantity
}

func ensureConveyorTraffic(ws *model.WorldState) {
	if ws.ConveyorTraffic == nil || ws.ConveyorTraffic.Tick != ws.Tick {
		ws.ConveyorTraffic = &model.ConveyorTrafficSnapshot{Tick: ws.Tick, Departed: map[string]int{}, QueuedBefore: map[string]int{}}
	}
}

func trafficMonitorTarget(ws *model.WorldState, monitor *model.Building, id string) *model.Building {
	target := ws.Buildings[id]
	if !model.IsTrafficMonitorBelt(target) || target.OwnerID != monitor.OwnerID {
		return nil
	}
	for _, pos := range ws.SurfaceNeighbors(monitor.Position) {
		if pos == target.Position {
			return target
		}
	}
	return nil
}

func trafficAlertEvent(ws *model.WorldState, b *model.Building) *model.GameEvent {
	s := b.TrafficMonitor
	return &model.GameEvent{EventType: model.EvtTrafficMonitorAlert, VisibilityScope: b.OwnerID, Payload: map[string]any{"building_id": b.ID, "planet_id": ws.PlanetID, "target_belt_id": s.TargetBeltID, "state": s.State, "alert_active": s.AlertActive, "items_per_tick": s.ItemsPerTick, "minimum_items_per_tick": s.MinimumItemsPerTick, "tick": ws.Tick}}
}

func (gc *GameCore) execConfigureTrafficMonitor(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	fail := func(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
	}
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return fail(model.CodeEntityNotFound, "traffic monitor not found")
	}
	if b.OwnerID != playerID {
		return fail(model.CodeNotOwner, "cannot configure another player's traffic monitor")
	}
	if b.Type != model.BuildingTypeTrafficMonitor || b.TrafficMonitor == nil {
		return fail(model.CodeInvalidTarget, "target is not an initialized traffic monitor")
	}
	target, ok := cmd.Payload["target_belt_id"].(string)
	if !ok {
		return fail(model.CodeValidationFailed, "payload.target_belt_id must be a string")
	}
	if target != "" && trafficMonitorTarget(ws, b, target) == nil {
		return fail(model.CodeInvalidTarget, "target must be an adjacent owned conveyor belt")
	}
	window, err := payloadStrictInt(cmd.Payload, "window_ticks")
	if err != nil {
		return fail(model.CodeValidationFailed, err.Error())
	}
	raw, exists := cmd.Payload["minimum_items_per_tick"]
	if !exists {
		return fail(model.CodeValidationFailed, "payload.minimum_items_per_tick required")
	}
	switch raw.(type) {
	case float64, float32, int, int32, int64:
	default:
		return fail(model.CodeValidationFailed, "payload.minimum_items_per_tick must be numeric")
	}
	threshold, err := anyToFloat(raw)
	if err != nil {
		return fail(model.CodeValidationFailed, fmt.Sprintf("invalid minimum flow: %v", err))
	}
	alerts, ok := cmd.Payload["alerts_enabled"].(bool)
	if !ok {
		return fail(model.CodeValidationFailed, "payload.alerts_enabled must be boolean")
	}
	staged := newTrafficMonitorConfig(target, window, threshold, alerts)
	if err := staged.Validate(); err != nil {
		return fail(model.CodeValidationFailed, err.Error())
	}
	wasActive := b.TrafficMonitor.AlertActive
	b.TrafficMonitor = staged
	events := []*model.GameEvent{{EventType: model.EvtBuildingStateChanged, VisibilityScope: playerID, Payload: map[string]any{"entity_id": b.ID, "traffic_monitor": staged.Clone()}}}
	if wasActive {
		events = append(events, trafficAlertEvent(ws, b))
	}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "traffic monitor configured"}, events
}

func newTrafficMonitorConfig(target string, window int, threshold float64, alerts bool) *model.TrafficMonitorState {
	state := "sampling"
	if target == "" {
		state = "unconfigured"
	}
	return &model.TrafficMonitorState{TargetBeltID: target, WindowTicks: window, MinimumItemsPerTick: threshold, AlertsEnabled: alerts, State: state, LastSampleTick: -1}
}

func settleTrafficMonitors(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	ids := make([]string, 0)
	for id, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeTrafficMonitor {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	var events []*model.GameEvent
	for _, id := range ids {
		b := ws.Buildings[id]
		model.InitBuildingTrafficMonitor(b)
		s := b.TrafficMonitor
		previousState, previousAlert := s.State, s.AlertActive
		switch {
		case s.TargetBeltID == "":
			s.ClearWindow()
			s.State = "unconfigured"
		case b.Runtime.State != model.BuildingWorkRunning:
			s.ClearWindow()
			s.State = string(b.Runtime.State)
		default:
			target := trafficMonitorTarget(ws, b, s.TargetBeltID)
			if target == nil {
				s.ClearWindow()
				s.State = "target_missing"
			} else if !conveyorActive(target) {
				s.ClearWindow()
				s.State = "target_inactive"
			} else if s.LastSampleTick != ws.Tick {
				if s.LastSampleTick != ws.Tick-1 {
					s.ClearWindow()
				}
				departed := 0
				if ws.ConveyorTraffic != nil && ws.ConveyorTraffic.Tick == ws.Tick {
					departed = ws.ConveyorTraffic.Departed[target.ID]
				}
				queued := target.Conveyor.TotalItems()
				if ws.ConveyorTraffic != nil && ws.ConveyorTraffic.Tick == ws.Tick {
					if before, ok := ws.ConveyorTraffic.QueuedBefore[target.ID]; ok {
						queued = before
					}
				}
				s.Samples = append(s.Samples, model.TrafficSample{Tick: ws.Tick, Items: departed, QueuedItems: queued})
				if len(s.Samples) > s.WindowTicks {
					s.Samples = s.Samples[len(s.Samples)-s.WindowTicks:]
				}
				s.SampleCount = len(s.Samples)
				s.WindowItems = 0
				allQueued := true
				for _, sample := range s.Samples {
					s.WindowItems += sample.Items
					allQueued = allQueued && sample.QueuedItems > 0
				}
				s.ItemsPerTick = float64(s.WindowItems) / float64(s.SampleCount)
				s.TotalItems += int64(departed)
				s.LastSampleTick = ws.Tick
				switch {
				case s.SampleCount < s.WindowTicks:
					s.State = "sampling"
				case s.WindowItems == 0 && allQueued:
					s.State = "blocked"
				case s.ItemsPerTick < s.MinimumItemsPerTick:
					s.State = "low_flow"
				case s.WindowItems == 0:
					s.State = "idle"
				default:
					s.State = "flowing"
				}
				s.AlertActive = s.AlertsEnabled && (s.State == "low_flow" || s.State == "blocked")
			}
		}
		if previousAlert != s.AlertActive || s.AlertActive && previousState != s.State {
			events = append(events, trafficAlertEvent(ws, b))
		}
	}
	return events
}
