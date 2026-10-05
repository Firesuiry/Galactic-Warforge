package gamecore

import (
	"siliconworld/internal/model"
)

type configureSplitterPayload struct {
	InputDirections  []model.ConveyorDirection          `json:"input_directions" payload:"required"`
	OutputDirections []model.ConveyorDirection          `json:"output_directions" payload:"required"`
	InputPriority    model.ConveyorDirection            `json:"input_priority"`
	OutputPriority   model.ConveyorDirection            `json:"output_priority"`
	OutputFilters    map[model.ConveyorDirection]string `json:"output_filters"`
}

func (gc *GameCore) execConfigureSplitter(ws *model.WorldState, playerID string, cmd model.Command, p configureSplitterPayload) (model.CommandResult, []*model.GameEvent) {
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
	staged := &model.SplitterState{
		InputDirections:  p.InputDirections,
		OutputDirections: p.OutputDirections,
		InputPriority:    p.InputPriority,
		OutputPriority:   p.OutputPriority,
		OutputFilters:    p.OutputFilters,
		TransferredItems: building.Splitter.TransferredItems,
		LastTransferTick: building.Splitter.LastTransferTick,
	}
	if err := staged.Validate(); err != nil {
		return fail(model.CodeValidationFailed, err.Error())
	}
	building.Splitter = staged
	event := &model.GameEvent{EventType: model.EvtBuildingStateChanged, VisibilityScope: playerID, Payload: map[string]any{"entity_id": building.ID, "splitter": staged.Clone()}}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "splitter ports configured"}, []*model.GameEvent{event}
}
