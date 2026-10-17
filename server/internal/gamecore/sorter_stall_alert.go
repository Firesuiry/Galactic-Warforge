package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// 分拣器停工告警（sorter_stalled）。
//
// 为什么要有：自动运输机器人会跳过「已有分拣器喂料」的建筑（haulSorterFedBuildings），
// 因为 DSP 式布局里这些机器本来就该由分拣器供料。但分拣器断电、被暂停、取不到货
// （带子空 / 过滤全挡）或放货端收不下时，被喂料的机器会**静默断料**——机器人不会
// 来救，玩家在告警条里也看不到任何东西。这条告警把「分拣器停了」这件事暴露出来，
// 指向分拣器本身，details 里写目标建筑与原因。
//
// 口径（与 belt_blocked 同节奏）：
//   - 只统计「本应搬运却连续没搬成」的分拣器，连续 sorterStallWarnTicks 后报警；
//   - 理由只报根因，按优先级取：no_power > not_running > drop_blocked > pick_empty；
//   - 选路与 settleSorters 共用 sorterBestRoute（最短的取货端 × 放货端），
//     保证 reason/target 对应实际尝试搬运的那条路线（range>1 的 mk2/mk3）；
//   - 防噪音：pick_empty 只在放货端的生产建筑**确实断料**（input_shortage）时才报；
//     drop_blocked 只在取货端**确实有货**时才报（取货端空着是 pick_empty，不是堵塞）；
//   - 恢复搬运（成功转移一件）即解除。
//
// 计数存在分拣器自己的 SorterState.Stall 里（SorterStallState.StalledTicks，
// 随快照落盘，读档后继续累计），不复用 ProductionMonitor 的 Samples/IdleSamples
// ——那两个字段归产线监控采样，两边各写各的会互相干扰。

const (
	// sorterStallWarnTicks 分拣器连续多少 tick 没搬成后报警。与 belt_blocked 同为
	// 300 tick（10 tps 下 30 秒），只用来滤掉换配方/开机瞬间的正常停顿。
	sorterStallWarnTicks = 300

	// 停工原因（写入 details.reason，客户端据此给中文说明）。
	//
	// 分拣器本身不耗电（buildings.yaml 里没有 energy 模块），正常运行时分拣器
	// 不会被置为 no_power；保留这条分支只为兼容旧存档/未来给分拣器加耗电。
	sorterStallReasonNoPower     = "no_power"
	sorterStallReasonNotRunning  = "not_running"
	sorterStallReasonPickEmpty   = "pick_empty"
	sorterStallReasonDropBlocked = "drop_blocked"
)

// sorterStallSample 一台分拣器本 tick 的停工判定结果。
type sorterStallSample struct {
	// eligible 表示这台分拣器「应该搬」：已配置、有两个端点。端点缺失的分拣器
	// 多半是刚放下还没接好，不算停工。
	eligible bool
	// due 表示本 tick 到了可以出发的时间点（往返周期已到）。没到点是在正常
	// 等下一趟，不累加停工时长。
	due bool
	// reason 非空表示本 tick 停工，值是根因枚举。
	reason string
	// targetID 是放货端落到的建筑（可能为空）。
	targetID string
}

