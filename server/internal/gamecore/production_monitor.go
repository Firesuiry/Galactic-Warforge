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

// alertResolution 标记「某建筑某类告警在本 tick 解除」，由 GameCore 写回告警
// 历史（AlertHistory.Resolve），让快照里的条目 active=false。
type alertResolution struct {
	playerID   string
	buildingID string
	alertType  model.ProductionAlertType
	tick       int64
}

// monitorAlert 是 model.ProductionMonitorState.Alert 的包装：返回是否发告警、
// 以及本次是否「由持续中转为解除」（此前 ActiveAlerts 里为 true，调用后为 false）。
func monitorAlert(state *model.ProductionMonitorState, alertType model.ProductionAlertType, condition bool, tick, cooldown int64) (fired, resolved bool) {
	if state == nil {
		return false, false
	}
	wasActive := state.ActiveAlerts[alertType]
	fired, active := state.Alert(alertType, condition, tick, cooldown)
	return fired, wasActive && !active
}

// settleProductionMonitoring samples production and collection buildings and generates alerts.
// 第二个返回值是新告警（写历史），第三个是已解除的告警（把历史条目标记为 inactive）。
func (pm *productionMonitor) settleProductionMonitoring(ws *model.WorldState, currentTick int64) ([]*model.GameEvent, []*model.ProductionAlert, []alertResolution) {
	if ws == nil || pm == nil {
		return nil, nil, nil
	}
	interval := pm.sampleInterval()
	if interval <= 0 || currentTick%interval != 0 {
		return nil, nil, nil
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return nil, nil, nil
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
	var resolved []alertResolution

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
		// Research-mode labs (Research module + empty recipe) are a legal idle
		// state for matrix_lab / self_evolution_lab. They share Production
		// throughput stats but must not raise factory-line shortage/drop alerts.
		researchMode := isResearchLab(building)
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
			// Collectors and research-mode labs do not produce factory outputs
			// that need conveyor drainage; skip output blockage for research mode.
			outputBlocked = !researchMode && storageOutputBlocked(building.Storage, production == nil)
		}
		if building.Conveyor != nil {
			moved = building.Conveyor.Throughput
		}
		efficiency := 0.0
		if throughput > 0 {
			efficiency = float64(moved) / float64(throughput)
		}
		if !researchMode && production != nil && throughput > 0 && building.Storage != nil && backlog <= 0 && efficiency < pm.cfg.ShortageRatio {
			inputShortage = true
		}

		idle := building.Runtime.State != model.BuildingWorkRunning
		powerState := string(building.Runtime.State)
		if building.ProductionMonitor == nil {
			building.ProductionMonitor = model.NewProductionMonitorState()
		}
		building.ProductionMonitor.RegisterSample(currentTick, moved, backlog, throughput, idle, inputShortage, outputBlocked, powerState)
		// 产出阻塞的 runtime 原因：有配方的生产建筑在 settleProduction 里写（那里能看到
		// 整批产出落不下的瞬间）；这里补采掘类（无配方，产出无处可放时 state 会掉成 idle）
		// 以及本 tick 没跑到 settleProduction 的情况。running 的 reason 交给
		// settleProduction 管理，避免在这里把 input_shortage 之类的原因写串。
		if outputBlocked && building.Runtime.State != model.BuildingWorkRunning {
			if evt := setBuildingStateReason(building, stateReasonOutputBlocked); evt != nil {
				events = append(events, evt)
			}
		} else if !outputBlocked && building.Runtime.StateReason == stateReasonOutputBlocked && building.Runtime.State != model.BuildingWorkRunning {
			if evt := setBuildingStateReason(building, ""); evt != nil {
				events = append(events, evt)
			}
		}

		newAlerts, newResolutions := pm.evaluateAlerts(building, currentTick, backlog, throughput, inputShortage, outputBlocked)
		resolved = append(resolved, newResolutions...)
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
	return events, alerts, resolved
}

