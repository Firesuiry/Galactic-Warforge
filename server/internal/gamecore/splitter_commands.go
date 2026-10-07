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
		return fail(model.CodeEntityNotFound, "未找到分流器")
	}
	if building.OwnerID != playerID {
		return fail(model.CodeNotOwner, "不能配置其他玩家的分流器")
	}
	if building.Type != model.BuildingTypeSplitter || building.Splitter == nil {
		return fail(model.CodeInvalidTarget, "目标不是已初始化的分流器")
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
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "分流器端口已配置"}, []*model.GameEvent{event}
}
