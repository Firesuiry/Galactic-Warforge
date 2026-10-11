package gamecore

import "siliconworld/internal/model"

const (
	stateReasonStart       = "start"
	stateReasonStop        = "stop"
	stateReasonPause       = "pause"
	stateReasonResume      = "resume"
	stateReasonUnderPower  = "under_power"
	stateReasonPowerReturn = "power_restored"
	stateReasonNoFuel      = "no_fuel"
	stateReasonFault       = "fault"
	stateReasonFaultClear  = "fault_cleared"
	stateReasonStateChange = "state_change"
	// stateReasonOutputBlocked：建筑在 running 但产出无处可放（输出缓冲 + 产出预留 +
	// 输入缓冲全满）。state 保持 running（生产周期本身正常），靠 reason 让 UI 显示
	// 「产物阻塞」而不是「运行中」（试玩 1014 层 04 P1）。
	stateReasonOutputBlocked = "output_blocked"
)

func applyBuildingState(building *model.Building, next model.BuildingWorkState, reason string) *model.GameEvent {
	if building == nil {
		return nil
	}
	prev := building.Runtime.State
	prevReason := building.Runtime.StateReason
	if reason == "" {
		reason = deriveBuildingStateReason(prev, next)
	}
	nextReason := reason
	if next == model.BuildingWorkRunning || next == model.BuildingWorkIdle {
		nextReason = ""
	}
	stateChanged := prev != next
	reasonChanged := prevReason != nextReason
	if !stateChanged && !reasonChanged {
		return nil
	}
	building.Runtime.State = next
	building.Runtime.StateReason = nextReason
	return &model.GameEvent{
		EventType:       model.EvtBuildingStateChanged,
		VisibilityScope: building.OwnerID,
		Payload: map[string]any{
			"building_id":   building.ID,
			"building_type": building.Type,
			"prev_state":    prev,
			"next_state":    next,
			"prev_reason":   prevReason,
			"reason":        reason,
		},
	}
}

// setBuildingStateReason 在 state 不变的前提下改写 state_reason（如 running + output_blocked）。
// applyBuildingState 对 running/idle 会强制清空 reason，所以运行态的原因只能走这里。
// reason 变化才发事件，连续 tick 重复写不会刷屏。
func setBuildingStateReason(building *model.Building, reason string) *model.GameEvent {
	if building == nil || building.Runtime.StateReason == reason {
		return nil
	}
	prev := building.Runtime.StateReason
	building.Runtime.StateReason = reason
	return &model.GameEvent{
		EventType:       model.EvtBuildingStateChanged,
		VisibilityScope: building.OwnerID,
		Payload: map[string]any{
			"building_id":   building.ID,
			"building_type": building.Type,
			"prev_state":    building.Runtime.State,
			"next_state":    building.Runtime.State,
			"prev_reason":   prev,
			"reason":        reason,
		},
	}
}

func deriveBuildingStateReason(prev, next model.BuildingWorkState) string {
	switch {
	case next == model.BuildingWorkNoPower:
		return stateReasonUnderPower
	case next == model.BuildingWorkError:
		return stateReasonFault
	case prev == model.BuildingWorkNoPower && next == model.BuildingWorkRunning:
		return stateReasonPowerReturn
	case prev == model.BuildingWorkError && next == model.BuildingWorkRunning:
		return stateReasonFaultClear
	case prev == model.BuildingWorkPaused && next == model.BuildingWorkRunning:
		return stateReasonResume
	case prev == model.BuildingWorkRunning && next == model.BuildingWorkPaused:
		return stateReasonPause
	case prev == model.BuildingWorkRunning && next == model.BuildingWorkIdle:
		return stateReasonStop
	case prev != model.BuildingWorkRunning && next == model.BuildingWorkRunning:
		return stateReasonStart
	default:
		return stateReasonStateChange
	}
}