// sorterStallSampleFor 判定一台分拣器本 tick 是否停工。
//
// 与 settleSorters 同一口径（取/放端点、过滤、放货端是否收得下），但只做判定，
// 不改世界状态。
func sorterStallSampleFor(ws *model.WorldState, sorter *model.Building) sorterStallSample {
	if ws == nil || sorter == nil || sorter.Sorter == nil {
		return sorterStallSample{}
	}
	state := sorter.Sorter
	// 断电 / 暂停 / 故障：分拣器本来就不搬，但被它喂料的机器会断料——这正是
	// 玩家需要知道的根因（自动机器人不会来救）。
	switch sorter.Runtime.State {
	case model.BuildingWorkNoPower:
		return sorterStallSample{eligible: true, due: true, reason: sorterStallReasonNoPower, targetID: sorterPrimaryTargetID(ws, sorter)}
	case model.BuildingWorkPaused, model.BuildingWorkError:
		return sorterStallSample{eligible: true, due: true, reason: sorterStallReasonNotRunning, targetID: sorterPrimaryTargetID(ws, sorter)}
	}
	if state.CycleTicks <= 0 || state.Range <= 0 {
		return sorterStallSample{}
	}
	outputs := sorterOutputEndpoints(ws, sorter, state)
	if len(outputs) == 0 {
		return sorterStallSample{}
	}
	inputs := sorterInputEndpoints(ws, sorter, state)
	if len(inputs) == 0 {
		return sorterStallSample{}
	}
	// 与 settleSorters 同一选路：一次往返只走「距离和最短」的那一对端点。
	in, out, ok := sorterBestRoute(ws, inputs, outputs)
	if !ok {
		return sorterStallSample{}
	}
	sample := sorterStallSample{eligible: true, targetID: out.id}
	// 还没到下一趟的时间点：不算停工（往返周期本来就是等）。
	if state.NextTripTick > ws.Tick {
		return sample
	}
	sample.due = true

	target := ws.Buildings[out.id]
	source := ws.Buildings[in.id]
	if target == nil || source == nil {
		return sample
	}
	// 放货端收不下：取货端确实有货才算「堵」，否则根因是取不到货。
	if !sorterTargetCanAccept(ws, sorter, source, target, out, in) {
		if sorterSourceHasCargo(source, in.port, state) {
			sample.reason = sorterStallReasonDropBlocked
		} else {
			sample.reason = sorterStallReasonPickEmpty
		}
		return sample
	}
	// 放货端收得下：取货端有没有本分拣器认的货？
	if !sorterSourceHasCargo(source, in.port, state) {
		sample.reason = sorterStallReasonPickEmpty
	}
	return sample
}

// sorterPrimaryTargetID 分拣器放货端落到的建筑 ID（用于断电/暂停时的 details）。
func sorterPrimaryTargetID(ws *model.WorldState, sorter *model.Building) string {
	if ws == nil || sorter == nil || sorter.Sorter == nil {
		return ""
	}
	for _, link := range sorterOutputEndpoints(ws, sorter, sorter.Sorter) {
		if target := ws.Buildings[link.id]; target != nil && target.Conveyor == nil {
			return link.id
		}
	}
	return ""
}

// sorterTargetCanAccept 放货端是否至少能收下取货端的一件货（与 sorterGrabOnce 同口径）。
func sorterTargetCanAccept(ws *model.WorldState, sorter, source, target *model.Building, out, in sorterLink) bool {
	if source == nil || target == nil {
		return false
	}
	if target.Conveyor != nil {
		return conveyorInsertCapacity(ws, target) > 0
	}
	// 建筑：只有过滤允许、来源端口放行的物品才谈得上「放得下」。
	if source.Conveyor != nil {
		for _, stack := range source.Conveyor.Buffer {
			if stack.Quantity <= 0 || !sorter.Sorter.Filter.Allows(stack.ItemID) {
				continue
			}
			if accepted, _, err := model.StoragePortPreviewInput(target, out.port, stack.ItemID, 1); err == nil && accepted > 0 {
				return true
			}
		}
		return false
	}
	itemID := sorterPickStorageItem(source, in.port, sorter.Sorter)
	if itemID == "" {
		return false
	}
	accepted, _, err := model.StoragePortPreviewInput(target, out.port, itemID, 1)
	return err == nil && accepted > 0
}

// sorterSourceHasCargo 取货端是否有「本分拣器认的」货（不看放货端收不收得下）。
func sorterSourceHasCargo(source *model.Building, sourcePort string, state *model.SorterState) bool {
	if source == nil || state == nil {
		return false
	}
	if source.Conveyor != nil {
		for _, stack := range source.Conveyor.Buffer {
			if stack.Quantity > 0 && state.Filter.Allows(stack.ItemID) {
				return true
			}
		}
		return false
	}
	return sorterPickStorageItem(source, sourcePort, state) != ""
}

