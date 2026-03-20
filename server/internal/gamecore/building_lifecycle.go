package gamecore

import "siliconworld/internal/model"

const (
	stateReasonStart       = "start"
	stateReasonStop        = "stop"
	stateReasonPause       = "pause"
	stateReasonResume      = "resume"
	stateReasonUnderPower  = "under_power"
	stateReasonPowerReturn = "power_restored"
	stateReasonFault       = "fault"
	stateReasonFaultClear  = "fault_cleared"
	stateReasonStateChange = "state_change"
)

func applyBuildingState(building *model.Building, next model.BuildingWorkState, reason string) *model.GameEvent {
	if building == nil {
		return nil
	}
	prev := building.Runtime.State
	if prev == next {
		return nil
	}
	building.Runtime.State = next
	if reason == "" {
		reason = deriveBuildingStateReason(prev, next)
	}
	return &model.GameEvent{
		EventType:       model.EvtBuildingStateChanged,
		VisibilityScope: building.OwnerID,
		Payload: map[string]any{
			"building_id":   building.ID,
			"building_type": building.Type,
			"prev_state":    prev,
			"next_state":    next,
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
