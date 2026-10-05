package gamecore

import "siliconworld/internal/model"

type configureMechaLogisticsPayload struct {
	Requests map[string]mechaLogisticsRequestPayload `json:"requests" payload:"required"`
}

type mechaLogisticsRequestPayload struct {
	Min *int `json:"min" payload:"required"`
	Max *int `json:"max" payload:"required"`
}

func (gc *GameCore) execConfigureMechaLogistics(ws *model.WorldState, playerID string, cmd model.Command, p configureMechaLogisticsPayload) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	fail := func(message string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, message)
	}
	if len(p.Requests) > 8 {
		return fail("requests must be an object with at most 8 item slots")
	}
	requests := make(map[string]model.MechaLogisticsRequest, len(p.Requests))
	for itemID, entry := range p.Requests {
		if item, ok := model.Item(itemID); !ok || item.Form != model.ResourceSolid {
			return fail("unknown logistics request item: " + itemID)
		}
		minimum, maximum := *entry.Min, *entry.Max
		if minimum < 0 || maximum < 1 || maximum > 1000 || minimum > maximum {
			return fail("request bounds require 0 <= min <= max <= 1000 and positive max")
		}
		requests[itemID] = model.MechaLogisticsRequest{Min: minimum, Max: maximum}
	}
	unit.Mecha.LogisticsRequests = requests
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "mecha logistics requests replaced"}, []*model.GameEvent{mechaStateEvent(unit)}
}
