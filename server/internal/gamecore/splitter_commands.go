package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func (gc *GameCore) execConfigureSplitter(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	fail := func(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
	}
	building := ws.Buildings[cmd.Target.EntityID]
	if building == nil {
		return fail(model.CodeEntityNotFound, "splitter not found")
	}
	if building.OwnerID != playerID {
		return fail(model.CodeNotOwner, "cannot configure another player's splitter")
	}
	if building.Type != model.BuildingTypeSplitter || building.Splitter == nil {
		return fail(model.CodeInvalidTarget, "target is not an initialized splitter")
	}
	staged := &model.SplitterState{TransferredItems: building.Splitter.TransferredItems, LastTransferTick: building.Splitter.LastTransferTick}
	for key, destination := range map[string]*[]model.ConveyorDirection{"input_directions": &staged.InputDirections, "output_directions": &staged.OutputDirections} {
		values, err := payloadStringSlice(cmd.Payload, key)
		if err != nil {
			return fail(model.CodeValidationFailed, err.Error())
		}
		for _, value := range values {
			*destination = append(*destination, model.ConveyorDirection(value))
		}
	}
	for key, destination := range map[string]*model.ConveyorDirection{"input_priority": &staged.InputPriority, "output_priority": &staged.OutputPriority} {
		if raw, exists := cmd.Payload[key]; exists {
			value, ok := raw.(string)
			if !ok {
				return fail(model.CodeValidationFailed, fmt.Sprintf("payload.%s must be a direction string", key))
			}
			*destination = model.ConveyorDirection(value)
		}
	}
	if raw, exists := cmd.Payload["output_filters"]; exists {
		staged.OutputFilters = make(map[model.ConveyorDirection]string)
		switch filters := raw.(type) {
		case map[string]any:
			for direction, value := range filters {
				item, ok := value.(string)
				if !ok {
					return fail(model.CodeValidationFailed, "output filter item must be a string")
				}
				staged.OutputFilters[model.ConveyorDirection(direction)] = item
			}
		case map[string]string:
			for direction, item := range filters {
				staged.OutputFilters[model.ConveyorDirection(direction)] = item
			}
		default:
			return fail(model.CodeValidationFailed, "payload.output_filters must be an object")
		}
	}
	if err := staged.Validate(); err != nil {
		return fail(model.CodeValidationFailed, err.Error())
	}
	building.Splitter = staged
	event := &model.GameEvent{EventType: model.EvtBuildingStateChanged, VisibilityScope: playerID, Payload: map[string]any{"entity_id": building.ID, "splitter": staged.Clone()}}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "splitter ports configured"}, []*model.GameEvent{event}
}
