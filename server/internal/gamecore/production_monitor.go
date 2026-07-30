package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/config"
	"siliconworld/internal/model"
)

type productionMonitor struct {
	cfg     config.ProductionMonitorConfig
	nextIdx int
}

func newProductionMonitor(cfg config.ProductionMonitorConfig) *productionMonitor {
	return &productionMonitor{cfg: cfg}
}

func (pm *productionMonitor) sampleInterval() int64 {
	if pm == nil || pm.cfg.SampleIntervalTicks <= 0 {
		return 5
	}
	return pm.cfg.SampleIntervalTicks
}

func (pm *productionMonitor) maxEntities() int {
	if pm == nil || pm.cfg.MaxEntitiesPerSample <= 0 {
		return 500
	}
	return pm.cfg.MaxEntitiesPerSample
}

func (pm *productionMonitor) cooldownTicks() int64 {
	if pm == nil || pm.cfg.AlertCooldownTicks <= 0 {
		return 20
	}
	return pm.cfg.AlertCooldownTicks
}

// settleProductionMonitoring samples production and collection buildings and generates alerts.
func (pm *productionMonitor) settleProductionMonitoring(ws *model.WorldState, currentTick int64) ([]*model.GameEvent, []*model.ProductionAlert) {
	if ws == nil || pm == nil {
		return nil, nil
	}
	interval := pm.sampleInterval()
	if interval <= 0 || currentTick%interval != 0 {
		return nil, nil
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return nil, nil
	}

	maxEntities := pm.maxEntities()
	if maxEntities > len(ids) {
		maxEntities = len(ids)
	}
	start := pm.nextIdx
	if start < 0 || start >= len(ids) {
		start = 0
	}

	var events []*model.GameEvent
	var alerts []*model.ProductionAlert

	for i := 0; i < maxEntities; i++ {
		idx := (start + i) % len(ids)
		building := ws.Buildings[ids[idx]]
		if building == nil {
			continue
		}
		production := building.Runtime.Functions.Production
		collect := building.Runtime.Functions.Collect
		if production == nil && collect == nil {
			continue
		}
		player := ws.Players[building.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}
		throughput := 0
		if production != nil {
			throughput = production.Throughput
		} else {
			throughput = collect.YieldPerTick
		}
		backlog := 0
		inputShortage := false
		outputBlocked := false
		moved := 0
		if building.Storage != nil {
			backlog = building.Storage.UsedInputBuffer()
			outputBlocked = storageOutputBlocked(building.Storage, production == nil)
		}
		if building.Conveyor != nil {
			moved = building.Conveyor.Throughput
		}
		efficiency := 0.0
		if throughput > 0 {
			efficiency = float64(moved) / float64(throughput)
		}
		if production != nil && throughput > 0 && building.Storage != nil && backlog <= 0 && efficiency < pm.cfg.ShortageRatio {
			inputShortage = true
		}

		idle := building.Runtime.State != model.BuildingWorkRunning
		powerState := string(building.Runtime.State)
		if building.ProductionMonitor == nil {
			building.ProductionMonitor = model.NewProductionMonitorState()
		}
		building.ProductionMonitor.RegisterSample(currentTick, moved, backlog, throughput, idle, inputShortage, outputBlocked, powerState)

		newAlerts := pm.evaluateAlerts(building, currentTick, backlog, throughput, inputShortage, outputBlocked)
		if len(newAlerts) == 0 {
			continue
		}
		for _, alert := range newAlerts {
			alerts = append(alerts, alert)
			events = append(events, &model.GameEvent{
				EventType:       model.EvtProductionAlert,
				VisibilityScope: building.OwnerID,
				Payload: map[string]any{
					"alert": alert,
				},
			})
		}
	}

	pm.nextIdx = (start + maxEntities) % len(ids)
	return events, alerts
}

// storageOutputBlocked reports whether produced items can no longer leave the
// building. Collectors only stall once their main inventory is also full,
// since their output buffer refills from inventory every tick.
func storageOutputBlocked(storage *model.StorageState, collector bool) bool {
	if storage == nil || storage.OutputBufferCapacity() <= 0 {
		return false
	}
	if storage.UsedOutputBuffer() < storage.OutputBufferCapacity() {
		return false
	}
	if !collector {
		return true
	}
	return storage.Capacity > 0 && storage.UsedInventory() >= storage.Capacity
}

