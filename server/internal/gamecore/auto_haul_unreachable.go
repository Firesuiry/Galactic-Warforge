package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// 自动模式运输机器人的「到不了」处理（试玩 1016 报告问题 3）。
//
// 机器人被派往某座建筑，但该建筑占地外圈没有可站立落点、或落点没有可达路径时，
// 原实现只是切到 waiting_* 阶段每 10 tick 重试——落点根本不存在时就成了永久
// 空转（u-184 在 (53,139) 卡了 4200 tick，目标熔炉外圈被三台熔炉 + 分拣器 +
// 传送带围死）。现在：
//   - 连续 haulUnreachableAttempts 次（或首次失败后超过 haulUnreachableTicks）
//     仍然规划不出路径 → 放弃这一单：释放认领、清空路线；
//   - 给该建筑记一条「本机器人冷却」（haulUnreachableCooldownTicks），冷却期内
//     派单跳过它，机器人去服务别的需求；
//   - 车上的货不丢：按 §2.1 收尾规则改送别的缺料建筑 / 最近仓储；
//   - 给该建筑发一条 haul_unreachable 告警（同一建筑只发一次），机器人重新
//     到达该建筑时解除。
//
// route（固定路线）模式不受影响：玩家自己写的路线走不通时仍原地等待。

const (
	// haulUnreachableAttempts 连续多少次「找不到落点/路径」后放弃这一单。
	haulUnreachableAttempts = 3
	// haulUnreachableTicks 首次失败后最多再等多少 tick 就放弃（兜底，
	// 防止尝试间隔被别的状态拉长时永远凑不够次数）。
	haulUnreachableTicks = 300
	// haulUnreachableCooldownTicks 放弃后该建筑对这台机器人的冷却（tick）。
	haulUnreachableCooldownTicks = 3000
)

// haulUnreachableFailure 自动模式一次「到不了」的尝试。返回非 nil 表示已经
// 放弃这一单（含改派事件）。
func haulUnreachableFailure(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase model.HaulPhase) []*model.GameEvent {
	haul := robot.Haul
	if haul == nil || haul.Mode != model.HaulModeAuto || building == nil {
		haulWaitForRoute(robot, travelPhase)
		return nil
	}
	if haul.UnreachableAttempts == 0 {
		haul.UnreachableSinceTick = ws.Tick
	}
	haul.UnreachableAttempts++
	if haul.UnreachableAttempts < haulUnreachableAttempts && ws.Tick-haul.UnreachableSinceTick < haulUnreachableTicks {
		haulWaitForRoute(robot, travelPhase)
		return nil
	}
	return haulGiveUpUnreachable(ws, robot, building)
}

// haulWaitForRoute 外圈暂时没有落点：停下等下一次轮询重试。
func haulWaitForRoute(robot *model.Unit, travelPhase model.HaulPhase) {
	robot.Haul.Phase = haulWaitingPhaseFor(travelPhase)
	robot.ClearMovement()
	robot.Stance = model.UnitStanceIdle
}

// haulGiveUpUnreachable 放弃到不了的建筑：释放认领、清空路线、记冷却、发告警，
// 车上有货时改送别处。
func haulGiveUpUnreachable(ws *model.WorldState, robot *model.Unit, building *model.Building) []*model.GameEvent {
	haul := robot.Haul
	cargoItem := haul.Cargo.ItemID
	haulMarkUnreachable(haul, building.ID, ws.Tick)
	haul.ClearRoute()
	haul.Phase = model.HaulPhaseIdle
	haul.UnreachableAttempts = 0
	haul.UnreachableSinceTick = 0
	robot.ClearMovement()
	robot.ClearEngagement()
	robot.Stance = model.UnitStanceIdle

	reason := fmt.Sprintf("到不了%s（%d,%d），已放弃这一单", buildingDisplayName(building), building.Position.X, building.Position.Y)
	events := []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":   robot.ID,
			"entity_kind": "unit",
			"order":       "auto_haul_unreachable",
			"reason":      reason,
			"message":     fmt.Sprintf("%s：%s", unitDisplayName(robot), reason),
		},
	}}
	if alertEvent := raiseHaulUnreachableAlert(ws, robot, building); alertEvent != nil {
		events = append(events, alertEvent)
	}
	// 车上的货不能凭空消失：优先送给另一台缺同种原料的建筑，否则送回最近仓储。
	if cargoItem != "" {
		if claim := haulDeliveryFallback(ws, robot, cargoItem); claim != nil {
			haul.Claim = claim
			haul.ToBuildingID = claim.DemandBuildingID
			haul.ItemID = claim.ItemID
			haul.Phase = model.HaulPhaseToTarget
			events = append(events, haulTaskEvent(robot, "auto_haul_deliver"))
		}
	}
	return events
}

