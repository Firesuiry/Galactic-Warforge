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