// settleSorterStallAlerts 每 tick 统计全部分拣器的停工时长，越过阈值发
// sorter_stalled 告警，恢复搬运后解除。返回新告警事件与本 tick 解除的告警。
//
// 顺序按分拣器 ID 排序，保证确定性。已配置但端点不全的分拣器不计数（多半是
// 刚放下还没接好），但会清掉旧计数，避免拆掉下游后残留一条永远不解除的告警。
func settleSorterStallAlerts(ws *model.WorldState) ([]*model.GameEvent, []alertResolution) {
	if ws == nil {
		return nil, nil
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if building != nil && building.Sorter != nil {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	sort.Strings(ids)

	var events []*model.GameEvent
	var resolved []alertResolution
	for _, id := range ids {
		sorter := ws.Buildings[id]
		if sorter == nil || sorter.Sorter == nil || sorter.HP <= 0 {
			continue
		}
		if sorter.ProductionMonitor == nil {
			sorter.ProductionMonitor = model.NewProductionMonitorState()
		}
		monitor := sorter.ProductionMonitor
		sample := sorterStallSampleFor(ws, sorter)

		// 本 tick 搬成了（在 settleSorters 之后判定，LastTransfer 是本 tick 的）/
		// 不该搬 / 只是等下一趟：计数归零；此前成立的告警解除。
		moved := sorter.Sorter.LastTransfer != nil && sorter.Sorter.LastTransfer.Tick == ws.Tick
		if !sample.eligible || moved || !sample.due || sample.reason == "" {
			sorter.Sorter.Stall.StalledTicks = 0
			if _, cleared := monitorAlert(monitor, model.AlertTypeSorterStalled, false, ws.Tick, 0); cleared {
				resolved = append(resolved, alertResolution{
					playerID: sorter.OwnerID, planetID: ws.PlanetID,
					buildingID: sorter.ID, alertType: model.AlertTypeSorterStalled, tick: ws.Tick,
				})
			}
			continue
		}
		if sample.reason == sorterStallReasonPickEmpty && !sorterStallTargetStarved(ws.Buildings[sample.targetID]) {
			// 目标机器并不缺料（只是暂时等下一批原料）：取不到货是正常节奏，不报警。
			// 计数仍继续累加——目标一旦断料就按已停工的时长立刻报出来。
			sorter.Sorter.Stall.StalledTicks++
			continue
		}
		sorter.Sorter.Stall.StalledTicks++
		if sorter.Sorter.Stall.StalledTicks < sorterStallWarnTicks {
			continue
		}
		sorter.Sorter.Stall.StalledTicks = 0
		if fired, _ := monitorAlert(monitor, model.AlertTypeSorterStalled, true, ws.Tick, sorterStallWarnTicks); !fired {
			continue
		}
		details := map[string]any{
			"position": sorter.Position,
			"reason":   sample.reason,
		}
		if sample.targetID != "" {
			details["building_id"] = sample.targetID
			if target := ws.Buildings[sample.targetID]; target != nil {
				details["target_type"] = string(target.Type)
				details["target_position"] = target.Position
			}
		}
		alert := &model.ProductionAlert{
			AlertID:      fmt.Sprintf("alert-%d-%s-%s", ws.Tick, sorter.ID, model.AlertTypeSorterStalled),
			Tick:         ws.Tick,
			Active:       true,
			PlayerID:     sorter.OwnerID,
			PlanetID:     ws.PlanetID,
			BuildingID:   sorter.ID,
			BuildingType: sorter.Type,
			AlertType:    model.AlertTypeSorterStalled,
			Severity:     model.AlertSeverityWarning,
			Message:      model.AlertMessage(model.AlertTypeSorterStalled, sorter.ID),
			Metrics:      monitor.LastStats,
			Details:      details,
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtProductionAlert,
			VisibilityScope: sorter.OwnerID,
			Payload:         map[string]any{"alert": alert},
		})
	}
	return events, resolved
}

// sorterStallTargetStarved 被喂料的建筑是否确实因缺料停工（判据同
// haulBuildingStarved：有配方、running、进度停在 0、原料凑不齐）。
func sorterStallTargetStarved(target *model.Building) bool {
	return haulBuildingStarved(target)
}