// haulMarkUnreachable 给建筑记一条本机器人的冷却。
func haulMarkUnreachable(haul *model.UnitHaulState, buildingID string, tick int64) {
	if haul == nil || buildingID == "" {
		return
	}
	if haul.UnreachableCooldowns == nil {
		haul.UnreachableCooldowns = map[string]int64{}
	}
	haul.UnreachableCooldowns[buildingID] = tick + haulUnreachableCooldownTicks
}

// haulCooldownActive 该建筑是否仍在这台机器人的冷却期内。
func haulCooldownActive(haul *model.UnitHaulState, buildingID string, tick int64) bool {
	if haul == nil || buildingID == "" {
		return false
	}
	until, ok := haul.UnreachableCooldowns[buildingID]
	return ok && tick < until
}

// pruneHaulCooldowns 清掉已过期或建筑已不存在的冷却条目（派单时调用）。
func pruneHaulCooldowns(ws *model.WorldState, haul *model.UnitHaulState) {
	if ws == nil || haul == nil || len(haul.UnreachableCooldowns) == 0 {
		return
	}
	for id, until := range haul.UnreachableCooldowns {
		if ws.Tick >= until || ws.Buildings[id] == nil {
			delete(haul.UnreachableCooldowns, id)
		}
	}
}

// haulRecordArrival 机器人到达建筑外圈：清掉失败计数、该建筑的冷却与告警。
func haulRecordArrival(robot *model.Unit, building *model.Building) {
	if robot == nil || robot.Haul == nil {
		return
	}
	haul := robot.Haul
	haul.UnreachableAttempts = 0
	haul.UnreachableSinceTick = 0
	if building != nil && haul.UnreachableCooldowns != nil {
		delete(haul.UnreachableCooldowns, building.ID)
	}
	clearHaulUnreachableAlert(building)
}

// haulRecordRoutePlanned 成功规划出一条路径：连续失败计数清零（长时间赶路
// 不会被当成「一直到不了」）。
func haulRecordRoutePlanned(robot *model.Unit) {
	if robot == nil || robot.Haul == nil {
		return
	}
	robot.Haul.UnreachableAttempts = 0
	robot.Haul.UnreachableSinceTick = 0
}

// raiseHaulUnreachableAlert 给到不了的建筑发一条 haul_unreachable 告警
// （同一建筑持续成立期间只发一次）。details 带 unit_id / building_id / position。
func raiseHaulUnreachableAlert(ws *model.WorldState, robot *model.Unit, building *model.Building) *model.GameEvent {
	if ws == nil || robot == nil || building == nil {
		return nil
	}
	if building.ProductionMonitor == nil {
		building.ProductionMonitor = model.NewProductionMonitorState()
	}
	monitor := building.ProductionMonitor
	if monitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		return nil
	}
	if monitor.ActiveAlerts == nil {
		monitor.ActiveAlerts = map[model.ProductionAlertType]bool{}
	}
	if monitor.LastAlertAt == nil {
		monitor.LastAlertAt = map[model.ProductionAlertType]int64{}
	}
	monitor.ActiveAlerts[model.AlertTypeHaulUnreachable] = true
	monitor.LastAlertAt[model.AlertTypeHaulUnreachable] = ws.Tick

	alert := &model.ProductionAlert{
		AlertID:      fmt.Sprintf("alert-%d-%s-%s", ws.Tick, building.ID, model.AlertTypeHaulUnreachable),
		Tick:         ws.Tick,
		PlayerID:     building.OwnerID,
		BuildingID:   building.ID,
		BuildingType: building.Type,
		AlertType:    model.AlertTypeHaulUnreachable,
		Severity:     model.AlertSeverityWarning,
		Message:      model.AlertMessage(model.AlertTypeHaulUnreachable, building.ID),
		Metrics:      monitor.LastStats,
		Details: map[string]any{
			"unit_id":     robot.ID,
			"building_id": building.ID,
			"position":    building.Position,
		},
	}
	return &model.GameEvent{
		EventType:       model.EvtProductionAlert,
		VisibilityScope: building.OwnerID,
		Payload:         map[string]any{"alert": alert},
	}
}

// clearHaulUnreachableAlert 机器人重新到达该建筑：解除告警的持续状态。
func clearHaulUnreachableAlert(building *model.Building) {
	if building == nil || building.ProductionMonitor == nil {
		return
	}
	if !building.ProductionMonitor.ActiveAlerts[model.AlertTypeHaulUnreachable] {
		return
	}
	building.ProductionMonitor.Alert(model.AlertTypeHaulUnreachable, false, 0, 0)
}