func (pm *productionMonitor) evaluateAlerts(building *model.Building, tick int64, backlog, throughput int, inputShortage, outputBlocked bool) []*model.ProductionAlert {
	if pm == nil || building == nil || building.ProductionMonitor == nil {
		return nil
	}
	var alerts []*model.ProductionAlert
	state := building.ProductionMonitor
	cooldown := pm.cooldownTicks()
	// Collectors have no recipe inputs, so only power and output blockage apply.
	collector := building.Runtime.Functions.Production == nil

	if building.Runtime.State == model.BuildingWorkNoPower && state.ShouldAlert(model.AlertTypePowerShortage, tick, cooldown) {
		details := map[string]any{"power_priority": building.Runtime.Params.PowerPriority}
		alerts = append(alerts, pm.buildAlert(building, tick, model.AlertTypePowerShortage, model.AlertSeverityWarning, state.LastStats, details))
		state.MarkAlert(model.AlertTypePowerShortage, tick)
	}

	if !collector && throughput > 0 {
		ratio := float64(backlog) / float64(throughput)
		if ratio >= pm.cfg.BacklogCriticalRatio && state.ShouldAlert(model.AlertTypeBacklog, tick, cooldown) {
			details := map[string]any{"backlog_ratio": ratio}
			alerts = append(alerts, pm.buildAlert(building, tick, model.AlertTypeBacklog, model.AlertSeverityCritical, state.LastStats, details))
			state.MarkAlert(model.AlertTypeBacklog, tick)
		} else if ratio >= pm.cfg.BacklogWarnRatio && state.ShouldAlert(model.AlertTypeBacklog, tick, cooldown) {
			details := map[string]any{"backlog_ratio": ratio}
			alerts = append(alerts, pm.buildAlert(building, tick, model.AlertTypeBacklog, model.AlertSeverityWarning, state.LastStats, details))
			state.MarkAlert(model.AlertTypeBacklog, tick)
		}
	}

	if !collector && inputShortage && state.ShouldAlert(model.AlertTypeInputShortage, tick, cooldown) {
		alerts = append(alerts, pm.buildAlert(building, tick, model.AlertTypeInputShortage, model.AlertSeverityWarning, state.LastStats, nil))
		state.MarkAlert(model.AlertTypeInputShortage, tick)
	}

	if outputBlocked && state.ShouldAlert(model.AlertTypeOutputBlocked, tick, cooldown) {
		alerts = append(alerts, pm.buildAlert(building, tick, model.AlertTypeOutputBlocked, model.AlertSeverityWarning, state.LastStats, nil))
		state.MarkAlert(model.AlertTypeOutputBlocked, tick)
	}

	eff := state.LastStats.Efficiency
	if !collector && throughput > 0 && eff < pm.cfg.EfficiencyWarnRatio && state.ShouldAlert(model.AlertTypeThroughputDrop, tick, cooldown) {
		details := map[string]any{"efficiency": eff}
		alerts = append(alerts, pm.buildAlert(building, tick, model.AlertTypeThroughputDrop, model.AlertSeverityWarning, state.LastStats, details))
		state.MarkAlert(model.AlertTypeThroughputDrop, tick)
	}

	return alerts
}

func (pm *productionMonitor) buildAlert(
	building *model.Building,
	tick int64,
	alertType model.ProductionAlertType,
	severity model.ProductionAlertSeverity,
	stats model.MonitorStats,
	details map[string]any,
) *model.ProductionAlert {
	alertID := fmt.Sprintf("alert-%d-%s-%s", tick, building.ID, alertType)
	return &model.ProductionAlert{
		AlertID:      alertID,
		Tick:         tick,
		PlayerID:     building.OwnerID,
		BuildingID:   building.ID,
		BuildingType: building.Type,
		AlertType:    alertType,
		Severity:     severity,
		Message:      model.AlertMessage(alertType, building.ID),
		Metrics:      stats,
		Details:      details,
	}
}