// storageOutputBlocked reports whether produced items can no longer leave the
// building. 产出的落点是「输出缓冲 → 主库存」（见 model.StorageState.StoreProduct /
// StoreCollectorProduct）：两处都放不下才算真的阻塞，与 storeProductionOutputs
// 同一口径。生产建筑的主库存落货只用「产出预留」那一段空位，采集建筑没有配方、
// 预留为 0，主库存全段可用（也正因如此，它们的「满仓阻塞」判定与生产建筑一致）。
func storageOutputBlocked(storage *model.StorageState, collector bool) bool {
	if storage == nil || storage.OutputBufferCapacity() <= 0 {
		return false
	}
	if storage.UsedOutputBuffer() < storage.OutputBufferCapacity() {
		return false
	}
	if collector {
		return storage.Capacity > 0 && storage.UsedInventory() >= storage.Capacity
	}
	return storage.ReservedSpace() <= 0
}

// evaluateAlerts 评估本建筑的全部告警类型：返回新告警与本次解除的告警。
// 每类告警都要走一遍 Alert（即便条件为 false），解除状态才会被看到并写回历史。
func (pm *productionMonitor) evaluateAlerts(building *model.Building, tick int64, backlog, throughput int, inputShortage, outputBlocked bool) ([]*model.ProductionAlert, []alertResolution) {
	if pm == nil || building == nil || building.ProductionMonitor == nil {
		return nil, nil
	}
	var alerts []*model.ProductionAlert
	var resolved []alertResolution
	state := building.ProductionMonitor
	cooldown := pm.cooldownTicks()
	// 统一处理「发告警 / 解除」：解除时把历史条目标记为 inactive（试玩 1016
	// 报告问题 2——旧实现只清 ActiveAlerts，快照里的条目永远挂着）。
	track := func(alertType model.ProductionAlertType, condition bool, build func() *model.ProductionAlert) {
		fired, cleared := monitorAlert(state, alertType, condition, tick, cooldown)
		if cleared {
			resolved = append(resolved, alertResolution{playerID: building.OwnerID, buildingID: building.ID, alertType: alertType, tick: tick})
		}
		if fired {
			alerts = append(alerts, build())
		}
	}
	// Collectors have no recipe inputs, so only power and output blockage apply.
	collector := building.Runtime.Functions.Production == nil
	// Research-mode labs (empty recipe) are idle research stations, not factories.
	researchMode := isResearchLab(building)
	// Factory-line throughput metrics only apply to true production buildings.
	lineAlerts := !collector && !researchMode

	track(model.AlertTypePowerShortage, building.Runtime.State == model.BuildingWorkNoPower, func() *model.ProductionAlert {
		details := map[string]any{"power_priority": building.Runtime.Params.PowerPriority}
		return pm.buildAlert(building, tick, model.AlertTypePowerShortage, model.AlertSeverityWarning, state.LastStats, details)
	})

	backlogRatio := 0.0
	if throughput > 0 {
		backlogRatio = float64(backlog) / float64(throughput)
	}
	backlogWarn := lineAlerts && throughput > 0 && backlogRatio >= pm.cfg.BacklogWarnRatio
	track(model.AlertTypeBacklog, backlogWarn, func() *model.ProductionAlert {
		severity := model.AlertSeverityWarning
		if backlogRatio >= pm.cfg.BacklogCriticalRatio {
			severity = model.AlertSeverityCritical
		}
		return pm.buildAlert(building, tick, model.AlertTypeBacklog, severity, state.LastStats, map[string]any{"backlog_ratio": backlogRatio})
	})

	track(model.AlertTypeInputShortage, lineAlerts && inputShortage, func() *model.ProductionAlert {
		return pm.buildAlert(building, tick, model.AlertTypeInputShortage, model.AlertSeverityWarning, state.LastStats, nil)
	})

	track(model.AlertTypeOutputBlocked, outputBlocked, func() *model.ProductionAlert {
		return pm.buildAlert(building, tick, model.AlertTypeOutputBlocked, model.AlertSeverityWarning, state.LastStats, nil)
	})

	eff := state.LastStats.Efficiency
	track(model.AlertTypeThroughputDrop, lineAlerts && throughput > 0 && eff < pm.cfg.EfficiencyWarnRatio, func() *model.ProductionAlert {
		return pm.buildAlert(building, tick, model.AlertTypeThroughputDrop, model.AlertSeverityWarning, state.LastStats, map[string]any{"efficiency": eff})
	})

	return alerts, resolved
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
		Active:       true,
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
